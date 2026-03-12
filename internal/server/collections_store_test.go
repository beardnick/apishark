package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCollectionFileStoreLoadMissingFile(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store, err := newCollectionFileStore(dir)
	if err != nil {
		t.Fatalf("newCollectionFileStore() error = %v", err)
	}

	got, err := store.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(got.Collections) != 0 {
		t.Fatalf("Load() collections = %d, want 0", len(got.Collections))
	}

	wantPath := filepath.Join(dir, collectionsFileName)
	if store.filePath != wantPath {
		t.Fatalf("store.filePath = %q, want %q", store.filePath, wantPath)
	}
}

func TestCollectionFileStoreSaveAndReload(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store, err := newCollectionFileStore(dir)
	if err != nil {
		t.Fatalf("newCollectionFileStore() error = %v", err)
	}

	input := CollectionStore{
		Collections: []RequestCollection{
			{
				ID:                "col_1",
				Name:              "Smoke Tests",
				AggregationPlugin: "vendor.collection",
				Requests: []SavedRequest{
					{
						ID:                             "req_1",
						Name:                           "Streaming chat",
						Method:                         "post",
						URL:                            "https://example.com/v1/chat/completions",
						TimeoutSeconds:                 15,
						UseCollectionAggregationPlugin: true,
						Headers: []SavedHeader{
							{Key: "Content-Type", Value: "application/json", Enabled: true},
							{Key: "Authorization", Value: "Bearer {{TOKEN}}", Enabled: false},
						},
						Body:               "{\"stream\":true}",
						AggregationPlugin:  "openai",
						AggregateOpenAISSE: true,
						UpdatedAt:          "2026-03-11T12:00:00Z",
					},
				},
			},
		},
	}

	saved, err := store.Save(input)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if saved.Collections[0].Requests[0].Method != "POST" {
		t.Fatalf("Save() normalized method = %q, want POST", saved.Collections[0].Requests[0].Method)
	}
	if saved.Collections[0].AggregationPlugin != "vendor.collection" {
		t.Fatalf("Save() normalized collection plugin = %q, want %q", saved.Collections[0].AggregationPlugin, "vendor.collection")
	}

	rawFile, err := os.ReadFile(filepath.Join(dir, collectionsFileName))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if len(rawFile) == 0 {
		t.Fatal("collections.json was empty after Save()")
	}

	reloaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load() after Save() error = %v", err)
	}

	request := reloaded.Collections[0].Requests[0]
	if request.Name != "Streaming chat" {
		t.Fatalf("reloaded request name = %q, want %q", request.Name, "Streaming chat")
	}
	if len(request.Headers) != 2 {
		t.Fatalf("reloaded header count = %d, want 2", len(request.Headers))
	}
	if !request.UseCollectionAggregationPlugin {
		t.Fatal("reloaded request should use collection aggregation plugin")
	}
	if request.AggregationPlugin != "" {
		t.Fatalf("reloaded aggregation plugin = %q, want empty override", request.AggregationPlugin)
	}
	if request.Headers[1].Enabled {
		t.Fatal("disabled header was not preserved")
	}
}

func TestLoadCollectionStoreFromFileRejectsInvalidJSON(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	filePath := filepath.Join(dir, collectionsFileName)
	if err := os.WriteFile(filePath, []byte("{not-json"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if _, err := loadCollectionStoreFromFile(filePath); err == nil {
		t.Fatal("loadCollectionStoreFromFile() error = nil, want parse error")
	}
}
