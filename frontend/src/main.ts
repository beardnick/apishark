import {
  prettifyJSONText,
  renderJSONText,
  renderJSONValue,
  type JsonFoldState,
  type JsonViewController,
} from "./json-view.js";
import {
  aggregateFragmentSize,
  aggregateFragmentsToText,
  isAggregateMediaFragment,
  isAggregateTextFragment,
  normalizeAggregateFragments,
  trimAggregateFragments,
  type AggregateFragment,
} from "./aggregate-fragments.js";
import {
  AGGREGATION_PLUGIN_NONE,
  AGGREGATION_PLUGIN_OPENAI,
  ResponseAggregationRuntime,
  aggregationPluginLabel,
  ensureAggregationPluginLoaded,
  getImportedAggregationPluginManifests,
  hasAggregationPlugin,
  listAggregationPlugins,
  parseImportedAggregationPluginFile,
  resolveAggregationPluginId,
  setImportedAggregationPluginManifests,
  type ImportedAggregationPluginManifest,
  type RawEvent,
} from "./aggregation-runtime.js";
import { buildCurlCommand } from "./curl-export.js";
import { resolveRequestDraft } from "./request-resolution.js";
import {
  createDuplicateRequestDraft,
  deletePersistedRequestDraft,
  getPersistedRequestDraft,
  normalizePersistedRequestDraftStore,
  prunePersistedRequestDraftStore,
  requestLibraryDraftsEqual,
  resolveEffectiveAggregationPlugin,
  setPersistedRequestDraft,
  type PersistedRequestDraftStore,
  type RequestDraftScope,
  type RequestLibraryDraft,
} from "./request-library.js";
import { PlainRawResponseBuffer } from "./raw-response-buffer.js";

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
  aggregationPlugin: string;
  useCollectionAggregationPlugin: boolean;
  aggregateOpenAISse: boolean;
  timeoutSeconds: number;
  requestDrafts: PersistedRequestDraftStore;
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
  aggregation_plugin?: string;
  use_collection_aggregation_plugin?: boolean;
  aggregate_openai_sse: boolean;
  timeout_seconds: number;
  updated_at?: string;
};

type RequestCollection = {
  id: string;
  name: string;
  aggregation_plugin: string;
  requests: SavedRequest[];
};

type CollectionStore = {
  collections: RequestCollection[];
};

type PluginStoreResponse = {
  plugins: ImportedAggregationPluginManifest[];
};

type ServerEvent =
  | {
      type: "meta";
      status: number;
      status_text: string;
      headers: Record<string, string>;
      response_headers?: Record<string, string>;
      sent_headers?: Record<string, string>;
      streaming: boolean;
      aggregation_plugin?: string;
    }
  | ({ type: "raw_event" } & RawEvent)
  | { type: "error"; message: string }
  | { type: "done"; duration_ms: number; aggregated: string };

type RawResponseMode = "plain" | "sse";
type BodyEditorMode = "text" | "json";

type SseLineEntry = {
  index: number;
  rawLine: string;
  payloadText: string;
  isJSON: boolean;
  button: HTMLButtonElement;
};

const STORAGE_KEY = "apishark.state.v2";
const REQUEST_AGGREGATION_USE_COLLECTION = "__collection__";
const RAW_OUTPUT_MAX_CHARS = 220_000;
const AGGREGATE_OUTPUT_MAX_CHARS = 120_000;
const OUTPUT_FLUSH_INTERVAL_MS = 50;
const SSE_MAX_LINES = 1_200;
const DRAFT_AUTOSAVE_DELAY_MS = 350;

const environmentSelect = byId<HTMLSelectElement>("environmentSelect");
const createEnvironmentBtn = byId<HTMLButtonElement>("createEnvironmentBtn");
const renameEnvironmentBtn = byId<HTMLButtonElement>("renameEnvironmentBtn");
const deleteEnvironmentBtn = byId<HTMLButtonElement>("deleteEnvironmentBtn");
const envInput = byId<HTMLTextAreaElement>("envInput");
const curlInput = byId<HTMLTextAreaElement>("curlInput");
const importCurlBtn = byId<HTMLButtonElement>("importCurlBtn");
const importPluginBtn = byId<HTMLButtonElement>("importPluginBtn");
const pluginImportInput = byId<HTMLInputElement>("pluginImportInput");
const pluginsStatusText = byId<HTMLElement>("pluginsStatusText");
const pluginsList = byId<HTMLElement>("pluginsList");
const requestNameInput = byId<HTMLInputElement>("requestNameInput");
const methodInput = byId<HTMLSelectElement>("methodInput");
const urlInput = byId<HTMLInputElement>("urlInput");
const addHeaderBtn = byId<HTMLButtonElement>("addHeaderBtn");
const headersEditor = byId<HTMLElement>("headersEditor");
const bodyEditorShell = byId<HTMLElement>("bodyEditorShell");
const bodyInput = byId<HTMLTextAreaElement>("bodyInput");
const bodyJsonViewer = byId<HTMLElement>("bodyJsonViewer");
const copyBodyBtn = byId<HTMLButtonElement>("copyBodyBtn");
const bodyPrettifyBtn = byId<HTMLButtonElement>("bodyPrettifyBtn");
const bodyCollapseBtn = byId<HTMLButtonElement>("bodyCollapseBtn");
const bodyExpandBtn = byId<HTMLButtonElement>("bodyExpandBtn");
const aggregationPluginInput = byId<HTMLSelectElement>("aggregationPluginInput");
const draftStatusText = byId<HTMLElement>("draftStatusText");
const effectiveAggregationText = byId<HTMLElement>("effectiveAggregationText");
const timeoutInput = byId<HTMLInputElement>("timeoutInput");
const exportCurlBtn = byId<HTMLButtonElement>("exportCurlBtn");
const copyExportCurlBtn = byId<HTMLButtonElement>("copyExportCurlBtn");
const closeExportCurlBtn = byId<HTMLButtonElement>("closeExportCurlBtn");
const curlExportPanel = byId<HTMLElement>("curlExportPanel");
const curlExportOutput = byId<HTMLTextAreaElement>("curlExportOutput");
const sendBtn = byId<HTMLButtonElement>("sendBtn");
const abortBtn = byId<HTMLButtonElement>("abortBtn");
const clearOutputBtn = byId<HTMLButtonElement>("clearOutputBtn");

const reloadCollectionsBtn = byId<HTMLButtonElement>("reloadCollectionsBtn");
const createCollectionBtn = byId<HTMLButtonElement>("createCollectionBtn");
const duplicateRequestBtn = byId<HTMLButtonElement>("duplicateRequestBtn");
const saveRequestBtn = byId<HTMLButtonElement>("saveRequestBtn");
const newCollectionNameInput = byId<HTMLInputElement>("newCollectionNameInput");
const collectionsStatusText = byId<HTMLElement>("collectionsStatusText");
const collectionsList = byId<HTMLElement>("collectionsList");

