package main

import (
	"encoding/json"

	"github.com/pulumi/pulumi-aws/sdk/v5/go/aws/ec2"
	"github.com/pulumi/pulumi-aws/sdk/v5/go/aws/rds"
	"github.com/pulumi/pulumi-eks/sdk/go/eks"
	k8s "github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes"
	batchv1 "github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/batch/v1"
	corev1 "github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/core/v1"
	"github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/kustomize"
	metav1 "github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/meta/v1"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi/config"
	"github.com/temporalio/temporal-benchmarks/utils"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		cfg := config.New(ctx, "")

		// clusterType := cfg.Require("ClusterType")
		// persistenceType := cfg.Require("PersistenceType")
		persistenceInstance := cfg.Require("PersistenceInstance")
		clusterName := ctx.Stack()

		var k8sCluster *k8s.Provider

		envStackName := cfg.Require("EnvironmentStackName")
		envStackRef, err := pulumi.NewStackReference(ctx, envStackName, nil)
		if err != nil {
			return err
		}

		cluster, err := eks.NewCluster(ctx, clusterName, &eks.ClusterArgs{
			VpcId:                        utils.GetStackStringOutput(envStackRef, "VpcId"),
			PublicSubnetIds:              utils.GetStackStringArrayOutput(envStackRef, "PublicSubnetIds"),
			PrivateSubnetIds:             utils.GetStackStringArrayOutput(envStackRef, "PrivateSubnetIds"),
			NodeAssociatePublicIpAddress: pulumi.Bool(false),
			DesiredCapacity:              pulumi.Int(3),
			MinSize:                      pulumi.Int(3),
			MaxSize:                      pulumi.Int(3),
		})
		if err != nil {
			return err
		}

		ctx.Export("kubeconfig", pulumi.ToSecret(cluster.Kubeconfig))

		k8sCluster, err = k8s.NewProvider(ctx, "eks", &k8s.ProviderArgs{
			Kubeconfig: cluster.Kubeconfig.ApplyT(
				func(config interface{}) (string, error) {
					b, err := json.Marshal(config)
					if err != nil {
						return "", err
					}
					return string(b), nil
				}).(pulumi.StringOutput),
		})
		if err != nil {
			return err
		}

		var persistenceEnvConfig pulumi.StringMapOutput

		subnetGroup, err := rds.NewSubnetGroup(ctx, "persistence", &rds.SubnetGroupArgs{
			SubnetIds: utils.GetStackStringArrayOutput(envStackRef, "PrivateSubnetIds"),
		})
		if err != nil {
			return err
		}

		securityGroup, err := ec2.NewSecurityGroup(ctx, "persistence-node-access", &ec2.SecurityGroupArgs{
			VpcId: utils.GetStackStringOutput(envStackRef, "VpcId"),
		})
		if err != nil {
			return err
		}

		nodeSecurityGroupID := cluster.NodeSecurityGroup.ApplyT(func(sg *ec2.SecurityGroup) pulumi.StringOutput {
			return sg.ID().ToStringOutput()
		}).(pulumi.StringOutput)

		_, err = ec2.NewSecurityGroupRule(ctx, "persistence-node-access", &ec2.SecurityGroupRuleArgs{
			Type:                  pulumi.String("ingress"),
			FromPort:              pulumi.Int(5432),
			ToPort:                pulumi.Int(5432),
			Protocol:              pulumi.String("tcp"),
			SecurityGroupId:       securityGroup.ID(),
			SourceSecurityGroupId: nodeSecurityGroupID,
		})
		if err != nil {
			return err
		}

		db, err := rds.NewInstance(ctx, "persistence", &rds.InstanceArgs{
			AllocatedStorage:    pulumi.Int(100),
			Engine:              pulumi.String("postgres"),
			EngineVersion:       pulumi.String("14.4"),
			InstanceClass:       pulumi.String(persistenceInstance),
			ParameterGroupName:  pulumi.String("default.postgres14"),
			Username:            pulumi.String("temporal"),
			Password:            pulumi.String("temporal"),
			SkipFinalSnapshot:   pulumi.Bool(true),
			DbSubnetGroupName:   subnetGroup.Name,
			AvailabilityZone:    utils.GetStackStringArrayOutput(envStackRef, "AvailabilityZones").Index(pulumi.Int(0)),
			VpcSecurityGroupIds: pulumi.StringArray{securityGroup.ID()},
		})
		if err != nil {
			return err
		}
		persistenceEnvConfig = pulumi.ToStringMapOutput(map[string]pulumi.StringOutput{
			"DB":                pulumi.String("postgresql").ToStringOutput(),
			"DB_PORT":           pulumi.String("5432").ToStringOutput(),
			"POSTGRES_SEEDS":    db.Address,
			"POSTGRES_USER":     pulumi.String("temporal").ToStringOutput(),
			"POSTGRES_PWD":      pulumi.String("temporal").ToStringOutput(),
			"DBNAME":            pulumi.String("temporal_persistence").ToStringOutput(),
			"VISIBILITY_DBNAME": pulumi.String("temporal_visibility").ToStringOutput(),
		})

		persistenceConfig, err := corev1.NewConfigMap(ctx, "temporal-persistence-env",
			&corev1.ConfigMapArgs{
				Metadata: &metav1.ObjectMetaArgs{
					Name: pulumi.String("temporal-persistence-env"),
				},
				Data: persistenceEnvConfig,
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
		)
		if err != nil {
			return err
		}

		kustomizeDirectory := cfg.Require("KustomizeDirectory")

		temporalSystem, err := kustomize.NewDirectory(ctx, kustomizeDirectory,
			kustomize.DirectoryArgs{
				Directory: pulumi.String(kustomizeDirectory),
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
			pulumi.DependsOn([]pulumi.Resource{persistenceConfig}),
		)
		if err != nil {
			return err
		}

		benchmarkConfig, err := corev1.NewConfigMap(ctx, "benchmark-config",
			&corev1.ConfigMapArgs{
				Metadata: &metav1.ObjectMetaArgs{
					Name: pulumi.String("benchmark-config"),
				},
				Data: pulumi.ToStringMap(map[string]string{"CLUSTER_NAME": clusterName}),
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
		)
		if err != nil {
			return err
		}

		kubeStateMetrics, err := kustomize.NewDirectory(ctx, "kube-state-metrics",
			kustomize.DirectoryArgs{
				Directory: pulumi.String("https://github.com/kubernetes/kube-state-metrics"),
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
		)
		if err != nil {
			return err
		}

		monitoringSystem, err := kustomize.NewDirectory(ctx, "../monitoring",
			kustomize.DirectoryArgs{
				Directory: pulumi.String("../monitoring"),
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
			pulumi.DependsOn([]pulumi.Resource{kubeStateMetrics, benchmarkConfig}),
		)
		if err != nil {
			return err
		}

		_, err = batchv1.NewJob(ctx, "benchmark-ramp-up",
			&batchv1.JobArgs{
				Metadata: &metav1.ObjectMetaArgs{
					Name: pulumi.String("benchmark-ramp-up"),
				},
				Spec: &batchv1.JobSpecArgs{
					BackoffLimit: pulumi.Int(3),
					Template: &corev1.PodTemplateSpecArgs{
						Spec: &corev1.PodSpecArgs{
							Containers: corev1.ContainerArray{
								&corev1.ContainerArgs{
									Name:            pulumi.String("k6"),
									Image:           pulumi.String("ghcr.io/temporalio/xk6-temporal:main"),
									ImagePullPolicy: pulumi.String("Always"),
									Command: pulumi.StringArray{
										pulumi.String("k6"),
										pulumi.String("run"),
										pulumi.String("/etc/benchmark-scripts/ramp_up.js"),
									},
									Env: corev1.EnvVarArray{
										corev1.EnvVarArgs{
											Name:  pulumi.String("TEMPORAL_GRPC_ENDPOINT"),
											Value: pulumi.String("temporal-frontend:7233"),
										},
									},
									EnvFrom: corev1.EnvFromSourceArray{
										corev1.EnvFromSourceArgs{
											SecretRef: corev1.SecretEnvSourceArgs{
												Name: pulumi.String("monitoring-env"),
											},
										},
									},
									VolumeMounts: corev1.VolumeMountArray{
										corev1.VolumeMountArgs{
											Name:      pulumi.String("benchmark-scripts"),
											MountPath: pulumi.String("/etc/benchmark-scripts"),
										},
									},
								},
							},
							Volumes: corev1.VolumeArray{
								corev1.VolumeArgs{
									Name: pulumi.String("benchmark-scripts"),
									ConfigMap: corev1.ConfigMapVolumeSourceArgs{
										Name: pulumi.String("benchmark-scripts"),
										Items: corev1.KeyToPathArray{
											corev1.KeyToPathArgs{Key: pulumi.String("ramp_up.js"), Path: pulumi.String("ramp_up.js")},
										},
									},
								},
							},
							RestartPolicy: pulumi.String("Never"),
						},
					},
				},
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
			pulumi.DependsOnInputs(utils.KustomizeReady(temporalSystem)),
			pulumi.DependsOnInputs(utils.KustomizeReady(monitoringSystem)),
			pulumi.Timeouts(&pulumi.CustomTimeouts{Create: "1h"}),
		)
		if err != nil {
			return err
		}

		return nil
	})
}
