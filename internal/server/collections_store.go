package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	collectionsFileName = "collections.json"
)

type SavedHeader struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type SavedRequest struct {
	ID                             string        `json:"id"`
	Name                           string        `json:"name"`
	Method                         string        `json:"method"`
	URL                            string        `json:"url"`
	Headers                        []SavedHeader `json:"headers"`
	Body                           string        `json:"body"`
	AggregationPlugin              string        `json:"aggregation_plugin,omitempty"`
	UseCollectionAggregationPlugin bool          `json:"use_collection_aggregation_plugin,omitempty"`
	AggregateOpenAISSE             bool          `json:"aggregate_openai_sse"`
	TimeoutSeconds                 int           `json:"timeout_seconds"`
	UpdatedAt                      string        `json:"updated_at,omitempty"`
}

type RequestCollection struct {
	ID                string         `json:"id"`
	Name              string         `json:"name"`
	AggregationPlugin string         `json:"aggregation_plugin"`
	Requests          []SavedRequest `json:"requests"`
}

type EnvironmentEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Text string `json:"text"`
}

type RequestDraft struct {
	Name                           string        `json:"name"`
	Method                         string        `json:"method"`
	URL                            string        `json:"url"`
	Headers                        []SavedHeader `json:"headers"`
	Body                           string        `json:"body"`
	AggregationPlugin              string        `json:"aggregation_plugin,omitempty"`
	UseCollectionAggregationPlugin bool          `json:"use_collection_aggregation_plugin"`
	AggregateOpenAISSE             bool          `json:"aggregate_openai_sse"`
	TimeoutSeconds                 int           `json:"timeout_seconds"`
}

type PersistedRequestDraft struct {
	Key          string       `json:"key"`
	CollectionID string       `json:"collection_id,omitempty"`
	RequestID    string       `json:"request_id,omitempty"`
	UpdatedAt    string       `json:"updated_at,omitempty"`
	Draft        RequestDraft `json:"draft"`
}

type EmbeddedAggregationPlugin struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	ImportedAt  string `json:"imported_at,omitempty"`
	Format      string `json:"format"`
	Source      string `json:"source"`
}

type CollectionStore struct {
	Collections         []RequestCollection       `json:"collections"`
	Plugins             []EmbeddedAggregationPlugin `json:"plugins,omitempty"`
	Environments        []EnvironmentEntry        `json:"environments"`
	ActiveEnvironmentID string                    `json:"active_environment_id,omitempty"`
	RequestDrafts       []PersistedRequestDraft   `json:"request_drafts"`
}

type collectionFileStore struct {
	mu       sync.Mutex
	filePath string
}

func newCollectionFileStore(projectDir string) (*collectionFileStore, error) {
	if strings.TrimSpace(projectDir) == "" {
		return nil, errors.New("project directory is required")
	}

	absProjectDir, err := filepath.Abs(projectDir)
	if err != nil {
		return nil, fmt.Errorf("resolve project directory: %w", err)
	}

	return &collectionFileStore{
		filePath: filepath.Join(absProjectDir, collectionsFileName),
	}, nil
}

func (s *collectionFileStore) Load() (CollectionStore, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return loadCollectionStoreFromFile(s.filePath)
}

func (s *collectionFileStore) Save(store CollectionStore) (CollectionStore, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	normalized := normalizeCollectionStore(store)
	if err := saveCollectionStoreToFile(s.filePath, normalized); err != nil {
		return CollectionStore{}, err
	}
	return normalized, nil
}

func loadCollectionStoreFromFile(filePath string) (CollectionStore, error) {
	file, err := os.Open(filePath)
	if errors.Is(err, os.ErrNotExist) {
		return emptyCollectionStore(), nil
	}
	if err != nil {
		return CollectionStore{}, fmt.Errorf("open collections file: %w", err)
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return CollectionStore{}, fmt.Errorf("read collections file: %w", err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return emptyCollectionStore(), nil
	}

	var store CollectionStore
	if err := json.Unmarshal(data, &store); err != nil {
		return CollectionStore{}, fmt.Errorf("parse collections file: %w", err)
	}

	return normalizeCollectionStore(store), nil
}

func saveCollectionStoreToFile(filePath string, store CollectionStore) error {
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal collections: %w", err)
	}
	data = append(data, '\n')
	return writeAtomicFile(filePath, data, 0o644)
}