const statusText = byId<HTMLSpanElement>("statusText");
const errorText = byId<HTMLParagraphElement>("errorText");
const sentHeadersOutput = byId<HTMLElement>("sentHeadersOutput");
const headersOutput = byId<HTMLElement>("headersOutput");
const rawJsonMeta = byId<HTMLElement>("rawJsonMeta");
const copyRawResponseBtn = byId<HTMLButtonElement>("copyRawResponseBtn");
const rawCollapseBtn = byId<HTMLButtonElement>("rawCollapseBtn");
const rawExpandBtn = byId<HTMLButtonElement>("rawExpandBtn");
const rawJsonViewer = byId<HTMLElement>("rawJsonViewer");
const rawOutput = byId<HTMLElement>("rawOutput");
const aggregateOutput = byId<HTMLElement>("aggregateOutput");
const copyAggregateResponseBtn = byId<HTMLButtonElement>("copyAggregateResponseBtn");
const sseInspector = byId<HTMLElement>("sseInspector");
const sseLineList = byId<HTMLElement>("sseLineList");
const ssePayloadMeta = byId<HTMLElement>("ssePayloadMeta");
const ssePayloadCollapseBtn = byId<HTMLButtonElement>("ssePayloadCollapseBtn");
const ssePayloadExpandBtn = byId<HTMLButtonElement>("ssePayloadExpandBtn");
const ssePayloadJsonViewer = byId<HTMLElement>("ssePayloadJsonViewer");
const ssePayloadOutput = byId<HTMLElement>("ssePayloadOutput");

