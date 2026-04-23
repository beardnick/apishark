package server

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var envPlaceholderPattern = regexp.MustCompile(`\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)

type HeaderKV struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type BodyFieldKV struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled,omitempty"`
}

type CurlImportRequest struct {
	Curl string `json:"curl"`
}

type CurlImportResponse struct {
	Method  string     `json:"method"`
	URL     string     `json:"url"`
	Headers []HeaderKV `json:"headers"`
	Body    string     `json:"body"`
}

type SendRequestPayload struct {
	Method             string            `json:"method"`
	URL                string            `json:"url"`
	Headers            []HeaderKV        `json:"headers"`
	BodyMode           string            `json:"body_mode,omitempty"`
	Body               string            `json:"body"`
	BodyFields         []BodyFieldKV     `json:"body_fields,omitempty"`
	Env                map[string]string `json:"env"`
	AggregationPlugin  string            `json:"aggregation_plugin"`
	AggregateOpenAISSE bool              `json:"aggregate_openai_sse"`
	TimeoutSeconds     int               `json:"timeout_seconds"`
}

type server struct {
	staticFS        fs.FS
	fileServer      http.Handler
	collectionStore *collectionFileStore
	pluginStore     *pluginFileStore
	httpClient      *http.Client
}

func NewHandler(staticFS fs.FS, projectDir string) http.Handler {
	collectionStore, err := newCollectionFileStore(projectDir)
	if err != nil {
		panic(err)
	}
	pluginStore, err := newPluginFileStore(projectDir)
	if err != nil {
		panic(err)
	}

	s := &server{
		staticFS:        staticFS,
		fileServer:      http.FileServer(http.FS(staticFS)),
		collectionStore: collectionStore,
		pluginStore:     pluginStore,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/import/curl", s.handleImportCurl)
	mux.HandleFunc("/api/request", s.handleSendRequest)
	mux.HandleFunc("/api/collections", s.handleCollections)
	mux.HandleFunc("/api/plugins", s.handlePlugins)
	mux.HandleFunc("/api/plugins/import", s.handleImportPlugin)
	mux.HandleFunc("/api/plugins/assets/", s.handlePluginAsset)
	mux.HandleFunc("/", s.handleStatic)
	return mux
}

func (s *server) handleImportCurl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	defer r.Body.Close()
	var req CurlImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	parsed, err := ParseCurlCommand(req.Curl)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := CurlImportResponse{
		Method:  parsed.Method,
		URL:     parsed.URL,
		Headers: parsed.Headers,
		Body:    parsed.Body,
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *server) handleSendRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	defer r.Body.Close()
	var payload SendRequestPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	method := strings.ToUpper(strings.TrimSpace(payload.Method))
	if method == "" {
		method = http.MethodGet
	}

	targetURL := applyEnv(payload.URL, payload.Env)
	if targetURL == "" {
		http.Error(w, "request url is required", http.StatusBadRequest)
		return
	}

	bodyText := applyEnv(payload.Body, payload.Env)
	bodyMode := normalizeRequestBodyMode(payload.BodyMode)
	bodyFields := resolveBodyFields(payload.BodyFields, payload.Env)
	reqBody, autoContentType, err := buildRequestBody(bodyMode, bodyText, bodyFields)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to build request body: %v", err), http.StatusBadRequest)
		return
	}

	upstreamReq, err := http.NewRequestWithContext(r.Context(), method, targetURL, reqBody)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create request: %v", err), http.StatusBadRequest)
		return
	}

	hasContentType := false
	for _, h := range payload.Headers {
		key := strings.TrimSpace(applyEnv(h.Key, payload.Env))
		if key == "" {
			continue
		}
		if strings.EqualFold(key, "Content-Type") {
			hasContentType = true
		}
		upstreamReq.Header.Add(key, applyEnv(h.Value, payload.Env))
	}
	if !hasContentType && autoContentType != "" {
		upstreamReq.Header.Set("Content-Type", autoContentType)
	}

	timeout := 120 * time.Second
	if payload.TimeoutSeconds > 0 {
		timeout = time.Duration(payload.TimeoutSeconds) * time.Second
	}

	client := s.httpClient
	if client == nil {
		client = &http.Client{}
	} else {
		cloned := *client
		client = &cloned
	}
	client.Timeout = timeout
	upstreamStart := time.Now()
	upstreamResp, err := client.Do(upstreamReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("upstream request failed: %v", err), http.StatusBadGateway)
		return
	}
	defer upstreamResp.Body.Close()

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming is not supported by this server", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	start := time.Now()
	contentType := upstreamResp.Header.Get("Content-Type")
	streaming := strings.Contains(strings.ToLower(contentType), "text/event-stream")
	if !sendEvent(w, flusher, map[string]any{
		"type":                       "meta",
		"status":                     upstreamResp.StatusCode,
		"status_text":                upstreamResp.Status,
		"headers":                    flattenHeaders(upstreamResp.Header),
		"response_headers":           flattenHeaders(upstreamResp.Header),
		"sent_headers":               flattenHeaders(upstreamReq.Header),
		"streaming":                  streaming,
		"first_response_duration_ms": time.Since(upstreamStart).Milliseconds(),
		"aggregation_plugin":         normalizeAggregationPlugin(payload.AggregationPlugin, payload.AggregateOpenAISSE),
	}) {
		return
	}

	if streaming {
		if !streamSSEBody(w, flusher, upstreamResp.Body, contentType) {
			return
		}
	} else {
		if !streamRegularBody(w, flusher, upstreamResp.Body, contentType) {
			return
		}
	}

	sendEvent(w, flusher, map[string]any{
		"type":        "done",
		"duration_ms": time.Since(start).Milliseconds(),
		"aggregated":  "",
	})
}

