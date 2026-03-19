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

## curl import support

The CLI command `go run . requests import ...` reuses the backend curl parser and
stores only fields that APIShark's request model actually supports.

### Saved fields

Import writes these request fields into `collections.json`:

- `method`
- `url`
- `headers`
- `body`

The CLI can additionally set request metadata such as `name`, `id`, `plugin`,
`inherit-plugin`, and `timeout`.

### Supported curl syntax

Currently supported:

- Method: `-X POST`, `-XPOST`, `--request POST`, `--request=POST`
- Headers: `-H 'Key: Value'`, `--header 'Key: Value'`, `--header='Key: Value'`
- Body: `-d`, `--data`, `--data-raw`, `--data-binary`, `--data-urlencode`, and `--flag=value`
- JSON shortcut: `--json '...'`, `--json='...'`
- URL: inline `https://...` / `http://...`, `--url`, `--url=`
- Method toggles: `-I` / `--head`, `-G` / `--get`
- Multi-line commands with trailing `\`

`--json` also adds `Content-Type: application/json` and `Accept: application/json`
if those headers were not already present.

When multiple supported body flags appear, the last one wins because APIShark
stores one final request body string.

### Not imported

These do not round-trip into APIShark request storage today:

- `--form` and multipart upload semantics
- Cookie jars and cookie files
- Proxy, retry, redirect, compression, and TLS/certificate options
- Output and verbosity flags such as `-o`, `-O`, `-i`, `-v`, `-s`
- Any curl option that does not map to APIShark's stored request model

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

### Plugin module contract

A JavaScript plugin module must export:

- `id`: lowercase plugin id such as `vendor.profile`
- `label`: user-facing label
- `description`: optional description
- `create()`: a factory that returns one plugin instance for one response

The plugin instance may implement any subset of:

- `init()`
- `onRawEvent(event)`
- `onNormalizedEvent(event)`
- `onDone()`
- `finalize()`

`onRawEvent(event)` receives raw transport events:

- `seq`: monotonically increasing event number
- `transport.mode`: `body` or `sse`
- `transport.contentType`: upstream content type when known
- `transport.field`: SSE field name when known
- `rawChunk`: original raw body chunk or SSE line
- `sseData`: extracted SSE `data:` payload when present
- `parsedJson`: best-effort parsed JSON for the raw chunk or `sseData`
- `done`: whether this event is terminal
- `ts`: RFC3339 timestamp

`onNormalizedEvent(event)` runs only when APIShark parsed JSON successfully. It receives:

- `kind`: currently `json_payload`
- `parsedJson`: parsed JSON value
- `rawEvent`: the original raw event
- `seq`, `transport`, `done`, `ts`: same lifecycle metadata

Each hook may return either nothing or an update object:

```js
{
  append: [{ kind: "content", text: "..." }],
  replace: [{ kind: "thinking", text: "..." }]
}
```

Fragment kinds:

- Text: `content`, `thinking`
- Media: `image`, `video`

Media URLs must be `https:`, `http:`, `blob:`, or a matching media `data:` URL.
Unsupported or unsafe URLs are dropped by the runtime.

### Lifecycle examples

Use `init()` to seed the pane:

```js
init() {
  return { append: [{ kind: "thinking", text: "[stream opened]\n" }] };
}
```

Use `onRawEvent(event)` to inspect every SSE line or body chunk:

```js
onRawEvent(event) {
  if (!event.sseData) {
    return;
  }
  return {
    append: [{ kind: "content", text: event.sseData + "\n" }],
  };
}
```

Use `onNormalizedEvent(event)` when you only care about parsed JSON:

```js
onNormalizedEvent(event) {
  const data = event.parsedJson;
  if (!data || typeof data !== "object" || !("message" in data)) {
    return;
  }
  return {
    append: [{ kind: "content", text: String(data.message) + "\n" }],
  };
}
```

Use `onDone()` for stream completion markers:

```js
onDone() {
  return { append: [{ kind: "thinking", text: "[done]\n" }] };
}
```

Use `finalize()` when you want the final aggregate output to replace everything accumulated so far:

```js
finalize() {
  return {
    replace: [{ kind: "content", text: this.parts.join("") }],
  };
}
```

### Full plugin example

```js
export const id = "demo.echo";
export const label = "Demo Echo";
export const description = "Echoes parsed deltas and emits one final answer.";

export function create() {
  const parts = [];
  return {
    init() {
      return { append: [{ kind: "thinking", text: "[plugin ready]\n" }] };
    },
    onNormalizedEvent(event) {
      const data = event.parsedJson;
      if (!data || typeof data !== "object" || !("delta" in data)) {
        return;
      }
      const chunk = String(data.delta ?? "");
      if (!chunk) {
        return;
      }
      parts.push(chunk);
      return {
        append: [{ kind: "content", text: chunk }],
      };
    },
    finalize() {
      return {
        replace: [{ kind: "content", text: parts.join("") }],
      };
    },
  };
}
```

### JSON-wrapped plugins

You can also import a `.json` wrapper that contains metadata plus ESM source:

```json
{
  "id": "demo.wrapper",
  "label": "Demo Wrapper",
  "description": "JSON-wrapped plugin example",
  "source": "export const id = \"demo.wrapper\"; export const label = \"Demo Wrapper\"; export function create() { return {}; }"
}
```

For the full AI-oriented authoring guide and CLI examples, run:

```bash
go run . doc
```
