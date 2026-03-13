package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	pluginWorkspaceDirName = ".apishark"
	pluginsFileName        = "plugins.json"
	pluginsModuleDirName   = "plugins"
	maxPluginsFileSize     = 1 << 20
	maxPluginSourceSize    = 256 << 10
)

var aggregationPluginIDPattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,63}$`)

type ImportedAggregationPlugin struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	ImportedAt  string `json:"imported_at"`
	Format      string `json:"format"`
	SourceFile  string `json:"source_file"`
}

type PluginStore struct {
	Plugins []ImportedAggregationPlugin `json:"plugins"`
}

type ImportedAggregationPluginResponse struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	ImportedAt  string `json:"imported_at"`
	Format      string `json:"format"`
	ModuleURL   string `json:"module_url"`
}

type PluginImportPayload struct {
	FileName    string `json:"file_name"`
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Source      string `json:"source"`
	Format      string `json:"format"`
}

type pluginFileStore struct {
	mu           sync.Mutex
	manifestPath string
	modulesDir   string
}

func newPluginFileStore(projectDir string) (*pluginFileStore, error) {
	if strings.TrimSpace(projectDir) == "" {
		return nil, errors.New("project directory is required")
	}

	absProjectDir, err := filepath.Abs(projectDir)
	if err != nil {
		return nil, fmt.Errorf("resolve project directory: %w", err)
	}

	workspaceDir := filepath.Join(absProjectDir, pluginWorkspaceDirName)
	return &pluginFileStore{
		manifestPath: filepath.Join(workspaceDir, pluginsFileName),
		modulesDir:   filepath.Join(workspaceDir, pluginsModuleDirName),
	}, nil
}

func (s *pluginFileStore) Load() (PluginStore, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return loadPluginStoreFromFile(s.manifestPath)
}

func (s *pluginFileStore) Import(payload PluginImportPayload) (ImportedAggregationPlugin, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	plugin, moduleSource, err := normalizeImportedPlugin(payload)
	if err != nil {
		return ImportedAggregationPlugin{}, err
	}

	store, err := loadPluginStoreFromFile(s.manifestPath)
	if err != nil {
		return ImportedAggregationPlugin{}, err
	}

	if err := os.MkdirAll(s.modulesDir, 0o755); err != nil {
		return ImportedAggregationPlugin{}, fmt.Errorf("create plugins directory: %w", err)
	}

	modulePath := filepath.Join(s.modulesDir, plugin.SourceFile)
	if err := writeAtomicFile(modulePath, []byte(moduleSource), 0o644); err != nil {
		return ImportedAggregationPlugin{}, fmt.Errorf("write plugin module: %w", err)
	}

	nextPlugins := make([]ImportedAggregationPlugin, 0, len(store.Plugins)+1)
	replaced := false
	for _, existing := range store.Plugins {
		if existing.ID == plugin.ID {
			nextPlugins = append(nextPlugins, plugin)
			replaced = true
			continue
		}
		nextPlugins = append(nextPlugins, existing)
	}
	if !replaced {
		nextPlugins = append(nextPlugins, plugin)
	}

	store.Plugins = normalizePluginEntries(nextPlugins)
	if err := savePluginStoreToFile(s.manifestPath, store); err != nil {
		return ImportedAggregationPlugin{}, err
	}

	return plugin, nil
}

func loadPluginStoreFromFile(filePath string) (PluginStore, error) {
	file, err := os.Open(filePath)
	if errors.Is(err, os.ErrNotExist) {
		return emptyPluginStore(), nil
	}
	if err != nil {
		return PluginStore{}, fmt.Errorf("open plugins file: %w", err)
	}
	defer file.Close()

	limited := io.LimitReader(file, maxPluginsFileSize+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return PluginStore{}, fmt.Errorf("read plugins file: %w", err)
	}
	if len(data) > maxPluginsFileSize {
		return PluginStore{}, fmt.Errorf("plugins file exceeds %d bytes", maxPluginsFileSize)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return emptyPluginStore(), nil
	}

	var store PluginStore
	if err := json.Unmarshal(data, &store); err != nil {
		return PluginStore{}, fmt.Errorf("parse plugins file: %w", err)
	}

	return PluginStore{Plugins: normalizePluginEntries(store.Plugins)}, nil
}

func savePluginStoreToFile(filePath string, store PluginStore) error {
	data, err := json.MarshalIndent(PluginStore{Plugins: normalizePluginEntries(store.Plugins)}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal plugins: %w", err)
	}
	data = append(data, '\n')
	return writeAtomicFile(filePath, data, 0o644)
}

func writeAtomicFile(filePath string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return fmt.Errorf("create directory: %w", err)
	}

	tempFile, err := os.CreateTemp(filepath.Dir(filePath), ".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
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
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := tempFile.Chmod(mode); err != nil {
		_ = tempFile.Close()
		return fmt.Errorf("chmod temp file: %w", err)
	}
	if err := tempFile.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}
	if err := os.Rename(tempPath, filePath); err != nil {
		return fmt.Errorf("replace file: %w", err)
	}

	cleanupTemp = false
	return nil
}

func normalizeImportedPlugin(payload PluginImportPayload) (ImportedAggregationPlugin, string, error) {
	id := normalizeImportedAggregationPluginID(payload.ID)
	if id == "" {
		return ImportedAggregationPlugin{}, "", errors.New("plugin id must be lowercase letters, numbers, dots, underscores, or dashes")
	}
	if id == "none" || id == "openai" {
		return ImportedAggregationPlugin{}, "", fmt.Errorf("plugin id %q is reserved by a built-in profile", id)
	}

	label := strings.TrimSpace(payload.Label)
	if label == "" {
		return ImportedAggregationPlugin{}, "", errors.New("plugin label is required")
	}

	format := strings.ToLower(strings.TrimSpace(payload.Format))
	if format != "json" && format != "js" {
		return ImportedAggregationPlugin{}, "", errors.New("plugin format must be json or js")
	}

	moduleSource := strings.TrimSpace(payload.Source)
	if moduleSource == "" {
		return ImportedAggregationPlugin{}, "", errors.New("plugin source is required")
	}
	if len(moduleSource) > maxPluginSourceSize {
		return ImportedAggregationPlugin{}, "", fmt.Errorf("plugin source exceeds %d bytes", maxPluginSourceSize)
	}

	importedAt := time.Now().UTC().Format(time.RFC3339Nano)
	return ImportedAggregationPlugin{
		ID:          id,
		Label:       label,
		Description: strings.TrimSpace(payload.Description),
		ImportedAt:  importedAt,
		Format:      format,
		SourceFile:  id + ".mjs",
	}, moduleSource + "\n", nil
}

func normalizePluginEntries(entries []ImportedAggregationPlugin) []ImportedAggregationPlugin {
	if len(entries) == 0 {
		return []ImportedAggregationPlugin{}
	}

	normalized := make([]ImportedAggregationPlugin, 0, len(entries))
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
		if label == "" {
			continue
		}

		format := strings.ToLower(strings.TrimSpace(entry.Format))
		if format != "json" && format != "js" {
			continue
		}

		normalized = append(normalized, ImportedAggregationPlugin{
			ID:          id,
			Label:       label,
			Description: strings.TrimSpace(entry.Description),
			ImportedAt:  strings.TrimSpace(entry.ImportedAt),
			Format:      format,
			SourceFile:  id + ".mjs",
		})
		seen[id] = struct{}{}
	}

	sort.Slice(normalized, func(i, j int) bool {
		return normalized[i].Label < normalized[j].Label
	})
	return normalized
}

func normalizeImportedAggregationPluginID(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if !aggregationPluginIDPattern.MatchString(normalized) {
		return ""
	}
	return normalized
}

func emptyPluginStore() PluginStore {
	return PluginStore{Plugins: []ImportedAggregationPlugin{}}
}
