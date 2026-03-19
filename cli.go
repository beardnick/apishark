package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"apishark/internal/server"
)

func run(args []string, stdin io.Reader, stdout, stderr io.Writer, projectDir string) int {
	if len(args) == 0 || strings.HasPrefix(args[0], "-") || args[0] == "serve" {
		if err := runServer(args, stderr, projectDir, embeddedFrontend); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}

	if err := runCLI(args, stdin, stdout, stderr, projectDir); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

func runServer(args []string, stderr io.Writer, projectDir string, embedded embed.FS) error {
	if len(args) > 0 && args[0] == "serve" {
		args = args[1:]
	}

	flags := flag.NewFlagSet("apishark", flag.ContinueOnError)
	flags.SetOutput(stderr)
	addr := flags.String("addr", "127.0.0.1:18080", "listen address for HTTP server")
	if err := flags.Parse(args); err != nil {
		return err
	}

	distFS, err := fs.Sub(embedded, "frontend/dist")
	if err != nil {
		return fmt.Errorf("failed to load embedded frontend: %w", err)
	}

	handler := server.NewHandler(distFS, projectDir)
	url := fmt.Sprintf("http://%s", *addr)
	log.Printf("APIShark is running at %s", url)
	return http.ListenAndServe(*addr, handler)
}

func runCLI(args []string, stdin io.Reader, stdout, stderr io.Writer, projectDir string) error {
	switch args[0] {
	case "doc":
		_, err := io.WriteString(stdout, buildAIDoc())
		return err
	case "collections":
		return runCollectionsCLI(args[1:], stdout, stderr, projectDir)
	case "requests":
		return runRequestsCLI(args[1:], stdin, stdout, stderr, projectDir)
	case "envs":
		return runEnvsCLI(args[1:], stdin, stdout, stderr, projectDir)
	case "plugins":
		return runPluginsCLI(args[1:], stdin, stdout, stderr, projectDir)
	case "help", "-h", "--help":
		_, err := io.WriteString(stdout, buildCLIUsage())
		return err
	default:
		return fmt.Errorf("unknown command %q\n\n%s", args[0], buildCLIUsage())
	}
}

func runCollectionsCLI(args []string, stdout, stderr io.Writer, projectDir string) error {
	if len(args) == 0 {
		return fmt.Errorf("collections subcommand is required\n\n%s", buildCLIUsage())
	}

	store, err := server.LoadCollectionStore(projectDir)
	if err != nil {
		return fmt.Errorf("load collections: %w", err)
	}

	switch args[0] {
	case "list":
		return writeJSON(stdout, store.Collections)
	case "put":
		flags := flag.NewFlagSet("collections put", flag.ContinueOnError)
		flags.SetOutput(stderr)
		id := flags.String("id", "", "collection id")
		name := flags.String("name", "", "collection name")
		const unsetPlugin = "__apishark_unset_plugin__"
		plugin := flags.String("plugin", unsetPlugin, "aggregation plugin id")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		trimmedID := strings.TrimSpace(*id)
		trimmedName := strings.TrimSpace(*name)
		index := findCollectionIndex(store.Collections, trimmedID, trimmedName)
		if index < 0 && trimmedName == "" {
			return errors.New("collections put requires --name when creating a collection")
		}

		collection := server.RequestCollection{
			ID:                firstNonEmpty(trimmedID, newCLIID("collection")),
			Name:              trimmedName,
			AggregationPlugin: "",
			Requests:          []server.SavedRequest{},
		}
		if *plugin != unsetPlugin {
			collection.AggregationPlugin = strings.TrimSpace(*plugin)
		}
		if index >= 0 {
			collection = store.Collections[index]
			if trimmedID != "" {
				collection.ID = trimmedID
			}
			if trimmedName != "" {
				collection.Name = trimmedName
			}
			if *plugin != unsetPlugin {
				collection.AggregationPlugin = strings.TrimSpace(*plugin)
			}
		}

		if collection.Name == "" {
			return errors.New("collection name cannot be empty")
		}

		if index >= 0 {
			store.Collections[index] = collection
		} else {
			store.Collections = append(store.Collections, collection)
		}

		saved, err := server.SaveCollectionStore(projectDir, store)
		if err != nil {
			return fmt.Errorf("save collections: %w", err)
		}

		savedIndex := findCollectionIndex(saved.Collections, collection.ID, collection.Name)
		if savedIndex < 0 {
			return errors.New("saved collection could not be found")
		}
		return writeJSON(stdout, saved.Collections[savedIndex])
	case "delete":
		flags := flag.NewFlagSet("collections delete", flag.ContinueOnError)
		flags.SetOutput(stderr)
		collectionRef := flags.String("collection", "", "collection id or name")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		collection, err := requireCollection(store.Collections, *collectionRef)
		if err != nil {
			return err
		}
		index := findCollectionIndex(store.Collections, collection.ID, collection.Name)
		if index < 0 {
			return fmt.Errorf("collection %q was not found", strings.TrimSpace(*collectionRef))
		}

		store.Collections = append(store.Collections[:index], store.Collections[index+1:]...)
		store.RequestDrafts = pruneDraftsForCollection(store.RequestDrafts, collection.ID)

		if _, err := server.SaveCollectionStore(projectDir, store); err != nil {
			return fmt.Errorf("save collections: %w", err)
		}
		return writeJSON(stdout, collection)
	default:
		return fmt.Errorf("unknown collections subcommand %q", args[0])
	}
}

func runRequestsCLI(args []string, stdin io.Reader, stdout, stderr io.Writer, projectDir string) error {
	if len(args) == 0 {
		return fmt.Errorf("requests subcommand is required\n\n%s", buildCLIUsage())
	}

	store, err := server.LoadCollectionStore(projectDir)
	if err != nil {
		return fmt.Errorf("load collections: %w", err)
	}

	switch args[0] {
	case "list":
		flags := flag.NewFlagSet("requests list", flag.ContinueOnError)
		flags.SetOutput(stderr)
		collectionRef := flags.String("collection", "", "collection id or name")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		collection, err := requireCollection(store.Collections, *collectionRef)
		if err != nil {
			return err
		}
		return writeJSON(stdout, collection.Requests)

	case "put":
		flags := flag.NewFlagSet("requests put", flag.ContinueOnError)
		flags.SetOutput(stderr)
		collectionRef := flags.String("collection", "", "collection id or name")
		requestID := flags.String("id", "", "request id")
		name := flags.String("name", "", "request name")
		method := flags.String("method", "GET", "HTTP method")
		urlValue := flags.String("url", "", "request URL")
		body := flags.String("body", "", "request body")
		bodyFile := flags.String("body-file", "", "path to request body file")
		bodyStdin := flags.Bool("body-stdin", false, "read request body from stdin")
		plugin := flags.String("plugin", "", "aggregation plugin id")
		inheritPlugin := flags.Bool("inherit-plugin", false, "inherit collection plugin")
		timeoutSeconds := flags.Int("timeout", 120, "request timeout in seconds")
		var headers stringListValue
		flags.Var(&headers, "header", "header in the form 'Key: Value'")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		bodyText, err := resolveTextInput(stdin, *body, *bodyFile, *bodyStdin)
		if err != nil {
			return err
		}

		request := server.SavedRequest{
			ID:                             firstNonEmpty(strings.TrimSpace(*requestID), newCLIID("request")),
			Name:                           strings.TrimSpace(*name),
			Method:                         strings.ToUpper(strings.TrimSpace(*method)),
			URL:                            strings.TrimSpace(*urlValue),
			Headers:                        parseHeaders(headers),
			Body:                           bodyText,
			AggregationPlugin:              strings.TrimSpace(*plugin),
			UseCollectionAggregationPlugin: *inheritPlugin,
			TimeoutSeconds:                 *timeoutSeconds,
		}
		if request.Name == "" {
			return errors.New("requests put requires --name")
		}
		if request.URL == "" {
			return errors.New("requests put requires --url")
		}
		if request.Method == "" {
			request.Method = "GET"
		}
		if request.UseCollectionAggregationPlugin {
			request.AggregationPlugin = ""
		}
		savedRequest, err := saveRequest(projectDir, store, *collectionRef, request)
		if err != nil {
			return err
		}
		return writeJSON(stdout, savedRequest)
	case "import":
		flags := flag.NewFlagSet("requests import", flag.ContinueOnError)
		flags.SetOutput(stderr)
		collectionRef := flags.String("collection", "", "collection id or name")
		requestID := flags.String("id", "", "request id")
		name := flags.String("name", "", "request name")
		curlText := flags.String("curl", "", "curl command text")
		curlFile := flags.String("file", "", "path to a file containing a curl command")
		curlStdin := flags.Bool("stdin", false, "read curl command from stdin")
		plugin := flags.String("plugin", "", "aggregation plugin id")
		inheritPlugin := flags.Bool("inherit-plugin", false, "inherit collection plugin")
		timeoutSeconds := flags.Int("timeout", 120, "request timeout in seconds")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		input, err := resolveTextInput(stdin, *curlText, *curlFile, *curlStdin)
		if err != nil {
			return err
		}
		parsed, err := server.ParseCurlCommand(input)
		if err != nil {
			return fmt.Errorf("parse curl: %w", err)
		}

		request := server.SavedRequest{
			ID:                             firstNonEmpty(strings.TrimSpace(*requestID), newCLIID("request")),
			Name:                           firstNonEmpty(strings.TrimSpace(*name), defaultImportedRequestName(parsed)),
			Method:                         strings.ToUpper(strings.TrimSpace(parsed.Method)),
			URL:                            strings.TrimSpace(parsed.URL),
			Headers:                        savedHeadersFromKV(parsed.Headers),
			Body:                           parsed.Body,
			AggregationPlugin:              strings.TrimSpace(*plugin),
			UseCollectionAggregationPlugin: *inheritPlugin,
			TimeoutSeconds:                 *timeoutSeconds,
		}
		if request.Method == "" {
			request.Method = "GET"
		}
		if request.URL == "" {
			return errors.New("imported curl command did not include a URL")
		}
		if request.UseCollectionAggregationPlugin {
			request.AggregationPlugin = ""
		}

		savedRequest, err := saveRequest(projectDir, store, *collectionRef, request)
		if err != nil {
			return err
		}
		return writeJSON(stdout, savedRequest)
	case "delete":
		flags := flag.NewFlagSet("requests delete", flag.ContinueOnError)
		flags.SetOutput(stderr)
		collectionRef := flags.String("collection", "", "collection id or name")
		requestRef := flags.String("request", "", "request id or name")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		collectionIndex := findCollectionIndex(store.Collections, strings.TrimSpace(*collectionRef), strings.TrimSpace(*collectionRef))
		if collectionIndex < 0 {
			return fmt.Errorf("collection %q was not found", strings.TrimSpace(*collectionRef))
		}

		requests := store.Collections[collectionIndex].Requests
		requestIndex := findRequestIndex(requests, strings.TrimSpace(*requestRef), strings.TrimSpace(*requestRef))
		if requestIndex < 0 {
			return fmt.Errorf("request %q was not found", strings.TrimSpace(*requestRef))
		}

		request := requests[requestIndex]
		store.Collections[collectionIndex].Requests = append(requests[:requestIndex], requests[requestIndex+1:]...)
		store.RequestDrafts = pruneDraftsForRequest(store.RequestDrafts, store.Collections[collectionIndex].ID, request.ID)

		if _, err := server.SaveCollectionStore(projectDir, store); err != nil {
			return fmt.Errorf("save collections: %w", err)
		}
		return writeJSON(stdout, request)
	default:
		return fmt.Errorf("unknown requests subcommand %q", args[0])
	}
}

func runEnvsCLI(args []string, stdin io.Reader, stdout, stderr io.Writer, projectDir string) error {
	if len(args) == 0 {
		return fmt.Errorf("envs subcommand is required\n\n%s", buildCLIUsage())
	}

	store, err := server.LoadCollectionStore(projectDir)
	if err != nil {
		return fmt.Errorf("load collections: %w", err)
	}

	switch args[0] {
	case "list":
		return writeJSON(stdout, store.Environments)

	case "put":
		flags := flag.NewFlagSet("envs put", flag.ContinueOnError)
		flags.SetOutput(stderr)
		envID := flags.String("id", "", "environment id")
		name := flags.String("name", "", "environment name")
		text := flags.String("text", "", "environment body")
		textFile := flags.String("file", "", "path to environment file")
		textStdin := flags.Bool("stdin", false, "read environment text from stdin")
		var kvPairs stringListValue
		flags.Var(&kvPairs, "kv", "KEY=VALUE pair")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		textValue, err := resolveEnvText(stdin, *text, *textFile, *textStdin, kvPairs)
		if err != nil {
			return err
		}

		trimmedID := strings.TrimSpace(*envID)
		trimmedName := strings.TrimSpace(*name)
		index := findEnvironmentIndex(store.Environments, trimmedID, trimmedName)
		if index < 0 && trimmedName == "" {
			return errors.New("envs put requires --name when creating an environment")
		}

		env := server.EnvironmentEntry{
			ID:   firstNonEmpty(trimmedID, newCLIID("env")),
			Name: trimmedName,
			Text: textValue,
		}
		if index >= 0 {
			env = store.Environments[index]
			if trimmedID != "" {
				env.ID = trimmedID
			}
			if trimmedName != "" {
				env.Name = trimmedName
			}
			env.Text = textValue
		}
		if env.Name == "" {
			return errors.New("environment name cannot be empty")
		}

		if index >= 0 {
			store.Environments[index] = env
		} else {
			store.Environments = append(store.Environments, env)
		}

		saved, err := server.SaveCollectionStore(projectDir, store)
		if err != nil {
			return fmt.Errorf("save collections: %w", err)
		}
		savedIndex := findEnvironmentIndex(saved.Environments, env.ID, env.Name)
		if savedIndex < 0 {
			return errors.New("saved environment could not be found")
		}
		return writeJSON(stdout, saved.Environments[savedIndex])

	case "activate":
		flags := flag.NewFlagSet("envs activate", flag.ContinueOnError)
		flags.SetOutput(stderr)
		envRef := flags.String("env", "", "environment id or name")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		env, err := requireEnvironment(store.Environments, *envRef)
		if err != nil {
			return err
		}
		store.ActiveEnvironmentID = env.ID
		saved, err := server.SaveCollectionStore(projectDir, store)
		if err != nil {
			return fmt.Errorf("save collections: %w", err)
		}
		return writeJSON(stdout, map[string]string{
			"active_environment_id": saved.ActiveEnvironmentID,
		})
	case "delete":
		flags := flag.NewFlagSet("envs delete", flag.ContinueOnError)
		flags.SetOutput(stderr)
		envRef := flags.String("env", "", "environment id or name")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		env, err := requireEnvironment(store.Environments, *envRef)
		if err != nil {
			return err
		}
		index := findEnvironmentIndex(store.Environments, env.ID, env.Name)
		if index < 0 {
			return fmt.Errorf("environment %q was not found", strings.TrimSpace(*envRef))
		}
		store.Environments = append(store.Environments[:index], store.Environments[index+1:]...)
		if store.ActiveEnvironmentID == env.ID {
			store.ActiveEnvironmentID = ""
		}

		if _, err := server.SaveCollectionStore(projectDir, store); err != nil {
			return fmt.Errorf("save collections: %w", err)
		}
		return writeJSON(stdout, env)
	default:
		return fmt.Errorf("unknown envs subcommand %q", args[0])
	}
}

func runPluginsCLI(args []string, stdin io.Reader, stdout, stderr io.Writer, projectDir string) error {
	if len(args) == 0 {
		return fmt.Errorf("plugins subcommand is required\n\n%s", buildCLIUsage())
	}

	switch args[0] {
	case "list":
		store, err := server.LoadPluginStore(projectDir)
		if err != nil {
			return fmt.Errorf("load plugins: %w", err)
		}
		return writeJSON(stdout, store.Plugins)

	case "import":
		flags := flag.NewFlagSet("plugins import", flag.ContinueOnError)
		flags.SetOutput(stderr)
		filePath := flags.String("file", "", "path to plugin source")
		inlineSource := flags.String("source", "", "plugin source text")
		sourceStdin := flags.Bool("stdin", false, "read plugin source from stdin")
		pluginID := flags.String("id", "", "plugin id")
		label := flags.String("label", "", "plugin label")
		description := flags.String("description", "", "plugin description")
		format := flags.String("format", "", "plugin format: js or json")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		source, err := resolveTextInput(stdin, *inlineSource, *filePath, *sourceStdin)
		if err != nil {
			return err
		}

		fileName := "plugin.js"
		if strings.TrimSpace(*filePath) != "" {
			fileName = filepath.Base(strings.TrimSpace(*filePath))
		}
		resolvedFormat := strings.ToLower(strings.TrimSpace(*format))
		if resolvedFormat == "" {
			switch strings.ToLower(filepath.Ext(fileName)) {
			case ".json":
				resolvedFormat = "json"
			default:
				resolvedFormat = "js"
			}
		}

		plugin, err := server.ImportPlugin(projectDir, server.PluginImportPayload{
			FileName:    fileName,
			ID:          strings.TrimSpace(*pluginID),
			Label:       strings.TrimSpace(*label),
			Description: strings.TrimSpace(*description),
			Source:      source,
			Format:      resolvedFormat,
		})
		if err != nil {
			return fmt.Errorf("import plugin: %w", err)
		}
		return writeJSON(stdout, plugin)
	case "delete":
		flags := flag.NewFlagSet("plugins delete", flag.ContinueOnError)
		flags.SetOutput(stderr)
		pluginID := flags.String("plugin", "", "plugin id")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}

		plugin, err := server.DeletePlugin(projectDir, strings.TrimSpace(*pluginID))
		if err != nil {
			return fmt.Errorf("delete plugin: %w", err)
		}
		return writeJSON(stdout, plugin)
	default:
		return fmt.Errorf("unknown plugins subcommand %q", args[0])
	}
}

