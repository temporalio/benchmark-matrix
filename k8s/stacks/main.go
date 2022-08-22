package main

import (
	"encoding/json"

	k8s "github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes"
	"github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/kustomize"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi/config"
)

func getKubeconfig(ctx *pulumi.Context, clusterStackName string) (pulumi.StringOutput, error) {
	clusterRef, err := pulumi.NewStackReference(ctx, clusterStackName, nil)
	if err != nil {
		return pulumi.StringOutput{}, err
	}

	return clusterRef.GetOutput(pulumi.String("kubeconfig")).ApplyT(
		func(config interface{}) (string, error) {
			b, err := json.Marshal(config)
			if err != nil {
				return "", err
			}
			return string(b), nil
		},
	).(pulumi.StringOutput), nil
}

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		cfg := config.New(ctx, "")
		clusterStackName := cfg.Require("cluster")
		kustomizeDirectory := cfg.Require("kustomize_directory")

		kubeconfig, err := getKubeconfig(ctx, clusterStackName)
		if err != nil {
			return err
		}
		k8sCluster, err := k8s.NewProvider(ctx, clusterStackName, &k8s.ProviderArgs{
			Kubeconfig: kubeconfig,
		})
		if err != nil {
			return err
		}

		_, err = kustomize.NewDirectory(ctx, kustomizeDirectory,
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

		_, err = kustomize.NewDirectory(ctx, "../local",
			kustomize.DirectoryArgs{
				Directory: pulumi.String("../local"),
			},
			pulumi.ProviderMap(map[string]pulumi.ProviderResource{
				"kubernetes": k8sCluster,
			}),
		)
		if err != nil {
			return err
		}

		return nil
	})
}
