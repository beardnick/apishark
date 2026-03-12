package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	collectionsFileName    = "collections.json"
	maxCollectionsFileSize = 4 << 20
)

type SavedHeader struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type SavedRequest struct {
	ID                 string        `json:"id"`
	Name               string        `json:"name"`
	Method             string        `json:"method"`
	URL                string        `json:"url"`
	Headers            []SavedHeader `json:"headers"`
	Body               string        `json:"body"`
	AggregationPlugin  string        `json:"aggregation_plugin,omitempty"`
	AggregateOpenAISSE bool          `json:"aggregate_openai_sse"`
	TimeoutSeconds     int           `json:"timeout_seconds"`
	UpdatedAt          string        `json:"updated_at,omitempty"`
}

type RequestCollection struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Requests []SavedRequest `json:"requests"`
}

type CollectionStore struct {
	Collections []RequestCollection `json:"collections"`
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

	limited := io.LimitReader(file, maxCollectionsFileSize+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return CollectionStore{}, fmt.Errorf("read collections file: %w", err)
	}
	if len(data) > maxCollectionsFileSize {
		return CollectionStore{}, fmt.Errorf("collections file exceeds %d bytes", maxCollectionsFileSize)
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
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return fmt.Errorf("create collections directory: %w", err)
	}

	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal collections: %w", err)
	}
	data = append(data, '\n')

	tempFile, err := os.CreateTemp(filepath.Dir(filePath), ".collections-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp collections file: %w", err)
	}

	tempPath := tempFile.Name()
	cleanupTemp := true
	defer func() {
		if cleanupTemp {
			_ = os.Remove(tempPath)
		}
	}()

	if _, err := tempFile.Write(data); err != nil {
		_ = tempFile.Close()
		return fmt.Errorf("write temp collections file: %w", err)
	}
	if err := tempFile.Chmod(0o644); err != nil {
		_ = tempFile.Close()
		return fmt.Errorf("chmod temp collections file: %w", err)
	}
	if err := tempFile.Close(); err != nil {
		return fmt.Errorf("close temp collections file: %w", err)
	}
	if err := os.Rename(tempPath, filePath); err != nil {
		return fmt.Errorf("replace collections file: %w", err)
	}

	cleanupTemp = false
	return nil
}

func normalizeCollectionStore(store CollectionStore) CollectionStore {
	if len(store.Collections) == 0 {
		return emptyCollectionStore()
	}

	normalized := CollectionStore{
		Collections: make([]RequestCollection, 0, len(store.Collections)),
	}

	for _, collection := range store.Collections {
		name := strings.TrimSpace(collection.Name)
		if name == "" {
			continue
		}

		nextCollection := RequestCollection{
			ID:       strings.TrimSpace(collection.ID),
			Name:     name,
			Requests: make([]SavedRequest, 0, len(collection.Requests)),
		}

		for _, request := range collection.Requests {
			aggregationPlugin := resolveAggregationPlugin(request.AggregationPlugin, request.AggregateOpenAISSE)
			nextRequest := SavedRequest{
				ID:                 strings.TrimSpace(request.ID),
				Name:               strings.TrimSpace(request.Name),
				Method:             strings.ToUpper(strings.TrimSpace(request.Method)),
				URL:                request.URL,
				Headers:            normalizeSavedHeaders(request.Headers),
				Body:               request.Body,
				AggregationPlugin:  aggregationPlugin,
				AggregateOpenAISSE: aggregationPlugin == "openai",
				TimeoutSeconds:     request.TimeoutSeconds,
				UpdatedAt:          strings.TrimSpace(request.UpdatedAt),
			}
			if nextRequest.Name == "" {
				nextRequest.Name = "Untitled Request"
			}
			if nextRequest.Method == "" {
				nextRequest.Method = http.MethodGet
			}
			if nextRequest.TimeoutSeconds <= 0 {
				nextRequest.TimeoutSeconds = 120
			}

			nextCollection.Requests = append(nextCollection.Requests, nextRequest)
		}

		normalized.Collections = append(normalized.Collections, nextCollection)
	}

	if len(normalized.Collections) == 0 {
		return emptyCollectionStore()
	}

	return normalized
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
	return CollectionStore{Collections: []RequestCollection{}}
}
