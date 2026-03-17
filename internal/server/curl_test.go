package server

import "testing"

func TestParseCurlCommandParsesDataRawBody(t *testing.T) {
	t.Parallel()

	parsed, err := ParseCurlCommand(`curl https://api.example.test/v1/chat/completions --data-raw '{"stream":true}'`)
	if err != nil {
		t.Fatalf("ParseCurlCommand() error = %v", err)
	}

	if parsed.Method != httpMethodPost {
		t.Fatalf("method = %q, want %q", parsed.Method, httpMethodPost)
	}
	if parsed.Body != `{"stream":true}` {
		t.Fatalf("body = %q, want %q", parsed.Body, `{"stream":true}`)
	}
}

func TestParseCurlCommandParsesDataEqualsForms(t *testing.T) {
	t.Parallel()

	parsed, err := ParseCurlCommand(`curl https://api.example.test/v1/items --data-binary='{"id":1}'`)
	if err != nil {
		t.Fatalf("ParseCurlCommand() error = %v", err)
	}

	if parsed.Method != httpMethodPost {
		t.Fatalf("method = %q, want %q", parsed.Method, httpMethodPost)
	}
	if parsed.Body != `{"id":1}` {
		t.Fatalf("body = %q, want %q", parsed.Body, `{"id":1}`)
	}
}

func TestParseCurlCommandParsesJSONShortcutAndHeaders(t *testing.T) {
	t.Parallel()

	parsed, err := ParseCurlCommand(`curl https://api.example.test/v1/responses --json '{"input":"hello"}'`)
	if err != nil {
		t.Fatalf("ParseCurlCommand() error = %v", err)
	}

	if parsed.Method != httpMethodPost {
		t.Fatalf("method = %q, want %q", parsed.Method, httpMethodPost)
	}
	if parsed.Body != `{"input":"hello"}` {
		t.Fatalf("body = %q, want %q", parsed.Body, `{"input":"hello"}`)
	}
	if len(parsed.Headers) != 2 {
		t.Fatalf("header count = %d, want 2", len(parsed.Headers))
	}
	if parsed.Headers[0] != (HeaderKV{Key: "Content-Type", Value: "application/json"}) {
		t.Fatalf("content-type header = %#v, want application/json", parsed.Headers[0])
	}
	if parsed.Headers[1] != (HeaderKV{Key: "Accept", Value: "application/json"}) {
		t.Fatalf("accept header = %#v, want application/json", parsed.Headers[1])
	}
}

func TestParseCurlCommandJSONShortcutDoesNotDuplicateHeaders(t *testing.T) {
	t.Parallel()

	parsed, err := ParseCurlCommand(`curl https://api.example.test/v1/responses -H 'Content-Type: application/merge-patch+json' --json '{"input":"hello"}'`)
	if err != nil {
		t.Fatalf("ParseCurlCommand() error = %v", err)
	}

	if len(parsed.Headers) != 2 {
		t.Fatalf("header count = %d, want 2", len(parsed.Headers))
	}
	if parsed.Headers[0] != (HeaderKV{Key: "Content-Type", Value: "application/merge-patch+json"}) {
		t.Fatalf("content-type header = %#v, want preserved explicit header", parsed.Headers[0])
	}
	if parsed.Headers[1] != (HeaderKV{Key: "Accept", Value: "application/json"}) {
		t.Fatalf("accept header = %#v, want application/json", parsed.Headers[1])
	}
}

func TestParseCurlCommandParsesBackslashContinuedMultilineCurl(t *testing.T) {
	t.Parallel()

	parsed, err := ParseCurlCommand(`curl https://api.example.test/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer token-123' \
  --data-raw '{"stream":true,"messages":[{"role":"user","content":"hi"}]}'`)
	if err != nil {
		t.Fatalf("ParseCurlCommand() error = %v", err)
	}

	if parsed.URL != "https://api.example.test/v1/chat/completions" {
		t.Fatalf("url = %q, want chat completions URL", parsed.URL)
	}
	if parsed.Method != httpMethodPost {
		t.Fatalf("method = %q, want %q", parsed.Method, httpMethodPost)
	}
	if len(parsed.Headers) != 2 {
		t.Fatalf("header count = %d, want 2", len(parsed.Headers))
	}
	if parsed.Headers[0] != (HeaderKV{Key: "Content-Type", Value: "application/json"}) {
		t.Fatalf("content-type header = %#v, want application/json", parsed.Headers[0])
	}
	if parsed.Headers[1] != (HeaderKV{Key: "Authorization", Value: "Bearer token-123"}) {
		t.Fatalf("authorization header = %#v, want bearer token", parsed.Headers[1])
	}
	if parsed.Body != `{"stream":true,"messages":[{"role":"user","content":"hi"}]}` {
		t.Fatalf("body = %q, want imported JSON body", parsed.Body)
	}
}
