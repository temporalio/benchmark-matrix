package utils

import (
	"github.com/pulumi/pulumi-kubernetes/sdk/v3/go/kubernetes/kustomize"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

func GetStackStringOutput(ref *pulumi.StackReference, key string) pulumi.StringOutput {
	return ref.GetStringOutput(pulumi.String(key))
}

func GetStackStringArrayOutput(ref *pulumi.StackReference, key string) pulumi.StringArrayOutput {
	output := ref.GetOutput(pulumi.String(key))
	return output.ApplyT(func(input interface{}) []string {
		vals := make([]string, len(input.([]interface{})))
		for idx, val := range input.([]interface{}) {
			vals[idx] = val.(string)
		}
		return vals
	}).(pulumi.StringArrayOutput)
}

// Hack because DependsOn kustomize does not wait until the resources it creates are ready.
// The below is a workaround based on the Helm Chart provider's .Ready property.
// https://github.com/pulumi/pulumi-kubernetes/issues/1773

func KustomizeReady(k *kustomize.Directory) pulumi.ResourceArrayOutput {
	return k.Resources.ApplyT(func(x interface{}) []pulumi.Resource {
		resources := x.(map[string]pulumi.Resource)
		var outputs []pulumi.Resource
		for _, r := range resources {
			outputs = append(outputs, r)
		}
		return outputs
	}).(pulumi.ResourceArrayOutput)
}
