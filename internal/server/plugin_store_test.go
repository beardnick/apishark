package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPluginFileStoreImportAndReload(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store, err := newPluginFileStore(dir)
	if err != nil {
		t.Fatalf("newPluginFileStore() error = %v", err)
	}

	imported, err := store.Import(PluginImportPayload{
		FileName:    "vendor-plugin.js",
		ID:          "vendor.example",
		Label:       "Vendor Example",
		Description: "Fixture plugin",
		Source:      "export function create() { return {}; }",
		Format:      "js",
	})
	if err != nil {
		t.Fatalf("Import() error = %v", err)
	}
	if imported.ID != "vendor.example" {
		t.Fatalf("Import() id = %q, want %q", imported.ID, "vendor.example")
	}

	modulePath := filepath.Join(dir, pluginWorkspaceDirName, pluginsModuleDirName, "vendor.example.mjs")
	rawModule, err := os.ReadFile(modulePath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", modulePath, err)
	}
	if !strings.Contains(string(rawModule), "create") {
		t.Fatalf("stored plugin module = %q, want create() source", string(rawModule))
	}

	reloaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(reloaded.Plugins) != 1 {
		t.Fatalf("Load() plugin count = %d, want 1", len(reloaded.Plugins))
	}
	if reloaded.Plugins[0].Format != "js" {
		t.Fatalf("Load() format = %q, want js", reloaded.Plugins[0].Format)
	}
}

func TestHandleImportPluginAndServeAsset(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	store, err := newPluginFileStore(dir)
	if err != nil {
		t.Fatalf("newPluginFileStore() error = %v", err)
	}

	handler := &server{pluginStore: store}
	payload, err := json.Marshal(PluginImportPayload{
		FileName:    "vendor-plugin.json",
		ID:          "vendor.asset",
		Label:       "Vendor Asset",
		Description: "Imported from test",
		Source:      "export function create() { return {}; }",
		Format:      "json",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	importRecorder := httptest.NewRecorder()
	importRequest := httptest.NewRequest(http.MethodPost, "/api/plugins/import", bytes.NewReader(payload))
	handler.handleImportPlugin(importRecorder, importRequest)
	if importRecorder.Code != http.StatusOK {
		t.Fatalf("handleImportPlugin() status = %d, want %d", importRecorder.Code, http.StatusOK)
	}

	listRecorder := httptest.NewRecorder()
	listRequest := httptest.NewRequest(http.MethodGet, "/api/plugins", nil)
	handler.handlePlugins(listRecorder, listRequest)
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("handlePlugins() status = %d, want %d", listRecorder.Code, http.StatusOK)
	}
	if !strings.Contains(listRecorder.Body.String(), "/api/plugins/assets/vendor.asset.mjs") {
		t.Fatalf("handlePlugins() body = %q, want module URL", listRecorder.Body.String())
	}
	if !strings.Contains(listRecorder.Body.String(), "\"source\":\"export function create() { return {}; }\\n\"") {
		t.Fatalf("handlePlugins() body = %q, want embedded source", listRecorder.Body.String())
	}

	assetRecorder := httptest.NewRecorder()
	assetRequest := httptest.NewRequest(http.MethodGet, "/api/plugins/assets/vendor.asset.mjs", nil)
	handler.handlePluginAsset(assetRecorder, assetRequest)
	if assetRecorder.Code != http.StatusOK {
		t.Fatalf("handlePluginAsset() status = %d, want %d", assetRecorder.Code, http.StatusOK)
	}
	if got := assetRecorder.Header().Get("Content-Type"); !strings.Contains(got, "text/javascript") {
		t.Fatalf("handlePluginAsset() content type = %q, want JavaScript", got)
	}
	if !strings.Contains(assetRecorder.Body.String(), "create") {
		t.Fatalf("handlePluginAsset() body = %q, want plugin source", assetRecorder.Body.String())
	}
}