func (s *server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cleanPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if cleanPath == "" || cleanPath == "." {
		cleanPath = "index.html"
	}

	if _, err := fs.Stat(s.staticFS, cleanPath); err == nil {
		s.fileServer.ServeHTTP(w, r)
		return
	}

	indexReq := r.Clone(r.Context())
	indexReq.URL.Path = "/index.html"
	s.fileServer.ServeHTTP(w, indexReq)
}

func (s *server) handleCollections(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		store, err := s.collectionStore.Load()
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to load collections: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, store)

	case http.MethodPut:
		defer r.Body.Close()

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}

		var store CollectionStore
		if err := json.Unmarshal(body, &store); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		saved, err := s.collectionStore.Save(store)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to save collections: %v", err), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, saved)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *server) handlePlugins(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	plugins, err := s.pluginStore.LoadEmbeddedPlugins()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to load plugins: %v", err), http.StatusInternalServerError)
		return
	}

	response := struct {
		Plugins []ImportedAggregationPluginResponse `json:"plugins"`
	}{
		Plugins: make([]ImportedAggregationPluginResponse, 0, len(plugins)),
	}
	for _, plugin := range plugins {
		response.Plugins = append(response.Plugins, ImportedAggregationPluginResponse{
			ID:          plugin.ID,
			Label:       plugin.Label,
			Description: plugin.Description,
			ImportedAt:  plugin.ImportedAt,
			Format:      plugin.Format,
			ModuleURL:   fmt.Sprintf("/api/plugins/assets/%s.mjs?v=%s", plugin.ID, urlQueryEscape(plugin.ImportedAt)),
			Source:      plugin.Source,
			SupportsPreRequest: plugin.SupportsPreRequest,
			SupportsPostResponse: plugin.SupportsPostResponse,
		})
	}

	writeJSON(w, http.StatusOK, response)
}

func (s *server) handleImportPlugin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	defer r.Body.Close()
	var payload PluginImportPayload
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxPluginSourceSize+(32<<10)))
	if err := decoder.Decode(&payload); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	plugin, err := s.pluginStore.Import(payload)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to import plugin: %v", err), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, ImportedAggregationPluginResponse{
		ID:          plugin.ID,
		Label:       plugin.Label,
		Description: plugin.Description,
		ImportedAt:  plugin.ImportedAt,
		Format:      plugin.Format,
		ModuleURL:   fmt.Sprintf("/api/plugins/assets/%s.mjs?v=%s", plugin.ID, urlQueryEscape(plugin.ImportedAt)),
		SupportsPreRequest: plugin.SupportsPreRequest,
		SupportsPostResponse: plugin.SupportsPostResponse,
	})
}

