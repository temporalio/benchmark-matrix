import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";

let config = new pulumi.Config();

const historyPodCount = (shardCount: number) => shardCount / 512
const matchingPodCount = (partitions: number) => partitions

interface TemporalConfig {
    HistoryShards: number;
    TaskQueuePartitions: number;
    WorkerCount: number;
    WorkerWorkflowPollers: number;
    WorkerActivityPollers: number;
    DynamicConfig: string;
}

interface Cluster {
    name: pulumi.Output<string>;
    kubeconfig: pulumi.Output<any>;
    provider: k8s.Provider;
    securityGroup: pulumi.Output<string>;
}

interface EKSClusterConfig {
    EnvironmentStackName: string;
    NodeType: string;
    NodeCount: number;
}

interface ClusterConfig {
    EKS: EKSClusterConfig | undefined;
}

interface PersistenceConfig {
    RDS: RDSPersistenceConfig | undefined;
}

interface RDSPersistenceConfig {
    EnvironmentStackName: string;
    Engine: string;
    EngineVersion: string;
    ParameterGroup: string;
    InstanceType: string;
}

interface Persistence {
    type: string;
    port: number;
    prefix: string;
    address: pulumi.Output<string>;
}

function createCluster(clusterConfig: ClusterConfig): Cluster {
    if (clusterConfig.EKS != undefined) {
        return eksCluster(pulumi.getStack(), clusterConfig.EKS)
    }

    throw("invalid cluster config")
}

function eksCluster(name: string, config: EKSClusterConfig): Cluster {
    const envStack = new pulumi.StackReference('eksEnvironment' + config.EnvironmentStackName, { name: config.EnvironmentStackName });
    
    const cluster = new eks.Cluster(name, {
        vpcId: envStack.getOutput("VpcId"),
        publicSubnetIds: envStack.getOutput("PublicSubnetIds"),
        privateSubnetIds: envStack.getOutput("PrivateSubnetIds"),
        nodeAssociatePublicIpAddress: false,
        instanceType: config.NodeType,
        desiredCapacity: config.NodeCount,
        minSize: config.NodeCount,
        maxSize: config.NodeCount
    });
    
    return {
        name: cluster.eksCluster.name,
        kubeconfig: cluster.kubeconfig,
        provider: cluster.provider,
        securityGroup: cluster.nodeSecurityGroup.id,
    }
}

function createPersistence(config: PersistenceConfig, securityGroup: pulumi.Output<string>): Persistence {
    if (config.RDS != undefined) {
        return rdsPersistence(pulumi.getStack(), config.RDS, securityGroup)
    }

    throw("invalid persistence config")
}

function rdsPersistence(name: string, config: RDSPersistenceConfig, securityGroup: pulumi.Output<string>): Persistence {
    const envStack = new pulumi.StackReference('rdsEnvironment', { name: config.EnvironmentStackName });

    let dbType: string;
    let dbPort: number;
    let dbPrefix: string;

    if (config.Engine == "postgres") {
        dbPrefix = "POSTGRES";
        dbType = "postgresql";
        dbPort = 5432;
    } else {
        throw("invalid RDS config");
    }

    const rdsSecurityGroup = new aws.ec2.SecurityGroup(name + "-rds", {
        vpcId: envStack.getOutput("VpcId"),
    });
    
    new aws.ec2.SecurityGroupRule(name + "-rds", {
        securityGroupId: rdsSecurityGroup.id,
        type: 'ingress',
        sourceSecurityGroupId: securityGroup,
        protocol: "tcp",
        fromPort: dbPort,
        toPort: dbPort,
    });

    const rdsInstance = new aws.rds.Instance(name, {
        availabilityZone: envStack.requireOutput('AvailabilityZones').apply(zones => zones[0]),
        dbSubnetGroupName: envStack.requireOutput('RdsSubnetGroupName'),
        vpcSecurityGroupIds: [rdsSecurityGroup.id],
        identifierPrefix: name,
        allocatedStorage: 100,
        engine: config.Engine,
        engineVersion: config.EngineVersion,
        instanceClass: config.InstanceType,
        parameterGroupName: config.ParameterGroup,
        skipFinalSnapshot: true,
        username: "temporal",
        password: "temporal",
    });
    
    return {
        type: dbType,
        port: dbPort,
        prefix: dbPrefix,
        address: rdsInstance.address
    }
}