let activeAbortController: AbortController | null = null;
let rawAppender: BatchedBoundedAppender;
let plainRawResponseBuffer: PlainRawResponseBuffer;
let aggregateAppender: BatchedAggregateAppender;
let aggregationRuntime: ResponseAggregationRuntime | null = null;
let rawResponseMode: RawResponseMode = "plain";
let requestIsLoading = false;
let environments: EnvironmentEntry[] = [];
let activeEnvironmentId: string | null = null;
let headerRows: EditableHeader[] = [];
let collectionStore: CollectionStore = { collections: [] };
let requestDrafts: PersistedRequestDraftStore = {};
let activeCollectionId: string | null = null;
let activeSavedRequestId: string | null = null;
let draftAutosaveTimer: number | null = null;
let latestSentHeaders: Record<string, string> = {};
let latestResponseHeaders: Record<string, string> = {};
let bodyJsonController: JsonViewController | null = null;
let bodyJsonFoldState: JsonFoldState | null = null;
let bodyEditorMode: BodyEditorMode = "text";
let rawJsonController: JsonViewController | null = null;
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
  importPluginBtn.addEventListener("click", () => {
    pluginImportInput.click();
  });
  pluginImportInput.addEventListener("change", () => {
    void importPlugin();
  });

  exportCurlBtn.addEventListener("click", () => {
    void exportCurl();
  });

  copyExportCurlBtn.addEventListener("click", () => {
    void copyExportedCurl();
  });

  closeExportCurlBtn.addEventListener("click", () => {
    hideCurlExport();
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
    markRequestEditorChanged();
  });

  bodyInput.addEventListener("focus", () => {
    showBodyTextEditor();
  });
  bodyInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (document.activeElement === bodyInput) {
        return;
      }
      bodyEditorMode = prettifyJSONText(bodyInput.value) ? "json" : "text";
      syncBodyEditor();
    }, 0);
  });
  bodyInput.addEventListener("input", () => {
    bodyEditorMode = "text";
    syncBodyEditor();
    markRequestEditorChanged();
  });

  bodyJsonViewer.addEventListener("click", () => {
    focusBodyEditor();
  });
  bodyJsonViewer.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    focusBodyEditor();
  });

  copyBodyBtn.addEventListener("click", () => {
    void copyRequestBody();
  });
  copyAggregateResponseBtn.addEventListener("click", () => {
    void copyAggregateResponse();
  });
  bodyPrettifyBtn.addEventListener("click", () => prettifyBodyJSON());
  bodyCollapseBtn.addEventListener("click", () => collapseBodyJSON());
  bodyExpandBtn.addEventListener("click", () => expandBodyJSON());
  copyRawResponseBtn.addEventListener("click", () => {
    void copyRawResponse();
  });
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
  duplicateRequestBtn.addEventListener("click", () => {
    void duplicateCurrentRequest();
  });
  saveRequestBtn.addEventListener("click", () => {
    void saveCurrentRequestToCollection();
  });
  aggregationPluginInput.addEventListener("change", () => {
    renderEffectiveAggregationPlugin();
  });

  const persistTargets: Array<
    EventTarget & { addEventListener: typeof EventTarget.prototype.addEventListener }
  > = [
    curlInput,
    requestNameInput,
    methodInput,
    urlInput,
    aggregationPluginInput,
    timeoutInput,
  ];

  for (const target of persistTargets) {
    const handler = target === curlInput ? persistState : markRequestEditorChanged;
    target.addEventListener("input", handler);
    target.addEventListener("change", handler);
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
    aggregationPlugin: AGGREGATION_PLUGIN_OPENAI,
    useCollectionAggregationPlugin: false,
    aggregateOpenAISse: true,
    timeoutSeconds: 120,
    requestDrafts: {},
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
  renderPluginOptionsIntoSelect(
    aggregationPluginInput,
    state.useCollectionAggregationPlugin
      ? REQUEST_AGGREGATION_USE_COLLECTION
      : resolveAggregationPluginId(state.aggregationPlugin, state.aggregateOpenAISse),
    true,
  );
  timeoutInput.value = String(state.timeoutSeconds);
  requestDrafts = state.requestDrafts;
  activeCollectionId = state.activeCollectionId;
  activeSavedRequestId = state.activeSavedRequestId;
  bodyEditorMode = "json";

  renderEnvironmentControls();
  renderHeaderRows();
  syncBodyEditor();
  renderDraftStatus();
  renderEffectiveAggregationPlugin();
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
      aggregationPlugin:
        typeof parsed.aggregationPlugin === "string"
          ? resolveAggregationPluginId(parsed.aggregationPlugin)
          : resolveAggregationPluginId(undefined, parsed.aggregateOpenAISse === true),
      useCollectionAggregationPlugin: parsed.useCollectionAggregationPlugin === true,
      aggregateOpenAISse:
        typeof parsed.aggregateOpenAISse === "boolean"
          ? parsed.aggregateOpenAISse
          : fallback.aggregateOpenAISse,
      timeoutSeconds:
        typeof parsed.timeoutSeconds === "number" && Number.isFinite(parsed.timeoutSeconds)
          ? parsed.timeoutSeconds
          : fallback.timeoutSeconds,
      requestDrafts: normalizePersistedRequestDraftStore(parsed.requestDrafts),
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
    aggregationPlugin: selectedRequestAggregationPluginOverride(),
    useCollectionAggregationPlugin: selectedRequestUsesCollectionPlugin(),
    aggregateOpenAISse: selectedEffectiveAggregationPlugin().pluginId === AGGREGATION_PLUGIN_OPENAI,
    timeoutSeconds: toPositiveInt(timeoutInput.value, 120),
    requestDrafts,
    activeCollectionId,
    activeSavedRequestId,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function markRequestEditorChanged(): void {
  persistState();
  scheduleDraftAutosave();
}

function scheduleDraftAutosave(): void {
  if (draftAutosaveTimer !== null) {
    window.clearTimeout(draftAutosaveTimer);
  }
  draftAutosaveTimer = window.setTimeout(() => {
    draftAutosaveTimer = null;
    persistCurrentRequestDraft();
  }, DRAFT_AUTOSAVE_DELAY_MS);
}

function flushDraftAutosave(): void {
  if (draftAutosaveTimer === null) {
    return;
  }
  window.clearTimeout(draftAutosaveTimer);
  draftAutosaveTimer = null;
  persistCurrentRequestDraft();
}

function currentRequestDraftScope(): RequestDraftScope {
  return {
    collectionId: activeCollectionId,
    requestId: activeSavedRequestId,
  };
}

function persistCurrentRequestDraft(): void {
  const scope = currentRequestDraftScope();
  const currentDraft = getCurrentSavedRequestDraft();
  const savedRequest = findSavedRequest(scope.collectionId, scope.requestId);
  const canonicalDraft = savedRequest ? savedRequestToDraft(savedRequest) : null;

  requestDrafts = canonicalDraft && requestLibraryDraftsEqual(currentDraft, canonicalDraft)
    ? deletePersistedRequestDraft(requestDrafts, scope)
    : setPersistedRequestDraft(requestDrafts, { scope, draft: currentDraft });

  persistState();
  renderDraftStatus();
}

function clearPersistedRequestDraft(scope: RequestDraftScope): void {
  requestDrafts = deletePersistedRequestDraft(requestDrafts, scope);
  renderDraftStatus();
}

function restoreDraftForCurrentSelection(fallbackDraft?: RequestLibraryDraft): boolean {
  const persistedDraft = getPersistedRequestDraft(requestDrafts, currentRequestDraftScope());
  if (persistedDraft) {
    applyEditorDraft(persistedDraft.draft);
    renderDraftStatus();
    return true;
  }
  if (fallbackDraft) {
    applyEditorDraft(fallbackDraft);
  }
  renderDraftStatus();
  return false;
}

function applyEditorDraft(draft: RequestLibraryDraft): void {
  requestNameInput.value = draft.name;
  methodInput.value = draft.method || "GET";
  urlInput.value = draft.url;
  bodyInput.value = draft.body;
  aggregationPluginInput.value = resolveAggregationPluginId(
    draft.aggregation_plugin,
    draft.aggregate_openai_sse,
  );
  timeoutInput.value = String(draft.timeout_seconds || 120);
  headerRows = normalizeHeaderRows(draft.headers);
  bodyEditorMode = "json";

  renderHeaderRows();
  syncBodyEditor();
}

function renderDraftStatus(): void {
  const hasDraft = getPersistedRequestDraft(requestDrafts, currentRequestDraftScope()) !== null;
  draftStatusText.textContent = hasDraft ? "Draft saved" : "";
}

function prunePersistedDrafts(): void {
  requestDrafts = prunePersistedRequestDraftStore(requestDrafts, {
    collectionIds: collectionStore.collections.map((collection) => collection.id),
    requestIds: collectionStore.collections.flatMap((collection) =>
      collection.requests.map((request) => request.id),
    ),
  });
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
  markRequestEditorChanged();
}

function patchHeaderRow(id: string, patch: Partial<EditableHeader>): void {
  headerRows = headerRows.map((header) => (header.id === id ? { ...header, ...patch } : header));
  markRequestEditorChanged();
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
  markRequestEditorChanged();
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
  markRequestEditorChanged();
}

function removeHeader(id: string): void {
  if (headerRows.length === 1) {
    headerRows = [createEmptyHeaderRow()];
  } else {
    headerRows = headerRows.filter((header) => header.id !== id);
  }
  renderHeaderRows();
  markRequestEditorChanged();
}

function syncBodyEditor(): void {
  if (bodyJsonController?.hasJSON) {
    bodyJsonFoldState = bodyJsonController.captureFoldState();
  }

  const controller = renderJSONText(bodyJsonViewer, bodyInput.value, {
    expandDepth: 2,
    foldState: bodyJsonFoldState,
  });
  bodyJsonController = controller;
  if (controller.hasJSON) {
    bodyJsonFoldState = controller.captureFoldState();
  }

  const hasJSON = controller.hasJSON;
  const shouldShowJSON = hasJSON && bodyEditorMode === "json" && document.activeElement !== bodyInput;

  bodyEditorShell.classList.toggle("is-json-mode", shouldShowJSON);
  bodyEditorShell.classList.toggle("has-json", hasJSON);
  bodyInput.classList.toggle("is-hidden", shouldShowJSON);
  bodyJsonViewer.classList.toggle("is-hidden", !shouldShowJSON);
  bodyJsonViewer.tabIndex = hasJSON && !requestIsLoading ? 0 : -1;
  bodyCollapseBtn.disabled = !hasJSON || requestIsLoading;
  bodyExpandBtn.disabled = !hasJSON || requestIsLoading;

  if (!hasJSON) {
    bodyEditorMode = "text";
    return;
  }

  if (document.activeElement !== bodyInput && bodyEditorMode !== "text") {
    bodyEditorMode = "json";
  }
}

function showBodyTextEditor(): void {
  bodyEditorMode = "text";
  syncBodyEditor();
}

function showBodyJSONViewer(): void {
  if (!bodyJsonController?.hasJSON) {
    return;
  }
  bodyEditorMode = "json";
  syncBodyEditor();
}

function focusBodyEditor(): void {
  if (requestIsLoading) {
    return;
  }
  showBodyTextEditor();
  bodyInput.focus();
}

function collapseBodyJSON(): void {
  showBodyJSONViewer();
  bodyJsonController?.collapseAll();
  if (bodyJsonController?.hasJSON) {
    bodyJsonFoldState = bodyJsonController.captureFoldState();
  }
}

function expandBodyJSON(): void {
  showBodyJSONViewer();
  bodyJsonController?.expandAll();
  if (bodyJsonController?.hasJSON) {
    bodyJsonFoldState = bodyJsonController.captureFoldState();
  }
}

function prettifyBodyJSON(): void {
  const pretty = prettifyJSONText(bodyInput.value);
  if (!pretty) {
    setError("Request body is not valid JSON.");
    return;
  }

  setError("");
  bodyInput.value = pretty;
  bodyEditorMode = document.activeElement === bodyInput ? "text" : "json";
  syncBodyEditor();
  markRequestEditorChanged();
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

    flushDraftAutosave();
    methodInput.value = parsed.method || "GET";
    urlInput.value = parsed.url || "";
    headerRows = normalizeHeaderRows(
      (parsed.headers || []).map((header) => ({ ...header, enabled: true })),
    );
    bodyInput.value = parsed.body || "";
    bodyEditorMode = "json";
    activeSavedRequestId = null;
    renderHeaderRows();
    syncBodyEditor();
    persistState();
    persistCurrentRequestDraft();
  } catch (error) {
    setError(errorMessage(error, "Failed to import curl command."));
  } finally {
    setLoading(false);
  }
}

async function importPlugin(): Promise<void> {
  const file = pluginImportInput.files?.[0];
  pluginImportInput.value = "";
  if (!file) {
    return;
  }

  setPluginsStatus(`Importing ${file.name}...`);
  try {
    const source = await file.text();
    const parsed = await parseImportedAggregationPluginFile(file.name, source);

    const response = await fetch("/api/plugins/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(responseText || `Import failed (${response.status})`);
    }

    await loadPlugins({
      successMessage: `Imported plugin "${parsed.label}".`,
    });
  } catch (error) {
    setPluginsStatus(errorMessage(error, "Failed to import plugin."), true);
  }
}

