# apishark

APIShark is a lightweight Postman-like tool shipped as a single Go binary.
The frontend is written in TypeScript, built into static assets, and embedded
into the Go executable via `embed`.

## Features

- Environment variable support with `{{VAR_NAME}}` interpolation
- Import request definition from a `curl` command
- Editable header rows with per-header enable/disable toggles
- Named collections saved to `./collections.json`
- Proxy arbitrary HTTP requests from the UI
- JSON prettify and collapsible JSON viewers for request/response payloads
- Incremental streaming display for SSE responses
- Built-in OpenAI-style SSE aggregator for token-by-token text rendering

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

## Frontend development

Frontend source is in `frontend/src`.

```bash
cd frontend
npm install
npm run build
```

This writes browser-ready files to `frontend/dist`, which are embedded into the
Go binary by `main.go`.
