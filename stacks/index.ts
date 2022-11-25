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
    Cassandra: CassandraPersistenceConfig | undefined;
}

interface RDSPersistenceConfig {
    EnvironmentStackName: string;
    Engine: string;
    EngineVersion: string;
    InstanceType: string;
}

interface CassandraPersistenceConfig {
    NodeType: string;
    NodeCount: number;
};

interface Persistence {
    Config: pulumi.Input<{
        [key: string]: pulumi.Input<string>;
    }>
}

function describeCluster(clusterConfig: ClusterConfig, persistenceConfig: PersistenceConfig): string {
    let summary = "";

    summary += "Cluster:\n";

    if (clusterConfig.EKS) {
        summary += "  Platform: EKS\n";
        summary += `  Nodes: ${clusterConfig.EKS.NodeCount} x ${clusterConfig.EKS.NodeType}\n`;
    } else {
        summary += "  Unknown cluster type\n";
    }

    summary += "Persistence:\n";

    if (persistenceConfig.RDS) {
        summary += `  Engine: ${persistenceConfig.RDS.Engine}\n`;
        summary += `  Instance: ${persistenceConfig.RDS.InstanceType}\n`;
    } else if (persistenceConfig.Cassandra) {
        summary += `  Engine: Cassandra\n`;
        summary += `  Instance: ${persistenceConfig.Cassandra.NodeCount} x ${persistenceConfig.Cassandra.NodeType}\n`;
    } else {
        summary += "  Unknown persistence system\n";
    }

    summary += "Temporal:\n";
    summary += `  History Shards: ${temporalConfig.HistoryShards}\n`;
    summary += `  Matching: ${matchingPodCount(temporalConfig.TaskQueuePartitions)} pods\n`;
    summary += `  History: ${historyPodCount(temporalConfig.HistoryShards)} pods\n`;
    summary += `  Task queue partitions: ${temporalConfig.TaskQueuePartitions}\n`;
    summary += "Benchmark Workers:\n";
    summary += `  Pods: ${temporalConfig.WorkerCount}\n`;
    summary += `  Workflow Pollers: ${temporalConfig.WorkerWorkflowPollers}\n`;
    summary += `  Activity Pollers: ${temporalConfig.WorkerActivityPollers}\n`;

    return summary;
}

function createCluster(clusterConfig: ClusterConfig, persistenceConfig: PersistenceConfig): Cluster {
    if (clusterConfig.EKS != undefined) {
        return eksCluster(pulumi.getStack(), clusterConfig.EKS, persistenceConfig)
    }

    throw("invalid cluster config")
}

function eksCluster(name: string, config: EKSClusterConfig, persistenceConfig: PersistenceConfig): Cluster {
    const envStack = new pulumi.StackReference('eksEnvironment' + config.EnvironmentStackName, { name: config.EnvironmentStackName });
    
    const cluster = new eks.Cluster(name, {
        vpcId: envStack.getOutput("VpcId"),
        publicSubnetIds: envStack.getOutput("PublicSubnetIds"),
        privateSubnetIds: envStack.getOutput("PrivateSubnetIds"),
        nodeAssociatePublicIpAddress: false,
        desiredCapacity: 3,
        minSize: 3,
        maxSize: 3,
    });

    cluster.createNodeGroup(name + '-temporal', {
        instanceType: config.NodeType,
        desiredCapacity: config.NodeCount,
        minSize: config.NodeCount,
        maxSize: config.NodeCount,
        labels: {
            dedicated: "temporal",
        },
        taints: {
            "dedicated": { value: "temporal", effect: "NoSchedule" }
        }
    })

    if (persistenceConfig.Cassandra) {
        const cassandraConfig = persistenceConfig.Cassandra;

        cluster.createNodeGroup(name + '-cassandra', {
            instanceType: cassandraConfig.NodeType,
            desiredCapacity: cassandraConfig.NodeCount,
            minSize: cassandraConfig.NodeCount,
            maxSize: cassandraConfig.NodeCount,
            labels: {
                dedicated: "cassandra",
            },
            taints: {
                "dedicated": { value: "cassandra", effect: "NoSchedule" }
            }
        })
    }

    return {
        name: cluster.eksCluster.name,
        kubeconfig: cluster.kubeconfig,
        provider: cluster.provider,
        securityGroup: cluster.nodeSecurityGroup.id,
    }
}

function createPersistence(config: PersistenceConfig, cluster: Cluster): Persistence {
    if (config.RDS != undefined) {
        return rdsPersistence(pulumi.getStack(), config.RDS, cluster.securityGroup)
    } else if (config.Cassandra != undefined) {
        return cassandraPersistence(pulumi.getStack(), config.Cassandra, cluster)
    }

    throw("invalid persistence config")
}