func buildCLIUsage() string {
	return strings.TrimSpace(`
Usage:
  apishark serve [-addr 127.0.0.1:18080]
  apishark doc
  apishark collections list
  apishark collections put --name NAME [--id ID] [--plugin PLUGIN]
  apishark collections delete --collection COLLECTION
  apishark requests list --collection COLLECTION
  apishark requests put --collection COLLECTION --name NAME --method METHOD --url URL [--header 'Key: Value']... [--body TEXT | --body-file PATH | --body-stdin] [--plugin PLUGIN | --inherit-plugin] [--timeout 120]
  apishark requests import --collection COLLECTION [--name NAME] [--id ID] [--curl TEXT | --file PATH | --stdin] [--plugin PLUGIN | --inherit-plugin] [--timeout 120]
  apishark requests delete --collection COLLECTION --request REQUEST
  apishark envs list
  apishark envs put --name NAME [--id ID] [--text TEXT | --file PATH | --stdin | --kv KEY=VALUE ...]
  apishark envs activate --env ENVIRONMENT
  apishark envs delete --env ENVIRONMENT
  apishark plugins list
  apishark plugins import --file PATH [--format js|json] --id ID --label LABEL [--description TEXT]
  apishark plugins delete --plugin PLUGIN_ID
`)
}