async function loadPlugins(options?: { successMessage?: string }): Promise<void> {
  if (!options?.successMessage) {
    setPluginsStatus("Loading plugins...");
  }

  try {
    const response = await fetch("/api/plugins");
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(responseText || `Load failed (${response.status})`);
    }

    const parsed = JSON.parse(responseText) as Partial<PluginStoreResponse>;
    const manifests = Array.isArray(parsed.plugins) ? parsed.plugins : [];
    setImportedAggregationPluginManifests(
      manifests.map((plugin) => ({
        id: resolveAggregationPluginId(plugin.id),
        label: typeof plugin.label === "string" ? plugin.label : resolveAggregationPluginId(plugin.id),
        description: typeof plugin.description === "string" ? plugin.description : "",
        module_url: typeof plugin.module_url === "string" ? plugin.module_url : "",
        imported_at: typeof plugin.imported_at === "string" ? plugin.imported_at : "",
        format: plugin.format === "json" ? "json" : "js",
      })),
    );

    renderImportedPlugins();
    renderAggregationPluginControls();
    renderCollections();
    renderEffectiveAggregationPlugin();
    setPluginsStatus(
      options?.successMessage ??
        (getImportedAggregationPluginManifests().length === 0
          ? 'Imported plugins are stored in "./.apishark/plugins.json".'
          : `Loaded ${getImportedAggregationPluginManifests().length} imported plugin${getImportedAggregationPluginManifests().length === 1 ? "" : "s"}.`),
    );
  } catch (error) {
    renderImportedPlugins();
    renderAggregationPluginControls();
    renderCollections();
    renderEffectiveAggregationPlugin();
    setPluginsStatus(errorMessage(error, "Failed to load plugins."), true);
  }
}

function renderImportedPlugins(): void {
  pluginsList.textContent = "";
  const importedPlugins = getImportedAggregationPluginManifests();
  if (importedPlugins.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No imported plugins yet. Import a JSON or JS package to add one.";
    pluginsList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const plugin of importedPlugins) {
    const item = document.createElement("div");
    item.className = "plugin-item";

    const title = document.createElement("strong");
    title.className = "plugin-title";
    title.textContent = plugin.label;

    const meta = document.createElement("p");
    meta.className = "hint compact plugin-meta";
    meta.textContent = `${plugin.id} • ${plugin.format.toUpperCase()}`;

    item.append(title, meta);
    if (plugin.description) {
      const description = document.createElement("p");
      description.className = "hint compact plugin-description";
      description.textContent = plugin.description;
      item.appendChild(description);
    }

    fragment.appendChild(item);
  }

  pluginsList.appendChild(fragment);
}

function renderAggregationPluginControls(): void {
  const currentValue = aggregationPluginInput.value || AGGREGATION_PLUGIN_OPENAI;
  renderPluginOptionsIntoSelect(aggregationPluginInput, currentValue, true);
}

function renderPluginOptionsIntoSelect(
  select: HTMLSelectElement,
  selectedValue: string,
  includeCollectionDefault = false,
): void {
  const fragment = document.createDocumentFragment();
  if (includeCollectionDefault) {
    const option = document.createElement("option");
    option.value = REQUEST_AGGREGATION_USE_COLLECTION;
    option.textContent = "Collection default";
    fragment.appendChild(option);
  }

  for (const plugin of listAggregationPlugins()) {
    const option = document.createElement("option");
    option.value = plugin.id;
    option.textContent = plugin.builtin ? plugin.label : `${plugin.label}`;
    fragment.appendChild(option);
  }

  const normalizedSelected =
    selectedValue === REQUEST_AGGREGATION_USE_COLLECTION
      ? REQUEST_AGGREGATION_USE_COLLECTION
      : resolveAggregationPluginId(selectedValue);
  const shouldAddMissingOption =
    normalizedSelected !== REQUEST_AGGREGATION_USE_COLLECTION &&
    normalizedSelected !== AGGREGATION_PLUGIN_NONE &&
    !hasAggregationPlugin(normalizedSelected);
  if (shouldAddMissingOption) {
    const missingOption = document.createElement("option");
    missingOption.value = normalizedSelected;
    missingOption.textContent = `Missing: ${normalizedSelected}`;
    fragment.appendChild(missingOption);
  }

  select.textContent = "";
  select.appendChild(fragment);
  select.value = normalizedSelected;
  if (select.value !== normalizedSelected) {
    select.value = includeCollectionDefault
      ? REQUEST_AGGREGATION_USE_COLLECTION
      : AGGREGATION_PLUGIN_NONE;
  }
}

function selectedRequestUsesCollectionPlugin(): boolean {
  return aggregationPluginInput.value === REQUEST_AGGREGATION_USE_COLLECTION;
}

function selectedRequestAggregationPluginOverride(): string {
  return selectedRequestUsesCollectionPlugin()
    ? AGGREGATION_PLUGIN_NONE
    : resolveAggregationPluginId(aggregationPluginInput.value);
}

function selectedEffectiveAggregationPlugin(): {
  pluginId: string;
  source: "request" | "collection" | "none";
  label: string;
} {
  return resolveEffectiveAggregationPlugin({
    requestPlugin: selectedRequestAggregationPluginOverride(),
    useCollectionPlugin: selectedRequestUsesCollectionPlugin(),
    collectionPlugin: findCollection(activeCollectionId)?.aggregation_plugin,
  });
}

function renderEffectiveAggregationPlugin(): void {
  const effective = selectedEffectiveAggregationPlugin();
  const activeCollection = findCollection(activeCollectionId);

  if (selectedRequestUsesCollectionPlugin()) {
    if (!activeCollection) {
      effectiveAggregationText.textContent = "Effective: None. No collection is selected.";
      return;
    }

    const suffix =
      effective.pluginId !== AGGREGATION_PLUGIN_NONE && !hasAggregationPlugin(effective.pluginId)
        ? " Missing plugin; raw output will still work."
        : "";
    effectiveAggregationText.textContent = `Effective: ${effective.label} via collection "${activeCollection.name}".${suffix}`;
    return;
  }

  const suffix =
    effective.pluginId !== AGGREGATION_PLUGIN_NONE && !hasAggregationPlugin(effective.pluginId)
      ? " Missing plugin; raw output will still work."
      : "";
  effectiveAggregationText.textContent = `Effective: ${effective.label} via request override.${suffix}`;
}

async function prepareAggregationRuntime(): Promise<{
  pluginId: string;
  runtime: ResponseAggregationRuntime;
}> {
  const effective = selectedEffectiveAggregationPlugin();
  if (effective.pluginId === AGGREGATION_PLUGIN_NONE) {
    return {
      pluginId: effective.pluginId,
      runtime: new ResponseAggregationRuntime(effective.pluginId),
    };
  }

  if (!hasAggregationPlugin(effective.pluginId)) {
    setError(`Aggregation plugin "${effective.pluginId}" is not available. Falling back to raw output.`);
    return {
      pluginId: AGGREGATION_PLUGIN_NONE,
      runtime: new ResponseAggregationRuntime(AGGREGATION_PLUGIN_NONE),
    };
  }

  try {
    await ensureAggregationPluginLoaded(effective.pluginId);
    return {
      pluginId: effective.pluginId,
      runtime: new ResponseAggregationRuntime(effective.pluginId),
    };
  } catch (error) {
    setError(`${errorMessage(error, "Failed to load aggregation plugin.")} Falling back to raw output.`);
    return {
      pluginId: AGGREGATION_PLUGIN_NONE,
      runtime: new ResponseAggregationRuntime(AGGREGATION_PLUGIN_NONE),
    };
  }
}