function rdsPersistence(name: string, config: RDSPersistenceConfig, securityGroup: pulumi.Output<string>): Persistence {
    const envStack = new pulumi.StackReference('rdsEnvironment', { name: config.EnvironmentStackName });

    let dbType: string;
    let dbPort: number;
    let dbPrefix: string;

    if (config.Engine == "postgres" || config.Engine == "aurora-postgresql") {
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

    if (config.Engine == "aurora-postgresql") {
        const rdsCluster = new aws.rds.Cluster(name, {
            availabilityZones: envStack.requireOutput('AvailabilityZones'),
            dbSubnetGroupName: envStack.requireOutput('RdsSubnetGroupName'),
            vpcSecurityGroupIds: [rdsSecurityGroup.id],
            clusterIdentifierPrefix: name,
            engine: config.Engine,
            engineVersion: config.EngineVersion,
            skipFinalSnapshot: true,
            masterUsername: "temporal",
            masterPassword: "temporal",
        });

        new aws.rds.ClusterInstance(name, {
            identifierPrefix: name,
            clusterIdentifier: rdsCluster.id,
            engine: config.Engine,
            engineVersion: config.EngineVersion,
            instanceClass: config.InstanceType,
        })

        return {
            Config: {
                "DB": dbType,
                "DB_PORT": dbPort.toString(),
                "SQL_MAX_CONNS": "40",
                "POSTGRES_SEEDS": rdsCluster.endpoint,
                "POSTGRES_USER": "temporal",
                "POSTGRES_PWD": "temporal",
                "DBNAME": "temporal_persistence",
                "VISIBILITY_DBNAME": "temporal_visibility",
                "NUM_HISTORY_SHARDS": temporalConfig.HistoryShards.toString(),    
            }
        }    
    } else {
        const rdsInstance = new aws.rds.Instance(name, {
            availabilityZone: envStack.requireOutput('AvailabilityZones').apply(zones => zones[0]),
            dbSubnetGroupName: envStack.requireOutput('RdsSubnetGroupName'),
            vpcSecurityGroupIds: [rdsSecurityGroup.id],
            identifierPrefix: name,
            allocatedStorage: 100,
            engine: config.Engine,
            engineVersion: config.EngineVersion,
            instanceClass: config.InstanceType,
            skipFinalSnapshot: true,
            username: "temporal",
            password: "temporal",
        });
        
        return {
            Config: {
                "DB": dbType,
                "DB_PORT": dbPort.toString(),
                "SQL_MAX_CONNS": "40",
                "POSTGRES_SEEDS": rdsInstance.address,
                "POSTGRES_USER": "temporal",
                "POSTGRES_PWD": "temporal",
                "DBNAME": "temporal_persistence",
                "VISIBILITY_DBNAME": "temporal_visibility",
                "NUM_HISTORY_SHARDS": temporalConfig.HistoryShards.toString(),    
            }
        }    
    }
}

function cassandraPersistence(name: string, config: CassandraPersistenceConfig, cluster: Cluster): Persistence {
    const namespace = new k8s.core.v1.Namespace("cassandra", { metadata: { name: "cassandra" } }, { provider: cluster.provider })
    
    new k8s.helm.v3.Chart('cassandra',
        {
            chart: "cassandra",
            version: "9.7.5",
            namespace: "cassandra",
            fetchOpts:{
                repo: "https://charts.bitnami.com/bitnami",
            },
            values: {
                "dbUser": {
                    "user": "temporal",
                    "password": "temporal",
                },
                "replicaCount": config.NodeCount,
                "persistence": {
                    "enabled": false,
                },
                "tolerations": [
                    { key: "dedicated", operator: "Equal", value: "cassandra", effect: "NoSchedule" },
                ],
            },
        },
        { dependsOn: namespace, provider: cluster.provider }
    )

    return {
        Config: {
            "DB": "cassandra",
            "DB_PORT": "9042",
            "CASSANDRA_MAX_CONNS": "40",
            "CASSANDRA_SEEDS": pulumi.output("cassandra.cassandra.svc.cluster.local"),
            "CASSANDRA_USER": "temporal",
            "CASSANDRA_PASSWORD": "temporal",
            "DBNAME": "temporal_persistence",
            "VISIBILITY_DBNAME": "temporal_visibility",
            "NUM_HISTORY_SHARDS": temporalConfig.HistoryShards.toString(),    
        }
    }
}

const temporalConfig = config.requireObject<TemporalConfig>('Temporal');
const clusterConfig = config.requireObject<ClusterConfig>('Cluster')
const persistenceConfig = config.requireObject<PersistenceConfig>('Persistence');

const cluster = createCluster(clusterConfig, persistenceConfig);
const persistence = createPersistence(persistenceConfig, cluster)

const temporalEnv = new k8s.core.v1.ConfigMap("temporal-env",
    {
        metadata: { name: "temporal-env" },
        data: persistence.Config,
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

const tolerateDedicated = (value: string) => {
    return (obj: any, opts: pulumi.CustomResourceOptions) => {
        if (obj.kind === "Deployment") {
            obj.spec.template.spec.tolerations = [
                { key: "dedicated", operator: "Equal", value: value, effect: "NoSchedule" }
            ]
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
            scaleDeployment("temporal-matching", matchingPodCount(temporalConfig.TaskQueuePartitions)),
            tolerateDedicated("temporal"),
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
        dependsOn: [temporalAutoSetup, workerConfig],
        provider: cluster.provider
    }
);

export const clusterName = cluster.name;
export const kubeconfig = cluster.kubeconfig;
export const clusterSummary = describeCluster(clusterConfig, persistenceConfig);