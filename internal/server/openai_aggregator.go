package server

import (
	"encoding/json"
	"strings"
)

const (
	AggregateFragmentContent  = "content"
	AggregateFragmentThinking = "thinking"
)

type AggregateFragment struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type OpenAIAggregator struct {
	enabled  bool
	builder  strings.Builder
	segments []AggregateFragment
}

func NewOpenAIAggregator(enabled bool) *OpenAIAggregator {
	return &OpenAIAggregator{enabled: enabled}
}

func (a *OpenAIAggregator) Text() string {
	return a.builder.String()
}

func (a *OpenAIAggregator) Segments() []AggregateFragment {
	if len(a.segments) == 0 {
		return nil
	}

	out := make([]AggregateFragment, len(a.segments))
	copy(out, a.segments)
	return out
}

func (a *OpenAIAggregator) ConsumeSSELine(line string) (fragments []AggregateFragment, done bool) {
	if !a.enabled {
		return nil, false
	}

	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "data:") {
		return nil, false
	}

	payload := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
	if payload == "" {
		return nil, false
	}
	if payload == "[DONE]" {
		return nil, true
	}

	// Ignore non-JSON payloads. The aggregator is best-effort.
	if payload[0] != '{' {
		return nil, false
	}

	var decoded map[string]any
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		return nil, false
	}

	return a.consumeJSONObject(decoded), false
}

func (a *OpenAIAggregator) ConsumeNonStreamJSON(raw []byte) []AggregateFragment {
	if !a.enabled || len(raw) == 0 {
		return nil
	}

	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil
	}

	return a.consumeJSONObject(decoded)
}

func (a *OpenAIAggregator) consumeJSONObject(data map[string]any) []AggregateFragment {
	if !a.enabled {
		return nil
	}

	var parts []AggregateFragment

	// Responses API / custom event streams that carry delta text directly.
	if eventType, ok := data["type"].(string); ok && strings.HasSuffix(eventType, ".delta") {
		if directDelta, ok := data["delta"].(string); ok {
			parts = append(parts, makeAggregateFragment(AggregateFragmentContent, directDelta)...)
		}
		if delta, ok := data["delta"].(map[string]any); ok {
			parts = append(parts, extractTextFragments(delta)...)
		}
	}

	if outputText, ok := data["output_text"].(string); ok {
		parts = append(parts, makeAggregateFragment(AggregateFragmentContent, outputText)...)
	}

	if message, ok := data["message"].(map[string]any); ok {
		parts = append(parts, extractTextFragments(message)...)
	}

	if output, ok := data["output"].([]any); ok {
		for _, item := range output {
			message, ok := item.(map[string]any)
			if !ok {
				continue
			}
			parts = append(parts, extractTextFragments(message)...)
		}
	}

	choices, _ := data["choices"].([]any)
	for _, choiceItem := range choices {
		choice, ok := choiceItem.(map[string]any)
		if !ok {
			continue
		}

		if text, ok := choice["text"].(string); ok {
			parts = append(parts, makeAggregateFragment(AggregateFragmentContent, text)...)
		}

		if delta, ok := choice["delta"].(map[string]any); ok {
			parts = append(parts, extractTextFragments(delta)...)
		}

		if message, ok := choice["message"].(map[string]any); ok {
			parts = append(parts, extractTextFragments(message)...)
		}
	}

	if len(parts) == 0 {
		return nil
	}

	a.appendFragments(parts)
	return parts
}

func (a *OpenAIAggregator) appendFragments(fragments []AggregateFragment) {
	for _, fragment := range fragments {
		if fragment.Text == "" {
			continue
		}

		fragment.Kind = normalizeAggregateFragmentKind(fragment.Kind)
		a.builder.WriteString(fragment.Text)
		if len(a.segments) > 0 && a.segments[len(a.segments)-1].Kind == fragment.Kind {
			a.segments[len(a.segments)-1].Text += fragment.Text
			continue
		}

		a.segments = append(a.segments, fragment)
	}
}

func extractTextFragments(container map[string]any) []AggregateFragment {
	type keySpec struct {
		name string
		kind string
	}

	keys := []keySpec{
		{name: "reasoning_content", kind: AggregateFragmentThinking},
		{name: "reasoning", kind: AggregateFragmentThinking},
		{name: "thinking", kind: AggregateFragmentThinking},
		{name: "content", kind: AggregateFragmentContent},
	}

	parts := make([]AggregateFragment, 0, len(keys))
	for _, key := range keys {
		value, ok := container[key.name]
		if !ok {
			continue
		}
		parts = append(parts, contentToStrings(value, key.kind)...)
	}
	return parts
}

func contentToStrings(value any, defaultKind string) []AggregateFragment {
	switch typed := value.(type) {
	case string:
		return makeAggregateFragment(defaultKind, typed)
	case []any:
		var out []AggregateFragment
		for _, item := range typed {
			switch piece := item.(type) {
			case string:
				out = append(out, makeAggregateFragment(defaultKind, piece)...)
			case map[string]any:
				if nested := extractTextFragments(piece); len(nested) > 0 {
					out = append(out, nested...)
					continue
				}

				kind := inferAggregateFragmentKind(piece, defaultKind)
				if outputText, ok := piece["output_text"].(string); ok {
					out = append(out, makeAggregateFragment(AggregateFragmentContent, outputText)...)
				}
				if text, ok := piece["text"].(string); ok {
					out = append(out, makeAggregateFragment(kind, text)...)
				}
			}
		}
		return out
	case map[string]any:
		if nested := extractTextFragments(typed); len(nested) > 0 {
			return nested
		}

		kind := inferAggregateFragmentKind(typed, defaultKind)
		var out []AggregateFragment
		if outputText, ok := typed["output_text"].(string); ok {
			out = append(out, makeAggregateFragment(AggregateFragmentContent, outputText)...)
		}
		if text, ok := typed["text"].(string); ok {
			out = append(out, makeAggregateFragment(kind, text)...)
		}
		return out
	default:
		return nil
	}
}

func inferAggregateFragmentKind(container map[string]any, fallback string) string {
	eventType, _ := container["type"].(string)
	lowered := strings.ToLower(eventType)
	if strings.Contains(lowered, "reason") || strings.Contains(lowered, "thinking") {
		return AggregateFragmentThinking
	}
	return normalizeAggregateFragmentKind(fallback)
}

func normalizeAggregateFragmentKind(kind string) string {
	if kind == AggregateFragmentThinking {
		return AggregateFragmentThinking
	}
	return AggregateFragmentContent
}

func makeAggregateFragment(kind string, text string) []AggregateFragment {
	if text == "" {
		return nil
	}
	return []AggregateFragment{{
		Kind: normalizeAggregateFragmentKind(kind),
		Text: text,
	}}
}
