package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDocCommandPrintsMarkdownGuide(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	stdout, stderr, code := runForTest([]string{"doc"}, "", projectDir)
	if code != 0 {
		t.Fatalf("doc exited with code %d: %s", code, stderr)
	}
	if stderr != "" {
		t.Fatalf("doc should not write stderr: %s", stderr)
	}
	if !strings.Contains(stdout, "# APIShark CLI Guide For AI Agents") {
		t.Fatalf("doc output missing title: %s", stdout)
	}
	if !strings.Contains(stdout, "apishark requests put") {
		t.Fatalf("doc output missing request command: %s", stdout)
	}
	if !strings.Contains(stdout, "apishark requests import") {
		t.Fatalf("doc output missing import command: %s", stdout)
	}
	if !strings.Contains(stdout, "apishark requests delete") {
		t.Fatalf("doc output missing delete command: %s", stdout)
	}
	if !strings.Contains(stdout, "plugins import") {
		t.Fatalf("doc output missing plugin instructions: %s", stdout)
	}
}

func TestCLICommandsManageCollectionsRequestsEnvironmentsAndPlugins(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()

	stdout, stderr, code := runForTest([]string{"collections", "put", "--name", "OpenAI Demo", "--plugin", "openai"}, "", projectDir)
	if code != 0 {
		t.Fatalf("collections put failed: %s", stderr)
	}

	var collection struct {
		ID                string `json:"id"`
		Name              string `json:"name"`
		AggregationPlugin string `json:"aggregation_plugin"`
	}
	if err := json.Unmarshal([]byte(stdout), &collection); err != nil {
		t.Fatalf("unmarshal collection output: %v", err)
	}
	if collection.Name != "OpenAI Demo" || collection.AggregationPlugin != "openai" {
		t.Fatalf("unexpected collection output: %s", stdout)
	}

	stdout, stderr, code = runForTest([]string{
		"requests", "put",
		"--collection", "OpenAI Demo",
		"--name", "Streaming Chat",
		"--method", "POST",
		"--url", "https://api.openai.com/v1/responses",
		"--header", "Authorization: Bearer {{OPENAI_API_KEY}}",
		"--header", "Content-Type: application/json",
		"--body", "{\"model\":\"gpt-4.1\",\"stream\":true}",
		"--inherit-plugin",
		"--timeout", "90",
	}, "", projectDir)
	if code != 0 {
		t.Fatalf("requests put failed: %s", stderr)
	}

	var request struct {
		Name                           string `json:"name"`
		Method                         string `json:"method"`
		URL                            string `json:"url"`
		Body                           string `json:"body"`
		TimeoutSeconds                 int    `json:"timeout_seconds"`
		UseCollectionAggregationPlugin bool   `json:"use_collection_aggregation_plugin"`
	}
	if err := json.Unmarshal([]byte(stdout), &request); err != nil {
		t.Fatalf("unmarshal request output: %v", err)
	}
	if request.Name != "Streaming Chat" || request.Method != "POST" || request.TimeoutSeconds != 90 {
		t.Fatalf("unexpected request output: %s", stdout)
	}
	if !request.UseCollectionAggregationPlugin {
		t.Fatalf("request should inherit collection plugin: %s", stdout)
	}

	stdout, stderr, code = runForTest([]string{
		"envs", "put",
		"--name", "local",
		"--kv", "OPENAI_API_KEY=sk-test",
		"--kv", "BASE_URL=https://api.openai.com",
	}, "", projectDir)
	if code != 0 {
		t.Fatalf("envs put failed: %s", stderr)
	}
	if !strings.Contains(stdout, "OPENAI_API_KEY=sk-test") {
		t.Fatalf("unexpected env output: %s", stdout)
	}

	stdout, stderr, code = runForTest([]string{"envs", "activate", "--env", "local"}, "", projectDir)
	if code != 0 {
		t.Fatalf("envs activate failed: %s", stderr)
	}
	if !strings.Contains(stdout, "active_environment_id") {
		t.Fatalf("unexpected activate output: %s", stdout)
	}

	pluginPath := filepath.Join(projectDir, "demo-echo.js")
	if err := os.WriteFile(pluginPath, []byte(strings.Join([]string{
		`export const id = "demo.echo";`,
		`export const label = "Demo Echo";`,
		`export function create() {`,
		`  return {};`,
		`}`,
		"",
	}, "\n")), 0o644); err != nil {
		t.Fatalf("write plugin file: %v", err)
	}

	stdout, stderr, code = runForTest([]string{
		"plugins", "import",
		"--file", pluginPath,
		"--id", "demo.echo",
		"--label", "Demo Echo",
		"--description", "Demo plugin",
	}, "", projectDir)
	if code != 0 {
		t.Fatalf("plugins import failed: %s", stderr)
	}
	if !strings.Contains(stdout, `"source_file": "demo.echo.mjs"`) {
		t.Fatalf("unexpected plugin output: %s", stdout)
	}

	collectionsData, err := os.ReadFile(filepath.Join(projectDir, "collections.json"))
	if err != nil {
		t.Fatalf("read collections.json: %v", err)
	}
	var store struct {
		Collections []struct {
			Requests []struct {
				Name string `json:"name"`
			} `json:"requests"`
		} `json:"collections"`
		Environments []struct {
			Name string `json:"name"`
			Text string `json:"text"`
		} `json:"environments"`
	}
	if err := json.Unmarshal(collectionsData, &store); err != nil {
		t.Fatalf("unmarshal collections.json: %v", err)
	}
	if len(store.Collections) != 1 || len(store.Collections[0].Requests) != 1 || store.Collections[0].Requests[0].Name != "Streaming Chat" {
		t.Fatalf("collections.json missing request: %s", string(collectionsData))
	}
	if len(store.Environments) != 1 || store.Environments[0].Name != "local" || !strings.Contains(store.Environments[0].Text, "OPENAI_API_KEY=sk-test") {
		t.Fatalf("collections.json missing environment text: %s", string(collectionsData))
	}

	pluginsData, err := os.ReadFile(filepath.Join(projectDir, ".apishark", "plugins.json"))
	if err != nil {
		t.Fatalf("read plugins.json: %v", err)
	}
	if !strings.Contains(string(pluginsData), `"demo.echo"`) {
		t.Fatalf("plugins.json missing plugin id: %s", string(pluginsData))
	}

	stdout, stderr, code = runForTest([]string{
		"requests", "delete",
		"--collection", "OpenAI Demo",
		"--request", "Streaming Chat",
	}, "", projectDir)
	if code != 0 {
		t.Fatalf("requests delete failed: %s", stderr)
	}
	if !strings.Contains(stdout, `"name": "Streaming Chat"`) {
		t.Fatalf("unexpected requests delete output: %s", stdout)
	}

	stdout, stderr, code = runForTest([]string{"envs", "delete", "--env", "local"}, "", projectDir)
	if code != 0 {
		t.Fatalf("envs delete failed: %s", stderr)
	}
	if !strings.Contains(stdout, `"name": "local"`) {
		t.Fatalf("unexpected envs delete output: %s", stdout)
	}

	stdout, stderr, code = runForTest([]string{"plugins", "delete", "--plugin", "demo.echo"}, "", projectDir)
	if code != 0 {
		t.Fatalf("plugins delete failed: %s", stderr)
	}
	if !strings.Contains(stdout, `"id": "demo.echo"`) {
		t.Fatalf("unexpected plugins delete output: %s", stdout)
	}
	if _, err := os.Stat(filepath.Join(projectDir, ".apishark", "plugins", "demo.echo.mjs")); !os.IsNotExist(err) {
		t.Fatalf("plugin module should be removed, stat err = %v", err)
	}

	stdout, stderr, code = runForTest([]string{"collections", "delete", "--collection", "OpenAI Demo"}, "", projectDir)
	if code != 0 {
		t.Fatalf("collections delete failed: %s", stderr)
	}
	if !strings.Contains(stdout, `"name": "OpenAI Demo"`) {
		t.Fatalf("unexpected collections delete output: %s", stdout)
	}

	stdout, stderr, code = runForTest([]string{"collections", "list"}, "", projectDir)
	if code != 0 {
		t.Fatalf("collections list after delete failed: %s", stderr)
	}
	if strings.TrimSpace(stdout) != "[]" {
		t.Fatalf("collections should be empty after delete: %s", stdout)
	}
}

