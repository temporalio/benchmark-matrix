package main

import (
	"github.com/pulumi/pulumi-awsx/sdk/go/awsx/ec2"
	"github.com/pulumi/pulumi-eks/sdk/go/eks"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi/config"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		vpc, err := ec2.NewVpc(ctx, "temporal-benchmark", &ec2.VpcArgs{})
		if err != nil {
			return err
		}

		cluster, err := eks.NewCluster(ctx, "temporal-benchmark", &eks.ClusterArgs{
			VpcId:                        vpc.VpcId,
			PublicSubnetIds:              vpc.PublicSubnetIds,
			PrivateSubnetIds:             vpc.PrivateSubnetIds,
			NodeAssociatePublicIpAddress: pulumi.Bool(false),
			DesiredCapacity:              pulumi.Int(3),
			MinSize:                      pulumi.Int(3),
			MaxSize:                      pulumi.Int(3),
		})
		if err != nil {
			return err
		}

		cfg := config.New(ctx, "")
		clusterName := cfg.Require("cluster-name")

		ctx.Export("cluster-name", pulumi.String(clusterName))
		ctx.Export("kubeconfig", cluster.Kubeconfig)
		return nil
	})
}
