package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

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

func transformKubeconfig(config pulumi.AnyOutput) pulumi.StringOutput {
	return config.ApplyT(
		func(config interface{}) (string, error) {
			b, err := json.Marshal(config)
			if err != nil {
				return "", err
			}

			return string(b), nil
		},
	).(pulumi.StringOutput)
}

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		cfg := config.New(ctx, "")

		stackName := ctx.Stack()

		persistenceInstance := cfg.Require("PersistenceInstance")
		persistenceEngine := cfg.Require("PersistenceEngine")
		persistenceEngineVersion := cfg.Require("PersistenceEngineVersion")
		persistenceParameterGroupName := cfg.Require("PersistenceParameterGroupName")
		var dbType string
		var dbPort int
		var dbPrefix string
		if persistenceEngine == "postgres" {
			dbType = "postgresql"
			dbPort = 5432
			dbPrefix = "POSTGRES"
		} else {
			dbType = "mysql"
			dbPort = 3306
			dbPrefix = "MYSQL"
		}

		shards := cfg.Require("HistoryShards")

		envStackName := cfg.Require("EnvironmentStackName")
		envStackRef, err := pulumi.NewStackReference(ctx, envStackName, nil)
		if err != nil {
			return err
		}

		cluster, err := eks.NewCluster(ctx, stackName, &eks.ClusterArgs{
			VpcId:                        utils.GetStackStringOutput(envStackRef, "VpcId"),
			PublicSubnetIds:              utils.GetStackStringArrayOutput(envStackRef, "PublicSubnetIds"),
			PrivateSubnetIds:             utils.GetStackStringArrayOutput(envStackRef, "PrivateSubnetIds"),
			NodeAssociatePublicIpAddress: pulumi.Bool(false),
			DesiredCapacity:              pulumi.Int(5),
			InstanceType:                 pulumi.String("c6i.large"),
			MinSize:                      pulumi.Int(5),
			MaxSize:                      pulumi.Int(5),
		})
		if err != nil {
			return err
		}

		kubeconfig := transformKubeconfig(cluster.Kubeconfig)
		kubeconfigOut := kubeconfig.ApplyT(func(kc interface{}) (string, error) {
			s, ok := kc.(string)
			if !ok {
				return "", fmt.Errorf("kubeconfig: unexpected type: %v", kc)
			}

			return base64.StdEncoding.EncodeToString([]byte(s)), nil
		}).(pulumi.StringOutput)

		ctx.Export("kubeconfig", kubeconfigOut)

		k8sCluster, err := k8s.NewProvider(ctx, "eks", &k8s.ProviderArgs{
			Kubeconfig: kubeconfig,
		})
		if err != nil {
			return err
		}

		_, err = kustomize.NewDirectory(ctx, "../monitoring",
			kustomize.DirectoryArgs{
				Directory: pulumi.String("../monitoring"),
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
		)
		if err != nil {
			return err
		}

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

		_, err = ec2.NewSecurityGroupRule(ctx, "persistence-node-access",
			&ec2.SecurityGroupRuleArgs{
				Type:                  pulumi.String("ingress"),
				FromPort:              pulumi.Int(dbPort),
				ToPort:                pulumi.Int(dbPort),
				Protocol:              pulumi.String("tcp"),
				SecurityGroupId:       securityGroup.ID(),
				SourceSecurityGroupId: nodeSecurityGroupID,
			},
		)
		if err != nil {
			return err
		}

		db, err := rds.NewInstance(ctx, "persistence", &rds.InstanceArgs{
			IdentifierPrefix:    pulumi.Sprintf("persistence-%s-shards-", shards),
			AllocatedStorage:    pulumi.Int(100),
			Engine:              pulumi.String(persistenceEngine),
			EngineVersion:       pulumi.String(persistenceEngineVersion),
			InstanceClass:       pulumi.String(persistenceInstance),
			ParameterGroupName:  pulumi.String(persistenceParameterGroupName),
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

		persistenceEnvConfig := pulumi.StringMap{
			"NUM_HISTORY_SHARDS":              pulumi.String(shards),
			"DB":                              pulumi.String(dbType),
			"DB_PORT":                         pulumi.Sprintf("%d", dbPort),
			"SQL_MAX_CONNS":                   pulumi.String("40"),
			"SQL_MAX_IDLE_CONNS":              pulumi.String("40"),
			fmt.Sprintf("%s_SEEDS", dbPrefix): db.Address,
			fmt.Sprintf("%s_USER", dbPrefix):  pulumi.String("temporal"),
			fmt.Sprintf("%s_PWD", dbPrefix):   pulumi.String("temporal"),
			"DBNAME":                          pulumi.String("temporal_persistence"),
			"VISIBILITY_DBNAME":               pulumi.String("temporal_visibility"),
			"MYSQL_TX_ISOLATION_COMPAT":       pulumi.String("true"),
		}.ToStringMapOutput()

		persistenceConfig, err := corev1.NewConfigMap(ctx, "temporal-env",
			&corev1.ConfigMapArgs{
				Metadata: &metav1.ObjectMetaArgs{
					Name: pulumi.String("temporal-env"),
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

		autosetup, err := batchv1.NewJob(ctx, "temporal-autosetup",
			&batchv1.JobArgs{
				Metadata: &metav1.ObjectMetaArgs{
					Name: pulumi.String("temporal-autosetup"),
				},
				Spec: &batchv1.JobSpecArgs{
					BackoffLimit: pulumi.Int(3),
					Template: &corev1.PodTemplateSpecArgs{
						Spec: &corev1.PodSpecArgs{
							Containers: corev1.ContainerArray{
								&corev1.ContainerArgs{
									Name:            pulumi.String("autosetup"),
									Image:           pulumi.String("temporalio/auto-setup:1.18.0"),
									ImagePullPolicy: pulumi.String("IfNotPresent"),
									Command:         pulumi.ToStringArray([]string{"/etc/temporal/auto-setup.sh"}),
									EnvFrom: corev1.EnvFromSourceArray{
										corev1.EnvFromSourceArgs{
											ConfigMapRef: corev1.ConfigMapEnvSourceArgs{
												Name: persistenceConfig.Metadata.Name(),
											},
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
			pulumi.DependsOn([]pulumi.Resource{persistenceConfig}),
		)
		if err != nil {
			return err
		}

		dynamicConfig, err := corev1.NewConfigMap(ctx, "temporal-dynamic-config",
			&corev1.ConfigMapArgs{
				Metadata: &metav1.ObjectMetaArgs{
					Name: pulumi.String("temporal-dynamic-config"),
				},
				Data: pulumi.StringMap{
					"dynamic_config.yaml": pulumi.String(cfg.Require("DynamicConfig")),
				},
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
		)
		if err != nil {
			return err
		}

		_, err = kustomize.NewDirectory(ctx, "benchmark",
			kustomize.DirectoryArgs{
				Directory: pulumi.String("../overlays/benchmark"),
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
			pulumi.DependsOn([]pulumi.Resource{persistenceConfig, dynamicConfig, autosetup}),
		)
		if err != nil {
			return err
		}

		return nil
	})
}