func buildAIDoc() string {
	lines := []string{
		"# APIShark CLI Guide For AI Agents",
		"",
		"This command set lets an AI mutate the project-local `collections.json` and `.apishark/plugins.json` files without editing JSON manually.",
		"Every mutating command prints the saved JSON object to stdout, so your next step can parse it directly.",
		"",
		"## Working Directory",
		"",
		"Run the commands from the APIShark project root. The CLI reads and writes:",
		"",
		"- `./collections.json` for collections, requests, environments, and request drafts",
		"- `.apishark/plugins.json` plus `.apishark/plugins/*.mjs` for imported aggregation plugins",
		"",
		"## Collection Commands",
		"",
		"Create or update a collection:",
		"",
		"```bash",
		`apishark collections put --name "OpenAI Demo" --plugin openai`,
		"```",
		"",
		"List collections:",
		"",
		"```bash",
		"apishark collections list",
		"```",
		"",
		"Delete one collection and its saved request drafts:",
		"",
		"```bash",
		`apishark collections delete --collection "OpenAI Demo"`,
		"```",
		"",
		"## Request Commands",
		"",
		"Create or replace a request inside a collection:",
		"",
		"```bash",
		`apishark requests put \`,
		`  --collection "OpenAI Demo" \`,
		`  --name "Streaming Chat" \`,
		`  --method POST \`,
		`  --url "https://api.openai.com/v1/responses" \`,
		`  --header "Authorization: Bearer {{OPENAI_API_KEY}}" \`,
		`  --header "Content-Type: application/json" \`,
		`  --body-file request-body.json \`,
		`  --plugin openai \`,
		`  --timeout 120`,
		"```",
		"",
		"Import a request from an existing curl command:",
		"",
		"```bash",
		`apishark requests import \`,
		`  --collection "OpenAI Demo" \`,
		`  --name "Imported Chat" \`,
		`  --file openai.curl \`,
		`  --inherit-plugin`,
		"```",
		"",
		"Notes:",
		"",
		"- `requests put` is an upsert. Match is by request `--id` when provided, otherwise by exact request `--name` inside the chosen collection.",
		"- `requests import` reuses the existing curl parser and saves the parsed method, URL, headers, and body into `collections.json`.",
		"- Use `--inherit-plugin` when the request should inherit the collection-level aggregation plugin instead of overriding it.",
		"- For large request bodies, prefer `--body-file` or `--body-stdin`.",
		"",
		"### curl Import Support",
		"",
		"`requests import` writes these APIShark request fields:",
		"",
		"- `method`",
		"- `url`",
		"- `headers`",
		"- `body`",
		"- plus CLI-only request metadata such as `name`, `id`, `plugin`, `inherit-plugin`, and `timeout`",
		"",
		"Supported curl inputs currently include:",
		"",
		"- Request method: `-X POST`, `-XPOST`, `--request POST`, `--request=POST`",
		"- Headers: `-H 'Key: Value'`, `--header 'Key: Value'`, `--header='Key: Value'`",
		"- Body flags: `-d`, `--data`, `--data-raw`, `--data-binary`, `--data-urlencode`, and their `--flag=value` forms",
		"- JSON body shortcuts: `--json '...'` and `--json='...'`",
		"- URL forms: inline `https://...`, `http://...`, `--url https://...`, `--url=https://...`",
		"- Method-changing flags: `-I` / `--head`, `-G` / `--get`",
		"- Multi-line curl commands that use trailing backslash continuation",
		"",
		"`--json` import behavior:",
		"",
		"- Saves the provided JSON text into `body`",
		"- Defaults method to `POST` when the curl command did not already choose a method",
		"- Adds `Content-Type: application/json` if not already present",
		"- Adds `Accept: application/json` if not already present",
		"",
		"When curl contains multiple body flags, the last supported body flag wins because APIShark stores one final body string.",
		"",
		"Unsupported or ignored curl content:",
		"",
		"- `--form`, multipart upload semantics, and file upload expansion",
		"- Cookies, cookie jars, auth helpers outside explicit headers, and browser-style session state",
		"- Proxy, retry, redirect, compression, and TLS/certificate options",
		"- Output flags such as `-o`, `-O`, `-i`, `-v`, `-s`",
		"- Any curl option that does not map onto APIShark's stored request model",
		"",
		"AI guidance:",
		"",
		"- Use `requests import` when you already have a curl command.",
		"- Use `requests put` when you want explicit control over the stored APIShark fields.",
		"- Do not assume unsupported curl flags survive import unless they become a header, method, URL, or body value in the saved request.",
		"",
		"List requests for one collection:",
		"",
		"```bash",
		`apishark requests list --collection "OpenAI Demo"`,
		"```",
		"",
		"Delete one request from a collection:",
		"",
		"```bash",
		`apishark requests delete --collection "OpenAI Demo" --request "Streaming Chat"`,
		"```",
		"",
		"## Environment Commands",
		"",
		"Create or replace an environment from explicit key/value lines:",
		"",
		"```bash",
		`apishark envs put \`,
		`  --name "local" \`,
		`  --kv "OPENAI_API_KEY=sk-example" \`,
		`  --kv "BASE_URL=https://api.openai.com"`,
		"```",
		"",
		"Create or replace an environment from a file:",
		"",
		"```bash",
		"apishark envs put --name \"staging\" --file staging.env",
		"```",
		"",
		"Activate an environment:",
		"",
		"```bash",
		"apishark envs activate --env \"local\"",
		"```",
		"",
		"List environments:",
		"",
		"```bash",
		"apishark envs list",
		"```",
		"",
		"Delete an environment:",
		"",
		"```bash",
		"apishark envs delete --env \"local\"",
		"```",
		"",
		"Environment text is stored exactly as newline-separated `KEY=VALUE` lines. Requests can reference them with placeholders such as `{{OPENAI_API_KEY}}`.",
		"",
		"## Plugin Authoring",
		"",
		"APIShark aggregation plugins are ESM modules loaded in the browser. A JavaScript plugin must export:",
		"",
		"- `id`: lowercase plugin id, for example `vendor.profile`",
		"- `label`: human-readable name shown in the UI",
		"- `description`: optional description shown in the UI",
		"- `create()`: factory returning one plugin instance for one response lifecycle",
		"",
		"`create()` must return an object. Only these extension functions are allowed on that object:",
		"",
		"- `init()` runs once when the runtime starts. Use it to seed the aggregate pane or initialize internal state.",
		"- `onRawEvent(event)` runs for every raw chunk or SSE line. Use it when you want full access to the transport stream, including partial payloads.",
		"- `onNormalizedEvent(event)` runs only when APIShark successfully parsed a JSON payload from the current raw event. Use it when you prefer structured JSON over manual parsing.",
		"- `onDone()` runs when the upstream response stream reaches its terminal event. Use it for last-minute flush behavior tied to stream completion.",
		"- `finalize()` runs after `onDone()` and is the last hook. Use it for cleanup-derived output, final summaries, or replacing the whole aggregate result.",
		"",
		"### Event Shapes",
		"",
		"`onRawEvent(event)` receives:",
		"",
		"- `event.seq`: monotonically increasing event number within the response",
		"- `event.transport.mode`: `body` or `sse`",
		"- `event.transport.contentType`: upstream content type when known",
		"- `event.transport.field`: SSE field name when the current line came from a field like `data:`",
		"- `event.rawChunk`: original raw body chunk or SSE line text",
		"- `event.sseData`: extracted `data:` payload when present",
		"- `event.parsedJson`: best-effort parsed JSON for the raw chunk or `sseData`",
		"- `event.done`: whether this raw event is terminal",
		"- `event.ts`: RFC3339 timestamp emitted by APIShark",
		"",
		"`onNormalizedEvent(event)` receives:",
		"",
		"- `event.kind`: currently always `json_payload`",
		"- `event.parsedJson`: parsed JSON value for the current payload",
		"- `event.rawEvent`: the original raw event that produced this normalized event",
		"- `event.seq`, `event.transport`, `event.done`, `event.ts`: same lifecycle metadata as the raw event",
		"",
		"### Return Value",
		"",
		"Each extension function may return either nothing or an update object:",
		"",
		"```js",
		"{",
		`  append: [{ kind: "content", text: "..." }],`,
		`  replace: [{ kind: "thinking", text: "..." }]`,
		"}",
		"```",
		"",
		"Rules:",
		"",
		"- `append` adds fragments to the current aggregate output.",
		"- `replace` replaces the entire aggregate output with the provided fragments.",
		"- Text fragment kinds are `content` and `thinking`.",
		"- Media fragment kinds are `image` and `video`.",
		"- Media URLs must be `https:`, `http:`, `blob:`, or a matching media `data:` URL. Unsupported or unsafe URLs are dropped.",
		"- Adjacent text fragments of the same kind are merged by the runtime.",
		"",
		"### Fragment Examples",
		"",
		"Append user-visible content:",
		"",
		"```js",
		`return { append: [{ kind: "content", text: "Hello\n" }] };`,
		"```",
		"",
		"Append muted reasoning text:",
		"",
		"```js",
		`return { append: [{ kind: "thinking", text: "model is planning...\n" }] };`,
		"```",
		"",
		"Replace the full aggregate pane with one final answer:",
		"",
		"```js",
		`return { replace: [{ kind: "content", text: finalText }] };`,
		"```",
		"",
		"Append an image:",
		"",
		"```js",
		`return { append: [{ kind: "image", url: imageURL, alt: "preview" }] };`,
		"```",
		"",
		"Append a video:",
		"",
		"```js",
		`return { append: [{ kind: "video", url: videoURL, mime: "video/mp4", title: "generation" }] };`,
		"```",
		"",
		"### Lifecycle Examples",
		"",
		"`init()` example: seed the pane with a banner.",
		"",
		"```js",
		"init() {",
		`  return { append: [{ kind: "thinking", text: "[stream opened]\n" }] };`,
		"}",
		"```",
		"",
		"`onRawEvent(event)` example: echo every SSE `data:` payload.",
		"",
		"```js",
		"onRawEvent(event) {",
		"  if (!event.sseData) {",
		"    return;",
		"  }",
		"  return {",
		`    append: [{ kind: "content", text: event.sseData + "\n" }],`,
		"  };",
		"}",
		"```",
		"",
		"`onNormalizedEvent(event)` example: extract one field from parsed JSON.",
		"",
		"```js",
		"onNormalizedEvent(event) {",
		"  const data = event.parsedJson;",
		`  if (!data || typeof data !== "object" || !("message" in data)) {`,
		"    return;",
		"  }",
		"  return {",
		`    append: [{ kind: "content", text: String(data.message) + "\n" }],`,
		"  };",
		"}",
		"```",
		"",
		"`onDone()` example: add a completion marker.",
		"",
		"```js",
		"onDone() {",
		`  return { append: [{ kind: "thinking", text: "[done]\n" }] };`,
		"}",
		"```",
		"",
		"`finalize()` example: collapse buffered chunks into one final answer.",
		"",
		"```js",
		"finalize() {",
		"  return {",
		`    replace: [{ kind: "content", text: this.parts.join("") }],`,
		"  };",
		"}",
		"```",
		"",
		"### Full JavaScript Plugin Example",
		"",
		"```js",
		`export const id = "demo.echo";`,
		`export const label = "Demo Echo";`,
		`export const description = "Echoes SSE payloads and emits a final joined answer.";`,
		"",
		"export function create() {",
		"  const parts = [];",
		"  return {",
		"    init() {",
		`      return { append: [{ kind: "thinking", text: "[plugin ready]\n" }] };`,
		"    },",
		"    onNormalizedEvent(event) {",
		"      const data = event.parsedJson;",
		`      if (!data || typeof data !== "object" || !("delta" in data)) {`,
		"        return;",
		"      }",
		"      const chunk = String(data.delta ?? \"\");",
		"      if (!chunk) {",
		"        return;",
		"      }",
		"      parts.push(chunk);",
		"      return {",
		`        append: [{ kind: "content", text: chunk }],`,
		"      };",
		"    },",
		"    finalize() {",
		"      return {",
		`        replace: [{ kind: "content", text: parts.join("") }],`,
		"      };",
		"    },",
		"  };",
		"}",
		"```",
		"",
		"### JSON Plugin Wrapper Example",
		"",
		"A `.json` plugin file wraps metadata plus ESM source code:",
		"",
		"```json",
		"{",
		`  "id": "demo.wrapper",`,
		`  "label": "Demo Wrapper",`,
		`  "description": "JSON-wrapped plugin example",`,
		`  "source": "export const id = \\"demo.wrapper\\"; export const label = \\"Demo Wrapper\\"; export function create() { return {}; }"`,
		"}",
		"```",
		"",
		"Import the plugin file:",
		"",
		"```bash",
		`apishark plugins import \`,
		`  --file demo-echo.js \`,
		`  --id demo.echo \`,
		`  --label "Demo Echo" \`,
		`  --description "Echoes SSE payloads into the aggregate pane"`,
		"```",
		"",
		"List imported plugins:",
		"",
		"```bash",
		"apishark plugins list",
		"```",
		"",
		"Delete an imported plugin:",
		"",
		"```bash",
		"apishark plugins delete --plugin demo.echo",
		"```",
		"",
		"## Recommended AI Workflow",
		"",
		"1. Use `apishark doc` to load this guide.",
		"2. Create or update the target collection with `collections put`.",
		"3. Generate request bodies as files when they are multi-line JSON, then call `requests put --body-file ...`.",
		"4. Generate environment variables with `envs put --kv ...` or `envs put --file ...`.",
		"5. If custom aggregation is needed, write an ESM plugin and import it with `plugins import`.",
		"",
		"## Output Contract",
		"",
		"- Success: pretty-printed JSON on stdout",
		"- Failure: non-zero exit code and an error message on stderr",
	}
	return strings.Join(lines, "\n") + "\n"
}