function setPluginsStatus(message: string, isError = false): void {
  pluginsStatusText.textContent = message;
  pluginsStatusText.classList.toggle("error", isError);
}

async function exportCurl(): Promise<void> {
  setError("");

  try {
    const env = parseEnvVars(getActiveEnvironment()?.text ?? "");
    const command = buildCurlCommand(resolveRequestDraft(getCurrentRequestDraft(), env));
    showCurlExport(command);

    if (await writeClipboardText(command)) {
      setSuccess("cURL copied to clipboard.");
      return;
    }

    curlExportOutput.focus();
    curlExportOutput.select();
    setError("cURL generated. Clipboard copy failed, so use the panel below to copy it.");
  } catch (error) {
    setError(errorMessage(error, "Failed to export cURL command."));
  }
}

async function copyExportedCurl(): Promise<void> {
  const command = curlExportOutput.value;
  if (!command) {
    setError("Generate a cURL command first.");
    return;
  }

  if (await writeClipboardText(command)) {
    setSuccess("cURL copied to clipboard.");
    return;
  }

  curlExportOutput.focus();
  curlExportOutput.select();
  setError("Clipboard copy failed. Select the cURL text and copy it manually.");
}

async function copyRequestBody(): Promise<void> {
  const body = bodyInput.value;
  if (!body) {
    setError("Request body is empty.");
    return;
  }

  if (await writeClipboardText(body)) {
    setSuccess("Request body copied to clipboard.");
    return;
  }

  showBodyTextEditor();
  bodyInput.focus();
  bodyInput.select();
  setError("Clipboard copy failed. Select the body text and copy it manually.");
}

async function copyRawResponse(): Promise<void> {
  const text = plainRawResponseBuffer.snapshotText();
  if (!text) {
    setError("Raw response is empty.");
    return;
  }

  if (await writeClipboardText(text)) {
    setSuccess("Raw response copied to clipboard.");
    return;
  }

  setError("Clipboard copy failed. Select the raw response text and copy it manually.");
}

async function copyAggregateResponse(): Promise<void> {
  const text = aggregateAppender.snapshotText();
  if (!text) {
    setError("Aggregated response is empty.");
    return;
  }

  if (await writeClipboardText(text)) {
    setSuccess("Aggregated response copied to clipboard.");
    return;
  }

  setError("Clipboard copy failed. Select the aggregated response text and copy it manually.");
}

async function sendRequest(): Promise<void> {
  setError("");
  clearOutputs();

  const draft = getCurrentRequestDraft();
  if (!draft.url) {
    setError("Request URL is required.");
    return;
  }

  setLoading(true);
  activeAbortController = new AbortController();

  try {
    const preparedAggregation = await prepareAggregationRuntime();
    aggregationRuntime = preparedAggregation.runtime;

    const env = parseEnvVars(getActiveEnvironment()?.text ?? "");
    const resolvedDraft = resolveRequestDraft(draft, env);
    if (!resolvedDraft.url) {
      throw new Error("Request URL is required.");
    }

    const payload = {
      method: resolvedDraft.method,
      url: resolvedDraft.url,
      headers: resolvedDraft.headers,
      body: resolvedDraft.body,
      env,
      aggregation_plugin: preparedAggregation.pluginId,
      aggregate_openai_sse: preparedAggregation.pluginId === AGGREGATION_PLUGIN_OPENAI,
      timeout_seconds: toPositiveInt(timeoutInput.value, 120),
    };

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
    finalizeAggregationRuntime();
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
    buffer = consumeBufferedFrames(buffer);
  }

  buffer += decoder.decode().replace(/\r\n/g, "\n");
  buffer = consumeBufferedFrames(buffer);
  if (buffer.trim()) {
    consumeFrame(buffer);
  }
}

function consumeBufferedFrames(buffer: string): string {
  let frameIndex = buffer.indexOf("\n\n");
  while (frameIndex >= 0) {
    const frame = buffer.slice(0, frameIndex);
    buffer = buffer.slice(frameIndex + 2);
    consumeFrame(frame);
    frameIndex = buffer.indexOf("\n\n");
  }
  return buffer;
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
      appendPlainRawText(`${payload}\n`);
    }
  }
}

function consumeEvent(event: ServerEvent): void {
  switch (event.type) {
    case "meta":
      latestSentHeaders = event.sent_headers ?? {};
      latestResponseHeaders = event.response_headers ?? event.headers;
      setRawResponseMode(event.streaming ? "sse" : "plain");
      statusText.textContent = `${event.status_text}${event.streaming ? " (SSE stream)" : ""}`;
      renderSentHeaders(latestSentHeaders);
      renderResponseHeaders(latestResponseHeaders);
      break;

    case "raw_event":
      consumeRawEvent(event);
      break;

    case "error":
      setError(event.message);
      break;

    case "done":
      if (statusText.textContent) {
        statusText.textContent = `${statusText.textContent} (${event.duration_ms} ms)`;
      }
      finalizeAggregationRuntime();
      finalizeResponseViews();
      break;
  }
}

function consumeRawEvent(event: RawEvent): void {
  rawOutput.classList.remove("is-hidden");
  rawJsonViewer.classList.add("is-hidden");

  if (event.transport.mode === "sse") {
    if (event.rawChunk) {
      appendSseLine(event.rawChunk);
    }
  } else if (event.rawChunk) {
    appendPlainRawText(event.rawChunk);
  }

  if (!aggregationRuntime) {
    return;
  }

  const result = aggregationRuntime.consumeRawEvent(event);
  if (result.error) {
    handleAggregationFailure(result.error);
    return;
  }

  applyAggregationRuntimeResult(result);
}

function finalizeAggregationRuntime(): void {
  if (!aggregationRuntime) {
    return;
  }

  const result = aggregationRuntime.finalize();
  if (result.error) {
    handleAggregationFailure(result.error);
    return;
  }

  applyAggregationRuntimeResult(result);
}

function applyAggregationRuntimeResult(result: {
  appendFragments?: AggregateFragment[];
  replaceFragments?: AggregateFragment[];
}): void {
  if ("replaceFragments" in result) {
    aggregateAppender.setFragments(result.replaceFragments ?? []);
    return;
  }

  if (result.appendFragments && result.appendFragments.length > 0) {
    aggregateAppender.enqueueFragments(result.appendFragments);
  }
}

function handleAggregationFailure(message: string): void {
  aggregationRuntime = null;
  aggregateAppender.clear();
  setError(message);
}

function finalizeResponseViews(): void {
  renderSentHeaders(latestSentHeaders);
  renderResponseHeaders(latestResponseHeaders);
  if (rawResponseMode === "plain") {
    const rawText = plainRawResponseBuffer.snapshotText();
    rawOutput.textContent = rawText;
    renderRawJSONIfPossible(rawText);
  }
}