func (s *server) handlePluginAsset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean(strings.TrimPrefix(r.URL.Path, "/api/plugins/assets/")), "/")
	if !strings.HasSuffix(name, ".mjs") || strings.Contains(name, "/") {
		http.NotFound(w, r)
		return
	}

	id := normalizeImportedAggregationPluginID(strings.TrimSuffix(name, ".mjs"))
	if id == "" {
		http.NotFound(w, r)
		return
	}

	store, err := s.pluginStore.Load()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to load plugins: %v", err), http.StatusInternalServerError)
		return
	}

	found := false
	for _, plugin := range store.Plugins {
		if plugin.ID == id {
			found = true
			break
		}
	}
	if !found {
		http.NotFound(w, r)
		return
	}

	modulePath := filepath.Join(s.pluginStore.modulesDir, id+".mjs")
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	http.ServeFile(w, r, modulePath)
}

func streamSSEBody(
	w http.ResponseWriter,
	flusher http.Flusher,
	body io.Reader,
	contentType string,
) bool {
	reader := NewLineReader(body)
	seq := 0

	for {
		line, err := reader.ReadLine()
		if line != "" || err == nil {
			seq++
			if !sendEvent(w, flusher, newSSERawEvent(seq, contentType, line, false)) {
				return false
			}
		}

		if err == io.EOF {
			break
		}
		if err != nil {
			return sendEvent(w, flusher, map[string]any{
				"type":    "error",
				"message": fmt.Sprintf("stream read failed: %v", err),
			})
		}
	}

	seq++
	return sendEvent(w, flusher, newSSERawEvent(seq, contentType, "", true))
}

func streamRegularBody(
	w http.ResponseWriter,
	flusher http.Flusher,
	body io.Reader,
	contentType string,
) bool {
	buf := make([]byte, 4096)
	seq := 0

	for {
		n, err := body.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			seq++
			if !sendEvent(w, flusher, newBodyRawEvent(seq, contentType, chunk, false)) {
				return false
			}
		}

		if err == io.EOF {
			break
		}
		if err != nil {
			return sendEvent(w, flusher, map[string]any{
				"type":    "error",
				"message": fmt.Sprintf("response read failed: %v", err),
			})
		}
	}

	seq++
	return sendEvent(w, flusher, newBodyRawEvent(seq, contentType, "", true))
}

func flattenHeaders(headers http.Header) map[string]string {
	out := make(map[string]string, len(headers))
	for key, values := range headers {
		out[key] = strings.Join(values, ", ")
	}
	return out
}

func sendEvent(w io.Writer, flusher http.Flusher, payload any) bool {
	data, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
		return false
	}
	flusher.Flush()
	return true
}

func normalizeAggregationPlugin(pluginID string, legacyOpenAI bool) string {
	normalized := strings.ToLower(strings.TrimSpace(pluginID))
	switch normalized {
	case "openai", "none":
		return normalized
	}
	if normalizeImportedAggregationPluginID(normalized) != "" {
		return normalized
	}
	if legacyOpenAI {
		return "openai"
	}
	return "none"
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func applyEnv(input string, env map[string]string) string {
	if input == "" || len(env) == 0 {
		return input
	}

	return envPlaceholderPattern.ReplaceAllStringFunc(input, func(match string) string {
		submatch := envPlaceholderPattern.FindStringSubmatch(match)
		if len(submatch) != 2 {
			return match
		}
		if value, ok := env[submatch[1]]; ok {
			return value
		}
		return match
	})
}

func urlQueryEscape(value string) string {
	replacer := strings.NewReplacer("%", "%25", ":", "%3A", "+", "%2B")
	return replacer.Replace(value)
}
