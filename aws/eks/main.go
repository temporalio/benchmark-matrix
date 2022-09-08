package main

import (
	"encoding/json"

	"github.com/pulumi/pulumi-eks/sdk/go/eks"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi/config"
	"github.com/temporalio/temporal-benchmarks/utils"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		cfg := config.New(ctx, "")

		envStackName := cfg.Require("EnvironmentStackName")
		clusterName := cfg.Require("ClusterName")

		envStackRef, err := pulumi.NewStackReference(ctx, envStackName, nil)
		if err != nil {
			return err
		}

		cluster, err := eks.NewCluster(ctx, "temporal-benchmark", &eks.ClusterArgs{
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

		kubeconfig := cluster.Kubeconfig.ApplyT(
			func(config interface{}) (string, error) {
				b, err := json.Marshal(config)
				if err != nil {
					return "", err
				}
				return string(b), nil
			},
		).(pulumi.StringOutput)

		ctx.Export("ClusterName", pulumi.String(clusterName))
		ctx.Export("Kubeconfig", pulumi.ToSecret(kubeconfig))

		return nil
	})
}
