package main

import (
	"encoding/json"

	k8s "github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes"
	batchv1 "github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/batch/v1"
	corev1 "github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/core/v1"
	"github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/kustomize"
	metav1 "github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/meta/v1"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi/config"
)

func getKubeconfig(clusterStackRef *pulumi.StackReference) (pulumi.StringOutput, error) {
	return clusterStackRef.GetOutput(pulumi.String("kubeconfig")).ApplyT(
		func(config interface{}) (string, error) {
			b, err := json.Marshal(config)
			if err != nil {
				return "", err
			}
			return string(b), nil
		},
	).(pulumi.StringOutput), nil
}

func getClusterName(clusterStackRef *pulumi.StackReference) (pulumi.StringOutput, error) {
	return clusterStackRef.GetStringOutput(pulumi.String("cluster-name")), nil
}

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		cfg := config.New(ctx, "")
		clusterStackName := cfg.Require("cluster")
		clusterStackRef, err := pulumi.NewStackReference(ctx, clusterStackName, nil)
		if err != nil {
			return err
		}

		kustomizeDirectory := cfg.Require("kustomize_directory")
		clusterName, err := getClusterName(clusterStackRef)
		if err != nil {
			return err
		}

		kubeconfig, err := getKubeconfig(clusterStackRef)
		if err != nil {
			return err
		}
		k8sCluster, err := k8s.NewProvider(ctx, clusterStackName, &k8s.ProviderArgs{
			Kubeconfig: kubeconfig,
		})
		if err != nil {
			return err
		}

		temporalSystem, err := kustomize.NewDirectory(ctx, kustomizeDirectory,
			kustomize.DirectoryArgs{
				Directory: pulumi.String(kustomizeDirectory),
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
		)
		if err != nil {
			return err
		}

		benchmarkConfig, err := corev1.NewConfigMap(ctx, "benchmark-config",
			&corev1.ConfigMapArgs{
				Metadata: &metav1.ObjectMetaArgs{
					Name: pulumi.String("benchmark-config"),
				},
				Data: pulumi.ToStringMapOutput(map[string]pulumi.StringOutput{"CLUSTER_NAME": clusterName}),
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

		// Hack because DependsOn kustomize does not wait until the resources it creates are ready.
		// The below is a workaround based on the Helm Chart provider's .Ready property.
		// https://github.com/pulumi/pulumi-kubernetes/issues/1773
		temporalReady := temporalSystem.Resources.ApplyT(func(x interface{}) []pulumi.Resource {
			resources := x.(map[string]pulumi.Resource)
			var outputs []pulumi.Resource
			for _, r := range resources {
				outputs = append(outputs, r)
			}
			return outputs
		}).(pulumi.ResourceArrayOutput)
		monitoringReady := monitoringSystem.Resources.ApplyT(func(x interface{}) []pulumi.Resource {
			resources := x.(map[string]pulumi.Resource)
			var outputs []pulumi.Resource
			for _, r := range resources {
				outputs = append(outputs, r)
			}
			return outputs
		}).(pulumi.ResourceArrayOutput)

		_, err = batchv1.NewJob(ctx, "benchmark-echo-1k",
			&batchv1.JobArgs{
				Metadata: &metav1.ObjectMetaArgs{
					Name: pulumi.String("benchmark-echo-1k"),
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
										pulumi.String("--vus"),
										pulumi.String("100"),
										pulumi.String("--iterations"),
										pulumi.String("1000"),
										pulumi.String("/etc/benchmark-scripts/echo.js"),
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
											corev1.KeyToPathArgs{Key: pulumi.String("echo.js"), Path: pulumi.String("echo.js")},
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
			pulumi.DependsOnInputs(temporalReady),
			pulumi.DependsOnInputs(monitoringReady),
		)
		if err != nil {
			return err
		}

		return nil
	})
}