const temporalConfig = config.requireObject<TemporalConfig>('Temporal');

const clusterConfig = config.requireObject<ClusterConfig>('Cluster')
const cluster = createCluster(clusterConfig);

const persistenceConfig = config.requireObject<PersistenceConfig>('Persistence');
const persistence = createPersistence(persistenceConfig, cluster.securityGroup)

const temporalEnv = new k8s.core.v1.ConfigMap("temporal-env",
    {
        metadata: { name: "temporal-env" },
        data: {
            "DB": persistence.type,
            "DB_PORT": persistence.port.toString(),
            "SQL_MAX_CONNS": "40",
            [`${persistence.prefix}_SEEDS`]: persistence.address,
            [`${persistence.prefix}_USER`]: "temporal",
            [`${persistence.prefix}_PWD`]: "temporal",
            "DBNAME": "temporal_persistence",
            "VISIBILITY_DBNAME": "temporal_visibility",
            "MYSQL_TX_ISOLATION_COMPAT": "true",
            "NUM_HISTORY_SHARDS": temporalConfig.HistoryShards.toString(),
        }
    },
    { provider: cluster.provider }
)

const temporalDynamicConfig = new k8s.core.v1.ConfigMap("temporal-dynamic-config",
    {
        metadata: { name: "temporal-dynamic-config" },
        data: {
            "dynamic_config.yaml": temporalConfig.DynamicConfig
        }
    },
    { provider: cluster.provider }
)

const workerConfig = new k8s.core.v1.ConfigMap("benchmark-worker-env",
    {
        metadata: { name: "benchmark-worker-env" },
        data: {
            "TEMPORAL_WORKFLOW_TASK_POLLERS": temporalConfig.WorkerWorkflowPollers.toString(),
			"TEMPORAL_ACTIVITY_TASK_POLLERS": temporalConfig.WorkerActivityPollers.toString(),
        }
    },
    { provider: cluster.provider }
)

const temporalAutoSetup = new k8s.batch.v1.Job("temporal-autosetup",
    {
        metadata: {
            name: "temporal-autosetup"
        },
        spec: {
            backoffLimit: 3,
            template: {
                spec: {
                    containers: [
                        {
                            name: "autosetup",
                            image: "temporalio/auto-setup:1.18.1",
                            imagePullPolicy: "IfNotPresent",
                            command: ["/etc/temporal/auto-setup.sh"],
                            envFrom: [
                                {
                                    configMapRef: { name: temporalEnv.metadata.name }
                                }
                            ]
                        }
                    ],
                    restartPolicy: "Never"
                }
            }
        }
    },
    {
        dependsOn: [temporalEnv],
        provider: cluster.provider
    }
)

const scaleDeployment = (name: string, replicas: number) => {
    return (obj: any, opts: pulumi.CustomResourceOptions) => {
        if (obj.kind === "Deployment" && obj.metadata.name === name) {
            obj.spec.replicas = replicas
        }
    }
}

new k8s.kustomize.Directory("monitoring",
    { directory: "../k8s/monitoring" },
    { provider: cluster.provider }
);

new k8s.kustomize.Directory("temporal",
    {
        directory: "../k8s/temporal",
        transformations: [
            scaleDeployment("temporal-history", historyPodCount(temporalConfig.HistoryShards)),
            scaleDeployment("temporal-matching", matchingPodCount(temporalConfig.TaskQueuePartitions))
        ]
    },
    {
        dependsOn: [temporalEnv, temporalDynamicConfig, temporalAutoSetup],
        provider: cluster.provider
    }
);

new k8s.kustomize.Directory("benchmark-workers",
    {
        directory: "../k8s/benchmark-workers",
        transformations: [
            scaleDeployment("benchmark-workers", temporalConfig.WorkerCount)
        ]
    },
    {
        dependsOn: [workerConfig],
        provider: cluster.provider
    }
);

export const clusterName = cluster.name;
export const kubeconfig = cluster.kubeconfig;