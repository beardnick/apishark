import {
  prettifyJSONText,
  renderJSONText,
  renderJSONValue,
  type JsonViewController,
} from "./json-view.js";

type HeaderKV = {
  key: string;
  value: string;
};

type EditableHeader = HeaderKV & {
  id: string;
  enabled: boolean;
};

type EnvironmentEntry = {
  id: string;
  name: string;
  text: string;
};

type PersistedState = {
  requestName: string;
  environments: EnvironmentEntry[];
  activeEnvironmentId: string | null;
  curlText: string;
  method: string;
  url: string;
  headers: EditableHeader[];
  headersText?: string;
  bodyText: string;
  aggregateOpenAISse: boolean;
  timeoutSeconds: number;
  activeCollectionId: string | null;
  activeSavedRequestId: string | null;
};

type SavedHeader = HeaderKV & {
  enabled: boolean;
};

type SavedRequest = {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: SavedHeader[];
  body: string;
  aggregate_openai_sse: boolean;
  timeout_seconds: number;
  updated_at?: string;
};

type RequestCollection = {
  id: string;
  name: string;
  requests: SavedRequest[];
};

type CollectionStore = {
  collections: RequestCollection[];
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

type RawResponseMode = "plain" | "sse";

type SseLineEntry = {
  index: number;
  rawLine: string;
  payloadText: string;
  isJSON: boolean;
  button: HTMLButtonElement;
};

const STORAGE_KEY = "apishark.state.v2";
const RAW_OUTPUT_MAX_CHARS = 220_000;
const AGGREGATE_OUTPUT_MAX_CHARS = 120_000;
const OUTPUT_FLUSH_INTERVAL_MS = 50;
const SSE_MAX_LINES = 1_200;

const environmentSelect = byId<HTMLSelectElement>("environmentSelect");
const createEnvironmentBtn = byId<HTMLButtonElement>("createEnvironmentBtn");
const renameEnvironmentBtn = byId<HTMLButtonElement>("renameEnvironmentBtn");
const deleteEnvironmentBtn = byId<HTMLButtonElement>("deleteEnvironmentBtn");
const envInput = byId<HTMLTextAreaElement>("envInput");
const curlInput = byId<HTMLTextAreaElement>("curlInput");
const importCurlBtn = byId<HTMLButtonElement>("importCurlBtn");
const requestNameInput = byId<HTMLInputElement>("requestNameInput");
const methodInput = byId<HTMLSelectElement>("methodInput");
const urlInput = byId<HTMLInputElement>("urlInput");
const addHeaderBtn = byId<HTMLButtonElement>("addHeaderBtn");
const headersEditor = byId<HTMLElement>("headersEditor");
const bodyInput = byId<HTMLTextAreaElement>("bodyInput");
const bodyPrettifyBtn = byId<HTMLButtonElement>("bodyPrettifyBtn");
const bodyCollapseBtn = byId<HTMLButtonElement>("bodyCollapseBtn");
const bodyExpandBtn = byId<HTMLButtonElement>("bodyExpandBtn");
const bodyJsonPanel = byId<HTMLElement>("bodyJsonPanel");
const bodyJsonMeta = byId<HTMLElement>("bodyJsonMeta");
const bodyJsonPreview = byId<HTMLElement>("bodyJsonPreview");
const aggregateInput = byId<HTMLInputElement>("aggregateInput");
const timeoutInput = byId<HTMLInputElement>("timeoutInput");
const sendBtn = byId<HTMLButtonElement>("sendBtn");
const abortBtn = byId<HTMLButtonElement>("abortBtn");
const clearOutputBtn = byId<HTMLButtonElement>("clearOutputBtn");

const reloadCollectionsBtn = byId<HTMLButtonElement>("reloadCollectionsBtn");
const createCollectionBtn = byId<HTMLButtonElement>("createCollectionBtn");
const saveRequestBtn = byId<HTMLButtonElement>("saveRequestBtn");
const newCollectionNameInput = byId<HTMLInputElement>("newCollectionNameInput");
const collectionsStatusText = byId<HTMLElement>("collectionsStatusText");
const collectionsList = byId<HTMLElement>("collectionsList");

const statusText = byId<HTMLSpanElement>("statusText");
const errorText = byId<HTMLParagraphElement>("errorText");
const headersOutput = byId<HTMLElement>("headersOutput");
const rawJsonMeta = byId<HTMLElement>("rawJsonMeta");
const rawCollapseBtn = byId<HTMLButtonElement>("rawCollapseBtn");
const rawExpandBtn = byId<HTMLButtonElement>("rawExpandBtn");
const rawJsonViewer = byId<HTMLElement>("rawJsonViewer");
const rawOutput = byId<HTMLElement>("rawOutput");
const aggregateOutput = byId<HTMLElement>("aggregateOutput");
const sseInspector = byId<HTMLElement>("sseInspector");
const sseLineList = byId<HTMLElement>("sseLineList");
const ssePayloadMeta = byId<HTMLElement>("ssePayloadMeta");
const ssePayloadCollapseBtn = byId<HTMLButtonElement>("ssePayloadCollapseBtn");
const ssePayloadExpandBtn = byId<HTMLButtonElement>("ssePayloadExpandBtn");
const ssePayloadJsonViewer = byId<HTMLElement>("ssePayloadJsonViewer");
const ssePayloadOutput = byId<HTMLElement>("ssePayloadOutput");

let activeAbortController: AbortController | null = null;
let rawAppender: BatchedBoundedAppender;
let aggregateAppender: BatchedBoundedAppender;
let rawResponseMode: RawResponseMode = "plain";
let requestIsLoading = false;
let environments: EnvironmentEntry[] = [];
let activeEnvironmentId: string | null = null;
let headerRows: EditableHeader[] = [];
let collectionStore: CollectionStore = { collections: [] };
let activeCollectionId: string | null = null;
let activeSavedRequestId: string | null = null;
let latestResponseHeaders: Record<string, string> = {};
let rawJsonController: JsonViewController | null = null;
let bodyJsonController: JsonViewController | null = null;
let ssePayloadJsonController: JsonViewController | null = null;
let sseLineEntries: SseLineEntry[] = [];
let selectedSseLine: SseLineEntry | null = null;
let sseLineCounter = 0;

function wireEvents(): void {
  environmentSelect.addEventListener("change", () => {
    activeEnvironmentId = environmentSelect.value || null;
    syncEnvironmentEditor();
    persistState();
  });

  createEnvironmentBtn.addEventListener("click", () => {
    createEnvironment();
  });

  renameEnvironmentBtn.addEventListener("click", () => {
    renameActiveEnvironment();
  });

  deleteEnvironmentBtn.addEventListener("click", () => {
    deleteActiveEnvironment();
  });

  envInput.addEventListener("input", () => {
    patchActiveEnvironment({ text: envInput.value });
  });

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

  addHeaderBtn.addEventListener("click", () => {
    headerRows.push(createEmptyHeaderRow());
    renderHeaderRows();
    persistState();
  });

  bodyInput.addEventListener("input", () => {
    updateBodyJsonPreview();
    persistState();
  });

  bodyPrettifyBtn.addEventListener("click", () => prettifyBodyJSON());
  bodyCollapseBtn.addEventListener("click", () => bodyJsonController?.collapseAll());
  bodyExpandBtn.addEventListener("click", () => bodyJsonController?.expandAll());
  rawCollapseBtn.addEventListener("click", () => rawJsonController?.collapseAll());
  rawExpandBtn.addEventListener("click", () => rawJsonController?.expandAll());
  ssePayloadCollapseBtn.addEventListener("click", () => ssePayloadJsonController?.collapseAll());
  ssePayloadExpandBtn.addEventListener("click", () => ssePayloadJsonController?.expandAll());

  reloadCollectionsBtn.addEventListener("click", () => {
    void loadCollections();
  });
  createCollectionBtn.addEventListener("click", () => {
    void createCollection();
  });
  saveRequestBtn.addEventListener("click", () => {
    void saveCurrentRequestToCollection();
  });

  const persistTargets: Array<
    EventTarget & { addEventListener: typeof EventTarget.prototype.addEventListener }
  > = [
    curlInput,
    requestNameInput,
    methodInput,
    urlInput,
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
  const buttons = document.querySelectorAll<HTMLButtonElement>(`[data-tab-group="${group}"]`);
  for (const button of buttons) {
    button.classList.toggle("is-active", button.dataset.tabTarget === targetId);
  }

  const panels = document.querySelectorAll<HTMLElement>(`[data-tab-panel="${group}"]`);
  for (const panel of panels) {
    panel.classList.toggle("is-active", panel.id === targetId);
  }
}

function defaultState(): PersistedState {
  const defaultEnvironment = createEnvironmentEntry(
    "Default",
    "OPENAI_API_KEY=\nBASE_URL=https://api.openai.com",
  );
  return {
    requestName: "Streaming Chat Request",
    environments: [defaultEnvironment],
    activeEnvironmentId: defaultEnvironment.id,
    curlText: "",
    method: "POST",
    url: "{{BASE_URL}}/v1/chat/completions",
    headers: [
      createHeaderRow("Content-Type", "application/json", true),
      createHeaderRow("Authorization", "Bearer {{OPENAI_API_KEY}}", true),
    ],
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
    activeCollectionId: null,
    activeSavedRequestId: null,
  };
}

function applyInitialState(): void {
  const state = loadState();
  requestNameInput.value = state.requestName;
  environments = normalizeEnvironments(state.environments);
  activeEnvironmentId = resolveActiveEnvironmentId(environments, state.activeEnvironmentId);
  curlInput.value = state.curlText;
  methodInput.value = state.method;
  urlInput.value = state.url;
  headerRows = normalizeHeaderRows(state.headers);
  bodyInput.value = state.bodyText;
  aggregateInput.checked = state.aggregateOpenAISse;
  timeoutInput.value = String(state.timeoutSeconds);
  activeCollectionId = state.activeCollectionId;
  activeSavedRequestId = state.activeSavedRequestId;

  renderEnvironmentControls();
  renderHeaderRows();
  updateBodyJsonPreview();
}

function loadState(): PersistedState {
  const fallback = defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState> & {
      envText?: unknown;
    };
    const parsedHeaders = Array.isArray(parsed.headers)
      ? normalizeHeaderRows(parsed.headers)
      : typeof parsed.headersText === "string"
        ? normalizeHeaderRows(parseLegacyHeadersText(parsed.headersText))
        : fallback.headers;
    const parsedEnvironments = Array.isArray(parsed.environments)
      ? normalizeEnvironments(parsed.environments)
      : typeof parsed.envText === "string"
        ? [createEnvironmentEntry("Default", parsed.envText)]
        : fallback.environments;

    return {
      requestName:
        typeof parsed.requestName === "string" && parsed.requestName.trim()
          ? parsed.requestName
          : fallback.requestName,
      environments: parsedEnvironments,
      activeEnvironmentId:
        typeof parsed.activeEnvironmentId === "string"
          ? parsed.activeEnvironmentId
          : resolveActiveEnvironmentId(parsedEnvironments, fallback.activeEnvironmentId),
      curlText: typeof parsed.curlText === "string" ? parsed.curlText : fallback.curlText,
      method: typeof parsed.method === "string" ? parsed.method : fallback.method,
      url: typeof parsed.url === "string" ? parsed.url : fallback.url,
      headers: parsedHeaders,
      bodyText: typeof parsed.bodyText === "string" ? parsed.bodyText : fallback.bodyText,
      aggregateOpenAISse:
        typeof parsed.aggregateOpenAISse === "boolean"
          ? parsed.aggregateOpenAISse
          : fallback.aggregateOpenAISse,
      timeoutSeconds:
        typeof parsed.timeoutSeconds === "number" && Number.isFinite(parsed.timeoutSeconds)
          ? parsed.timeoutSeconds
          : fallback.timeoutSeconds,
      activeCollectionId:
        typeof parsed.activeCollectionId === "string" ? parsed.activeCollectionId : null,
      activeSavedRequestId:
        typeof parsed.activeSavedRequestId === "string" ? parsed.activeSavedRequestId : null,
    };
  } catch {
    return fallback;
  }
}

function persistState(): void {
  const state: PersistedState = {
    requestName: requestNameInput.value.trim() || "Untitled Request",
    environments: environments.map((environment) => ({ ...environment })),
    activeEnvironmentId,
    curlText: curlInput.value,
    method: methodInput.value,
    url: urlInput.value,
    headers: headerRows.map((header) => ({ ...header })),
    bodyText: bodyInput.value,
    aggregateOpenAISse: aggregateInput.checked,
    timeoutSeconds: toPositiveInt(timeoutInput.value, 120),
    activeCollectionId,
    activeSavedRequestId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function renderEnvironmentControls(): void {
  environments = normalizeEnvironments(environments);
  activeEnvironmentId = resolveActiveEnvironmentId(environments, activeEnvironmentId);

  const fragment = document.createDocumentFragment();
  for (const environment of environments) {
    const option = document.createElement("option");
    option.value = environment.id;
    option.textContent = environment.name;
    fragment.appendChild(option);
  }

  environmentSelect.textContent = "";
  environmentSelect.appendChild(fragment);
  environmentSelect.value = activeEnvironmentId ?? "";

  syncEnvironmentEditor();
}

function syncEnvironmentEditor(): void {
  const activeEnvironment = getActiveEnvironment();
  envInput.value = activeEnvironment?.text ?? "";
  environmentSelect.disabled = requestIsLoading || environments.length === 0;
  createEnvironmentBtn.disabled = requestIsLoading;
  renameEnvironmentBtn.disabled = requestIsLoading || !activeEnvironment;
  deleteEnvironmentBtn.disabled = requestIsLoading || environments.length <= 1 || !activeEnvironment;
}

function getActiveEnvironment(): EnvironmentEntry | null {
  if (!activeEnvironmentId) {
    return null;
  }
  return environments.find((environment) => environment.id === activeEnvironmentId) ?? null;
}

function patchActiveEnvironment(patch: Partial<EnvironmentEntry>): void {
  const activeEnvironment = getActiveEnvironment();
  if (!activeEnvironment) {
    return;
  }

  environments = environments.map((environment) =>
    environment.id === activeEnvironment.id ? { ...environment, ...patch } : environment,
  );
  persistState();
}

function createEnvironment(): void {
  const suggestedName = nextEnvironmentName();
  const name = window.prompt("New environment name", suggestedName)?.trim();
  if (!name) {
    return;
  }

  const environment = createEnvironmentEntry(name, "");
  environments = [...environments, environment];
  activeEnvironmentId = environment.id;
  renderEnvironmentControls();
  persistState();
}

function renameActiveEnvironment(): void {
  const activeEnvironment = getActiveEnvironment();
  if (!activeEnvironment) {
    return;
  }

  const name = window.prompt("Rename environment", activeEnvironment.name)?.trim();
  if (!name || name === activeEnvironment.name) {
    return;
  }

  patchActiveEnvironment({ name });
  renderEnvironmentControls();
}

function deleteActiveEnvironment(): void {
  const activeEnvironment = getActiveEnvironment();
  if (!activeEnvironment || environments.length <= 1) {
    return;
  }
  if (!window.confirm(`Delete environment "${activeEnvironment.name}"?`)) {
    return;
  }

  const index = environments.findIndex((environment) => environment.id === activeEnvironment.id);
  environments = environments.filter((environment) => environment.id !== activeEnvironment.id);
  activeEnvironmentId =
    environments[index]?.id ?? environments[index - 1]?.id ?? environments[0]?.id ?? null;
  renderEnvironmentControls();
  persistState();
}

function nextEnvironmentName(): string {
  const usedNames = new Set(environments.map((environment) => environment.name));
  let index = environments.length + 1;
  let candidate = `Environment ${index}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `Environment ${index}`;
  }
  return candidate;
}

function normalizeEnvironments(
  rows: Array<Partial<EnvironmentEntry> | EnvironmentEntry>,
): EnvironmentEntry[] {
  const normalized = rows.map((environment, index) => {
    const typed = environment as Partial<EnvironmentEntry>;
    const name =
      typeof typed.name === "string" && typed.name.trim()
        ? typed.name.trim()
        : index === 0
          ? "Default"
          : `Environment ${index + 1}`;

    return {
      id: typeof typed.id === "string" && typed.id ? typed.id : makeId("env"),
      name,
      text: typeof typed.text === "string" ? typed.text : "",
    };
  });

  return normalized.length > 0
    ? normalized
    : [createEnvironmentEntry("Default", "OPENAI_API_KEY=\nBASE_URL=https://api.openai.com")];
}

function resolveActiveEnvironmentId(
  rows: EnvironmentEntry[],
  preferredId: string | null,
): string | null {
  if (preferredId && rows.some((environment) => environment.id === preferredId)) {
    return preferredId;
  }
  return rows[0]?.id ?? null;
}

function renderHeaderRows(): void {
  if (headerRows.length === 0) {
    headerRows = [createEmptyHeaderRow()];
  }

  const fragment = document.createDocumentFragment();
  for (const header of headerRows) {
    const row = document.createElement("div");
    row.className = `header-row${header.enabled ? "" : " is-disabled"}`;

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "header-toggle";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = header.enabled;
    toggle.disabled = requestIsLoading;
    toggle.addEventListener("change", () => {
      updateHeaderRow(header.id, { enabled: toggle.checked });
    });
    const toggleText = document.createElement("span");
    toggleText.className = "header-toggle-text";
    toggleText.textContent = header.enabled ? "On" : "Off";
    const toggleLabelText = header.enabled ? "Send this header" : "Skip this header";
    toggle.ariaLabel = toggleLabelText;
    toggle.title = toggleLabelText;
    toggleLabel.title = toggleLabelText;
    toggleLabel.append(toggle, toggleText);

    const keyInput = document.createElement("input");
    keyInput.className = "header-key-input";
    keyInput.type = "text";
    keyInput.placeholder = "Header name";
    keyInput.value = header.key;
    keyInput.disabled = requestIsLoading;
    keyInput.addEventListener("input", () => {
      patchHeaderRow(header.id, { key: keyInput.value });
    });

    const valueInput = document.createElement("input");
    valueInput.className = "header-value-input";
    valueInput.type = "text";
    valueInput.placeholder = "Header value";
    valueInput.value = header.value;
    valueInput.disabled = requestIsLoading;
    valueInput.addEventListener("input", () => {
      patchHeaderRow(header.id, { value: valueInput.value });
    });

    const actions = document.createElement("div");
    actions.className = "header-row-actions";
    actions.append(
      createHeaderActionButton(
        "＋",
        "Insert header below",
        () => insertHeaderAfter(header.id),
        requestIsLoading,
      ),
      createHeaderActionButton(
        "⎘",
        "Duplicate header",
        () => duplicateHeader(header.id),
        requestIsLoading,
      ),
      createHeaderActionButton(
        "✕",
        "Delete header",
        () => removeHeader(header.id),
        requestIsLoading,
        true,
      ),
    );

    row.append(toggleLabel, keyInput, valueInput, actions);
    fragment.appendChild(row);
  }

  headersEditor.textContent = "";
  headersEditor.appendChild(fragment);
}

function createHeaderActionButton(
  symbol: string,
  label: string,
  onClick: () => void,
  disabled: boolean,
  danger = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = danger ? "action-btn icon-btn danger" : "action-btn icon-btn";
  button.ariaLabel = label;
  button.title = label;
  const icon = document.createElement("span");
  icon.className = "action-symbol";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = symbol;
  button.appendChild(icon);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function updateHeaderRow(id: string, patch: Partial<EditableHeader>): void {
  headerRows = headerRows.map((header) => (header.id === id ? { ...header, ...patch } : header));
  renderHeaderRows();
  persistState();
}

function patchHeaderRow(id: string, patch: Partial<EditableHeader>): void {
  headerRows = headerRows.map((header) => (header.id === id ? { ...header, ...patch } : header));
  persistState();
}

function insertHeaderAfter(id: string): void {
  const index = headerRows.findIndex((header) => header.id === id);
  if (index < 0) {
    return;
  }
  const next = [...headerRows];
  next.splice(index + 1, 0, createEmptyHeaderRow());
  headerRows = next;
  renderHeaderRows();
  persistState();
}

function duplicateHeader(id: string): void {
  const index = headerRows.findIndex((header) => header.id === id);
  if (index < 0) {
    return;
  }
  const source = headerRows[index];
  const duplicate: EditableHeader = {
    id: makeId("hdr"),
    key: source.key,
    value: source.value,
    enabled: source.enabled,
  };
  const next = [...headerRows];
  next.splice(index + 1, 0, duplicate);
  headerRows = next;
  renderHeaderRows();
  persistState();
}

function removeHeader(id: string): void {
  if (headerRows.length === 1) {
    headerRows = [createEmptyHeaderRow()];
  } else {
    headerRows = headerRows.filter((header) => header.id !== id);
  }
  renderHeaderRows();
  persistState();
}

function updateBodyJsonPreview(): void {
  const controller = renderJSONText(bodyJsonPreview, bodyInput.value, { expandDepth: 2 });
  bodyJsonController = controller;
  const hasJSON = controller.hasJSON;

  bodyJsonPanel.classList.toggle("is-hidden", !hasJSON);
  bodyCollapseBtn.disabled = !hasJSON;
  bodyExpandBtn.disabled = !hasJSON;
  bodyJsonMeta.textContent = hasJSON
    ? "Collapsible JSON preview for the request body."
    : "JSON preview";
}

function prettifyBodyJSON(): void {
  const pretty = prettifyJSONText(bodyInput.value);
  if (!pretty) {
    setError("Request body is not valid JSON.");
    return;
  }

  setError("");
  bodyInput.value = pretty;
  updateBodyJsonPreview();
  persistState();
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
    headerRows = normalizeHeaderRows(
      (parsed.headers || []).map((header) => ({ ...header, enabled: true })),
    );
    bodyInput.value = parsed.body || "";
    activeSavedRequestId = null;
    renderHeaderRows();
    updateBodyJsonPreview();
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
    headers: headerRows
      .filter((header) => header.enabled)
      .map((header) => ({ key: header.key, value: header.value }))
      .filter((header) => header.key.trim() !== ""),
    body: bodyInput.value,
    env: parseEnvVars(getActiveEnvironment()?.text ?? ""),
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
    finalizeResponseViews();
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
  for (const line of frame.split("\n")) {
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
      latestResponseHeaders = event.headers;
      setRawResponseMode(event.streaming ? "sse" : "plain");
      statusText.textContent = `${event.status_text}${event.streaming ? " (SSE stream)" : ""}`;
      renderResponseHeaders(event.headers);
      break;

    case "sse_line":
      appendSseLine(event.line);
      break;

    case "body_chunk":
      rawOutput.classList.remove("is-hidden");
      rawJsonViewer.classList.add("is-hidden");
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
      finalizeResponseViews();
      break;
  }
}

function finalizeResponseViews(): void {
  renderResponseHeaders(latestResponseHeaders);
  if (rawResponseMode === "plain") {
    const rawText = rawAppender.snapshotText();
    renderRawJSONIfPossible(rawText);
  }
}

function clearOutputs(): void {
  latestResponseHeaders = {};
  setRawResponseMode("plain");
  statusText.textContent = "-";
  headersOutput.textContent = "";
  rawAppender.clear();
  aggregateAppender.clear();
  clearSseInspector();
  rawJsonViewer.textContent = "";
  rawJsonViewer.classList.add("is-hidden");
  rawOutput.classList.remove("is-hidden");
  rawJsonMeta.textContent =
    "JSON tools appear automatically when the final response body is valid JSON.";
  rawCollapseBtn.disabled = true;
  rawExpandBtn.disabled = true;
}

function setRawResponseMode(mode: RawResponseMode): void {
  rawResponseMode = mode;
  const sseMode = mode === "sse";
  sseInspector.classList.toggle("is-visible", sseMode);
  rawOutput.classList.toggle("is-hidden", sseMode);
  rawJsonViewer.classList.toggle("is-hidden", true);
  rawCollapseBtn.disabled = true;
  rawExpandBtn.disabled = true;
}

function renderRawJSONIfPossible(text: string): void {
  const controller = renderJSONText(rawJsonViewer, text, { expandDepth: 1 });
  rawJsonController = controller;

  if (!controller.hasJSON) {
    rawOutput.classList.remove("is-hidden");
    rawJsonViewer.classList.add("is-hidden");
    rawJsonMeta.textContent =
      "JSON tools appear automatically when the final response body is valid JSON.";
    rawCollapseBtn.disabled = true;
    rawExpandBtn.disabled = true;
    return;
  }

  rawOutput.classList.add("is-hidden");
  rawJsonViewer.classList.remove("is-hidden");
  rawJsonMeta.textContent = "Response body rendered as collapsible JSON.";
  rawCollapseBtn.disabled = false;
  rawExpandBtn.disabled = false;
}

function renderResponseHeaders(headers: Record<string, string>): void {
  if (Object.keys(headers).length === 0) {
    headersOutput.textContent = "";
    return;
  }
  renderJSONValue(headersOutput, headers, { expandDepth: 1 });
}

function clearSseInspector(): void {
  sseLineEntries = [];
  selectedSseLine = null;
  sseLineCounter = 0;
  sseLineList.textContent = "";
  ssePayloadMeta.textContent = "Click a line to inspect payload.";
  ssePayloadOutput.textContent = "";
  ssePayloadJsonViewer.textContent = "";
  ssePayloadJsonViewer.classList.add("is-hidden");
  ssePayloadOutput.classList.remove("is-hidden");
  ssePayloadCollapseBtn.disabled = true;
  ssePayloadExpandBtn.disabled = true;
}

function appendSseLine(rawLine: string): void {
  const index = ++sseLineCounter;
  const payloadText = extractPayloadText(rawLine);
  const isJSON = prettifyJSONText(payloadText) !== null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "sse-line-btn";
  button.title = rawLine;
  button.textContent = `${index}. ${summarizeLineForButton(rawLine, payloadText)}`;

  const entry: SseLineEntry = {
    index,
    rawLine,
    payloadText: payloadText || rawLine,
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

  if (entry.isJSON) {
    ssePayloadJsonController = renderJSONText(ssePayloadJsonViewer, entry.payloadText, {
      expandDepth: 2,
    });
    ssePayloadJsonViewer.classList.remove("is-hidden");
    ssePayloadOutput.classList.add("is-hidden");
    ssePayloadCollapseBtn.disabled = false;
    ssePayloadExpandBtn.disabled = false;
    ssePayloadMeta.textContent = `Line ${entry.index} payload (JSON view)`;
    return;
  }

  ssePayloadJsonViewer.textContent = "";
  ssePayloadJsonViewer.classList.add("is-hidden");
  ssePayloadOutput.classList.remove("is-hidden");
  ssePayloadOutput.textContent = entry.payloadText;
  ssePayloadCollapseBtn.disabled = true;
  ssePayloadExpandBtn.disabled = true;
  ssePayloadMeta.textContent = `Line ${entry.index} payload`;
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

function parseLegacyHeadersText(text: string): EditableHeader[] {
  const headers: EditableHeader[] = [];
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const splitAt = trimmed.indexOf(":");
    if (splitAt <= 0) {
      continue;
    }
    headers.push(
      createHeaderRow(trimmed.slice(0, splitAt).trim(), trimmed.slice(splitAt + 1).trim(), true),
    );
  }
  return headers;
}

function normalizeHeaderRows(rows: Array<Partial<EditableHeader> | SavedHeader | HeaderKV>): EditableHeader[] {
  const normalized = rows
    .map((row) => {
      const typed = row as Partial<EditableHeader> & Partial<SavedHeader>;
      return {
        id: typeof typed.id === "string" && typed.id ? typed.id : makeId("hdr"),
        key: typeof typed.key === "string" ? typed.key : "",
        value: typeof typed.value === "string" ? typed.value : "",
        enabled: typeof typed.enabled === "boolean" ? typed.enabled : true,
      };
    })
    .filter((row) => row.key !== "" || row.value !== "" || row.enabled);

  return normalized.length > 0 ? normalized : [createEmptyHeaderRow()];
}

function createEnvironmentEntry(name: string, text: string): EnvironmentEntry {
  return {
    id: makeId("env"),
    name,
    text,
  };
}

function createHeaderRow(key: string, value: string, enabled: boolean): EditableHeader {
  return {
    id: makeId("hdr"),
    key,
    value,
    enabled,
  };
}

function createEmptyHeaderRow(): EditableHeader {
  return createHeaderRow("", "", true);
}

async function loadCollections(): Promise<void> {
  setCollectionsStatus("Loading collections...");

  try {
    const response = await fetch("/api/collections");
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(responseText || `Load failed (${response.status})`);
    }

    const parsed = normalizeCollectionStore(JSON.parse(responseText) as Partial<CollectionStore>);
    collectionStore = parsed;

    if (!findCollection(activeCollectionId)) {
      activeCollectionId = parsed.collections[0]?.id ?? null;
    }
    if (activeCollectionId) {
      const activeCollection = findCollection(activeCollectionId);
      if (!activeCollection?.requests.some((request) => request.id === activeSavedRequestId)) {
        activeSavedRequestId = null;
      }
    }

    renderCollections();
    persistState();
    setCollectionsStatus(
      parsed.collections.length === 0
        ? "Collections are stored in ./collections.json."
        : `Loaded ${parsed.collections.length} collection${parsed.collections.length === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    renderCollections();
    setCollectionsStatus(errorMessage(error, "Failed to load collections."), true);
  }
}

async function createCollection(): Promise<void> {
  const name = newCollectionNameInput.value.trim();
  if (!name) {
    setCollectionsStatus("Enter a collection name first.", true);
    return;
  }

  const previous = cloneCollectionStore(collectionStore);
  const nextCollection: RequestCollection = {
    id: makeId("col"),
    name,
    requests: [],
  };

  collectionStore = {
    collections: [...collectionStore.collections, nextCollection],
  };
  activeCollectionId = nextCollection.id;
  activeSavedRequestId = null;

  if (!(await saveCollectionsToServer(previous))) {
    return;
  }

  newCollectionNameInput.value = "";
  renderCollections();
  persistState();
  setCollectionsStatus(`Selected collection "${name}".`);
}

async function saveCurrentRequestToCollection(): Promise<void> {
  if (!activeCollectionId) {
    setCollectionsStatus("Create or select a collection first.", true);
    return;
  }

  const collection = findCollection(activeCollectionId);
  if (!collection) {
    setCollectionsStatus("Selected collection no longer exists.", true);
    return;
  }

  const requestName = requestNameInput.value.trim() || "Untitled Request";
  const savedRequest: SavedRequest = {
    id: activeSavedRequestId ?? makeId("req"),
    name: requestName,
    method: methodInput.value.trim().toUpperCase(),
    url: urlInput.value.trim(),
    headers: headerRows.map((header) => ({
      key: header.key,
      value: header.value,
      enabled: header.enabled,
    })),
    body: bodyInput.value,
    aggregate_openai_sse: aggregateInput.checked,
    timeout_seconds: toPositiveInt(timeoutInput.value, 120),
    updated_at: new Date().toISOString(),
  };

  const previous = cloneCollectionStore(collectionStore);
  collectionStore = {
    collections: collectionStore.collections.map((item) => {
      if (item.id !== activeCollectionId) {
        return item;
      }

      const existingIndex = item.requests.findIndex((request) => request.id === savedRequest.id);
      const requests = [...item.requests];
      if (existingIndex >= 0) {
        requests[existingIndex] = savedRequest;
      } else {
        requests.push(savedRequest);
      }

      return {
        ...item,
        requests,
      };
    }),
  };
  activeSavedRequestId = savedRequest.id;

  if (!(await saveCollectionsToServer(previous))) {
    return;
  }

  renderCollections();
  persistState();
  setCollectionsStatus(`Saved "${requestName}" to "${collection.name}".`);
}

function loadSavedRequest(collectionId: string, requestId: string): void {
  const collection = findCollection(collectionId);
  const savedRequest = collection?.requests.find((request) => request.id === requestId);
  if (!collection || !savedRequest) {
    setCollectionsStatus("Saved request no longer exists.", true);
    return;
  }

  activeCollectionId = collectionId;
  activeSavedRequestId = requestId;
  requestNameInput.value = savedRequest.name;
  methodInput.value = savedRequest.method || "GET";
  urlInput.value = savedRequest.url;
  bodyInput.value = savedRequest.body;
  aggregateInput.checked = savedRequest.aggregate_openai_sse;
  timeoutInput.value = String(savedRequest.timeout_seconds || 120);
  headerRows = normalizeHeaderRows(savedRequest.headers);

  renderHeaderRows();
  updateBodyJsonPreview();
  renderCollections();
  persistState();
  setCollectionsStatus(`Loaded "${savedRequest.name}" from "${collection.name}".`);
}

async function deleteCollection(collectionId: string): Promise<void> {
  const collection = findCollection(collectionId);
  if (!collection) {
    return;
  }
  if (!window.confirm(`Delete collection "${collection.name}"?`)) {
    return;
  }

  const previous = cloneCollectionStore(collectionStore);
  collectionStore = {
    collections: collectionStore.collections.filter((item) => item.id !== collectionId),
  };

  if (activeCollectionId === collectionId) {
    activeCollectionId = collectionStore.collections[0]?.id ?? null;
    activeSavedRequestId = null;
  }

  if (!(await saveCollectionsToServer(previous))) {
    return;
  }

  renderCollections();
  persistState();
  setCollectionsStatus(`Deleted collection "${collection.name}".`);
}

async function deleteSavedRequest(collectionId: string, requestId: string): Promise<void> {
  const collection = findCollection(collectionId);
  const request = collection?.requests.find((item) => item.id === requestId);
  if (!collection || !request) {
    return;
  }
  if (!window.confirm(`Delete saved request "${request.name}"?`)) {
    return;
  }

  const previous = cloneCollectionStore(collectionStore);
  collectionStore = {
    collections: collectionStore.collections.map((item) => {
      if (item.id !== collectionId) {
        return item;
      }
      return {
        ...item,
        requests: item.requests.filter((saved) => saved.id !== requestId),
      };
    }),
  };

  if (activeSavedRequestId === requestId) {
    activeSavedRequestId = null;
  }

  if (!(await saveCollectionsToServer(previous))) {
    return;
  }

  renderCollections();
  persistState();
  setCollectionsStatus(`Deleted "${request.name}".`);
}

async function saveCollectionsToServer(previous: CollectionStore): Promise<boolean> {
  try {
    const response = await fetch("/api/collections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectionStore),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(responseText || `Save failed (${response.status})`);
    }

    collectionStore = normalizeCollectionStore(JSON.parse(responseText) as Partial<CollectionStore>);
    if (activeCollectionId && !findCollection(activeCollectionId)) {
      activeCollectionId = collectionStore.collections[0]?.id ?? null;
      activeSavedRequestId = null;
    }
    return true;
  } catch (error) {
    collectionStore = previous;
    renderCollections();
    setCollectionsStatus(errorMessage(error, "Failed to save collections."), true);
    return false;
  }
}

function renderCollections(): void {
  collectionsList.textContent = "";

  if (collectionStore.collections.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No collections yet. Create one, then save the current request into it.";
    collectionsList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const collection of collectionStore.collections) {
    const card = document.createElement("article");
    card.className = `collection-card${collection.id === activeCollectionId ? " is-selected" : ""}`;

    const head = document.createElement("div");
    head.className = "collection-card-head";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "collection-select-btn";
    selectBtn.addEventListener("click", () => {
      activeCollectionId = collection.id;
      if (!collection.requests.some((request) => request.id === activeSavedRequestId)) {
        activeSavedRequestId = null;
      }
      renderCollections();
      persistState();
      setCollectionsStatus(`Selected collection "${collection.name}".`);
    });

    const name = document.createElement("strong");
    name.textContent = collection.name;
    const meta = document.createElement("p");
    meta.className = "collection-meta hint compact";
    meta.textContent = `${collection.requests.length} saved request${collection.requests.length === 1 ? "" : "s"}`;
    selectBtn.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "collection-card-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "small-btn";
    saveBtn.textContent = "Save here";
    saveBtn.addEventListener("click", () => {
      activeCollectionId = collection.id;
      void saveCurrentRequestToCollection();
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "small-btn collection-delete-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      void deleteCollection(collection.id);
    });
    actions.append(saveBtn, deleteBtn);

    head.append(selectBtn, actions);
    card.appendChild(head);

    const requestList = document.createElement("div");
    requestList.className = "request-list";

    if (collection.requests.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No saved requests in this collection yet.";
      requestList.appendChild(empty);
    } else {
      for (const request of collection.requests) {
        const item = document.createElement("div");
        item.className = `request-item${request.id === activeSavedRequestId ? " is-selected" : ""}`;

        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "request-load-btn";
        loadBtn.addEventListener("click", () => loadSavedRequest(collection.id, request.id));

        const requestName = document.createElement("strong");
        requestName.textContent = request.name;
        const requestMeta = document.createElement("p");
        requestMeta.className = "request-meta hint compact";
        requestMeta.textContent = `${request.method} ${request.url || "(no URL)"}`;
        loadBtn.append(requestName, requestMeta);

        const requestActions = document.createElement("div");
        requestActions.className = "request-item-actions";
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "small-btn request-delete-btn";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
          void deleteSavedRequest(collection.id, request.id);
        });
        requestActions.appendChild(deleteBtn);

        item.append(loadBtn, requestActions);
        requestList.appendChild(item);
      }
    }

    card.appendChild(requestList);
    fragment.appendChild(card);
  }

  collectionsList.appendChild(fragment);
}

function normalizeCollectionStore(input: Partial<CollectionStore>): CollectionStore {
  const rawCollections = Array.isArray(input.collections) ? input.collections : [];
  return {
    collections: rawCollections
      .map((collection) => ({
        id: typeof collection.id === "string" ? collection.id : makeId("col"),
        name: typeof collection.name === "string" ? collection.name : "Untitled Collection",
        requests: Array.isArray(collection.requests)
          ? collection.requests.map((request) => ({
              id: typeof request.id === "string" ? request.id : makeId("req"),
              name: typeof request.name === "string" ? request.name : "Untitled Request",
              method: typeof request.method === "string" ? request.method : "GET",
              url: typeof request.url === "string" ? request.url : "",
              headers: normalizeSavedHeaders(request.headers),
              body: typeof request.body === "string" ? request.body : "",
              aggregate_openai_sse:
                typeof request.aggregate_openai_sse === "boolean"
                  ? request.aggregate_openai_sse
                  : false,
              timeout_seconds:
                typeof request.timeout_seconds === "number" && Number.isFinite(request.timeout_seconds)
                  ? request.timeout_seconds
                  : 120,
              updated_at:
                typeof request.updated_at === "string" ? request.updated_at : undefined,
            }))
          : [],
      }))
      .filter((collection) => collection.name.trim() !== ""),
  };
}

function normalizeSavedHeaders(headers: unknown): SavedHeader[] {
  if (!Array.isArray(headers)) {
    return [];
  }

  return headers.map((header) => {
    const typed = header as Partial<SavedHeader>;
    return {
      key: typeof typed.key === "string" ? typed.key : "",
      value: typeof typed.value === "string" ? typed.value : "",
      enabled: typeof typed.enabled === "boolean" ? typed.enabled : true,
    };
  });
}

function findCollection(id: string | null): RequestCollection | undefined {
  if (!id) {
    return undefined;
  }
  return collectionStore.collections.find((collection) => collection.id === id);
}

function setCollectionsStatus(message: string, isError = false): void {
  collectionsStatusText.textContent = message;
  collectionsStatusText.classList.toggle("error", isError);
}

function setLoading(isLoading: boolean): void {
  requestIsLoading = isLoading;
  sendBtn.disabled = isLoading;
  importCurlBtn.disabled = isLoading;
  requestNameInput.disabled = isLoading;
  envInput.disabled = isLoading;
  methodInput.disabled = isLoading;
  urlInput.disabled = isLoading;
  bodyInput.disabled = isLoading;
  timeoutInput.disabled = isLoading;
  aggregateInput.disabled = isLoading;
  addHeaderBtn.disabled = isLoading;
  bodyPrettifyBtn.disabled = isLoading;
  abortBtn.disabled = !isLoading;
  sendBtn.textContent = isLoading ? "Sending..." : "Send";
  syncEnvironmentEditor();
  renderHeaderRows();
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

function makeId(prefix: string): string {
  if ("randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneCollectionStore(store: CollectionStore): CollectionStore {
  return JSON.parse(JSON.stringify(store)) as CollectionStore;
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
  private currentText = "";
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

  snapshotText(): string {
    this.flushNow();
    return this.currentText;
  }

  clear(): void {
    this.cancelFlush();
    this.pending = [];
    this.pendingChars = 0;
    this.totalChars = 0;
    this.currentText = "";
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
    this.currentText += text;
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
        this.currentText = this.currentText.slice(first.len);
        overflow -= first.len;
        continue;
      }

      first.node.data = first.node.data.slice(overflow);
      first.len -= overflow;
      this.totalChars -= overflow;
      this.currentText = this.currentText.slice(overflow);
      overflow = 0;
    }
  }
}

function isNearBottom(element: HTMLElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 24;
}

rawAppender = new BatchedBoundedAppender(rawOutput, RAW_OUTPUT_MAX_CHARS);
aggregateAppender = new BatchedBoundedAppender(aggregateOutput, AGGREGATE_OUTPUT_MAX_CHARS);
setRawResponseMode("plain");
clearSseInspector();
applyInitialState();
setupTabs();
wireEvents();
void loadCollections();
