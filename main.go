package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	"apishark/internal/server"
)

//go:embed frontend/dist/index.html frontend/dist/assets/*
var embeddedFrontend embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:18080", "listen address for HTTP server")
	flag.Parse()

	distFS, err := fs.Sub(embeddedFrontend, "frontend/dist")
	if err != nil {
		log.Fatalf("failed to load embedded frontend: %v", err)
	}

	projectDir, err := os.Getwd()
	if err != nil {
		log.Fatalf("failed to resolve project directory: %v", err)
	}

	handler := server.NewHandler(distFS, projectDir)
	url := fmt.Sprintf("http://%s", *addr)
	log.Printf("APIShark is running at %s", url)

	if err := http.ListenAndServe(*addr, handler); err != nil {
		log.Fatal(err)
	}
}
