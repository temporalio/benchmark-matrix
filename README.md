# Temporal Benchmark Matrix

The Benchmark Matrix is designed to give users a guide to what kind of performance they can expect out of various cluster and persistence configurations.

Please note that this project is in the extremely early stages, clusters are not being tuned, resource limits are not set or enforced. Any performance numbers recorded should be ignored for now.

Once the matrix is able to run benchmarks across multiple providers and persistence backends we will apply constraints and tuning so that we can get consistent and meaningful benchmark results.

# Current benchmarks

| Provider | Platform | Persistence Type | Persistence Size |
|---|---|---|---|
|AWS|EKS|Postgres|m6i-large|
|AWS|EKS|Postgres|m6i-2xlarge|

# Running the benchmarks

TODO :)

# Contributing

Currently we only run on AWS EKS with Postgres RDS instances. We would love to support Azure, GCP and more persistence systems. All contributions welcome!