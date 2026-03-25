package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleSendRequestResolvesHeaderPlaceholdersAndReportsSentHeaders(t *testing.T) {
	t.Parallel()

	type upstreamRequest struct {
		body          string
		authorization string
		traceID       string
	}

	upstreamSeen := make(chan upstreamRequest, 1)
	client := &http.Client{
		Transport: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			body, _ := io.ReadAll(r.Body)

			upstreamSeen <- upstreamRequest{
				body:          string(body),
				authorization: r.Header.Get("Authorization"),
				traceID:       r.Header.Get("X-Trace"),
			}

			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Header: http.Header{
					"Content-Type": []string{"application/json"},
					"X-Upstream":   []string{"ok"},
				},
				Body:    io.NopCloser(strings.NewReader(`{"ok":true}`)),
				Request: r,
			}, nil
		}),
	}

	payload := SendRequestPayload{
		Method: "POST",
		URL:    "https://upstream.example.test/v1/chat/completions",
		Headers: []HeaderKV{
			{Key: "Authorization", Value: "Bearer {{TOKEN}}"},
			{Key: "X-Trace", Value: "req-{{REQUEST_ID}}"},
		},
		Body: `{"token":"{{TOKEN}}"}`,
		Env: map[string]string{
			"TOKEN":      "secret-token",
			"REQUEST_ID": "1234",
		},
	}

	requestBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/request", bytes.NewReader(requestBody))
	(&server{httpClient: client}).handleSendRequest(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("handleSendRequest() status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.Contains(got, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want SSE content type", got)
	}

	select {
	case seen := <-upstreamSeen:
		if seen.body != `{"token":"secret-token"}` {
			t.Fatalf("upstream body = %q, want %q", seen.body, `{"token":"secret-token"}`)
		}
		if seen.authorization != "Bearer secret-token" {
			t.Fatalf("upstream Authorization = %q, want %q", seen.authorization, "Bearer secret-token")
		}
		if seen.traceID != "req-1234" {
			t.Fatalf("upstream X-Trace = %q, want %q", seen.traceID, "req-1234")
		}
	default:
		t.Fatal("upstream request was not observed")
	}

	events := parseSSEEvents(t, recorder.Body.String())
	meta := firstEventByType(t, events, "meta")

	sentHeaders := nestedStringMap(t, meta, "sent_headers")
	if got := sentHeaders["Authorization"]; got != "Bearer secret-token" {
		t.Fatalf("meta sent Authorization = %q, want %q", got, "Bearer secret-token")
	}
	if got := sentHeaders["X-Trace"]; got != "req-1234" {
		t.Fatalf("meta sent X-Trace = %q, want %q", got, "req-1234")
	}

	responseHeaders := nestedStringMap(t, meta, "response_headers")
	if got := responseHeaders["X-Upstream"]; got != "ok" {
		t.Fatalf("meta response X-Upstream = %q, want %q", got, "ok")
	}

	rawEvents := eventsByType(events, "raw_event")
	if len(rawEvents) != 2 {
		t.Fatalf("raw_event count = %d, want 2", len(rawEvents))
	}

	firstRaw := rawEvents[0]
	if got := intValue(t, firstRaw, "seq"); got != 1 {
		t.Fatalf("first raw_event seq = %d, want 1", got)
	}
	if got := stringValue(t, firstRaw, "rawChunk"); got != `{"ok":true}` {
		t.Fatalf("first raw_event rawChunk = %q, want %q", got, `{"ok":true}`)
	}
	transport := nestedMap(t, firstRaw, "transport")
	if got := stringValue(t, transport, "mode"); got != "body" {
		t.Fatalf("first raw_event transport.mode = %q, want %q", got, "body")
	}
	if got := stringValue(t, transport, "contentType"); got != "application/json" {
		t.Fatalf("first raw_event transport.contentType = %q, want %q", got, "application/json")
	}
	if parsed := nestedMap(t, firstRaw, "parsedJson"); boolValue(t, parsed, "ok") != true {
		t.Fatalf("first raw_event parsedJson.ok = %v, want true", parsed["ok"])
	}

	lastRaw := rawEvents[1]
	if got := intValue(t, lastRaw, "seq"); got != 2 {
		t.Fatalf("done raw_event seq = %d, want 2", got)
	}
	if !boolValue(t, lastRaw, "done") {
		t.Fatal("done raw_event done = false, want true")
	}
}

