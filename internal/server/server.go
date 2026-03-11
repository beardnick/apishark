package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"
)

var envPlaceholderPattern = regexp.MustCompile(`\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}`)

type HeaderKV struct {
	Key   string `json:"key"`
	Value string `json:"value"`
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
	Body               string            `json:"body"`
	Env                map[string]string `json:"env"`
	AggregateOpenAISSE bool              `json:"aggregate_openai_sse"`
	TimeoutSeconds     int               `json:"timeout_seconds"`
}

type server struct {
	staticFS         fs.FS
	fileServer       http.Handler
	collectionStore  *collectionFileStore
}

func NewHandler(staticFS fs.FS, projectDir string) http.Handler {
	collectionStore, err := newCollectionFileStore(projectDir)
	if err != nil {
		panic(err)
	}

	s := &server{
		staticFS:        staticFS,
		fileServer:      http.FileServer(http.FS(staticFS)),
		collectionStore: collectionStore,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/import/curl", s.handleImportCurl)
	mux.HandleFunc("/api/request", s.handleSendRequest)
	mux.HandleFunc("/api/collections", s.handleCollections)
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
	var reqBody io.Reader
	if bodyText != "" {
		reqBody = strings.NewReader(bodyText)
	}

	upstreamReq, err := http.NewRequestWithContext(r.Context(), method, targetURL, reqBody)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create request: %v", err), http.StatusBadRequest)
		return
	}

	for _, h := range payload.Headers {
		key := strings.TrimSpace(applyEnv(h.Key, payload.Env))
		if key == "" {
			continue
		}
		upstreamReq.Header.Add(key, applyEnv(h.Value, payload.Env))
	}

	timeout := 120 * time.Second
	if payload.TimeoutSeconds > 0 {
		timeout = time.Duration(payload.TimeoutSeconds) * time.Second
	}

	client := &http.Client{Timeout: timeout}
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
	streaming := strings.Contains(strings.ToLower(upstreamResp.Header.Get("Content-Type")), "text/event-stream")
	if !sendEvent(w, flusher, map[string]any{
		"type":        "meta",
		"status":      upstreamResp.StatusCode,
		"status_text": upstreamResp.Status,
		"headers":     flattenHeaders(upstreamResp.Header),
		"streaming":   streaming,
	}) {
		return
	}

	aggregator := NewOpenAIAggregator(payload.AggregateOpenAISSE)
	if streaming {
		if !streamSSEBody(w, flusher, upstreamResp.Body, aggregator) {
			return
		}
	} else {
		if !streamRegularBody(w, flusher, upstreamResp.Body, aggregator, payload.AggregateOpenAISSE) {
			return
		}
	}

	sendEvent(w, flusher, map[string]any{
		"type":        "done",
		"duration_ms": time.Since(start).Milliseconds(),
		"aggregated":  aggregator.Text(),
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

		limitedBody := io.LimitReader(r.Body, maxCollectionsFileSize+1)
		body, err := io.ReadAll(limitedBody)
		if err != nil {
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}
		if len(body) > maxCollectionsFileSize {
			http.Error(w, "collections payload is too large", http.StatusRequestEntityTooLarge)
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

func streamSSEBody(
	w http.ResponseWriter,
	flusher http.Flusher,
	body io.Reader,
	aggregator *OpenAIAggregator,
) bool {
	reader := NewLineReader(body)

	for {
		line, err := reader.ReadLine()
		if line != "" {
			if !sendEvent(w, flusher, map[string]any{
				"type": "sse_line",
				"line": line,
			}) {
				return false
			}

			if delta, done := aggregator.ConsumeSSELine(line); delta != "" {
				if !sendEvent(w, flusher, map[string]any{
					"type":  "aggregate_delta",
					"delta": delta,
					"text":  aggregator.Text(),
				}) {
					return false
				}
			} else if done {
				if !sendEvent(w, flusher, map[string]any{
					"type": "aggregate_done",
					"text": aggregator.Text(),
				}) {
					return false
				}
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

	return true
}

func streamRegularBody(
	w http.ResponseWriter,
	flusher http.Flusher,
	body io.Reader,
	aggregator *OpenAIAggregator,
	aggregateEnabled bool,
) bool {
	var fullBody bytes.Buffer
	buf := make([]byte, 4096)

	for {
		n, err := body.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			fullBody.Write(buf[:n])
			if !sendEvent(w, flusher, map[string]any{
				"type":  "body_chunk",
				"chunk": chunk,
			}) {
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

	if aggregateEnabled {
		if delta := aggregator.ConsumeNonStreamJSON(fullBody.Bytes()); delta != "" {
			if !sendEvent(w, flusher, map[string]any{
				"type": "aggregate_done",
				"text": aggregator.Text(),
			}) {
				return false
			}
		}
	}

	return true
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
