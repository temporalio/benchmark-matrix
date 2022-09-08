package main

import (
	"github.com/pulumi/pulumi-awsx/sdk/go/awsx/ec2"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		vpc, err := ec2.NewVpc(ctx, "temporal-benchmark", &ec2.VpcArgs{})
		if err != nil {
			return err
		}

		ctx.Export("VpcId", vpc.VpcId)
		ctx.Export("PrivateSubnetIds", vpc.PrivateSubnetIds)
		ctx.Export("PublicSubnetIds", vpc.PublicSubnetIds)

		return nil
	})
}