func TestHandleSendRequestStreamsSSERawEventsWithParsedJSON(t *testing.T) {
	t.Parallel()

	client := &http.Client{
		Transport: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Header: http.Header{
					"Content-Type": []string{"text/event-stream"},
				},
				Body: io.NopCloser(strings.NewReader(strings.Join([]string{
					`data: {"choices":[{"delta":{"reasoning":"plan "}}]}`,
					`data: {"choices":[{"delta":{"content":"answer"}}]}`,
					`data: [DONE]`,
					"",
					"",
				}, "\n"))),
				Request: r,
			}, nil
		}),
	}

	payload := SendRequestPayload{
		Method:            "POST",
		URL:               "https://upstream.example.test/v1/responses",
		AggregationPlugin: "openai",
	}

	requestBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/request", bytes.NewReader(requestBody))
	(&server{httpClient: client}).handleSendRequest(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("handleSendRequest() status = %d, want %d", recorder.Code, http.StatusOK)
	}

	events := parseSSEEvents(t, recorder.Body.String())
	rawEvents := eventsByType(events, "raw_event")
	if len(rawEvents) != 5 {
		t.Fatalf("raw_event count = %d, want 5", len(rawEvents))
	}

	firstRaw := rawEvents[0]
	if got := stringValue(t, nestedMap(t, firstRaw, "transport"), "mode"); got != "sse" {
		t.Fatalf("first raw_event transport.mode = %q, want %q", got, "sse")
	}
	if got := stringValue(t, firstRaw, "sseData"); got != `{"choices":[{"delta":{"reasoning":"plan "}}]}` {
		t.Fatalf("first raw_event sseData = %q", got)
	}
	parsed := nestedMap(t, firstRaw, "parsedJson")
	choices, ok := parsed["choices"].([]any)
	if !ok || len(choices) != 1 {
		t.Fatalf("first raw_event parsedJson.choices = %#v, want 1 choice", parsed["choices"])
	}

	donePayload := rawEvents[2]
	if got := stringValue(t, donePayload, "sseData"); got != "[DONE]" {
		t.Fatalf("done payload sseData = %q, want %q", got, "[DONE]")
	}

	doneEvent := rawEvents[len(rawEvents)-1]
	if !boolValue(t, doneEvent, "done") {
		t.Fatal("final raw_event done = false, want true")
	}
}

func TestHandleSendRequestBuildsFormURLEncodedBodyAndContentType(t *testing.T) {
	t.Parallel()

	type upstreamRequest struct {
		body        string
		contentType string
	}

	upstreamSeen := make(chan upstreamRequest, 1)
	client := &http.Client{
		Transport: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			body, _ := io.ReadAll(r.Body)

			upstreamSeen <- upstreamRequest{
				body:        string(body),
				contentType: r.Header.Get("Content-Type"),
			}

			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Header: http.Header{
					"Content-Type": []string{"application/json"},
				},
				Body:    io.NopCloser(strings.NewReader(`{"ok":true}`)),
				Request: r,
			}, nil
		}),
	}

	payload := SendRequestPayload{
		Method:   "POST",
		URL:      "https://upstream.example.test/login",
		BodyMode: "form_urlencoded",
		BodyFields: []BodyFieldKV{
			{Key: "username", Value: "{{USER}}", Enabled: true},
			{Key: "token", Value: "Bearer {{TOKEN}}", Enabled: true},
			{Key: "disabled", Value: "skip", Enabled: false},
		},
		Env: map[string]string{
			"USER":  "alice@example.com",
			"TOKEN": "secret token",
		},
	}

	requestBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/request", bytes.NewReader(requestBody))
	(&server{httpClient: client}).handleSendRequest(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("handleSendRequest() status = %d, want %d", recorder.Code, http.StatusOK)
	}

	select {
	case seen := <-upstreamSeen:
		if seen.body != "username=alice%40example.com&token=Bearer+secret+token" {
			t.Fatalf("upstream body = %q, want form-urlencoded payload", seen.body)
		}
		if seen.contentType != "application/x-www-form-urlencoded" {
			t.Fatalf("upstream Content-Type = %q, want application/x-www-form-urlencoded", seen.contentType)
		}
	default:
		t.Fatal("upstream request was not observed")
	}
}

func TestHandleSendRequestBuildsMultipartBodyAndRespectsExplicitContentType(t *testing.T) {
	t.Parallel()

	type upstreamRequest struct {
		body        string
		contentType string
	}

	upstreamSeen := make(chan upstreamRequest, 1)
	client := &http.Client{
		Transport: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			body, _ := io.ReadAll(r.Body)

			upstreamSeen <- upstreamRequest{
				body:        string(body),
				contentType: r.Header.Get("Content-Type"),
			}

			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Header: http.Header{
					"Content-Type": []string{"application/json"},
				},
				Body:    io.NopCloser(strings.NewReader(`{"ok":true}`)),
				Request: r,
			}, nil
		}),
	}

	payload := SendRequestPayload{
		Method:   "POST",
		URL:      "https://upstream.example.test/upload",
		BodyMode: "multipart",
		Headers: []HeaderKV{
			{Key: "Content-Type", Value: "multipart/custom"},
		},
		BodyFields: []BodyFieldKV{
			{Key: "scope", Value: "images", Enabled: true},
			{Key: "note", Value: "{{NOTE}}", Enabled: true},
		},
		Env: map[string]string{
			"NOTE": "hello world",
		},
	}

	requestBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/request", bytes.NewReader(requestBody))
	(&server{httpClient: client}).handleSendRequest(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("handleSendRequest() status = %d, want %d", recorder.Code, http.StatusOK)
	}

	select {
	case seen := <-upstreamSeen:
		if seen.contentType != "multipart/custom" {
			t.Fatalf("upstream Content-Type = %q, want explicit header", seen.contentType)
		}
		if !strings.Contains(seen.body, `name="scope"`) || !strings.Contains(seen.body, "images") {
			t.Fatalf("upstream multipart body missing scope field: %q", seen.body)
		}
		if !strings.Contains(seen.body, `name="note"`) || !strings.Contains(seen.body, "hello world") {
			t.Fatalf("upstream multipart body missing note field: %q", seen.body)
		}
	default:
		t.Fatal("upstream request was not observed")
	}
}

