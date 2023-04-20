// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

/**
 * GrafanaDatasource is the Schema for the grafanadatasources API
 */
export class GrafanaDatasource extends pulumi.CustomResource {
    /**
     * Get an existing GrafanaDatasource resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): GrafanaDatasource {
        return new GrafanaDatasource(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:grafana.integreatly.org/v1beta1:GrafanaDatasource';

    /**
     * Returns true if the given object is an instance of GrafanaDatasource.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is GrafanaDatasource {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === GrafanaDatasource.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"grafana.integreatly.org/v1beta1" | undefined>;
    public readonly kind!: pulumi.Output<"GrafanaDatasource" | undefined>;
    public readonly metadata!: pulumi.Output<ObjectMeta | undefined>;
    /**
     * GrafanaDatasourceSpec defines the desired state of GrafanaDatasource
     */
    public readonly spec!: pulumi.Output<outputs.grafana.v1beta1.GrafanaDatasourceSpec | undefined>;
    /**
     * GrafanaDatasourceStatus defines the observed state of GrafanaDatasource
     */
    public readonly status!: pulumi.Output<outputs.grafana.v1beta1.GrafanaDatasourceStatus | undefined>;

    /**
     * Create a GrafanaDatasource resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: GrafanaDatasourceArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "grafana.integreatly.org/v1beta1";
            resourceInputs["kind"] = "GrafanaDatasource";
            resourceInputs["metadata"] = args ? args.metadata : undefined;
            resourceInputs["spec"] = args ? args.spec : undefined;
            resourceInputs["status"] = args ? args.status : undefined;
        } else {
            resourceInputs["apiVersion"] = undefined /*out*/;
            resourceInputs["kind"] = undefined /*out*/;
            resourceInputs["metadata"] = undefined /*out*/;
            resourceInputs["spec"] = undefined /*out*/;
            resourceInputs["status"] = undefined /*out*/;
        }
        opts = pulumi.mergeOptions(utilities.resourceOptsDefaults(), opts);
        super(GrafanaDatasource.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a GrafanaDatasource resource.
 */
export interface GrafanaDatasourceArgs {
    apiVersion?: pulumi.Input<"grafana.integreatly.org/v1beta1">;
    kind?: pulumi.Input<"GrafanaDatasource">;
    metadata?: pulumi.Input<ObjectMeta>;
    /**
     * GrafanaDatasourceSpec defines the desired state of GrafanaDatasource
     */
    spec?: pulumi.Input<inputs.grafana.v1beta1.GrafanaDatasourceSpecArgs>;
    /**
     * GrafanaDatasourceStatus defines the observed state of GrafanaDatasource
     */
    status?: pulumi.Input<inputs.grafana.v1beta1.GrafanaDatasourceStatusArgs>;
}