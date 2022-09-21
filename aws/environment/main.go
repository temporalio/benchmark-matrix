package main

import (
	ec2c "github.com/pulumi/pulumi-aws/sdk/v5/go/aws/ec2"
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

		zones := vpc.Subnets.ApplyT(func(subnets []*ec2c.Subnet) pulumi.StringArrayOutput {
			var azs []pulumi.StringOutput
			for _, subnet := range subnets {
				azs = append(azs, subnet.AvailabilityZone)
			}
			return pulumi.ToStringArrayOutput(azs)
		}).(pulumi.StringArrayOutput)

		zones = zones.ApplyT(func(azs []string) pulumi.StringArrayOutput {
			seenZones := make(map[string]struct{}, len(azs))
			uniqZones := []string{}

			for _, z := range azs {
				if _, ok := seenZones[z]; !ok {
					seenZones[z] = struct{}{}
					uniqZones = append(uniqZones, z)
				}
			}

			return pulumi.ToStringArray(uniqZones).ToStringArrayOutput()
		}).(pulumi.StringArrayOutput)

		ctx.Export("AvailabilityZones", zones)

		return nil
	})
}