func TestRequestsImportParsesCurlIntoSavedRequest(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()

	stdout, stderr, code := runForTest([]string{"collections", "put", "--name", "Imported Demo", "--plugin", "openai"}, "", projectDir)
	if code != 0 {
		t.Fatalf("collections put failed: %s", stderr)
	}
	if !strings.Contains(stdout, `"name": "Imported Demo"`) {
		t.Fatalf("unexpected collection output: %s", stdout)
	}

	curlCommand := strings.Join([]string{
		"curl https://api.openai.com/v1/responses \\",
		`  -H "Authorization: Bearer {{OPENAI_API_KEY}}" \`,
		`  -H "Content-Type: application/json" \`,
		`  --data-raw '{"model":"gpt-4.1","stream":true}'`,
	}, "\n")

	stdout, stderr, code = runForTest([]string{
		"requests", "import",
		"--collection", "Imported Demo",
		"--inherit-plugin",
		"--curl", curlCommand,
	}, "", projectDir)
	if code != 0 {
		t.Fatalf("requests import failed: %s", stderr)
	}

	var request struct {
		Name    string `json:"name"`
		Method  string `json:"method"`
		URL     string `json:"url"`
		Body    string `json:"body"`
		Headers []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"headers"`
		UseCollectionAggregationPlugin bool `json:"use_collection_aggregation_plugin"`
	}
	if err := json.Unmarshal([]byte(stdout), &request); err != nil {
		t.Fatalf("unmarshal imported request output: %v", err)
	}
	if request.Method != "POST" {
		t.Fatalf("imported request method = %q, want POST", request.Method)
	}
	if request.URL != "https://api.openai.com/v1/responses" {
		t.Fatalf("imported request url = %q", request.URL)
	}
	if request.Name != "POST https://api.openai.com/v1/responses" {
		t.Fatalf("imported request default name = %q", request.Name)
	}
	if request.Body != `{"model":"gpt-4.1","stream":true}` {
		t.Fatalf("imported request body = %q", request.Body)
	}
	if len(request.Headers) != 2 {
		t.Fatalf("imported request headers = %d, want 2", len(request.Headers))
	}
	if !request.UseCollectionAggregationPlugin {
		t.Fatalf("imported request should inherit collection plugin: %s", stdout)
	}
}
