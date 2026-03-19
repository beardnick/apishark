package main

import (
	"embed"
	"log"
	"os"
)

//go:embed frontend/dist/index.html frontend/dist/assets/*
var embeddedFrontend embed.FS

func main() {
	projectDir, err := os.Getwd()
	if err != nil {
		log.Fatalf("failed to resolve project directory: %v", err)
	}

	if code := run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr, projectDir); code != 0 {
		os.Exit(code)
	}
}