func normalizeCollectionStore(store CollectionStore) CollectionStore {
	normalized := CollectionStore{
		Collections:   make([]RequestCollection, 0, len(store.Collections)),
		Plugins:       normalizeEmbeddedAggregationPlugins(store.Plugins),
		Environments:  normalizeEnvironmentEntries(store.Environments),
		RequestDrafts: normalizePersistedRequestDrafts(store.RequestDrafts),
	}
	normalized.ActiveEnvironmentID = resolveActiveEnvironmentID(
		normalized.Environments,
		store.ActiveEnvironmentID,
	)

	for _, collection := range store.Collections {
		name := strings.TrimSpace(collection.Name)
		if name == "" {
			continue
		}

		nextCollection := RequestCollection{
			ID:                strings.TrimSpace(collection.ID),
			Name:              name,
			AggregationPlugin: normalizeAggregationPlugin(collection.AggregationPlugin, false),
			Requests:          make([]SavedRequest, 0, len(collection.Requests)),
		}

		for _, request := range collection.Requests {
			aggregationPlugin := normalizeAggregationPlugin(request.AggregationPlugin, request.AggregateOpenAISSE)
			useCollectionAggregationPlugin := request.UseCollectionAggregationPlugin
			if useCollectionAggregationPlugin {
				aggregationPlugin = ""
			}

			nextRequest := SavedRequest{
				ID:                             strings.TrimSpace(request.ID),
				Name:                           strings.TrimSpace(request.Name),
				Method:                         strings.ToUpper(strings.TrimSpace(request.Method)),
				URL:                            request.URL,
				Headers:                        normalizeSavedHeaders(request.Headers),
				Body:                           request.Body,
				AggregationPlugin:              aggregationPlugin,
				UseCollectionAggregationPlugin: useCollectionAggregationPlugin,
				AggregateOpenAISSE:             aggregationPlugin == "openai",
				TimeoutSeconds:                 request.TimeoutSeconds,
				UpdatedAt:                      strings.TrimSpace(request.UpdatedAt),
			}
			if nextRequest.Name == "" {
				nextRequest.Name = "Untitled Request"
			}
			if nextRequest.Method == "" {
				nextRequest.Method = "GET"
			}
			if nextRequest.TimeoutSeconds <= 0 {
				nextRequest.TimeoutSeconds = 120
			}

			nextCollection.Requests = append(nextCollection.Requests, nextRequest)
		}

		normalized.Collections = append(normalized.Collections, nextCollection)
	}

	if len(normalized.Collections) == 0 {
		return CollectionStore{
			Collections:         []RequestCollection{},
			Plugins:             normalized.Plugins,
			Environments:        normalized.Environments,
			ActiveEnvironmentID: normalized.ActiveEnvironmentID,
			RequestDrafts:       normalized.RequestDrafts,
		}
	}

	return normalized
}

func normalizeEmbeddedAggregationPlugins(entries []EmbeddedAggregationPlugin) []EmbeddedAggregationPlugin {
	if len(entries) == 0 {
		return []EmbeddedAggregationPlugin{}
	}

	normalized := make([]EmbeddedAggregationPlugin, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		id := normalizeImportedAggregationPluginID(entry.ID)
		if id == "" || id == "none" || id == "openai" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}

		label := strings.TrimSpace(entry.Label)
		format := strings.ToLower(strings.TrimSpace(entry.Format))
		source := strings.TrimSpace(entry.Source)
		if label == "" || source == "" {
			continue
		}
		if format != "json" && format != "js" {
			continue
		}
		if len(source) > maxPluginSourceSize {
			continue
		}

		normalized = append(normalized, EmbeddedAggregationPlugin{
			ID:          id,
			Label:       label,
			Description: strings.TrimSpace(entry.Description),
			ImportedAt:  strings.TrimSpace(entry.ImportedAt),
			Format:      format,
			Source:      source,
		})
		seen[id] = struct{}{}
	}

	return normalized
}

