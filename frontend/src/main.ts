import "./styles.css";

type HeaderKV = {
  key: string;
  value: string;
};

type PersistedState = {
  envText: string;
  curlText: string;
  method: string;
  url: string;
  headersText: string;
  bodyText: string;
  aggregateOpenAISse: boolean;
  timeoutSeconds: number;
};

type ServerEvent =
  | {
      type: "meta";
      status: number;
      status_text: string;
      headers: Record<string, string>;
      streaming: boolean;
    }
  | { type: "sse_line"; line: string }
  | { type: "body_chunk"; chunk: string }
  | { type: "aggregate_delta"; delta: string; text: string }
  | { type: "aggregate_done"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; duration_ms: number; aggregated: string };

const STORAGE_KEY = "apishark.state.v1";
const RAW_OUTPUT_MAX_CHARS = 220_000;
const AGGREGATE_OUTPUT_MAX_CHARS = 120_000;
const OUTPUT_FLUSH_INTERVAL_MS = 50;
const SSE_MAX_LINES = 1_200;

const envInput = byId<HTMLTextAreaElement>("envInput");
const curlInput = byId<HTMLTextAreaElement>("curlInput");
const importCurlBtn = byId<HTMLButtonElement>("importCurlBtn");
const methodInput = byId<HTMLSelectElement>("methodInput");
const urlInput = byId<HTMLInputElement>("urlInput");
const headersInput = byId<HTMLTextAreaElement>("headersInput");
const bodyInput = byId<HTMLTextAreaElement>("bodyInput");
const aggregateInput = byId<HTMLInputElement>("aggregateInput");
const timeoutInput = byId<HTMLInputElement>("timeoutInput");
const sendBtn = byId<HTMLButtonElement>("sendBtn");
const abortBtn = byId<HTMLButtonElement>("abortBtn");
const clearOutputBtn = byId<HTMLButtonElement>("clearOutputBtn");

const statusText = byId<HTMLSpanElement>("statusText");
const errorText = byId<HTMLParagraphElement>("errorText");
const headersOutput = byId<HTMLElement>("headersOutput");
const rawOutput = byId<HTMLElement>("rawOutput");
const aggregateOutput = byId<HTMLElement>("aggregateOutput");
const sseInspector = byId<HTMLElement>("sseInspector");
const sseLineList = byId<HTMLElement>("sseLineList");
const ssePayloadOutput = byId<HTMLElement>("ssePayloadOutput");
const ssePayloadMeta = byId<HTMLElement>("ssePayloadMeta");

type RawResponseMode = "plain" | "sse";

type SseLineEntry = {
  index: number;
  rawLine: string;
  payloadDisplay: string;
  isJSON: boolean;
  button: HTMLButtonElement;
};

let activeAbortController: AbortController | null = null;
let rawAppender: BatchedBoundedAppender;
let aggregateAppender: BatchedBoundedAppender;
let rawResponseMode: RawResponseMode = "plain";
let sseLineEntries: SseLineEntry[] = [];
let selectedSseLine: SseLineEntry | null = null;
let sseLineCounter = 0;

function wireEvents(): void {
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

  const persistTargets: Array<EventTarget & { addEventListener: typeof EventTarget.prototype.addEventListener }> = [
    envInput,
    curlInput,
    methodInput,
    urlInput,
    headersInput,
    bodyInput,
    aggregateInput,
    timeoutInput,
  ];

  for (const target of persistTargets) {
    target.addEventListener("input", persistState);
    target.addEventListener("change", persistState);
  }
}

function setupTabs(): void {
  const tabButtons = document.querySelectorAll<HTMLButtonElement>(
    "[data-tab-group][data-tab-target]",
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

function activateTab(group: string, targetId: string): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    `[data-tab-group="${group}"]`,
  );
  for (const button of buttons) {
    button.classList.toggle("is-active", button.dataset.tabTarget === targetId);
  }

  const panels = document.querySelectorAll<HTMLElement>(
    `[data-tab-panel="${group}"]`,
  );
  for (const panel of panels) {
    panel.classList.toggle("is-active", panel.id === targetId);
  }
}

function setRawResponseMode(mode: RawResponseMode): void {
  rawResponseMode = mode;
  const sseMode = mode === "sse";
  sseInspector.classList.toggle("is-visible", sseMode);
  rawOutput.classList.toggle("is-hidden", sseMode);
}

function clearSseInspector(): void {
  sseLineEntries = [];
  selectedSseLine = null;
  sseLineCounter = 0;
  sseLineList.textContent = "";
  ssePayloadMeta.textContent = "Click a line to inspect payload.";
  ssePayloadOutput.textContent = "";
}

