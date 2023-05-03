#!/usr/bin/env bash

host="https://temporal-benchmark.ngrok.io"

for uid in $(curl -s "${host}/api/search?tag=temporal" | jq -r '.[] | .uid'); do
    dashboard="$(curl -s "${host}/api/dashboards/uid/${uid}")"
    name=$(echo "${dashboard}" | jq -r '.meta.slug')
    echo "${dashboard}" | jq '.dashboard' > ${name}.json
done