type stringListValue []string

func (v *stringListValue) String() string {
	return strings.Join(*v, ",")
}

func (v *stringListValue) Set(input string) error {
	*v = append(*v, input)
	return nil
}

func writeJSON(w io.Writer, payload any) error {
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	return encoder.Encode(payload)
}

func resolveTextInput(stdin io.Reader, inline, filePath string, useStdin bool) (string, error) {
	sources := 0
	if strings.TrimSpace(inline) != "" {
		sources++
	}
	if strings.TrimSpace(filePath) != "" {
		sources++
	}
	if useStdin {
		sources++
	}
	if sources > 1 {
		return "", errors.New("choose only one of inline text, file, or stdin")
	}

	switch {
	case strings.TrimSpace(filePath) != "":
		data, err := os.ReadFile(strings.TrimSpace(filePath))
		if err != nil {
			return "", fmt.Errorf("read file %q: %w", filePath, err)
		}
		return string(data), nil
	case useStdin:
		data, err := io.ReadAll(stdin)
		if err != nil {
			return "", fmt.Errorf("read stdin: %w", err)
		}
		return string(data), nil
	default:
		return inline, nil
	}
}

func resolveEnvText(stdin io.Reader, inline, filePath string, useStdin bool, kvPairs []string) (string, error) {
	text, err := resolveTextInput(stdin, inline, filePath, useStdin)
	if err != nil {
		return "", err
	}
	if len(kvPairs) == 0 {
		return text, nil
	}
	if strings.TrimSpace(text) != "" {
		return "", errors.New("choose either --text/--file/--stdin or --kv, not both")
	}

	lines := make([]string, 0, len(kvPairs))
	for _, pair := range kvPairs {
		if !strings.Contains(pair, "=") {
			return "", fmt.Errorf("invalid --kv value %q, expected KEY=VALUE", pair)
		}
		lines = append(lines, pair)
	}
	return strings.Join(lines, "\n"), nil
}