function appendSseLine(rawLine: string): void {
  const index = ++sseLineCounter;
  const payloadText = extractPayloadText(rawLine);
  const pretty = prettifyJSON(payloadText);
  const isJSON = pretty !== null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "sse-line-btn";
  button.title = rawLine;
  button.textContent = `${index}. ${summarizeLineForButton(rawLine, payloadText)}`;

  const entry: SseLineEntry = {
    index,
    rawLine,
    payloadDisplay: isJSON ? pretty : payloadText || rawLine,
    isJSON,
    button,
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

function trimSseLines(): void {
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

function selectSseLine(entry: SseLineEntry): void {
  if (selectedSseLine === entry) {
    return;
  }

  if (selectedSseLine) {
    selectedSseLine.button.classList.remove("is-selected");
  }

  selectedSseLine = entry;
  entry.button.classList.add("is-selected");
  ssePayloadOutput.textContent = entry.payloadDisplay;
  ssePayloadMeta.textContent = entry.isJSON
    ? `Line ${entry.index} payload (JSON prettified)`
    : `Line ${entry.index} payload`;
}

function extractPayloadText(rawLine: string): string {
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

function prettifyJSON(payload: string): string | null {
  if (!payload) {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return null;
  }
}

function summarizeLineForButton(rawLine: string, payloadText: string): string {
  const base = (payloadText || rawLine).replace(/\s+/g, " ").trim();
  if (!base) {
    return "(empty)";
  }
  if (base.length <= 110) {
    return base;
  }
  return `${base.slice(0, 107)}...`;
}

function defaultState(): PersistedState {
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
        messages: [{ role: "user", content: "Write a haiku about sharks." }],
      },
      null,
      2,
    ),
    aggregateOpenAISse: true,
    timeoutSeconds: 120,
  };
}

function applyInitialState(): void {
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

function loadState(): PersistedState {
  const fallback = defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      envText: typeof parsed.envText === "string" ? parsed.envText : fallback.envText,
      curlText: typeof parsed.curlText === "string" ? parsed.curlText : fallback.curlText,
      method: typeof parsed.method === "string" ? parsed.method : fallback.method,
      url: typeof parsed.url === "string" ? parsed.url : fallback.url,
      headersText: typeof parsed.headersText === "string" ? parsed.headersText : fallback.headersText,
      bodyText: typeof parsed.bodyText === "string" ? parsed.bodyText : fallback.bodyText,
      aggregateOpenAISse:
        typeof parsed.aggregateOpenAISse === "boolean"
          ? parsed.aggregateOpenAISse
          : fallback.aggregateOpenAISse,
      timeoutSeconds:
        typeof parsed.timeoutSeconds === "number" && Number.isFinite(parsed.timeoutSeconds)
          ? parsed.timeoutSeconds
          : fallback.timeoutSeconds,
    };
  } catch {
    return fallback;
  }
}

function persistState(): void {
  const state: PersistedState = {
    envText: envInput.value,
    curlText: curlInput.value,
    method: methodInput.value,
    url: urlInput.value,
    headersText: headersInput.value,
    bodyText: bodyInput.value,
    aggregateOpenAISse: aggregateInput.checked,
    timeoutSeconds: toPositiveInt(timeoutInput.value, 120),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function importCurl(): Promise<void> {
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
      body: JSON.stringify({ curl }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(responseText || `Import failed (${response.status})`);
    }

    const parsed = JSON.parse(responseText) as {
      method: string;
      url: string;
      headers: HeaderKV[];
      body: string;
    };

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

async function sendRequest(): Promise<void> {
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
    timeout_seconds: toPositiveInt(timeoutInput.value, 120),
  };

  try {
    const response = await fetch("/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: activeAbortController.signal,
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

async function consumeServerEvents(response: Response): Promise<void> {
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

function consumeFrame(frame: string): void {
  const dataParts: string[] = [];
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
    const event = JSON.parse(payload) as ServerEvent;
    consumeEvent(event);
  } catch {
    if (rawResponseMode === "sse") {
      appendSseLine(payload);
    } else {
      rawAppender.enqueue(`${payload}\n`);
    }
  }
}

function consumeEvent(event: ServerEvent): void {
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

function clearOutputs(): void {
  setRawResponseMode("plain");
  statusText.textContent = "-";
  headersOutput.textContent = "";
  rawAppender.clear();
  aggregateAppender.clear();
  clearSseInspector();
}

function parseEnvVars(text: string): Record<string, string> {
  const env: Record<string, string> = {};
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

function parseHeaders(text: string): HeaderKV[] {
  const headers: HeaderKV[] = [];
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

function stringifyHeaders(headers: HeaderKV[]): string {
  return headers.map((h) => `${h.key}: ${h.value}`).join("\n");
}

function setLoading(isLoading: boolean): void {
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

function setError(message: string): void {
  errorText.textContent = message;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function toPositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element with id ${id}`);
  }
  return element as T;
}

class BatchedBoundedAppender {
  private readonly element: HTMLElement;
  private readonly maxChars: number;
  private readonly flushIntervalMs: number;
  private readonly chunks: Array<{ node: Text; len: number }> = [];

  private pending: string[] = [];
  private pendingChars = 0;
  private totalChars = 0;
  private flushTimer: number | null = null;

  constructor(element: HTMLElement, maxChars: number, flushIntervalMs = OUTPUT_FLUSH_INTERVAL_MS) {
    this.element = element;
    this.maxChars = maxChars;
    this.flushIntervalMs = flushIntervalMs;
  }

  enqueue(text: string): void {
    if (!text) {
      return;
    }
    this.pending.push(text);
    this.pendingChars += text.length;
    this.scheduleFlush();
  }

  hasContent(): boolean {
    return this.totalChars > 0 || this.pendingChars > 0;
  }

  setText(text: string): void {
    this.clear();
    this.enqueue(text);
    this.flushNow();
  }

  clear(): void {
    this.cancelFlush();
    this.pending = [];
    this.pendingChars = 0;
    this.totalChars = 0;
    this.chunks.length = 0;
    this.element.textContent = "";
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, this.flushIntervalMs);
  }

  private cancelFlush(): void {
    if (this.flushTimer === null) {
      return;
    }
    window.clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private flushNow(): void {
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

  private trimOverflow(): void {
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
}

function isNearBottom(element: HTMLElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 24;
}

rawAppender = new BatchedBoundedAppender(rawOutput, RAW_OUTPUT_MAX_CHARS);
aggregateAppender = new BatchedBoundedAppender(
  aggregateOutput,
  AGGREGATE_OUTPUT_MAX_CHARS,
);
setRawResponseMode("plain");
clearSseInspector();
applyInitialState();
setupTabs();
wireEvents();
