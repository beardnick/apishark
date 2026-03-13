package server

import (
	"encoding/json"
	"net/url"
	"strings"
)

const (
	AggregateFragmentContent  = "content"
	AggregateFragmentThinking = "thinking"
	AggregateFragmentImage    = "image"
	AggregateFragmentVideo    = "video"
)

type AggregateFragment struct {
	Kind  string `json:"kind"`
	Text  string `json:"text,omitempty"`
	URL   string `json:"url,omitempty"`
	MIME  string `json:"mime,omitempty"`
	Alt   string `json:"alt,omitempty"`
	Title string `json:"title,omitempty"`
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
	if media, ok := extractMediaFragment(data); ok {
		parts = append(parts, media)
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

	return a.appendFragments(parts)
}

func (a *OpenAIAggregator) appendFragments(fragments []AggregateFragment) []AggregateFragment {
	var appended []AggregateFragment
	for _, fragment := range fragments {
		fragment.Kind = normalizeAggregateFragmentKind(fragment.Kind)
		if isAggregateMediaKind(fragment.Kind) {
			if normalized, ok := normalizeAggregateMediaFragment(fragment); ok {
				a.segments = append(a.segments, normalized)
				appended = append(appended, normalized)
			}
			continue
		}
		if fragment.Text == "" {
			continue
		}
		a.builder.WriteString(fragment.Text)
		if len(a.segments) > 0 &&
			a.segments[len(a.segments)-1].Kind == fragment.Kind &&
			!isAggregateMediaKind(a.segments[len(a.segments)-1].Kind) {
			a.segments[len(a.segments)-1].Text += fragment.Text
			if len(appended) > 0 && appended[len(appended)-1].Kind == fragment.Kind {
				appended[len(appended)-1].Text += fragment.Text
			} else {
				appended = append(appended, fragment)
			}
			continue
		}

		a.segments = append(a.segments, fragment)
		appended = append(appended, fragment)
	}
	return appended
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
				if media, ok := extractMediaFragment(piece); ok {
					out = append(out, media)
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
		if media, ok := extractMediaFragment(typed); ok {
			out = append(out, media)
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
	switch kind {
	case AggregateFragmentThinking:
		return AggregateFragmentThinking
	case AggregateFragmentImage:
		return AggregateFragmentImage
	case AggregateFragmentVideo:
		return AggregateFragmentVideo
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

func isAggregateMediaKind(kind string) bool {
	return kind == AggregateFragmentImage || kind == AggregateFragmentVideo
}

func extractMediaFragment(container map[string]any) (AggregateFragment, bool) {
	kind, ok := inferMediaKind(container)
	if !ok {
		return AggregateFragment{}, false
	}

	urlValue, mimeValue, ok := extractMediaDetails(container, kind)
	if !ok {
		return AggregateFragment{}, false
	}

	return AggregateFragment{
		Kind:  kind,
		URL:   urlValue,
		MIME:  mimeValue,
		Alt:   firstNonEmptyString(container["alt"], container["alt_text"]),
		Title: firstNonEmptyString(container["title"], container["name"]),
	}, true
}

func inferMediaKind(container map[string]any) (string, bool) {
	eventType, _ := container["type"].(string)
	lowered := strings.ToLower(eventType)
	switch {
	case strings.Contains(lowered, "image"):
		return AggregateFragmentImage, true
	case strings.Contains(lowered, "video"):
		return AggregateFragmentVideo, true
	case container["image_url"] != nil || container["image"] != nil || container["b64_json"] != nil:
		return AggregateFragmentImage, true
	case container["video_url"] != nil || container["video"] != nil:
		return AggregateFragmentVideo, true
	default:
		return "", false
	}
}

func extractMediaDetails(container map[string]any, kind string) (string, string, bool) {
	fields := []string{"url", "src"}
	if kind == AggregateFragmentImage {
		fields = append([]string{"image_url", "image"}, fields...)
	} else {
		fields = append([]string{"video_url", "video"}, fields...)
	}

	defaultMime := firstNonEmptyString(container["mime_type"], container["mime"])
	for _, field := range fields {
		urlValue, mimeValue, ok := mediaValueToDetails(container[field], defaultMime)
		if ok {
			return urlValue, mimeValue, true
		}
	}

	if kind == AggregateFragmentImage {
		b64 := firstNonEmptyString(container["b64_json"])
		if b64 == "" {
			return "", "", false
		}
		mimeValue := defaultMime
		if mimeValue == "" {
			mimeValue = "image/png"
		}
		return "data:" + mimeValue + ";base64," + b64, mimeValue, true
	}

	return "", "", false
}

func mediaValueToDetails(value any, defaultMime string) (string, string, bool) {
	if text, ok := value.(string); ok {
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			return "", "", false
		}
		return trimmed, defaultMime, true
	}

	record, ok := value.(map[string]any)
	if !ok {
		return "", "", false
	}

	for _, key := range []string{"url", "uri", "src", "href"} {
		if text := firstNonEmptyString(record[key]); text != "" {
			mimeValue := firstNonEmptyString(record["mime_type"], record["mime"])
			if mimeValue == "" {
				mimeValue = defaultMime
			}
			return text, mimeValue, true
		}
	}

	return "", "", false
}

func normalizeAggregateMediaFragment(fragment AggregateFragment) (AggregateFragment, bool) {
	urlValue, mimeValue, ok := normalizeAggregateMediaURL(fragment.Kind, fragment.URL, fragment.MIME)
	if !ok {
		return AggregateFragment{}, false
	}

	return AggregateFragment{
		Kind:  fragment.Kind,
		URL:   urlValue,
		MIME:  mimeValue,
		Alt:   normalizeAggregateMetadata(fragment.Alt),
		Title: normalizeAggregateMetadata(fragment.Title),
	}, true
}

func normalizeAggregateMediaURL(kind string, rawURL string, rawMIME string) (string, string, bool) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" || containsControlChars(trimmed) {
		return "", "", false
	}

	normalizedMIME := normalizeAggregateMediaMIME(kind, rawMIME)
	if strings.HasPrefix(trimmed, "data:") {
		comma := strings.IndexByte(trimmed, ',')
		if comma <= len("data:") {
			return "", "", false
		}
		meta := trimmed[len("data:"):comma]
		mimePart, _, _ := strings.Cut(meta, ";")
		dataMIME := normalizeAggregateMediaMIME(kind, mimePart)
		if dataMIME == "" {
			return "", "", false
		}
		if normalizedMIME == "" {
			normalizedMIME = dataMIME
		}
		return trimmed, normalizedMIME, true
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", "", false
	}
	switch parsed.Scheme {
	case "http", "https", "blob":
	default:
		return "", "", false
	}

	return parsed.String(), normalizedMIME, true
}

func normalizeAggregateMediaMIME(kind string, raw string) string {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" || containsControlChars(normalized) {
		return ""
	}
	switch kind {
	case AggregateFragmentImage:
		if !strings.HasPrefix(normalized, "image/") || normalized == "image/svg+xml" {
			return ""
		}
	case AggregateFragmentVideo:
		if !strings.HasPrefix(normalized, "video/") {
			return ""
		}
	default:
		return ""
	}
	return normalized
}

func normalizeAggregateMetadata(raw string) string {
	return strings.TrimSpace(raw)
}

func containsControlChars(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool {
		return r < 0x20 || r == 0x7f
	}) >= 0
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		text, ok := value.(string)
		if !ok {
			continue
		}
		trimmed := strings.TrimSpace(text)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