func parseHeaders(values []string) []server.SavedHeader {
	headers := make([]server.SavedHeader, 0, len(values))
	for _, value := range values {
		key, headerValue, ok := strings.Cut(value, ":")
		if !ok {
			continue
		}
		headers = append(headers, server.SavedHeader{
			Key:     strings.TrimSpace(key),
			Value:   strings.TrimSpace(headerValue),
			Enabled: true,
		})
	}
	return headers
}

func savedHeadersFromKV(values []server.HeaderKV) []server.SavedHeader {
	headers := make([]server.SavedHeader, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value.Key) == "" {
			continue
		}
		headers = append(headers, server.SavedHeader{
			Key:     strings.TrimSpace(value.Key),
			Value:   strings.TrimSpace(value.Value),
			Enabled: true,
		})
	}
	return headers
}

func findCollectionIndex(collections []server.RequestCollection, id, name string) int {
	trimmedID := strings.TrimSpace(id)
	trimmedName := strings.TrimSpace(name)
	if trimmedID != "" {
		for index, collection := range collections {
			if collection.ID == trimmedID {
				return index
			}
		}
	}
	if trimmedName != "" {
		for index, collection := range collections {
			if collection.Name == trimmedName {
				return index
			}
		}
	}
	return -1
}

func requireCollection(collections []server.RequestCollection, ref string) (server.RequestCollection, error) {
	index := findCollectionIndex(collections, ref, ref)
	if index < 0 {
		return server.RequestCollection{}, fmt.Errorf("collection %q was not found", strings.TrimSpace(ref))
	}
	return collections[index], nil
}