function clearOutputs(): void {
  latestSentHeaders = {};
  latestResponseHeaders = {};
  aggregationRuntime = null;
  setRawResponseMode("plain");
  statusText.textContent = "-";
  sentHeadersOutput.textContent = "";
  headersOutput.textContent = "";
  plainRawResponseBuffer.clear();
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

function appendPlainRawText(text: string): void {
  if (!text) {
    return;
  }
  plainRawResponseBuffer.append(text);
  rawAppender.enqueue(text);
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
  renderHeaderMap(headersOutput, headers);
}

function renderSentHeaders(headers: Record<string, string>): void {
  renderHeaderMap(sentHeadersOutput, headers);
}

function renderHeaderMap(element: HTMLElement, headers: Record<string, string>): void {
  if (Object.keys(headers).length === 0) {
    element.textContent = "";
    return;
  }
  renderJSONValue(element, headers, { expandDepth: 1 });
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
    prunePersistedDrafts();

    if (!findCollection(activeCollectionId)) {
      activeCollectionId = parsed.collections[0]?.id ?? null;
    }
    if (activeCollectionId) {
      const activeCollection = findCollection(activeCollectionId);
      if (!activeCollection?.requests.some((request) => request.id === activeSavedRequestId)) {
        activeSavedRequestId = null;
      }
    }

    const activeSavedRequest = findSavedRequest(activeCollectionId, activeSavedRequestId);
    restoreDraftForCurrentSelection(
      activeSavedRequest ? savedRequestToDraft(activeSavedRequest) : undefined,
    );
    renderCollections();
    renderEffectiveAggregationPlugin();
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

  flushDraftAutosave();
  const previous = cloneCollectionStore(collectionStore);
  const nextCollection: RequestCollection = {
    id: makeId("col"),
    name,
    aggregation_plugin: AGGREGATION_PLUGIN_NONE,
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
  renderEffectiveAggregationPlugin();
  persistState();
  setCollectionsStatus(`Selected collection "${name}".`);
}

async function saveCurrentRequestToCollection(): Promise<void> {
  flushDraftAutosave();
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
  const previousScope = currentRequestDraftScope();
  const savedRequest = createSavedRequest({
    id: activeSavedRequestId ?? makeId("req"),
    draft: getCurrentSavedRequestDraft(),
  });

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
  renderEffectiveAggregationPlugin();
  clearPersistedRequestDraft(previousScope);
  clearPersistedRequestDraft({ collectionId: activeCollectionId, requestId: savedRequest.id });
  persistState();
  setCollectionsStatus(`Saved "${requestName}" to "${collection.name}".`);
}

async function duplicateCurrentRequest(): Promise<void> {
  flushDraftAutosave();
  const currentDraft = getCurrentSavedRequestDraft();
  const targetCollection = findCollection(activeCollectionId);
  const existingNames = targetCollection
    ? targetCollection.requests.map((request) => request.name)
    : collectionStore.collections.flatMap((collection) =>
        collection.requests.map((request) => request.name),
      );
  const duplicateDraft = createDuplicateRequestDraft(currentDraft, existingNames);

  if (!targetCollection || !activeCollectionId) {
    requestNameInput.value = duplicateDraft.name;
    activeSavedRequestId = null;
    renderPluginOptionsIntoSelect(
      aggregationPluginInput,
      duplicateDraft.use_collection_aggregation_plugin
        ? REQUEST_AGGREGATION_USE_COLLECTION
        : resolveAggregationPluginId(duplicateDraft.aggregation_plugin),
      true,
    );
    renderEffectiveAggregationPlugin();
    persistState();
    persistCurrentRequestDraft();
    setCollectionsStatus(
      `Prepared duplicate "${duplicateDraft.name}". Select a collection and save it to keep both versions.`,
    );
    return;
  }

  const sourceName = currentDraft.name;
  const insertAfterRequestId = activeSavedRequestId;
  const savedRequest = createSavedRequest({
    id: makeId("req"),
    draft: duplicateDraft,
  });
  const previous = cloneCollectionStore(collectionStore);
  collectionStore = {
    collections: collectionStore.collections.map((collection) => {
      if (collection.id !== activeCollectionId) {
        return collection;
      }
      return {
        ...collection,
        requests: insertSavedRequest(collection.requests, savedRequest, insertAfterRequestId),
      };
    }),
  };

  if (!(await saveCollectionsToServer(previous))) {
    return;
  }

  requestNameInput.value = savedRequest.name;
  activeSavedRequestId = savedRequest.id;
  renderCollections();
  renderEffectiveAggregationPlugin();
  clearPersistedRequestDraft({ collectionId: activeCollectionId, requestId: savedRequest.id });
  persistState();
  setCollectionsStatus(
    `Duplicated "${sourceName}" to "${savedRequest.name}" in "${targetCollection.name}".`,
  );
}

function loadSavedRequest(collectionId: string, requestId: string): void {
  const collection = findCollection(collectionId);
  const savedRequest = collection?.requests.find((request) => request.id === requestId);
  if (!collection || !savedRequest) {
    setCollectionsStatus("Saved request no longer exists.", true);
    return;
  }

  flushDraftAutosave();
  activeCollectionId = collectionId;
  activeSavedRequestId = requestId;
  restoreDraftForCurrentSelection(savedRequestToDraft(savedRequest));
  renderCollections();
  renderEffectiveAggregationPlugin();
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

  if (activeCollectionId === collectionId) {
    flushDraftAutosave();
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

  prunePersistedDrafts();
  restoreDraftForCurrentSelection();
  renderCollections();
  renderEffectiveAggregationPlugin();
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

  if (activeCollectionId === collectionId && activeSavedRequestId === requestId) {
    flushDraftAutosave();
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

  clearPersistedRequestDraft({ collectionId, requestId });
  restoreDraftForCurrentSelection();
  renderCollections();
  renderEffectiveAggregationPlugin();
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
    prunePersistedDrafts();
    if (activeCollectionId && !findCollection(activeCollectionId)) {
      activeCollectionId = collectionStore.collections[0]?.id ?? null;
      activeSavedRequestId = null;
    }
    if (activeSavedRequestId && !findSavedRequest(activeCollectionId, activeSavedRequestId)) {
      activeSavedRequestId = null;
    }
    renderDraftStatus();
    return true;
  } catch (error) {
    collectionStore = previous;
    renderCollections();
    renderEffectiveAggregationPlugin();
    setCollectionsStatus(errorMessage(error, "Failed to save collections."), true);
    return false;
  }
}

async function updateCollectionAggregationPlugin(
  collectionId: string,
  pluginId: string,
): Promise<void> {
  const collection = findCollection(collectionId);
  if (!collection) {
    return;
  }

  if (collection.aggregation_plugin === pluginId) {
    return;
  }

  const previous = cloneCollectionStore(collectionStore);
  collectionStore = {
    collections: collectionStore.collections.map((item) =>
      item.id === collectionId ? { ...item, aggregation_plugin: pluginId } : item,
    ),
  };

  if (!(await saveCollectionsToServer(previous))) {
    return;
  }

  renderCollections();
  renderEffectiveAggregationPlugin();
  persistState();
  setCollectionsStatus(
    `Collection "${collection.name}" now defaults to ${aggregationPluginLabel(pluginId)}.`,
  );
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
      flushDraftAutosave();
      activeCollectionId = collection.id;
      if (!collection.requests.some((request) => request.id === activeSavedRequestId)) {
        activeSavedRequestId = null;
      }
      restoreDraftForCurrentSelection();
      renderCollections();
      renderEffectiveAggregationPlugin();
      persistState();
      setCollectionsStatus(`Selected collection "${collection.name}".`);
    });

    const name = document.createElement("strong");
    name.textContent = collection.name;
    const meta = document.createElement("p");
    meta.className = "collection-meta hint compact";
    meta.textContent = formatCollectionMeta(collection);
    selectBtn.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "collection-card-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "small-btn";
    saveBtn.textContent = "↥";
    saveBtn.ariaLabel = `Save current request to ${collection.name}`;
    saveBtn.title = `Save current request to ${collection.name}`;
    saveBtn.addEventListener("click", () => {
      flushDraftAutosave();
      activeCollectionId = collection.id;
      void saveCurrentRequestToCollection();
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "small-btn collection-delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.ariaLabel = `Delete collection ${collection.name}`;
    deleteBtn.title = `Delete collection ${collection.name}`;
    deleteBtn.addEventListener("click", () => {
      void deleteCollection(collection.id);
    });
    actions.append(saveBtn, deleteBtn);

    head.append(selectBtn, actions);
    card.appendChild(head);

    const bindingRow = document.createElement("label");
    bindingRow.className = "collection-plugin-row";
    const bindingLabel = document.createElement("span");
    bindingLabel.className = "hint compact";
    bindingLabel.textContent = "Aggregation";
    const bindingSelect = document.createElement("select");
    bindingSelect.className = "collection-plugin-select";
    bindingSelect.disabled = requestIsLoading;
    renderPluginOptionsIntoSelect(bindingSelect, collection.aggregation_plugin);
    bindingSelect.addEventListener("change", () => {
      void updateCollectionAggregationPlugin(
        collection.id,
        resolveAggregationPluginId(bindingSelect.value),
      );
    });
    bindingRow.append(bindingLabel, bindingSelect);
    card.appendChild(bindingRow);

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

        const requestPrimary = document.createElement("div");
        requestPrimary.className = "request-primary";
        const requestMethod = document.createElement("span");
        requestMethod.className = "request-method";
        requestMethod.dataset.method = request.method;
        requestMethod.textContent = request.method;
        const requestText = document.createElement("div");
        requestText.className = "request-text";
        const requestName = document.createElement("strong");
        requestName.className = "request-title";
        requestName.textContent = request.name;
        const requestMeta = document.createElement("p");
        requestMeta.className = "request-meta hint compact";
        requestMeta.textContent = formatSavedRequestMeta(request, collection);
        requestText.append(requestName, requestMeta);
        requestPrimary.append(requestMethod, requestText);
        loadBtn.append(requestPrimary);

        const requestActions = document.createElement("div");
        requestActions.className = "request-item-actions";
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "small-btn request-delete-btn";
        deleteBtn.textContent = "✕";
        deleteBtn.ariaLabel = `Delete saved request ${request.name}`;
        deleteBtn.title = `Delete saved request ${request.name}`;
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
        aggregation_plugin:
          typeof collection.aggregation_plugin === "string"
            ? resolveAggregationPluginId(collection.aggregation_plugin)
            : AGGREGATION_PLUGIN_NONE,
        requests: Array.isArray(collection.requests)
          ? collection.requests.map((request) => ({
              id: typeof request.id === "string" ? request.id : makeId("req"),
              name: typeof request.name === "string" ? request.name : "Untitled Request",
              method: typeof request.method === "string" ? request.method : "GET",
              url: typeof request.url === "string" ? request.url : "",
              headers: normalizeSavedHeaders(request.headers),
              body: typeof request.body === "string" ? request.body : "",
              aggregation_plugin:
                request.use_collection_aggregation_plugin === true
                  ? undefined
                  : typeof request.aggregation_plugin === "string"
                    ? resolveAggregationPluginId(request.aggregation_plugin)
                    : resolveAggregationPluginId(undefined, request.aggregate_openai_sse === true),
              use_collection_aggregation_plugin:
                request.use_collection_aggregation_plugin === true,
              aggregate_openai_sse:
                request.use_collection_aggregation_plugin === true
                  ? false
                  : resolveAggregationPluginId(
                        typeof request.aggregation_plugin === "string"
                          ? request.aggregation_plugin
                          : undefined,
                        request.aggregate_openai_sse === true,
                      ) === AGGREGATION_PLUGIN_OPENAI,
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

function findSavedRequest(
  collectionId: string | null,
  requestId: string | null,
): SavedRequest | undefined {
  if (!requestId) {
    return undefined;
  }

  const collection = findCollection(collectionId);
  if (collection) {
    return collection.requests.find((request) => request.id === requestId);
  }

  for (const item of collectionStore.collections) {
    const request = item.requests.find((candidate) => candidate.id === requestId);
    if (request) {
      return request;
    }
  }

  return undefined;
}

function setCollectionsStatus(message: string, isError = false): void {
  collectionsStatusText.textContent = message;
  collectionsStatusText.classList.toggle("error", isError);
}

function formatCollectionMeta(collection: RequestCollection): string {
  return `${collection.requests.length} saved request${collection.requests.length === 1 ? "" : "s"} • ${aggregationPluginLabel(collection.aggregation_plugin)}`;
}

function formatSavedRequestMeta(request: SavedRequest, collection: RequestCollection): string {
  const url = request.url.trim() || "(no URL)";
  const binding = request.use_collection_aggregation_plugin
    ? `via ${aggregationPluginLabel(collection.aggregation_plugin)} collection default`
    : `${aggregationPluginLabel(request.aggregation_plugin)} override`;

  if (!request.updated_at) {
    return `${url} • ${binding}`;
  }

  const parsed = new Date(request.updated_at);
  if (Number.isNaN(parsed.getTime())) {
    return `${url} • ${binding}`;
  }

  return `${url} • ${binding} • ${parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function setLoading(isLoading: boolean): void {
  requestIsLoading = isLoading;
  sendBtn.disabled = isLoading;
  importCurlBtn.disabled = isLoading;
  importPluginBtn.disabled = isLoading;
  pluginImportInput.disabled = isLoading;
  exportCurlBtn.disabled = isLoading;
  requestNameInput.disabled = isLoading;
  envInput.disabled = isLoading;
  methodInput.disabled = isLoading;
  urlInput.disabled = isLoading;
  bodyInput.disabled = isLoading;
  timeoutInput.disabled = isLoading;
  aggregationPluginInput.disabled = isLoading;
  addHeaderBtn.disabled = isLoading;
  copyBodyBtn.disabled = isLoading;
  copyRawResponseBtn.disabled = isLoading;
  copyAggregateResponseBtn.disabled = isLoading;
  bodyPrettifyBtn.disabled = isLoading;
  bodyCollapseBtn.disabled = isLoading || !bodyJsonController?.hasJSON;
  bodyExpandBtn.disabled = isLoading || !bodyJsonController?.hasJSON;
  abortBtn.disabled = !isLoading;
  sendBtn.textContent = isLoading ? "Sending..." : "Send";
  syncEnvironmentEditor();
  renderHeaderRows();
  syncBodyEditor();
  renderCollections();
  renderEffectiveAggregationPlugin();
}

function setError(message: string): void {
  errorText.textContent = message;
  errorText.classList.remove("success");
  errorText.classList.add("error");
}

function setSuccess(message: string): void {
  errorText.textContent = message;
  errorText.classList.remove("error");
  errorText.classList.add("success");
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

function getCurrentSavedRequestDraft(): RequestLibraryDraft {
  const aggregationPlugin = selectedRequestAggregationPluginOverride();
  const useCollectionAggregationPlugin = selectedRequestUsesCollectionPlugin();
  return {
    name: requestNameInput.value.trim() || "Untitled Request",
    method: methodInput.value.trim().toUpperCase() || "GET",
    url: urlInput.value.trim(),
    headers: headerRows.map((header) => ({
      key: header.key,
      value: header.value,
      enabled: header.enabled,
    })),
    body: bodyInput.value,
    aggregation_plugin: aggregationPlugin,
    use_collection_aggregation_plugin: useCollectionAggregationPlugin,
    aggregate_openai_sse:
      !useCollectionAggregationPlugin && aggregationPlugin === AGGREGATION_PLUGIN_OPENAI,
    timeout_seconds: toPositiveInt(timeoutInput.value, 120),
  };
}

function savedRequestToDraft(savedRequest: SavedRequest): RequestLibraryDraft {
  const aggregationPlugin = resolveAggregationPluginId(
    savedRequest.aggregation_plugin,
    savedRequest.aggregate_openai_sse,
  );
  return {
    name: savedRequest.name,
    method: savedRequest.method || "GET",
    url: savedRequest.url,
    headers: savedRequest.headers.map((header) => ({ ...header })),
    body: savedRequest.body,
    aggregation_plugin: aggregationPlugin,
    use_collection_aggregation_plugin: savedRequest.use_collection_aggregation_plugin !== false,
    aggregate_openai_sse: aggregationPlugin === AGGREGATION_PLUGIN_OPENAI,
    timeout_seconds: savedRequest.timeout_seconds || 120,
  };
}

function createSavedRequest(input: { id: string; draft: RequestLibraryDraft }): SavedRequest {
  return {
    id: input.id,
    name: input.draft.name,
    method: input.draft.method,
    url: input.draft.url,
    headers: input.draft.headers.map((header) => ({ ...header })),
    body: input.draft.body,
    aggregation_plugin: input.draft.use_collection_aggregation_plugin
      ? undefined
      : input.draft.aggregation_plugin,
    use_collection_aggregation_plugin: input.draft.use_collection_aggregation_plugin,
    aggregate_openai_sse: input.draft.aggregate_openai_sse,
    timeout_seconds: input.draft.timeout_seconds,
    updated_at: new Date().toISOString(),
  };
}

function insertSavedRequest(
  requests: SavedRequest[],
  savedRequest: SavedRequest,
  afterRequestId: string | null,
): SavedRequest[] {
  const next = [...requests];
  if (!afterRequestId) {
    next.push(savedRequest);
    return next;
  }

  const index = next.findIndex((request) => request.id === afterRequestId);
  if (index < 0) {
    next.push(savedRequest);
    return next;
  }

  next.splice(index + 1, 0, savedRequest);
  return next;
}

function getCurrentRequestDraft(): {
  method: string;
  url: string;
  headers: HeaderKV[];
  body: string;
} {
  return {
    method: methodInput.value.trim().toUpperCase() || "GET",
    url: urlInput.value.trim(),
    headers: headerRows
      .filter((header) => header.enabled && header.key.trim() !== "")
      .map((header) => ({ key: header.key, value: header.value })),
    body: bodyInput.value,
  };
}

function showCurlExport(command: string): void {
  curlExportOutput.value = command;
  curlExportPanel.classList.remove("is-hidden");
}

function hideCurlExport(): void {
  curlExportPanel.classList.add("is-hidden");
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
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

class BatchedAggregateAppender {
  private readonly element: HTMLElement;
  private readonly maxChars: number;
  private readonly flushIntervalMs: number;
  private fragments: AggregateFragment[] = [];
  private pending: AggregateFragment[] = [];
  private pendingUnits = 0;
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
    this.enqueueFragments([{ kind: "content", text }]);
  }

  enqueueFragments(fragments: AggregateFragment[]): void {
    const normalized = normalizeAggregateFragments(fragments);
    if (normalized.length === 0) {
      return;
    }

    this.pending.push(...normalized);
    this.pendingUnits += normalized.reduce((sum, fragment) => sum + aggregateFragmentSize(fragment), 0);
    this.scheduleFlush();
  }

  hasContent(): boolean {
    return this.fragments.length > 0 || this.pendingUnits > 0;
  }

  setText(text: string): void {
    this.setFragments(text ? [{ kind: "content", text }] : []);
  }

  setFragments(fragments: AggregateFragment[]): void {
    this.clear();
    this.enqueueFragments(fragments);
    this.flushNow();
  }

  snapshotText(): string {
    this.flushNow();
    return aggregateFragmentsToText(this.fragments);
  }

  clear(): void {
    this.cancelFlush();
    this.fragments = [];
    this.pending = [];
    this.pendingUnits = 0;
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
    if (this.pendingUnits === 0) {
      return;
    }

    const pending = this.pending;
    this.pending = [];
    this.pendingUnits = 0;
    const stickToBottom = isNearBottom(this.element);
    this.fragments = trimAggregateFragments([...this.fragments, ...pending], this.maxChars);
    renderAggregateFragments(this.element, this.fragments);

    if (stickToBottom) {
      this.element.scrollTop = this.element.scrollHeight;
    }
  }
}

function renderAggregateFragments(element: HTMLElement, fragments: AggregateFragment[]): void {
  element.textContent = "";

  const fragment = document.createDocumentFragment();
  for (const part of fragments) {
    if (isAggregateTextFragment(part)) {
      if (!part.text) {
        continue;
      }
      if (part.kind === "thinking") {
        const span = document.createElement("span");
        span.className = "aggregate-fragment is-thinking";
        span.textContent = part.text;
        fragment.appendChild(span);
        continue;
      }

      fragment.appendChild(document.createTextNode(part.text));
      continue;
    }

    if (isAggregateMediaFragment(part)) {
      fragment.appendChild(createAggregateMediaElement(part));
    }
  }

  element.appendChild(fragment);
}

function createAggregateMediaElement(fragment: Extract<AggregateFragment, { kind: "image" | "video" }>): HTMLElement {
  const wrapper = document.createElement("figure");
  wrapper.className = `aggregate-media aggregate-media-${fragment.kind}`;

  if (fragment.kind === "image") {
    const image = document.createElement("img");
    image.className = "aggregate-media-element";
    image.src = fragment.url;
    image.alt = fragment.alt ?? fragment.title ?? "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    if (fragment.title) {
      image.title = fragment.title;
    }
    wrapper.appendChild(image);
  } else {
    const video = document.createElement("video");
    video.className = "aggregate-media-element";
    video.src = fragment.url;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    if (fragment.title) {
      video.title = fragment.title;
    }
    video.setAttribute("aria-label", fragment.title ?? fragment.alt ?? "Aggregated video");
    wrapper.appendChild(video);
  }

  if (fragment.title) {
    const caption = document.createElement("figcaption");
    caption.className = "aggregate-media-caption";
    caption.textContent = fragment.title;
    wrapper.appendChild(caption);
  }

  return wrapper;
}

function isNearBottom(element: HTMLElement): boolean {
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  return remaining < 24;
}

plainRawResponseBuffer = new PlainRawResponseBuffer(RAW_OUTPUT_MAX_CHARS);
rawAppender = new BatchedBoundedAppender(rawOutput, RAW_OUTPUT_MAX_CHARS);
aggregateAppender = new BatchedAggregateAppender(aggregateOutput, AGGREGATE_OUTPUT_MAX_CHARS);
setRawResponseMode("plain");
clearSseInspector();
setupTabs();
wireEvents();
void initializeApp();

async function initializeApp(): Promise<void> {
  renderAggregationPluginControls();
  await loadPlugins();
  applyInitialState();
  await loadCollections();
}
