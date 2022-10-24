import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";

let config = new pulumi.Config();
let dbPort = 5432;
let dbType = "postgresql";

const envStack = new pulumi.StackReference(config.require("EnvironmentStackName"));

const cluster = new eks.Cluster(pulumi.getStack(), {
    vpcId: envStack.getOutput("VpcId"),
    publicSubnetIds: envStack.getOutput("PublicSubnetIds"),
    privateSubnetIds: envStack.getOutput("PrivateSubnetIds"),
    nodeAssociatePublicIpAddress: false,
    desiredCapacity: 6,
    minSize: 6,
    maxSize: 6
});

export const clusterName = cluster.eksCluster.name;
export const kubeconfig = cluster.kubeconfig;

const rdsSecurityGroup = new aws.ec2.SecurityGroup(pulumi.getStack() + "-rds", {
    vpcId: envStack.getOutput("VpcId"),
    ingress: [
        {
            fromPort: dbPort,
            toPort: dbPort,
            protocol: "tcp",
            securityGroups: [cluster.nodeSecurityGroup.id]
        }
    ]
});

const rdsSubnetGroup = new aws.rds.SubnetGroup(pulumi.getStack() + "-rds", {
    subnetIds: envStack.getOutput("PrivateSubnetIds")
});

const rdsInstance = new aws.rds.Instance(pulumi.getStack(), {
    availabilityZone: envStack.requireOutput('AvailabilityZones').apply(azs => azs[0]),
    dbSubnetGroupName: rdsSubnetGroup.name,
    vpcSecurityGroupIds: [rdsSecurityGroup.id],
    identifierPrefix: pulumi.concat("persistence-", config.require('HistoryShards'), "-shards"),
    allocatedStorage: 100,
    engine: config.require("PersistenceEngine"),
    engineVersion: config.require("PersistenceEngineVersion"),
    instanceClass: config.require("PersistenceInstance"),
    parameterGroupName: config.require("PersistenceParameterGroupName"),
    skipFinalSnapshot: true,
    username: "temporal",
    password: "temporal",
});

const monitoring = new k8s.kustomize.Directory("monitoring",
    { directory: "../k8s/monitoring" },
    { provider: cluster.provider }
);

let dbPrefix = "POSTGRES";

const temporalConfig = new k8s.core.v1.ConfigMap("temporal-env",
    {
        metadata: { name: "temporal-env" },
        data: {
            "DB": dbType,
            "DB_PORT": dbPort.toString(),
            "SQL_MAX_CONNS": "40",
            [`${dbPrefix}_SEEDS`]: rdsInstance.address,
            [`${dbPrefix}_USER`]: "temporal",
            [`${dbPrefix}_PWD`]: "temporal",
            "DBNAME": "temporal_persistence",
            "VISIBILITY_DBNAME": "temporal_visibility",
            "MYSQL_TX_ISOLATION_COMPAT": "true",
            "NUM_HISTORY_SHARDS": config.require("HistoryShards"),
        }
    },
    { provider: cluster.provider }
)

const temporalDynamicConfig = new k8s.core.v1.ConfigMap("temporal-dynamic-config",
    {
        metadata: { name: "temporal-dynamic-config" },
        data: {
            "dynamic_config.yaml": config.require("DynamicConfig")
        }
    },
    { provider: cluster.provider }
)

const workerConfig = new k8s.core.v1.ConfigMap("benchmark-worker-env",
    {
        metadata: { name: "benchmark-worker-env" },
        data: {
            "TEMPORAL_WORKFLOW_TASK_POLLERS": config.require("WorkerWorkflowPollers"),
			"TEMPORAL_ACTIVITY_TASK_POLLERS": config.require("WorkerActivityPollers"),
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
                                    configMapRef: { name: temporalConfig.metadata.name }
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
        dependsOn: [temporalConfig],
        provider: cluster.provider
    }
)

new k8s.kustomize.Directory("benchmark-workers",
    {
        directory: "../k8s/benchmark-workers",
        transformations: [
            (obj: any, opts: pulumi.CustomResourceOptions) => {
                if (obj.kind === "Deployment" && obj.metadata.name === "benchmark-workers") {
                    obj.spec.replicas = config.requireNumber("WorkerCount")
                }
            },
        ]
    },
    {
        dependsOn: [workerConfig],
        provider: cluster.provider
    }
);

new k8s.kustomize.Directory("temporal",
    {
        directory: "../k8s/temporal",
        transformations: [
            (obj: any, opts: pulumi.CustomResourceOptions) => {
                if (obj.kind === "Deployment" && obj.metadata.name === "temporal-history") {
                    obj.spec.replicas = config.requireNumber("HistoryShards") / 512
                }
            },
            (obj: any, opts: pulumi.CustomResourceOptions) => {
                if (obj.kind === "Deployment" && obj.metadata.name === "temporal-matching") {
                    obj.spec.replicas = config.requireNumber("TaskQueuePartitions")
                }
            }
        ]
    },
    {
        dependsOn: [temporalConfig, temporalDynamicConfig, temporalAutoSetup],
        provider: cluster.provider
    }
);