func findRequestIndex(requests []server.SavedRequest, id, name string) int {
	trimmedID := strings.TrimSpace(id)
	trimmedName := strings.TrimSpace(name)
	if trimmedID != "" {
		for index, request := range requests {
			if request.ID == trimmedID {
				return index
			}
		}
	}
	if trimmedName != "" {
		for index, request := range requests {
			if request.Name == trimmedName {
				return index
			}
		}
	}
	return -1
}

func findEnvironmentIndex(entries []server.EnvironmentEntry, id, name string) int {
	trimmedID := strings.TrimSpace(id)
	trimmedName := strings.TrimSpace(name)
	if trimmedID != "" {
		for index, entry := range entries {
			if entry.ID == trimmedID {
				return index
			}
		}
	}
	if trimmedName != "" {
		for index, entry := range entries {
			if entry.Name == trimmedName {
				return index
			}
		}
	}
	return -1
}

func requireEnvironment(entries []server.EnvironmentEntry, ref string) (server.EnvironmentEntry, error) {
	index := findEnvironmentIndex(entries, ref, ref)
	if index < 0 {
		return server.EnvironmentEntry{}, fmt.Errorf("environment %q was not found", strings.TrimSpace(ref))
	}
	return entries[index], nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func defaultImportedRequestName(parsed *server.ParsedCurl) string {
	if parsed == nil {
		return "Imported Request"
	}
	if parsed.Method != "" && parsed.URL != "" {
		return fmt.Sprintf("%s %s", strings.ToUpper(parsed.Method), strings.TrimSpace(parsed.URL))
	}
	if parsed.URL != "" {
		return strings.TrimSpace(parsed.URL)
	}
	return "Imported Request"
}

func newCLIID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, time.Now().UTC().UnixNano())
}