func TestHandleCollectionsAcceptsLargePayload(t *testing.T) {
	t.Parallel()

	projectDir := t.TempDir()
	collectionStore, err := newCollectionFileStore(projectDir)
	if err != nil {
		t.Fatalf("newCollectionFileStore() error = %v", err)
	}

	largeBody := strings.Repeat("x", 5<<20)
	payload := CollectionStore{
		Collections: []RequestCollection{
			{
				ID:   "large",
				Name: "Large",
				Requests: []SavedRequest{
					{
						ID:             "req-large",
						Name:           "Large Body",
						Method:         "POST",
						URL:            "https://example.com/upload",
						Body:           largeBody,
						TimeoutSeconds: 120,
					},
				},
			},
		},
	}

	requestBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/collections", bytes.NewReader(requestBody))
	(&server{collectionStore: collectionStore}).handleCollections(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("handleCollections() status = %d, want %d", recorder.Code, http.StatusOK)
	}

	reloaded, err := collectionStore.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got := reloaded.Collections[0].Requests[0].Body; got != largeBody {
		t.Fatalf("reloaded body length = %d, want %d", len(got), len(largeBody))
	}
}

func parseSSEEvents(t *testing.T, body string) []map[string]any {
	t.Helper()

	frames := strings.Split(strings.TrimSpace(body), "\n\n")
	events := make([]map[string]any, 0, len(frames))
	for _, frame := range frames {
		frame = strings.TrimSpace(frame)
		if frame == "" {
			continue
		}

		var payloadBuilder strings.Builder
		for _, line := range strings.Split(frame, "\n") {
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			payloadBuilder.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}

		if payloadBuilder.Len() == 0 {
			continue
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(payloadBuilder.String()), &event); err != nil {
			t.Fatalf("json.Unmarshal(%q) error = %v", payloadBuilder.String(), err)
		}
		events = append(events, event)
	}

	return events
}

func firstEventByType(t *testing.T, events []map[string]any, eventType string) map[string]any {
	t.Helper()

	for _, event := range events {
		if event["type"] == eventType {
			return event
		}
	}

	t.Fatalf("event type %q not found", eventType)
	return nil
}

func eventsByType(events []map[string]any, eventType string) []map[string]any {
	filtered := make([]map[string]any, 0, len(events))
	for _, event := range events {
		if event["type"] == eventType {
			filtered = append(filtered, event)
		}
	}
	return filtered
}

func nestedStringMap(t *testing.T, event map[string]any, key string) map[string]string {
	t.Helper()

	raw, ok := event[key].(map[string]any)
	if !ok {
		t.Fatalf("event[%q] missing or wrong type", key)
	}

	out := make(map[string]string, len(raw))
	for headerKey, value := range raw {
		text, ok := value.(string)
		if !ok {
			t.Fatalf("event[%q][%q] = %T, want string", key, headerKey, value)
		}
		out[headerKey] = text
	}
	return out
}

func nestedMap(t *testing.T, event map[string]any, key string) map[string]any {
	t.Helper()

	raw, ok := event[key].(map[string]any)
	if !ok {
		t.Fatalf("event[%q] missing or wrong type", key)
	}
	return raw
}

func stringValue(t *testing.T, event map[string]any, key string) string {
	t.Helper()

	value, ok := event[key].(string)
	if !ok {
		t.Fatalf("event[%q] = %T, want string", key, event[key])
	}
	return value
}

func intValue(t *testing.T, event map[string]any, key string) int {
	t.Helper()

	value, ok := event[key].(float64)
	if !ok {
		t.Fatalf("event[%q] = %T, want number", key, event[key])
	}
	return int(value)
}

func boolValue(t *testing.T, event map[string]any, key string) bool {
	t.Helper()

	value, ok := event[key].(bool)
	if !ok {
		t.Fatalf("event[%q] = %T, want bool", key, event[key])
	}
	return value
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
