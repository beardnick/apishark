package server

import (
	"fmt"
	"reflect"
	"testing"
)

func TestOpenAIAggregatorTracksThinkingFragments(t *testing.T) {
	t.Parallel()

	aggregator := NewOpenAIAggregator(true)

	first, done := aggregator.ConsumeSSELine(`data: {"choices":[{"delta":{"reasoning":"plan "}}]}`)
	if done {
		t.Fatal("ConsumeSSELine() done = true, want false")
	}
	if diff := compareAggregateFragments(first, []AggregateFragment{
		{Kind: AggregateFragmentThinking, Text: "plan "},
	}); diff != "" {
		t.Fatalf("ConsumeSSELine() thinking fragments mismatch: %s", diff)
	}

	second, done := aggregator.ConsumeSSELine(`data: {"choices":[{"delta":{"content":"answer"}}]}`)
	if done {
		t.Fatal("ConsumeSSELine() done = true, want false")
	}
	if diff := compareAggregateFragments(second, []AggregateFragment{
		{Kind: AggregateFragmentContent, Text: "answer"},
	}); diff != "" {
		t.Fatalf("ConsumeSSELine() content fragments mismatch: %s", diff)
	}

	if got := aggregator.Text(); got != "plan answer" {
		t.Fatalf("Text() = %q, want %q", got, "plan answer")
	}

	if diff := compareAggregateFragments(aggregator.Segments(), []AggregateFragment{
		{Kind: AggregateFragmentThinking, Text: "plan "},
		{Kind: AggregateFragmentContent, Text: "answer"},
	}); diff != "" {
		t.Fatalf("Segments() mismatch: %s", diff)
	}
}

func TestOpenAIAggregatorConsumesNonStreamOutputFragments(t *testing.T) {
	t.Parallel()

	aggregator := NewOpenAIAggregator(true)
	fragments := aggregator.ConsumeNonStreamJSON([]byte(`{
		"output": [{
			"content": [
				{"type": "reasoning", "text": "considering"},
				{"type": "output_text", "text": " final"}
			]
		}]
	}`))

	if diff := compareAggregateFragments(fragments, []AggregateFragment{
		{Kind: AggregateFragmentThinking, Text: "considering"},
		{Kind: AggregateFragmentContent, Text: " final"},
	}); diff != "" {
		t.Fatalf("ConsumeNonStreamJSON() mismatch: %s", diff)
	}

	if got := aggregator.Text(); got != "considering final" {
		t.Fatalf("Text() = %q, want %q", got, "considering final")
	}
}

func TestOpenAIAggregatorConsumesMediaFragments(t *testing.T) {
	t.Parallel()

	aggregator := NewOpenAIAggregator(true)
	fragments := aggregator.ConsumeNonStreamJSON([]byte(`{
		"output": [{
			"content": [
				{"type": "output_text", "text": "caption "},
				{"type": "output_image", "image_url": {"url": "https://cdn.example.test/cat.png", "mime_type": "image/png"}, "alt": "cat", "title": "Cat"},
				{"type": "output_video", "video_url": "https://cdn.example.test/cat.mp4", "mime_type": "video/mp4", "title": "Clip"},
				{"type": "output_image", "image_url": "javascript:alert(1)", "mime_type": "image/png"}
			]
		}]
	}`))

	if diff := compareAggregateFragments(fragments, []AggregateFragment{
		{Kind: AggregateFragmentContent, Text: "caption "},
		{Kind: AggregateFragmentImage, URL: "https://cdn.example.test/cat.png", MIME: "image/png", Alt: "cat", Title: "Cat"},
		{Kind: AggregateFragmentVideo, URL: "https://cdn.example.test/cat.mp4", MIME: "video/mp4", Title: "Clip"},
	}); diff != "" {
		t.Fatalf("ConsumeNonStreamJSON() media mismatch: %s", diff)
	}

	if got := aggregator.Text(); got != "caption " {
		t.Fatalf("Text() = %q, want %q", got, "caption ")
	}

	if diff := compareAggregateFragments(aggregator.Segments(), []AggregateFragment{
		{Kind: AggregateFragmentContent, Text: "caption "},
		{Kind: AggregateFragmentImage, URL: "https://cdn.example.test/cat.png", MIME: "image/png", Alt: "cat", Title: "Cat"},
		{Kind: AggregateFragmentVideo, URL: "https://cdn.example.test/cat.mp4", MIME: "video/mp4", Title: "Clip"},
	}); diff != "" {
		t.Fatalf("Segments() media mismatch: %s", diff)
	}
}

func compareAggregateFragments(got []AggregateFragment, want []AggregateFragment) string {
	if reflect.DeepEqual(got, want) {
		return ""
	}
	return fmt.Sprintf("got %#v want %#v", got, want)
}