func saveRequest(
	projectDir string,
	store server.CollectionStore,
	collectionRef string,
	request server.SavedRequest,
) (server.SavedRequest, error) {
	collectionIndex := findCollectionIndex(store.Collections, strings.TrimSpace(collectionRef), strings.TrimSpace(collectionRef))
	if collectionIndex < 0 {
		return server.SavedRequest{}, fmt.Errorf("collection %q was not found", strings.TrimSpace(collectionRef))
	}

	requests := store.Collections[collectionIndex].Requests
	requestIndex := findRequestIndex(requests, request.ID, request.Name)
	if requestIndex >= 0 {
		requests[requestIndex] = request
	} else {
		requests = append(requests, request)
	}
	store.Collections[collectionIndex].Requests = requests

	saved, err := server.SaveCollectionStore(projectDir, store)
	if err != nil {
		return server.SavedRequest{}, fmt.Errorf("save collections: %w", err)
	}
	savedCollection, err := requireCollection(saved.Collections, store.Collections[collectionIndex].ID)
	if err != nil {
		return server.SavedRequest{}, err
	}
	savedRequestIndex := findRequestIndex(savedCollection.Requests, request.ID, request.Name)
	if savedRequestIndex < 0 {
		return server.SavedRequest{}, errors.New("saved request could not be found")
	}
	return savedCollection.Requests[savedRequestIndex], nil
}

func pruneDraftsForCollection(drafts []server.PersistedRequestDraft, collectionID string) []server.PersistedRequestDraft {
	if len(drafts) == 0 {
		return drafts
	}
	next := make([]server.PersistedRequestDraft, 0, len(drafts))
	for _, draft := range drafts {
		if draft.CollectionID == collectionID {
			continue
		}
		next = append(next, draft)
	}
	return next
}

func pruneDraftsForRequest(
	drafts []server.PersistedRequestDraft,
	collectionID string,
	requestID string,
) []server.PersistedRequestDraft {
	if len(drafts) == 0 {
		return drafts
	}
	next := make([]server.PersistedRequestDraft, 0, len(drafts))
	for _, draft := range drafts {
		if draft.CollectionID == collectionID && draft.RequestID == requestID {
			continue
		}
		next = append(next, draft)
	}
	return next
}

func runForTest(args []string, stdinText string, projectDir string) (stdout string, stderr string, code int) {
	var stdoutBuffer bytes.Buffer
	var stderrBuffer bytes.Buffer
	code = run(args, strings.NewReader(stdinText), &stdoutBuffer, &stderrBuffer, projectDir)
	return stdoutBuffer.String(), stderrBuffer.String(), code
}
