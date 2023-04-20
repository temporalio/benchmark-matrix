#!/bin/sh

jq '.id = null | .version = 1' |
jq '(.panels[].targets[]?.datasource | select(.type == "prometheus")).uid |= "prometheus"' |
jq '(.panels[].targets[]?.datasource | select(.type == "cloudwatch")).uid |= "cloudwatch"'