func normalizeEnvironmentEntries(entries []EnvironmentEntry) []EnvironmentEntry {
	if len(entries) == 0 {
		return []EnvironmentEntry{}
	}

	normalized := make([]EnvironmentEntry, 0, len(entries))
	for _, entry := range entries {
		name := strings.TrimSpace(entry.Name)
		if name == "" {
			continue
		}

		normalized = append(normalized, EnvironmentEntry{
			ID:   strings.TrimSpace(entry.ID),
			Name: name,
			Text: entry.Text,
		})
	}

	return normalized
}

func resolveActiveEnvironmentID(entries []EnvironmentEntry, preferred string) string {
	preferred = strings.TrimSpace(preferred)
	if preferred == "" {
		return ""
	}

	for _, entry := range entries {
		if entry.ID == preferred {
			return preferred
		}
	}

	return ""
}

func normalizePersistedRequestDrafts(drafts []PersistedRequestDraft) []PersistedRequestDraft {
	if len(drafts) == 0 {
		return []PersistedRequestDraft{}
	}

	normalized := make([]PersistedRequestDraft, 0, len(drafts))
	for _, draft := range drafts {
		requestID := strings.TrimSpace(draft.RequestID)
		collectionID := strings.TrimSpace(draft.CollectionID)
		key := strings.TrimSpace(draft.Key)
		if key == "" {
			key = requestDraftKey(collectionID, requestID)
		}

		normalized = append(normalized, PersistedRequestDraft{
			Key:          key,
			CollectionID: collectionID,
			RequestID:    requestID,
			UpdatedAt:    strings.TrimSpace(draft.UpdatedAt),
			Draft:        normalizeRequestDraft(draft.Draft),
		})
	}

	return normalized
}

func normalizeRequestDraft(draft RequestDraft) RequestDraft {
	aggregationPlugin := normalizeAggregationPlugin(
		draft.AggregationPlugin,
		draft.AggregateOpenAISSE,
	)
	useCollectionAggregationPlugin := draft.UseCollectionAggregationPlugin
	if useCollectionAggregationPlugin {
		aggregationPlugin = ""
	}

	normalized := RequestDraft{
		Name:                           strings.TrimSpace(draft.Name),
		Method:                         strings.ToUpper(strings.TrimSpace(draft.Method)),
		URL:                            draft.URL,
		Headers:                        normalizeSavedHeaders(draft.Headers),
		Body:                           draft.Body,
		AggregationPlugin:              aggregationPlugin,
		UseCollectionAggregationPlugin: useCollectionAggregationPlugin,
		AggregateOpenAISSE:             aggregationPlugin == "openai",
		TimeoutSeconds:                 draft.TimeoutSeconds,
	}
	if normalized.Name == "" {
		normalized.Name = "Untitled Request"
	}
	if normalized.Method == "" {
		normalized.Method = "GET"
	}
	if normalized.TimeoutSeconds <= 0 {
		normalized.TimeoutSeconds = 120
	}

	return normalized
}

func requestDraftKey(collectionID string, requestID string) string {
	if collectionID != "" && requestID != "" {
		return fmt.Sprintf("collection:%s:request:%s", collectionID, requestID)
	}
	if requestID != "" {
		return fmt.Sprintf("request:%s", requestID)
	}
	if collectionID != "" {
		return fmt.Sprintf("collection:%s:unsaved", collectionID)
	}
	return "workspace:unsaved"
}

func normalizeSavedHeaders(headers []SavedHeader) []SavedHeader {
	if len(headers) == 0 {
		return []SavedHeader{}
	}

	normalized := make([]SavedHeader, 0, len(headers))
	for _, header := range headers {
		normalized = append(normalized, SavedHeader{
			Key:     header.Key,
			Value:   header.Value,
			Enabled: header.Enabled,
		})
	}
	return normalized
}

func emptyCollectionStore() CollectionStore {
	return CollectionStore{
		Collections:   []RequestCollection{},
		Plugins:       []EmbeddedAggregationPlugin{},
		Environments:  []EnvironmentEntry{},
		RequestDrafts: []PersistedRequestDraft{},
	}
}
