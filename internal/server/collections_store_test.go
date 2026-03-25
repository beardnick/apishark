package server

import (
	"os"
	"path/filepath"
	"strings"
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
	if len(got.Environments) != 0 {
		t.Fatalf("Load() environments = %d, want 0", len(got.Environments))
	}
	if len(got.RequestDrafts) != 0 {
		t.Fatalf("Load() request drafts = %d, want 0", len(got.RequestDrafts))
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
		Plugins: []EmbeddedAggregationPlugin{
			{
				ID:          "vendor.example",
				Label:       "Vendor Example",
				Description: "Embeds plugin source in collections.json",
				ImportedAt:  "2026-03-11T11:59:00Z",
				Format:      "js",
				Source:      "export function create() { return {}; }",
				SupportsPreRequest: false,
				SupportsPostResponse: true,
			},
		},
		Environments: []EnvironmentEntry{
			{
				ID:   "env_default",
				Name: "Default",
				Text: "OPENAI_API_KEY=\nBASE_URL=https://api.openai.com",
			},
		},
		ActiveEnvironmentID: "env_default",
		RequestDrafts: []PersistedRequestDraft{
			{
				CollectionID: "col_1",
				UpdatedAt:    "2026-03-11T12:05:00Z",
				Draft: RequestDraft{
					Name:                           "Unsaved draft",
					Method:                         "post",
					URL:                            "https://example.com/v1/responses",
					Headers:                        []SavedHeader{{Key: "Content-Type", Value: "application/json", Enabled: true}},
					BodyMode:                       "form_urlencoded",
					Body:                           "{\"input\":\"hello\"}",
					BodyFields:                     []SavedBodyField{{Key: "token", Value: "{{TOKEN}}", Enabled: true}},
					AggregationPlugin:              "openai",
					UseCollectionAggregationPlugin: false,
					AggregateOpenAISSE:             true,
					TimeoutSeconds:                 30,
				},
			},
		},
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
						BodyMode:           "multipart",
						Body:               "{\"stream\":true}",
						BodyFields:         []SavedBodyField{{Key: "scope", Value: "images", Enabled: true}},
						PreRequestPlugin:   "vendor.signer",
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
	if saved.ActiveEnvironmentID != "env_default" {
		t.Fatalf("Save() active environment = %q, want %q", saved.ActiveEnvironmentID, "env_default")
	}
	if len(saved.Plugins) != 1 {
		t.Fatalf("Save() plugins = %d, want 1", len(saved.Plugins))
	}
	if saved.Plugins[0].Source != "export function create() { return {}; }" {
		t.Fatalf("Save() plugin source = %q, want plugin source", saved.Plugins[0].Source)
	}
	if !saved.Plugins[0].SupportsPostResponse {
		t.Fatal("Save() plugin should preserve post-response capability")
	}
	if len(saved.RequestDrafts) != 1 {
		t.Fatalf("Save() request drafts = %d, want 1", len(saved.RequestDrafts))
	}
	if saved.RequestDrafts[0].Key != "collection:col_1:unsaved" {
		t.Fatalf("Save() request draft key = %q, want %q", saved.RequestDrafts[0].Key, "collection:col_1:unsaved")
	}
	if saved.RequestDrafts[0].Draft.Method != "POST" {
		t.Fatalf("Save() request draft method = %q, want POST", saved.RequestDrafts[0].Draft.Method)
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
	if request.PreRequestPlugin != "vendor.signer" {
		t.Fatalf("reloaded pre-request plugin = %q, want %q", request.PreRequestPlugin, "vendor.signer")
	}
	if request.Headers[1].Enabled {
		t.Fatal("disabled header was not preserved")
	}
	if request.BodyMode != "multipart" {
		t.Fatalf("reloaded body mode = %q, want multipart", request.BodyMode)
	}
	if len(request.BodyFields) != 1 || request.BodyFields[0].Key != "scope" {
		t.Fatalf("reloaded body fields = %#v, want multipart field", request.BodyFields)
	}
	if reloaded.ActiveEnvironmentID != "env_default" {
		t.Fatalf("reloaded active environment = %q, want %q", reloaded.ActiveEnvironmentID, "env_default")
	}
	if len(reloaded.Plugins) != 1 {
		t.Fatalf("reloaded plugins = %d, want 1", len(reloaded.Plugins))
	}
	if reloaded.Plugins[0].ID != "vendor.example" {
		t.Fatalf("reloaded plugin id = %q, want %q", reloaded.Plugins[0].ID, "vendor.example")
	}
	if len(reloaded.Environments) != 1 {
		t.Fatalf("reloaded environments = %d, want 1", len(reloaded.Environments))
	}
	if len(reloaded.RequestDrafts) != 1 {
		t.Fatalf("reloaded request drafts = %d, want 1", len(reloaded.RequestDrafts))
	}
	if reloaded.RequestDrafts[0].Draft.Name != "Unsaved draft" {
		t.Fatalf("reloaded request draft name = %q, want %q", reloaded.RequestDrafts[0].Draft.Name, "Unsaved draft")
	}
	if reloaded.RequestDrafts[0].Draft.BodyMode != "form_urlencoded" {
		t.Fatalf("reloaded request draft body mode = %q, want form_urlencoded", reloaded.RequestDrafts[0].Draft.BodyMode)
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

func TestCollectionFileStoreAllowsLargeCollections(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store, err := newCollectionFileStore(dir)
	if err != nil {
		t.Fatalf("newCollectionFileStore() error = %v", err)
	}

	largeBody := strings.Repeat("x", 5<<20)
	input := CollectionStore{
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

	if _, err := store.Save(input); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	reloaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got := reloaded.Collections[0].Requests[0].Body; got != largeBody {
		t.Fatalf("reloaded body length = %d, want %d", len(got), len(largeBody))
	}
}

func TestCollectionFileStoreKeepsPluginsWithoutCollections(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store, err := newCollectionFileStore(dir)
	if err != nil {
		t.Fatalf("newCollectionFileStore() error = %v", err)
	}

	saved, err := store.Save(CollectionStore{
		Plugins: []EmbeddedAggregationPlugin{
			{
				ID:     "vendor.embedded",
				Label:  "Vendor Embedded",
				Format: "js",
				Source: "export function create() { return {}; }",
			},
		},
	})
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	if len(saved.Collections) != 0 {
		t.Fatalf("Save() collections = %d, want 0", len(saved.Collections))
	}
	if len(saved.Plugins) != 1 {
		t.Fatalf("Save() plugins = %d, want 1", len(saved.Plugins))
	}

	reloaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(reloaded.Plugins) != 1 {
		t.Fatalf("Load() plugins = %d, want 1", len(reloaded.Plugins))
	}
	if reloaded.Plugins[0].ID != "vendor.embedded" {
		t.Fatalf("Load() plugin id = %q, want %q", reloaded.Plugins[0].ID, "vendor.embedded")
	}
}
