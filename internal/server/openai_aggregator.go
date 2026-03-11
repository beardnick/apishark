package server

import (
	"encoding/json"
	"strings"
)

type OpenAIAggregator struct {
	enabled bool
	builder strings.Builder
}

func NewOpenAIAggregator(enabled bool) *OpenAIAggregator {
	return &OpenAIAggregator{enabled: enabled}
}

func (a *OpenAIAggregator) Text() string {
	return a.builder.String()
}

func (a *OpenAIAggregator) ConsumeSSELine(line string) (delta string, done bool) {
	if !a.enabled {
		return "", false
	}

	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "data:") {
		return "", false
	}

	payload := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
	if payload == "" {
		return "", false
	}
	if payload == "[DONE]" {
		return "", true
	}

	// Ignore non-JSON payloads. The aggregator is best-effort.
	if payload[0] != '{' {
		return "", false
	}

	var decoded map[string]any
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		return "", false
	}

	return a.consumeJSONObject(decoded), false
}

func (a *OpenAIAggregator) ConsumeNonStreamJSON(raw []byte) string {
	if !a.enabled || len(raw) == 0 {
		return ""
	}

	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return ""
	}

	return a.consumeJSONObject(decoded)
}

func (a *OpenAIAggregator) consumeJSONObject(data map[string]any) string {
	if !a.enabled {
		return ""
	}

	var parts []string

	// Responses API / custom event streams that carry delta text directly.
	if eventType, ok := data["type"].(string); ok && strings.HasSuffix(eventType, ".delta") {
		if directDelta, ok := data["delta"].(string); ok {
			parts = append(parts, directDelta)
		}
	}

	if outputText, ok := data["output_text"].(string); ok {
		parts = append(parts, outputText)
	}

	choices, _ := data["choices"].([]any)
	for _, choiceItem := range choices {
		choice, ok := choiceItem.(map[string]any)
		if !ok {
			continue
		}

		if text, ok := choice["text"].(string); ok {
			parts = append(parts, text)
		}

		if delta, ok := choice["delta"].(map[string]any); ok {
			parts = append(parts, extractTextFragments(delta)...)
		}

		if message, ok := choice["message"].(map[string]any); ok {
			parts = append(parts, extractTextFragments(message)...)
		}
	}

	if len(parts) == 0 {
		return ""
	}

	joined := strings.Join(parts, "")
	a.builder.WriteString(joined)
	return joined
}

func extractTextFragments(container map[string]any) []string {
	keys := []string{
		"content",
		"reasoning_content",
		"reasoning",
		"thinking",
	}

	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		value, ok := container[key]
		if !ok {
			continue
		}
		parts = append(parts, contentToStrings(value)...)
	}
	return parts
}

func contentToStrings(value any) []string {
	switch typed := value.(type) {
	case string:
		if typed == "" {
			return nil
		}
		return []string{typed}
	case []any:
		var out []string
		for _, item := range typed {
			switch piece := item.(type) {
			case string:
				if piece != "" {
					out = append(out, piece)
				}
			case map[string]any:
				if text, ok := piece["text"].(string); ok && text != "" {
					out = append(out, text)
				}
			}
		}
		return out
	default:
		return nil
	}
}
