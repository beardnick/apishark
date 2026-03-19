# apishark

APIShark is a lightweight Postman-like tool shipped as a single Go binary.
The frontend is written in TypeScript, built into static assets, and embedded
into the Go executable via `embed`.

## Features

- Named environments with `{{VAR_NAME}}` interpolation and active switching
- Import request definition from a `curl` command
- Editable header rows with per-header enable/disable toggles
- Named collections saved to `./collections.json`, including environments and scratch drafts
- Proxy arbitrary HTTP requests from the UI
- JSON prettify and collapsible JSON viewers for request/response payloads
- Incremental streaming display for SSE responses
- Plugin-based response aggregation fed by raw streaming events
- Sent/response header inspection with environment-resolved request headers
- Muted styling for aggregated thinking/reasoning segments
- Native aggregated image/video rendering for plugin-produced media fragments

## Run

```bash
go run . -addr 127.0.0.1:18080
```

Then open:

- <http://127.0.0.1:18080>

## Build binary

```bash
go build -o apishark .
./apishark -addr 127.0.0.1:18080
```

## CLI automation

APIShark also exposes a non-interactive CLI for automation and AI agents.

Print the built-in Markdown guide:

```bash
go run . doc
```

Manage collections, requests, environments, and plugins:

```bash
go run . collections list
go run . collections put --name "OpenAI Demo" --plugin openai
go run . requests put --collection "OpenAI Demo" --name "Streaming Chat" --method POST --url "https://api.openai.com/v1/responses"
go run . requests import --collection "OpenAI Demo" --name "Imported Chat" --file openai.curl
go run . envs put --name "local" --kv "OPENAI_API_KEY=sk-example"
go run . plugins list
go run . requests delete --collection "OpenAI Demo" --request "Streaming Chat"
go run . envs delete --env "local"
```

Run `go run . doc` to get the full AI-oriented Markdown guide, including plugin authoring and command examples.

## Frontend development

Frontend source is in `frontend/src`.

```bash
cd frontend
npm install
npm run build
```

This writes browser-ready files to `frontend/dist`, which are embedded into the
Go binary by `main.go`.

## Aggregation Plugins

APIShark streams canonical `raw_event` messages from the Go server to the frontend.
Each event is delivered incrementally, one chunk or SSE line at a time, with:

- `seq`: monotonically increasing event number per response
- `transport`: metadata such as `mode`, `contentType`, and SSE `field`
- `rawChunk`: the raw body chunk or SSE line text
- `sseData`: extracted SSE `data:` payload when available
- `parsedJson`: best-effort parsed JSON for `rawChunk` or `sseData`
- `done`: marks the terminal raw event for the response stream
- `ts`: RFC3339 timestamp for when APIShark emitted the raw event

Frontend aggregation plugins implement a small lifecycle contract:
`init`, `onRawEvent`, `onNormalizedEvent`, `onDone`, and `finalize`.
Plugin updates can `append` or `replace` text/thinking fragments as well as
media fragments (`image` / `video`) with safe HTTP(S), `blob:`, or matching
media `data:` URLs.
Built-in profiles currently include `none` and `openai`. Plugin failures do not
break the request flow; the UI falls back to raw/plain rendering and shows a
readable aggregation error.
