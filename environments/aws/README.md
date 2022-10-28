[![Deploy](https://get.pulumi.com/new/button.svg)](https://app.pulumi.com/new?template=https://github.com/temporalio/benchmark-matrix/tree/master/environments/aws)

# AWS Environment for Temporal Benchmark Clusters

This [Pulumi](https://pulumi.com) app creates a VPC, subnets and RDS subnet group to hold clusters created for the Temporal Benchmark Matrix.

## Deploying

You can create this application in Pulumi using the button above, or if you'd prefer to use local state storage to experiment with Temporal Benchmark Matrix, you can use:

1. Configure pulumi to use local state:

    ```shell
    $ pulumi login --local
    ```

2. Bring up a stack:

    ```shell
    $ pulumi -s dev up
    ```

For more information on Pulumi state storage, please see [their docs](https://www.pulumi.com/docs/intro/concepts/state/)