// src/main.ts
var STORAGE_KEY = "apishark.state.v1";
var RAW_OUTPUT_MAX_CHARS = 22e4;
var AGGREGATE_OUTPUT_MAX_CHARS = 12e4;
var OUTPUT_FLUSH_INTERVAL_MS = 50;
var SSE_MAX_LINES = 1200;
var envInput = byId("envInput");
var curlInput = byId("curlInput");
var importCurlBtn = byId("importCurlBtn");
var methodInput = byId("methodInput");
var urlInput = byId("urlInput");
var headersInput = byId("headersInput");
var bodyInput = byId("bodyInput");
var aggregateInput = byId("aggregateInput");
var timeoutInput = byId("timeoutInput");
var sendBtn = byId("sendBtn");
var abortBtn = byId("abortBtn");
var clearOutputBtn = byId("clearOutputBtn");
var statusText = byId("statusText");
var errorText = byId("errorText");
var headersOutput = byId("headersOutput");
var rawOutput = byId("rawOutput");
var aggregateOutput = byId("aggregateOutput");
var sseInspector = byId("sseInspector");
var sseLineList = byId("sseLineList");
var ssePayloadOutput = byId("ssePayloadOutput");
var ssePayloadMeta = byId("ssePayloadMeta");
var activeAbortController = null;
var rawAppender;
var aggregateAppender;
var rawResponseMode = "plain";
var sseLineEntries = [];
var selectedSseLine = null;
var sseLineCounter = 0;
function wireEvents() {
  importCurlBtn.addEventListener("click", () => {
    void importCurl();
  });
  sendBtn.addEventListener("click", () => {
    void sendRequest();
  });
  abortBtn.addEventListener("click", () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  });
  clearOutputBtn.addEventListener("click", () => clearOutputs());
  const persistTargets = [
    envInput,
    curlInput,
    methodInput,
    urlInput,
    headersInput,
    bodyInput,
    aggregateInput,
    timeoutInput
  ];
  for (const target of persistTargets) {
    target.addEventListener("input", persistState);
    target.addEventListener("change", persistState);
  }
}
function setupTabs() {
  const tabButtons = document.querySelectorAll(
    "[data-tab-group][data-tab-target]"
  );
  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const group = button.dataset.tabGroup;
      const target = button.dataset.tabTarget;
      if (!group || !target) {
        return;
      }
      activateTab(group, target);
    });
  }
}
function activateTab(group, targetId) {
  const buttons = document.querySelectorAll(
    `[data-tab-group="${group}"]`
  );
  for (const button of buttons) {
    button.classList.toggle("is-active", button.dataset.tabTarget === targetId);
  }
  const panels = document.querySelectorAll(
    `[data-tab-panel="${group}"]`
  );
  for (const panel of panels) {
    panel.classList.toggle("is-active", panel.id === targetId);
  }
}
function setRawResponseMode(mode) {
  rawResponseMode = mode;
  const sseMode = mode === "sse";
  sseInspector.classList.toggle("is-visible", sseMode);
  rawOutput.classList.toggle("is-hidden", sseMode);
}
function clearSseInspector() {
  sseLineEntries = [];
  selectedSseLine = null;
  sseLineCounter = 0;
  sseLineList.textContent = "";
  ssePayloadMeta.textContent = "Click a line to inspect payload.";
  ssePayloadOutput.textContent = "";
}
function appendSseLine(rawLine) {
  const index = ++sseLineCounter;
  const payloadText = extractPayloadText(rawLine);
  const pretty = prettifyJSON(payloadText);
  const isJSON = pretty !== null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sse-line-btn";
  button.title = rawLine;
  button.textContent = `${index}. ${summarizeLineForButton(rawLine, payloadText)}`;
  const entry = {
    index,
    rawLine,
    payloadDisplay: isJSON ? pretty : payloadText || rawLine,
    isJSON,
    button
  };
  button.addEventListener("click", () => selectSseLine(entry));
  const shouldStick = isNearBottom(sseLineList);
  sseLineEntries.push(entry);
  sseLineList.appendChild(button);
  trimSseLines();
  if (selectedSseLine === null) {
    selectSseLine(entry);
  }
  if (shouldStick) {
    sseLineList.scrollTop = sseLineList.scrollHeight;
  }
}
function trimSseLines() {
  while (sseLineEntries.length > SSE_MAX_LINES) {
    const removed = sseLineEntries.shift();
    if (!removed) {
      return;
    }
    removed.button.remove();
    if (selectedSseLine === removed) {
      selectedSseLine = null;
    }
  }
  if (selectedSseLine === null && sseLineEntries.length > 0) {
    selectSseLine(sseLineEntries[sseLineEntries.length - 1]);
  }
}
function selectSseLine(entry) {
  if (selectedSseLine === entry) {
    return;
  }
  if (selectedSseLine) {
    selectedSseLine.button.classList.remove("is-selected");
  }
  selectedSseLine = entry;
  entry.button.classList.add("is-selected");
  ssePayloadOutput.textContent = entry.payloadDisplay;
  ssePayloadMeta.textContent = entry.isJSON ? `Line ${entry.index} payload (JSON prettified)` : `Line ${entry.index} payload`;
}
function extractPayloadText(rawLine) {
  const trimmed = rawLine.trim();
  if (trimmed.startsWith("data:")) {
    return trimmed.slice(5).trimStart();
  }
  if (trimmed.startsWith("event:")) {
    return trimmed.slice(6).trimStart();
  }
  if (trimmed.startsWith("id:")) {
    return trimmed.slice(3).trimStart();
  }
  return trimmed;
}
function prettifyJSON(payload) {
  if (!payload) {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return null;
  }
}
function summarizeLineForButton(rawLine, payloadText) {
  const base = (payloadText || rawLine).replace(/\s+/g, " ").trim();
  if (!base) {
    return "(empty)";
  }
  if (base.length <= 110) {
    return base;
  }
  return `${base.slice(0, 107)}...`;
}
function defaultState() {
  return {
    envText: "OPENAI_API_KEY=\nBASE_URL=https://api.openai.com",
    curlText: "",
    method: "POST",
    url: "{{BASE_URL}}/v1/chat/completions",
    headersText: "Content-Type: application/json\nAuthorization: Bearer {{OPENAI_API_KEY}}",
    bodyText: JSON.stringify(
      {
        model: "gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: "Write a haiku about sharks." }]
      },
      null,
      2
    ),
    aggregateOpenAISse: true,
    timeoutSeconds: 120
  };
}
function applyInitialState() {
  const state = loadState();
  envInput.value = state.envText;
  curlInput.value = state.curlText;
  methodInput.value = state.method;
  urlInput.value = state.url;
  headersInput.value = state.headersText;
  bodyInput.value = state.bodyText;
  aggregateInput.checked = state.aggregateOpenAISse;
  timeoutInput.value = String(state.timeoutSeconds);
}
function loadState() {
  const fallback = defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      envText: typeof parsed.envText === "string" ? parsed.envText : fallback.envText,
      curlText: typeof parsed.curlText === "string" ? parsed.curlText : fallback.curlText,
      method: typeof parsed.method === "string" ? parsed.method : fallback.method,
      url: typeof parsed.url === "string" ? parsed.url : fallback.url,
      headersText: typeof parsed.headersText === "string" ? parsed.headersText : fallback.headersText,
      bodyText: typeof parsed.bodyText === "string" ? parsed.bodyText : fallback.bodyText,
      aggregateOpenAISse: typeof parsed.aggregateOpenAISse === "boolean" ? parsed.aggregateOpenAISse : fallback.aggregateOpenAISse,
      timeoutSeconds: typeof parsed.timeoutSeconds === "number" && Number.isFinite(parsed.timeoutSeconds) ? parsed.timeoutSeconds : fallback.timeoutSeconds
    };
  } catch {
    return fallback;
  }
}
function persistState() {
  const state = {
    envText: envInput.value,
    curlText: curlInput.value,
    method: methodInput.value,
    url: urlInput.value,
    headersText: headersInput.value,
    bodyText: bodyInput.value,
    aggregateOpenAISse: aggregateInput.checked,
    timeoutSeconds: toPositiveInt(timeoutInput.value, 120)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
async function importCurl() {
  setError("");
  const curl = curlInput.value.trim();
  if (!curl) {
    setError("Enter a curl command first.");
    return;
  }
  setLoading(true);
  try {
    const response = await fetch("/api/import/curl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curl })
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(responseText || `Import failed (${response.status})`);
    }
    const parsed = JSON.parse(responseText);
    methodInput.value = parsed.method || "GET";
    urlInput.value = parsed.url || "";
    headersInput.value = stringifyHeaders(parsed.headers || []);
    bodyInput.value = parsed.body || "";
    persistState();
  } catch (error) {
    setError(errorMessage(error, "Failed to import curl command."));
  } finally {
    setLoading(false);
  }
}
async function sendRequest() {
  setError("");
  clearOutputs();
  const url = urlInput.value.trim();
  if (!url) {
    setError("Request URL is required.");
    return;
  }
  setLoading(true);
  activeAbortController = new AbortController();
  const payload = {
    method: methodInput.value.trim().toUpperCase(),
    url,
    headers: parseHeaders(headersInput.value),
    body: bodyInput.value,
    env: parseEnvVars(envInput.value),
    aggregate_openai_sse: aggregateInput.checked,
    timeout_seconds: toPositiveInt(timeoutInput.value, 120)
  };
  try {
    const response = await fetch("/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: activeAbortController.signal
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(errorBody || `Request failed (${response.status})`);
    }
    await consumeServerEvents(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      setError("Request aborted.");
    } else {
      setError(errorMessage(error, "Failed to send request."));
    }
  } finally {
    activeAbortController = null;
    setLoading(false);
    persistState();
  }
}
async function consumeServerEvents(response) {
  if (!response.body) {
    throw new Error("Streaming body is unavailable in this browser.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let frameIndex = buffer.indexOf("\n\n");
    while (frameIndex >= 0) {
      const frame = buffer.slice(0, frameIndex);
      buffer = buffer.slice(frameIndex + 2);
      consumeFrame(frame);
      frameIndex = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) {
    consumeFrame(buffer);
  }
}
function consumeFrame(frame) {
  const dataParts = [];
  const lines = frame.split("\n");
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trimStart());
    }
  }
  if (dataParts.length === 0) {
    return;
  }
  const payload = dataParts.join("\n");
  try {
    const event = JSON.parse(payload);
    consumeEvent(event);
  } catch {
    if (rawResponseMode === "sse") {
      appendSseLine(payload);
    } else {
      rawAppender.enqueue(`${payload}
`);
    }
  }
}
function consumeEvent(event) {
  switch (event.type) {
    case "meta":
      setRawResponseMode(event.streaming ? "sse" : "plain");
      statusText.textContent = `${event.status_text}${event.streaming ? " (SSE stream)" : ""}`;
      headersOutput.textContent = JSON.stringify(event.headers, null, 2);
      break;
    case "sse_line":
      appendSseLine(event.line);
      break;
    case "body_chunk":
      if (rawResponseMode === "sse") {
        const normalized = event.chunk.replace(/\r\n/g, "\n");
        for (const line of normalized.split("\n")) {
          if (line) {
            appendSseLine(line);
          }
        }
      } else {
        rawAppender.enqueue(event.chunk);
      }
      break;
    case "aggregate_delta":
      aggregateAppender.enqueue(event.delta);
      break;
    case "aggregate_done":
      if (!aggregateAppender.hasContent() && event.text) {
        aggregateAppender.setText(event.text);
      }
      break;
    case "error":
      setError(event.message);
      break;
    case "done":
      if (statusText.textContent) {
        statusText.textContent = `${statusText.textContent} (${event.duration_ms} ms)`;
      }
      if (!aggregateAppender.hasContent() && event.aggregated) {
        aggregateAppender.setText(event.aggregated);
      }
      break;
  }
}
function clearOutputs() {
  setRawResponseMode("plain");
  statusText.textContent = "-";
  headersOutput.textContent = "";
  rawAppender.clear();
  aggregateAppender.clear();
  clearSseInspector();
}
function parseEnvVars(text) {
  const env = {};
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) {
      continue;
    }
    const key = trimmed.slice(0, splitAt).trim();
    const value = trimmed.slice(splitAt + 1);
    if (key) {
      env[key] = value;
    }
  }
  return env;
}
function parseHeaders(text) {
  const headers = [];
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const splitAt = trimmed.indexOf(":");
    if (splitAt <= 0) {
      continue;
    }
    const key = trimmed.slice(0, splitAt).trim();
    const value = trimmed.slice(splitAt + 1).trim();
    if (key) {
      headers.push({ key, value });
    }
  }
  return headers;
}
function stringifyHeaders(headers) {
  return headers.map((h) => `${h.key}: ${h.value}`).join("\n");
}
function setLoading(isLoading) {
  sendBtn.disabled = isLoading;
  importCurlBtn.disabled = isLoading;
  methodInput.disabled = isLoading;
  urlInput.disabled = isLoading;
  headersInput.disabled = isLoading;
  bodyInput.disabled = isLoading;
  timeoutInput.disabled = isLoading;
  aggregateInput.disabled = isLoading;
  abortBtn.disabled = !isLoading;
  sendBtn.textContent = isLoading ? "Sending..." : "Send";
}
function setError(message) {
  errorText.textContent = message;
}
function errorMessage(error, fallback) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}
function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element with id ${id}`);
  }
  return element;
}
var BatchedBoundedAppender = class {
  constructor(element, maxChars, flushIntervalMs = OUTPUT_FLUSH_INTERVAL_MS) {
    this.chunks = [];
    this.pending = [];
    this.pendingChars = 0;
    this.totalChars = 0;
    this.flushTimer = null;
    this.element = element;
    this.maxChars = maxChars;
    this.flushIntervalMs = flushIntervalMs;
  }
  enqueue(text) {
    if (!text) {
      return;
    }
    this.pending.push(text);
    this.pendingChars += text.length;
    this.scheduleFlush();
  }
  hasContent() {
    return this.totalChars > 0 || this.pendingChars > 0;
  }
  setText(text) {
    this.clear();
    this.enqueue(text);
    this.flushNow();
  }
  clear() {
    this.cancelFlush();
    this.pending = [];
    this.pendingChars = 0;
    this.totalChars = 0;
    this.chunks.length = 0;
    this.element.textContent = "";
  }
  scheduleFlush() {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, this.flushIntervalMs);
  }
  cancelFlush() {
    if (this.flushTimer === null) {
      return;
    }
    window.clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }
  flushNow() {
    if (this.pendingChars === 0) {
      return;
    }
    const text = this.pending.join("");
    this.pending = [];
    this.pendingChars = 0;
    if (!text) {
      return;
    }
    const stickToBottom = isNearBottom(this.element);
    const textNode = document.createTextNode(text);
    this.element.appendChild(textNode);
    this.chunks.push({ node: textNode, len: text.length });
    this.totalChars += text.length;
    this.trimOverflow();
    if (stickToBottom) {
      this.element.scrollTop = this.element.scrollHeight;
    }
  }
  trimOverflow() {
    let overflow = this.totalChars - this.maxChars;
    while (overflow > 0 && this.chunks.length > 0) {
      const first = this.chunks[0];
      if (overflow >= first.len) {
        this.element.removeChild(first.node);
        this.chunks.shift();
        this.totalChars -= first.len;
        overflow -= first.len;
        continue;
      }
      first.node.data = first.node.data.slice(overflow);
      first.len -= overflow;
      this.totalChars -= overflow;
      overflow = 0;
    }
  }
};
function isNearBottom(element) {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 24;
}
rawAppender = new BatchedBoundedAppender(rawOutput, RAW_OUTPUT_MAX_CHARS);
aggregateAppender = new BatchedBoundedAppender(
  aggregateOutput,
  AGGREGATE_OUTPUT_MAX_CHARS
);
setRawResponseMode("plain");
clearSseInspector();
applyInitialState();
setupTabs();
wireEvents();
