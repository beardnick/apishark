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

func compareAggregateFragments(got []AggregateFragment, want []AggregateFragment) string {
	if reflect.DeepEqual(got, want) {
		return ""
	}
	return fmt.Sprintf("got %#v want %#v", got, want)
}
