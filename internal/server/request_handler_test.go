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

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (fn roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
