package main

import (
	"bytes"
	"context"
	"io/ioutil"
	"log"
	"net/http"
	"os"

	"github.com/K-Phoen/grabana"
	"github.com/K-Phoen/grabana/decoder"
)

func main() {
	ctx := context.Background()
	options := []grabana.Option{}
	if os.Getenv("GRAFANA_API_TOKEN") != "" {
		options = append(options, grabana.WithAPIToken(os.Getenv("GRAFANA_API_TOKEN")))
	}
	client := grabana.NewClient(&http.Client{}, os.Getenv("GRAFANA_HOST"), options...)

	folder, err := client.FindOrCreateFolder(ctx, "Benchmarks")
	if err != nil {
		log.Fatalf("could not find or create folder: %v\n", err)
	}

	content, err := ioutil.ReadFile("./dashboards/stack.yaml")
	if err != nil {
		log.Fatalf("could not read file: %v\n", err)
	}

	dashboard, err := decoder.UnmarshalYAML(bytes.NewBuffer(content))
	if err != nil {
		log.Fatalf("could not parse file: %v\n", err)
	}

	if _, err := client.UpsertDashboard(ctx, folder, dashboard); err != nil {
		log.Fatalf("could not create dashboard: %v\n", err)
	}

	content, err = ioutil.ReadFile("./dashboards/summary.yaml")
	if err != nil {
		log.Fatalf("could not read file: %v\n", err)
	}

	dashboard, err = decoder.UnmarshalYAML(bytes.NewBuffer(content))
	if err != nil {
		log.Fatalf("could not parse file: %v\n", err)
	}

	if _, err := client.UpsertDashboard(ctx, folder, dashboard); err != nil {
		log.Fatalf("could not create dashboard: %v\n", err)
	}

}
