package server

import (
	"encoding/json"
	"strings"
	"time"
)

const (
	rawTransportModeBody = "body"
	rawTransportModeSSE  = "sse"
)

type RawTransportMetadata struct {
	Mode        string `json:"mode"`
	ContentType string `json:"contentType,omitempty"`
	Field       string `json:"field,omitempty"`
}

type RawEvent struct {
	Type      string               `json:"type"`
	Seq       int                  `json:"seq"`
	Transport RawTransportMetadata `json:"transport"`
	RawChunk  string               `json:"rawChunk"`
	SSEData   string               `json:"sseData,omitempty"`
	ParsedJSON any                 `json:"parsedJson,omitempty"`
	Done      bool                 `json:"done"`
	TS        string               `json:"ts"`
}

func newBodyRawEvent(seq int, contentType string, chunk string, done bool) RawEvent {
	event := RawEvent{
		Type: "raw_event",
		Seq:  seq,
		Transport: RawTransportMetadata{
			Mode:        rawTransportModeBody,
			ContentType: contentType,
		},
		RawChunk: chunk,
		Done:     done,
		TS:       time.Now().UTC().Format(time.RFC3339Nano),
	}
	if !done {
		event.ParsedJSON = parseJSONFragment(chunk)
	}
	return event
}

func newSSERawEvent(seq int, contentType string, line string, done bool) RawEvent {
	event := RawEvent{
		Type: "raw_event",
		Seq:  seq,
		Transport: RawTransportMetadata{
			Mode:        rawTransportModeSSE,
			ContentType: contentType,
			Field:       detectSSEField(line),
		},
		RawChunk: line,
		Done:     done,
		TS:       time.Now().UTC().Format(time.RFC3339Nano),
	}
	if done {
		return event
	}

	if event.Transport.Field == "data" {
		event.SSEData = extractSSEData(line)
		event.ParsedJSON = parseJSONFragment(event.SSEData)
	}
	return event
}

func detectSSEField(line string) string {
	if line == "" {
		return "blank"
	}
	if strings.HasPrefix(line, ":") {
		return "comment"
	}

	field, _, found := strings.Cut(line, ":")
	if !found {
		return "data"
	}

	field = strings.TrimSpace(field)
	if field == "" {
		return "data"
	}
	return strings.ToLower(field)
}

func extractSSEData(line string) string {
	if !strings.HasPrefix(strings.TrimSpace(line), "data:") {
		return ""
	}

	_, value, _ := strings.Cut(line, ":")
	return strings.TrimSpace(value)
}

func parseJSONFragment(raw string) any {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	var decoded any
	if err := json.Unmarshal([]byte(trimmed), &decoded); err != nil {
		return nil
	}
	return decoded
}
