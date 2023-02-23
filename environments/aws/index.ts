import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const azCount = 3;

export const AvailabilityZones = aws.getAvailabilityZones({state: "available"}).then(zones => zones.names.slice(0, azCount))

const vpc = new awsx.ec2.Vpc("temporal-benchmark", {
    requestedAvailabilityZones: AvailabilityZones
})

const rdsSubnetGroup = new aws.rds.SubnetGroup("temporal-benchmark-rds", {
    subnetIds: vpc.publicSubnetIds
});

export const VpcId = vpc.id
export const PrivateSubnetIds = vpc.privateSubnetIds
export const PublicSubnetIds = vpc.publicSubnetIds
export const RdsSubnetGroupName = rdsSubnetGroup.name
export const Role = "BenchmarkClusterAdmin"