import { createBodyEditor, } from "./body-editor.js";
import { prettifyJSONText, renderJSONText, renderJSONValue, } from "./json-view.js";
import { aggregateFragmentSize, aggregateFragmentsToText, isAggregateMediaFragment, isAggregateTextFragment, normalizeAggregateFragments, trimAggregateFragments, } from "./aggregate-fragments.js";
import { AGGREGATION_PLUGIN_NONE, AGGREGATION_PLUGIN_OPENAI, ResponseAggregationRuntime, aggregationPluginLabel, ensureAggregationPluginLoaded, getImportedAggregationPluginManifests, hasAggregationPlugin, listAggregationPlugins, parseImportedAggregationPluginFile, resolveAggregationPluginId, setImportedAggregationPluginManifests, } from "./aggregation-runtime.js";
import { buildCurlCommand } from "./curl-export.js";
import { resolveRequestDraft } from "./request-resolution.js";
import { createDuplicateRequestDraft, deletePersistedRequestDraft, getCollectionScratchDraft, getPersistedRequestDraft, normalizePersistedRequestDraftStore, prunePersistedRequestDraftStore, requestLibraryDraftsEqual, resolveEffectiveAggregationPlugin, serializePersistedRequestDraftStore, setPersistedRequestDraft, } from "./request-library.js";
import { PlainRawResponseBuffer } from "./raw-response-buffer.js";
import { applyUtilitySidebarCollapsedState, normalizeUtilitySidebarCollapsed, } from "./utility-sidebar.js";
import { setupUtilitySections, } from "./utility-sections.js";
const STORAGE_KEY = "apishark.state.v2";
const REQUEST_AGGREGATION_USE_COLLECTION = "__collection__";
const RAW_OUTPUT_MAX_CHARS = 220000;
const AGGREGATE_OUTPUT_MAX_CHARS = 120000;
const OUTPUT_FLUSH_INTERVAL_MS = 50;
const SSE_MAX_LINES = 1200;
const DRAFT_AUTOSAVE_DELAY_MS = 350;
const COLLECTION_STATE_SAVE_DELAY_MS = 500;
const DEFAULT_UTILITY_PANEL_ID = "environmentUtility";
const PANE_LAYOUT_STORAGE_KEY = "apishark.pane-layout.v1";
const VALID_UTILITY_PANEL_IDS = new Set([
    "environmentUtility",
    "helperUtility",
    "importUtility",
    "pluginUtility",
]);
const ENV_TEMPLATE_PATTERN = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/;
const DYNAMIC_TEMPLATE_PATTERN = /\{\{\s*\$[^{}]+\}\}/;
const pmShell = document.querySelector(".pm-shell") ??
    (() => {
        throw new Error("Missing root shell");
    })();
const utilitySidebarBody = byId("appUtilitySidebarBody");
const sidebarResizeHandle = byId("sidebarResizeHandle");
const environmentSummaryText = byId("environmentSummaryText");
const openEnvironmentModalBtn = byId("openEnvironmentModalBtn");
const environmentSelect = byId("environmentSelect");
const addEnvironmentRowBtn = byId("addEnvironmentRowBtn");
const createEnvironmentBtn = byId("createEnvironmentBtn");
const renameEnvironmentBtn = byId("renameEnvironmentBtn");
const deleteEnvironmentBtn = byId("deleteEnvironmentBtn");
const envEditor = byId("envEditor");
const closeEnvironmentModalBtn = byId("closeEnvironmentModalBtn");
const environmentOverlay = byId("environmentOverlay");
const curlInput = byId("curlInput");
const importCurlBtn = byId("importCurlBtn");
const openImportModalBtn = byId("openImportModalBtn");
const openImportModalFromSidebarBtn = byId("openImportModalFromSidebarBtn");
const closeImportModalBtn = byId("closeImportModalBtn");
const importCurlOverlay = byId("importCurlOverlay");
const importPluginBtn = byId("importPluginBtn");
const pluginImportInput = byId("pluginImportInput");
const pluginsStatusText = byId("pluginsStatusText");
const pluginsList = byId("pluginsList");
const requestNameInput = byId("requestNameInput");
const methodInput = byId("methodInput");
const urlInput = byId("urlInput");
const addHeaderBtn = byId("addHeaderBtn");
const headersEditor = byId("headersEditor");
const bodyEditorShell = byId("bodyEditorShell");
const bodyEditorModeBadge = byId("bodyEditorModeBadge");
const bodyEditorHint = byId("bodyEditorHint");
const bodyInput = byId("bodyInput");
const bodyEditor = byId("bodyEditor");
const copyBodyBtn = byId("copyBodyBtn");
const bodyUndoBtn = byId("bodyUndoBtn");
const bodyPrettifyBtn = byId("bodyPrettifyBtn");
const bodyCollapseBtn = byId("bodyCollapseBtn");
const bodyExpandBtn = byId("bodyExpandBtn");
const aggregationPluginInput = byId("aggregationPluginInput");
const draftStatusText = byId("draftStatusText");
const effectiveAggregationText = byId("effectiveAggregationText");
const timeoutInput = byId("timeoutInput");
const exportCurlBtn = byId("exportCurlBtn");
const copyExportCurlBtn = byId("copyExportCurlBtn");
const closeExportCurlBtn = byId("closeExportCurlBtn");
const curlExportOverlay = byId("curlExportOverlay");
const curlExportOutput = byId("curlExportOutput");
const sendBtn = byId("sendBtn");
const abortBtn = byId("abortBtn");
const clearOutputBtn = byId("clearOutputBtn");
const reloadCollectionsBtn = byId("reloadCollectionsBtn");
const createCollectionBtn = byId("createCollectionBtn");
const duplicateRequestBtn = byId("duplicateRequestBtn");
const saveRequestBtn = byId("saveRequestBtn");
const newCollectionNameInput = byId("newCollectionNameInput");
const requestSearchInput = byId("requestSearchInput");
const collectionsStatusText = byId("collectionsStatusText");
const collectionsList = byId("collectionsList");
const libraryResizeHandle = byId("libraryResizeHandle");
const requestContextMenu = byId("requestContextMenu");
const requestContextDuplicateBtn = byId("requestContextDuplicateBtn");
const requestContextDeleteBtn = byId("requestContextDeleteBtn");
const headerContextMenu = byId("headerContextMenu");
const headerContextDuplicateBtn = byId("headerContextDuplicateBtn");
const headerContextDeleteBtn = byId("headerContextDeleteBtn");
const statusText = byId("statusText");
const errorText = byId("errorText");
const sentHeadersOutput = byId("sentHeadersOutput");
const headersOutput = byId("headersOutput");
const rawJsonMeta = byId("rawJsonMeta");
const copyRawResponseBtn = byId("copyRawResponseBtn");
const rawCollapseBtn = byId("rawCollapseBtn");
const rawExpandBtn = byId("rawExpandBtn");
const rawJsonViewer = byId("rawJsonViewer");
const rawOutput = byId("rawOutput");
const aggregateOutput = byId("aggregateOutput");
const copyAggregateResponseBtn = byId("copyAggregateResponseBtn");
const sseInspector = byId("sseInspector");
const sseLineList = byId("sseLineList");
const ssePayloadMeta = byId("ssePayloadMeta");
const copySseStreamBtn = byId("copySseStreamBtn");
const copySsePayloadBtn = byId("copySsePayloadBtn");
const ssePayloadCollapseBtn = byId("ssePayloadCollapseBtn");
const ssePayloadExpandBtn = byId("ssePayloadExpandBtn");
const ssePayloadJsonViewer = byId("ssePayloadJsonViewer");
const ssePayloadOutput = byId("ssePayloadOutput");
let activeAbortController = null;
let rawAppender;
let plainRawResponseBuffer;
let aggregateAppender;
let aggregationRuntime = null;
let rawResponseMode = "plain";
let requestIsLoading = false;
let environments = [];
let activeEnvironmentId = null;
let environmentRows = [];
let environmentRowsSourceId = null;
let environmentRowsSourceText = "";
let headerRows = [];
let collectionStore = {
    collections: [],
    environments: [],
    active_environment_id: null,
    request_drafts: {},
};
let requestDrafts = {};
let activeCollectionId = null;
let activeSavedRequestId = null;
let requestSearchQuery = "";
let collapsedCollectionIds = new Set();
let requestContextMenuTarget = null;
let headerContextMenuTarget = null;
let draftAutosaveTimer = null;
let collectionStateSaveTimer = null;
let latestSentHeaders = {};
let latestResponseHeaders = {};
let bodyEditorHasJSON = false;
let rawJsonController = null;
let ssePayloadJsonController = null;
let sseLineEntries = [];
let selectedSseLine = null;
let sseLineCounter = 0;
let utilitySidebarCollapsed = normalizeUtilitySidebarCollapsed(document.documentElement.getAttribute("data-utilities-collapsed") === "true");
let utilitySidebarLastPanelId = normalizeActiveUtilityPanelId(document.documentElement.getAttribute("data-active-utility")) ??
    DEFAULT_UTILITY_PANEL_ID;
let utilitySectionsController;
let environmentModalTrigger = null;
let importModalTrigger = null;
const bodyEditorController = createBodyEditor({
    parent: bodyEditor,
    input: bodyInput,
    ariaLabelledBy: "bodyEditorLabel",
    editable: !requestIsLoading,
    undoStorageKey: "apishark.body-editor.undo.v1",
    onStateChange: (event) => {
        syncBodyEditor();
        if (event.reason === "doc" && event.source === "user") {
            markRequestEditorChanged();
        }
    },
});
function wireEvents() {
    environmentSelect.addEventListener("change", () => {
        activeEnvironmentId = environmentSelect.value || null;
        syncEnvironmentEditor();
        renderEnvironmentSummary();
        persistState();
        scheduleCollectionStateSave();
    });
    openEnvironmentModalBtn.addEventListener("click", () => {
        showEnvironmentModal();
    });
    closeEnvironmentModalBtn.addEventListener("click", () => {
        hideEnvironmentModal(true);
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
    addEnvironmentRowBtn.addEventListener("click", () => {
        insertEnvironmentRowAfter(environmentRows[environmentRows.length - 1]?.id ?? null);
    });
    importCurlBtn.addEventListener("click", () => {
        void importCurl();
    });
    openImportModalBtn.addEventListener("click", () => {
        showImportModal();
    });
    openImportModalFromSidebarBtn.addEventListener("click", () => {
        showImportModal();
    });
    closeImportModalBtn.addEventListener("click", () => {
        hideImportModal(true);
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
        hideCurlExport(true);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }
        if (!curlExportOverlay.hidden) {
            hideCurlExport(true);
        }
        if (!environmentOverlay.hidden) {
            hideEnvironmentModal(true);
        }
        if (!importCurlOverlay.hidden) {
            hideImportModal(true);
        }
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
    urlInput.addEventListener("input", () => {
        applyTemplateTone(urlInput, urlInput.value);
    });
    copyBodyBtn.addEventListener("click", () => {
        void copyRequestBody();
    });
    bodyUndoBtn.addEventListener("click", () => {
        undoBodyEdit();
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
    copySseStreamBtn.addEventListener("click", () => {
        void copyRawResponse();
    });
    copySsePayloadBtn.addEventListener("click", () => {
        void copySelectedSsePayload();
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
    requestSearchInput.addEventListener("input", () => {
        requestSearchQuery = requestSearchInput.value;
        renderCollections();
    });
    requestContextDuplicateBtn.addEventListener("click", () => {
        void handleRequestContextDuplicate();
    });
    requestContextDeleteBtn.addEventListener("click", () => {
        void handleRequestContextDelete();
    });
    headerContextDuplicateBtn.addEventListener("click", () => {
        handleHeaderContextDuplicate();
    });
    headerContextDeleteBtn.addEventListener("click", () => {
        handleHeaderContextDelete();
    });
    aggregationPluginInput.addEventListener("change", () => {
        renderEffectiveAggregationPlugin();
    });
    document.addEventListener("click", (event) => {
        if (event.target instanceof Node &&
            !requestContextMenu.hidden &&
            !requestContextMenu.contains(event.target)) {
            hideRequestContextMenu();
        }
        if (event.target instanceof Node &&
            !headerContextMenu.hidden &&
            !headerContextMenu.contains(event.target)) {
            hideHeaderContextMenu();
        }
        if (event.target === environmentOverlay) {
            hideEnvironmentModal();
        }
        if (event.target === importCurlOverlay) {
            hideImportModal();
        }
    });
    window.addEventListener("blur", () => {
        hideRequestContextMenu();
        hideHeaderContextMenu();
    });
    window.addEventListener("resize", () => {
        hideRequestContextMenu();
        hideHeaderContextMenu();
    });
    window.addEventListener("scroll", () => {
        hideRequestContextMenu();
        hideHeaderContextMenu();
    }, true);
    const persistTargets = [
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
function setupTabs() {
    const tabButtons = document.querySelectorAll("[data-tab-group][data-tab-target]");
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
    const buttons = document.querySelectorAll(`[data-tab-group="${group}"]`);
    for (const button of buttons) {
        button.classList.toggle("is-active", button.dataset.tabTarget === targetId);
    }
    const panels = document.querySelectorAll(`[data-tab-panel="${group}"]`);
    for (const panel of panels) {
        panel.classList.toggle("is-active", panel.id === targetId);
    }
}
function defaultState() {
    const defaultEnvironment = createEnvironmentEntry("Default", "OPENAI_API_KEY=\nBASE_URL=https://api.openai.com");
    return {
        sidebarCollapsed: true,
        activeUtilityPanelId: DEFAULT_UTILITY_PANEL_ID,
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
        bodyText: JSON.stringify({
            model: "gpt-4o-mini",
            stream: true,
            messages: [{ role: "user", content: "Write a haiku about sharks." }],
        }, null, 2),
        aggregationPlugin: AGGREGATION_PLUGIN_OPENAI,
        useCollectionAggregationPlugin: false,
        aggregateOpenAISse: true,
        timeoutSeconds: 120,
        requestDrafts: {},
        activeCollectionId: null,
        activeSavedRequestId: null,
        collapsedCollectionIds: [],
    };
}
function applyInitialState(state) {
    setUtilitySidebarCollapsed(state.sidebarCollapsed, state.activeUtilityPanelId);
    requestNameInput.value = state.requestName;
    environments = normalizeEnvironments(state.environments);
    activeEnvironmentId = resolveActiveEnvironmentId(environments, state.activeEnvironmentId);
    curlInput.value = state.curlText;
    methodInput.value = state.method;
    urlInput.value = state.url;
    applyTemplateTone(urlInput, state.url);
    headerRows = normalizeHeaderRows(state.headers);
    setBodyEditorText(state.bodyText);
    renderPluginOptionsIntoSelect(aggregationPluginInput, state.useCollectionAggregationPlugin
        ? REQUEST_AGGREGATION_USE_COLLECTION
        : resolveAggregationPluginId(state.aggregationPlugin, state.aggregateOpenAISse), true);
    timeoutInput.value = String(state.timeoutSeconds);
    requestDrafts = state.requestDrafts;
    activeCollectionId = state.activeCollectionId;
    activeSavedRequestId = state.activeSavedRequestId;
    collapsedCollectionIds = new Set(state.collapsedCollectionIds ?? []);
    renderEnvironmentControls();
    renderEnvironmentSummary();
    renderHeaderRows();
    syncBodyEditor();
    renderDraftStatus();
    renderEffectiveAggregationPlugin();
}
function loadState() {
    const fallback = defaultState();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(raw);
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
            sidebarCollapsed: normalizeUtilitySidebarCollapsed(parsed.sidebarCollapsed),
            activeUtilityPanelId: normalizeActiveUtilityPanelId(parsed.activeUtilityPanelId) ?? fallback.activeUtilityPanelId,
            requestName: typeof parsed.requestName === "string" && parsed.requestName.trim()
                ? parsed.requestName
                : fallback.requestName,
            environments: parsedEnvironments,
            activeEnvironmentId: typeof parsed.activeEnvironmentId === "string"
                ? parsed.activeEnvironmentId
                : resolveActiveEnvironmentId(parsedEnvironments, fallback.activeEnvironmentId),
            curlText: typeof parsed.curlText === "string" ? parsed.curlText : fallback.curlText,
            method: typeof parsed.method === "string" ? parsed.method : fallback.method,
            url: typeof parsed.url === "string" ? parsed.url : fallback.url,
            headers: parsedHeaders,
            bodyText: typeof parsed.bodyText === "string" ? parsed.bodyText : fallback.bodyText,
            aggregationPlugin: typeof parsed.aggregationPlugin === "string"
                ? resolveAggregationPluginId(parsed.aggregationPlugin)
                : resolveAggregationPluginId(undefined, parsed.aggregateOpenAISse === true),
            useCollectionAggregationPlugin: parsed.useCollectionAggregationPlugin === true,
            aggregateOpenAISse: typeof parsed.aggregateOpenAISse === "boolean"
                ? parsed.aggregateOpenAISse
                : fallback.aggregateOpenAISse,
            timeoutSeconds: typeof parsed.timeoutSeconds === "number" && Number.isFinite(parsed.timeoutSeconds)
                ? parsed.timeoutSeconds
                : fallback.timeoutSeconds,
            requestDrafts: normalizePersistedRequestDraftStore(parsed.requestDrafts),
            activeCollectionId: typeof parsed.activeCollectionId === "string" ? parsed.activeCollectionId : null,
            activeSavedRequestId: typeof parsed.activeSavedRequestId === "string" ? parsed.activeSavedRequestId : null,
            collapsedCollectionIds: normalizeCollapsedCollectionIds(parsed.collapsedCollectionIds),
        };
    }
    catch {
        return fallback;
    }
}
function persistState() {
    const state = {
        sidebarCollapsed: utilitySidebarCollapsed,
        activeUtilityPanelId: utilitySidebarLastPanelId,
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
        collapsedCollectionIds: [...collapsedCollectionIds].sort(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function buildCollectionStorePayload() {
    return {
        collections: cloneCollectionStore(collectionStore).collections,
        environments: environments.map((environment) => ({ ...environment })),
        active_environment_id: activeEnvironmentId,
        request_drafts: serializePersistedRequestDraftStore(requestDrafts),
    };
}
function scheduleCollectionStateSave() {
    if (collectionStateSaveTimer !== null) {
        window.clearTimeout(collectionStateSaveTimer);
    }
    collectionStateSaveTimer = window.setTimeout(() => {
        collectionStateSaveTimer = null;
        void saveCollectionStateToServer();
    }, COLLECTION_STATE_SAVE_DELAY_MS);
}
async function saveCollectionStateToServer() {
    try {
        const response = await fetch("/api/collections", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildCollectionStorePayload()),
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(responseText || `Save failed (${response.status})`);
        }
        collectionStore = normalizeCollectionStore(JSON.parse(responseText));
    }
    catch (error) {
        setCollectionsStatus(errorMessage(error, "Failed to save collections."), true);
    }
}
function setUtilitySidebarCollapsed(collapsed, panelId) {
    const normalizedPanelId = normalizeActiveUtilityPanelId(panelId) ?? DEFAULT_UTILITY_PANEL_ID;
    utilitySidebarCollapsed = collapsed;
    utilitySidebarLastPanelId = normalizedPanelId;
    utilitySectionsController.setActivePanel(collapsed ? null : normalizedPanelId);
    document.documentElement.setAttribute("data-active-utility", utilitySidebarLastPanelId);
    applyUtilitySidebarCollapsedState(document.documentElement, utilitySidebarBody, utilitySidebarCollapsed);
    syncPaneResizeHandleState();
}
function handleUtilitySectionToggle(panelId) {
    if (panelId) {
        setUtilitySidebarCollapsed(false, panelId);
    }
    else {
        setUtilitySidebarCollapsed(true, utilitySidebarLastPanelId);
    }
    persistState();
}
function normalizeActiveUtilityPanelId(value) {
    return typeof value === "string" && VALID_UTILITY_PANEL_IDS.has(value) ? value : null;
}
function loadPaneLayoutState() {
    const fallback = {};
    const raw = localStorage.getItem(PANE_LAYOUT_STORAGE_KEY);
    if (!raw) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(raw);
        return {
            sidebarWidth: typeof parsed.sidebarWidth === "number" && Number.isFinite(parsed.sidebarWidth)
                ? parsed.sidebarWidth
                : undefined,
            sidebarRailWidth: typeof parsed.sidebarRailWidth === "number" && Number.isFinite(parsed.sidebarRailWidth)
                ? parsed.sidebarRailWidth
                : undefined,
            libraryWidth: typeof parsed.libraryWidth === "number" && Number.isFinite(parsed.libraryWidth)
                ? parsed.libraryWidth
                : undefined,
        };
    }
    catch {
        return fallback;
    }
}
function applyPaneLayoutState(state) {
    if (typeof state.sidebarWidth === "number") {
        document.documentElement.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
    }
    if (typeof state.sidebarRailWidth === "number") {
        document.documentElement.style.setProperty("--sidebar-rail-width", `${state.sidebarRailWidth}px`);
    }
    if (typeof state.libraryWidth === "number") {
        document.documentElement.style.setProperty("--library-width", `${state.libraryWidth}px`);
    }
}
function persistPaneLayoutState() {
    const rootStyle = getComputedStyle(document.documentElement);
    const state = {
        sidebarWidth: parseFloat(rootStyle.getPropertyValue("--sidebar-width")),
        sidebarRailWidth: parseFloat(rootStyle.getPropertyValue("--sidebar-rail-width")),
        libraryWidth: parseFloat(rootStyle.getPropertyValue("--library-width")),
    };
    localStorage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify(state));
}
function syncPaneResizeHandleState() {
    const isCompact = window.innerWidth <= 1120;
    const sidebarDisabled = isCompact;
    const libraryDisabled = isCompact;
    sidebarResizeHandle.classList.toggle("is-disabled", sidebarDisabled);
    libraryResizeHandle.classList.toggle("is-disabled", libraryDisabled);
    sidebarResizeHandle.setAttribute("aria-disabled", sidebarDisabled ? "true" : "false");
    libraryResizeHandle.setAttribute("aria-disabled", libraryDisabled ? "true" : "false");
}
function setupPaneResizeHandles() {
    const setup = (handle, type) => {
        handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || window.innerWidth <= 1120) {
                return;
            }
            event.preventDefault();
            handle.classList.add("is-dragging");
            document.body.classList.add("is-resizing");
            handle.setPointerCapture(event.pointerId);
            const onPointerMove = (moveEvent) => {
                const shellBounds = pmShell.getBoundingClientRect();
                if (type === "sidebar") {
                    const visibleWidth = moveEvent.clientX - shellBounds.left;
                    if (utilitySidebarCollapsed) {
                        document.documentElement.style.setProperty("--sidebar-rail-width", `${clamp(visibleWidth, 64, 118)}px`);
                    }
                    else {
                        document.documentElement.style.setProperty("--sidebar-width", `${clamp(visibleWidth, 248, 520)}px`);
                    }
                }
                else {
                    const width = shellBounds.right - moveEvent.clientX;
                    document.documentElement.style.setProperty("--library-width", `${clamp(width, 240, 540)}px`);
                }
            };
            const finish = () => {
                handle.classList.remove("is-dragging");
                document.body.classList.remove("is-resizing");
                handle.removeEventListener("pointermove", onPointerMove);
                handle.removeEventListener("pointerup", finish);
                handle.removeEventListener("pointercancel", finish);
                persistPaneLayoutState();
            };
            handle.addEventListener("pointermove", onPointerMove);
            handle.addEventListener("pointerup", finish);
            handle.addEventListener("pointercancel", finish);
        });
    };
    setup(sidebarResizeHandle, "sidebar");
    setup(libraryResizeHandle, "library");
    syncPaneResizeHandleState();
    window.addEventListener("resize", syncPaneResizeHandleState);
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function markRequestEditorChanged() {
    persistState();
    scheduleDraftAutosave();
}
function scheduleDraftAutosave() {
    if (draftAutosaveTimer !== null) {
        window.clearTimeout(draftAutosaveTimer);
    }
    draftAutosaveTimer = window.setTimeout(() => {
        draftAutosaveTimer = null;
        persistCurrentRequestDraft();
    }, DRAFT_AUTOSAVE_DELAY_MS);
}
function flushDraftAutosave() {
    if (draftAutosaveTimer === null) {
        return;
    }
    window.clearTimeout(draftAutosaveTimer);
    draftAutosaveTimer = null;
    persistCurrentRequestDraft();
}
function currentRequestDraftScope() {
    return {
        collectionId: activeCollectionId,
        requestId: activeSavedRequestId,
    };
}
function persistCurrentRequestDraft() {
    const scope = currentRequestDraftScope();
    const currentDraft = getCurrentSavedRequestDraft();
    const savedRequest = findSavedRequest(scope.collectionId, scope.requestId);
    const canonicalDraft = savedRequest ? savedRequestToDraft(savedRequest) : null;
    requestDrafts = canonicalDraft && requestLibraryDraftsEqual(currentDraft, canonicalDraft)
        ? deletePersistedRequestDraft(requestDrafts, scope)
        : setPersistedRequestDraft(requestDrafts, { scope, draft: currentDraft });
    persistState();
    renderDraftStatus();
    scheduleCollectionStateSave();
}
function clearPersistedRequestDraft(scope) {
    const next = deletePersistedRequestDraft(requestDrafts, scope);
    if (next === requestDrafts) {
        return;
    }
    requestDrafts = next;
    renderDraftStatus();
    persistState();
    scheduleCollectionStateSave();
}
function restoreDraftForCurrentSelection(fallbackDraft) {
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
function applyEditorDraft(draft) {
    requestNameInput.value = draft.name;
    methodInput.value = draft.method || "GET";
    urlInput.value = draft.url;
    applyTemplateTone(urlInput, draft.url);
    setBodyEditorText(draft.body);
    aggregationPluginInput.value = resolveAggregationPluginId(draft.aggregation_plugin, draft.aggregate_openai_sse);
    timeoutInput.value = String(draft.timeout_seconds || 120);
    headerRows = normalizeHeaderRows(draft.headers);
    renderHeaderRows();
    syncBodyEditor();
}
function renderDraftStatus() {
    const hasDraft = getPersistedRequestDraft(requestDrafts, currentRequestDraftScope()) !== null;
    draftStatusText.textContent = hasDraft ? "Draft saved" : "";
}
function prunePersistedDrafts() {
    const next = prunePersistedRequestDraftStore(requestDrafts, {
        collectionIds: collectionStore.collections.map((collection) => collection.id),
        requestIds: collectionStore.collections.flatMap((collection) => collection.requests.map((request) => request.id)),
    });
    if (next === requestDrafts) {
        return false;
    }
    requestDrafts = next;
    return true;
}
function renderEnvironmentControls() {
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
    renderEnvironmentSummary();
}
function syncEnvironmentEditor() {
    const activeEnvironment = getActiveEnvironment();
    const activeText = activeEnvironment?.text ?? "";
    if (environmentRowsSourceId !== activeEnvironment?.id || environmentRowsSourceText !== activeText) {
        environmentRows = parseEnvironmentRows(activeText);
        environmentRowsSourceId = activeEnvironment?.id ?? null;
        environmentRowsSourceText = activeText;
    }
    renderEnvironmentRows();
    environmentSelect.disabled = requestIsLoading || environments.length === 0;
    addEnvironmentRowBtn.disabled = requestIsLoading || !activeEnvironment;
    createEnvironmentBtn.disabled = requestIsLoading;
    renameEnvironmentBtn.disabled = requestIsLoading || !activeEnvironment;
    deleteEnvironmentBtn.disabled = requestIsLoading || environments.length <= 1 || !activeEnvironment;
}
function renderEnvironmentSummary() {
    const activeEnvironment = getActiveEnvironment();
    if (!activeEnvironment) {
        environmentSummaryText.textContent = "No active environment.";
        return;
    }
    const variableCount = parseEnvironmentRows(activeEnvironment.text).filter((row) => row.key.trim() !== "" || row.value.trim() !== "").length;
    environmentSummaryText.textContent = `${activeEnvironment.name} • ${variableCount} variable${variableCount === 1 ? "" : "s"}`;
}
function getActiveEnvironment() {
    if (!activeEnvironmentId) {
        return null;
    }
    return environments.find((environment) => environment.id === activeEnvironmentId) ?? null;
}
function patchActiveEnvironment(patch) {
    const activeEnvironment = getActiveEnvironment();
    if (!activeEnvironment) {
        return;
    }
    environments = environments.map((environment) => {
        if (environment.id !== activeEnvironment.id) {
            return environment;
        }
        const next = { ...environment, ...patch };
        if (next.id === activeEnvironment.id && typeof next.text === "string") {
            environmentRowsSourceId = next.id;
            environmentRowsSourceText = next.text;
        }
        return next;
    });
    renderEnvironmentSummary();
    persistState();
    scheduleCollectionStateSave();
}
function createEnvironment() {
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
    scheduleCollectionStateSave();
}
function renameActiveEnvironment() {
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
function deleteActiveEnvironment() {
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
    scheduleCollectionStateSave();
}
function nextEnvironmentName() {
    const usedNames = new Set(environments.map((environment) => environment.name));
    let index = environments.length + 1;
    let candidate = `Environment ${index}`;
    while (usedNames.has(candidate)) {
        index += 1;
        candidate = `Environment ${index}`;
    }
    return candidate;
}
function normalizeEnvironments(rows) {
    const normalized = rows.map((environment, index) => {
        const typed = environment;
        const name = typeof typed.name === "string" && typed.name.trim()
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
function resolveActiveEnvironmentId(rows, preferredId) {
    if (preferredId && rows.some((environment) => environment.id === preferredId)) {
        return preferredId;
    }
    return rows[0]?.id ?? null;
}
function renderHeaderRows() {
    hideHeaderContextMenu();
    if (headerRows.length === 0) {
        headerRows = [createEmptyHeaderRow()];
    }
    const fragment = document.createDocumentFragment();
    for (const header of headerRows) {
        const row = document.createElement("div");
        row.className = `header-row${header.enabled ? "" : " is-disabled"}`;
        row.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            showHeaderContextMenu(event.clientX, event.clientY, header.id);
        });
        const toggleLabel = document.createElement("label");
        toggleLabel.className = "header-toggle header-cell";
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
        applyTemplateTone(keyInput, header.key);
        keyInput.addEventListener("input", () => {
            patchHeaderRow(header.id, { key: keyInput.value });
            applyTemplateTone(keyInput, keyInput.value);
        });
        const keyCell = document.createElement("div");
        keyCell.className = "header-input-cell header-cell";
        keyCell.appendChild(keyInput);
        const valueInput = document.createElement("input");
        valueInput.className = "header-value-input";
        valueInput.type = "text";
        valueInput.placeholder = "Header value";
        valueInput.value = header.value;
        valueInput.disabled = requestIsLoading;
        applyTemplateTone(valueInput, header.value);
        valueInput.addEventListener("input", () => {
            patchHeaderRow(header.id, { value: valueInput.value });
            applyTemplateTone(valueInput, valueInput.value);
        });
        const valueCell = document.createElement("div");
        valueCell.className = "header-input-cell header-cell";
        valueCell.appendChild(valueInput);
        row.append(toggleLabel, keyCell, valueCell);
        fragment.appendChild(row);
    }
    headersEditor.textContent = "";
    headersEditor.appendChild(fragment);
}
function renderEnvironmentRows() {
    if (environmentRows.length === 0) {
        environmentRows = [createEmptyEnvironmentRow()];
    }
    const fragment = document.createDocumentFragment();
    for (const rowState of environmentRows) {
        const row = document.createElement("div");
        row.className = "env-row";
        const keyInput = document.createElement("input");
        keyInput.className = "env-key-input";
        keyInput.type = "text";
        keyInput.placeholder = "Variable name";
        keyInput.value = rowState.key;
        keyInput.disabled = requestIsLoading;
        applyTemplateTone(keyInput, rowState.key);
        keyInput.addEventListener("input", () => {
            patchEnvironmentRow(rowState.id, { key: keyInput.value });
            applyTemplateTone(keyInput, keyInput.value);
        });
        const keyCell = document.createElement("div");
        keyCell.className = "header-input-cell env-cell";
        keyCell.appendChild(keyInput);
        const valueInput = document.createElement("input");
        valueInput.className = "env-value-input";
        valueInput.type = "text";
        valueInput.placeholder = "Value";
        valueInput.value = rowState.value;
        valueInput.disabled = requestIsLoading;
        applyTemplateTone(valueInput, rowState.value);
        valueInput.addEventListener("input", () => {
            patchEnvironmentRow(rowState.id, { value: valueInput.value });
            applyTemplateTone(valueInput, valueInput.value);
        });
        const valueCell = document.createElement("div");
        valueCell.className = "header-input-cell env-cell";
        valueCell.appendChild(valueInput);
        const actions = document.createElement("div");
        actions.className = "env-row-actions env-cell";
        actions.append(createHeaderActionButton("＋", "Insert variable below", () => insertEnvironmentRowAfter(rowState.id), requestIsLoading), createHeaderActionButton("⎘", "Duplicate variable", () => duplicateEnvironmentRow(rowState.id), requestIsLoading), createHeaderActionButton("✕", "Delete variable", () => removeEnvironmentRow(rowState.id), requestIsLoading, true));
        row.append(keyCell, valueCell, actions);
        fragment.appendChild(row);
    }
    envEditor.textContent = "";
    envEditor.appendChild(fragment);
}
function createHeaderActionButton(symbol, label, onClick, disabled, danger = false) {
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
function applyTemplateTone(element, text) {
    const hasEnvTemplate = ENV_TEMPLATE_PATTERN.test(text);
    const hasDynamicTemplate = DYNAMIC_TEMPLATE_PATTERN.test(text);
    element.classList.toggle("has-template", hasEnvTemplate || hasDynamicTemplate);
    element.classList.toggle("has-env-template", hasEnvTemplate);
    element.classList.toggle("has-dynamic-template", hasDynamicTemplate);
}
function createEnvironmentRow(key, value) {
    return {
        id: makeId("envrow"),
        key,
        value,
    };
}
function createEmptyEnvironmentRow() {
    return createEnvironmentRow("", "");
}
function parseEnvironmentRows(text) {
    const rows = text
        .split(/\r?\n/)
        .filter((line, index, all) => line.trim() !== "" || all.length === 1)
        .map((line) => {
        const splitIndex = line.indexOf("=");
        if (splitIndex < 0) {
            return createEnvironmentRow(line.trim(), "");
        }
        return createEnvironmentRow(line.slice(0, splitIndex).trim(), line.slice(splitIndex + 1));
    });
    return rows.length > 0 ? rows : [createEmptyEnvironmentRow()];
}
function serializeEnvironmentRows(rows) {
    return rows
        .map((row) => [row.key.trim(), row.value])
        .filter(([key, value]) => key !== "" || value.trim() !== "")
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
}
function patchEnvironmentRow(id, patch) {
    environmentRows = environmentRows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    patchActiveEnvironment({ text: serializeEnvironmentRows(environmentRows) });
}
function insertEnvironmentRowAfter(id) {
    if (id === null) {
        environmentRows = [...environmentRows, createEmptyEnvironmentRow()];
    }
    else {
        const index = environmentRows.findIndex((row) => row.id === id);
        if (index < 0) {
            environmentRows = [...environmentRows, createEmptyEnvironmentRow()];
        }
        else {
            const next = [...environmentRows];
            next.splice(index + 1, 0, createEmptyEnvironmentRow());
            environmentRows = next;
        }
    }
    renderEnvironmentRows();
    patchActiveEnvironment({ text: serializeEnvironmentRows(environmentRows) });
}
function duplicateEnvironmentRow(id) {
    const index = environmentRows.findIndex((row) => row.id === id);
    if (index < 0) {
        return;
    }
    const source = environmentRows[index];
    const duplicate = createEnvironmentRow(source.key, source.value);
    const next = [...environmentRows];
    next.splice(index + 1, 0, duplicate);
    environmentRows = next;
    renderEnvironmentRows();
    patchActiveEnvironment({ text: serializeEnvironmentRows(environmentRows) });
}
function removeEnvironmentRow(id) {
    environmentRows =
        environmentRows.length === 1
            ? [createEmptyEnvironmentRow()]
            : environmentRows.filter((row) => row.id !== id);
    renderEnvironmentRows();
    patchActiveEnvironment({ text: serializeEnvironmentRows(environmentRows) });
}
function updateHeaderRow(id, patch) {
    headerRows = headerRows.map((header) => (header.id === id ? { ...header, ...patch } : header));
    renderHeaderRows();
    markRequestEditorChanged();
}
function patchHeaderRow(id, patch) {
    headerRows = headerRows.map((header) => (header.id === id ? { ...header, ...patch } : header));
    markRequestEditorChanged();
}
function insertHeaderAfter(id) {
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
function duplicateHeader(id) {
    const index = headerRows.findIndex((header) => header.id === id);
    if (index < 0) {
        return;
    }
    const source = headerRows[index];
    const duplicate = {
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
function removeHeader(id) {
    if (headerRows.length === 1) {
        headerRows = [createEmptyHeaderRow()];
    }
    else {
        headerRows = headerRows.filter((header) => header.id !== id);
    }
    renderHeaderRows();
    markRequestEditorChanged();
}
function syncBodyEditor() {
    const result = bodyEditorController.getSnapshot();
    bodyEditorHasJSON = result.hasJSON;
    bodyEditorShell.classList.toggle("has-json", result.hasJSON);
    bodyEditorShell.classList.toggle("is-collapsed", result.hasFoldedBlocks);
    syncBodyEditorBanner(result);
    bodyEditor.setAttribute("aria-disabled", requestIsLoading ? "true" : "false");
    bodyUndoBtn.disabled = requestIsLoading || !bodyEditorController.canUndo();
    bodyCollapseBtn.disabled = !result.hasJSON || requestIsLoading || result.foldableBlockCount === 0 || result.isFullyCollapsed;
    bodyExpandBtn.disabled = !result.hasJSON || requestIsLoading || !result.hasFoldedBlocks;
}
function syncBodyEditorBanner(result) {
    if (result.syntaxError) {
        bodyEditorShell.dataset.mode = "json-invalid";
        bodyEditorModeBadge.textContent = "JSON error";
        bodyEditorHint.textContent = `Invalid JSON at line ${result.syntaxError.line}, column ${result.syntaxError.column}: ${result.syntaxError.message}`;
        return;
    }
    if (!result.hasJSON) {
        bodyEditorShell.dataset.mode = "plain";
        bodyEditorModeBadge.textContent = "Plain text";
        bodyEditorHint.textContent = bodyInput.value.trim()
            ? "Valid JSON unlocks folding and prettify helpers."
            : "Paste valid JSON to enable folding.";
        return;
    }
    if (result.hasFoldedBlocks) {
        bodyEditorShell.dataset.mode = "json-collapsed";
        bodyEditorModeBadge.textContent = "JSON folded";
        bodyEditorHint.textContent = requestIsLoading
            ? "Request is running. Folding is preserved while editing is temporarily disabled."
            : "Use gutter toggles for per-block folding, or Expand to open every JSON block.";
        return;
    }
    bodyEditorShell.dataset.mode = "json-expanded";
    bodyEditorModeBadge.textContent = "Editing JSON";
    bodyEditorHint.textContent = requestIsLoading
        ? "Request is running. Editing is temporarily disabled."
        : "Use gutter toggles for nested JSON, Collapse to fold all, or Prettify to normalize formatting.";
}
function focusBodyEditor(selectAll = false) {
    if (requestIsLoading) {
        return;
    }
    bodyEditorController.focus(selectAll);
}
function setBodyEditorText(text) {
    bodyEditorController.setText(text);
    syncBodyEditor();
}
function undoBodyEdit() {
    if (requestIsLoading) {
        return;
    }
    if (!bodyEditorController.undo()) {
        return;
    }
    syncBodyEditor();
    markRequestEditorChanged();
}
function collapseBodyJSON() {
    if (!bodyEditorHasJSON || requestIsLoading) {
        return;
    }
    bodyEditorController.collapseAll();
}
function expandBodyJSON() {
    bodyEditorController.expandAll();
}
function prettifyBodyJSON() {
    const pretty = bodyEditorController.prettify();
    if (!pretty) {
        setError("Request body is not valid JSON.");
        return;
    }
    setError("");
    markRequestEditorChanged();
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
            body: JSON.stringify({ curl }),
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(responseText || `Import failed (${response.status})`);
        }
        const parsed = JSON.parse(responseText);
        flushDraftAutosave();
        methodInput.value = parsed.method || "GET";
        urlInput.value = parsed.url || "";
        applyTemplateTone(urlInput, urlInput.value);
        headerRows = normalizeHeaderRows((parsed.headers || []).map((header) => ({ ...header, enabled: true })));
        setBodyEditorText(parsed.body || "");
        activeSavedRequestId = null;
        renderHeaderRows();
        syncBodyEditor();
        persistState();
        persistCurrentRequestDraft();
        renderCollections();
        renderEffectiveAggregationPlugin();
        hideImportModal();
        setCollectionsStatus(activeCollectionId
            ? `Imported cURL into an unsaved request in "${findCollection(activeCollectionId)?.name ?? "the selected collection"}".`
            : "Imported cURL into the workspace scratch request.");
    }
    catch (error) {
        setError(errorMessage(error, "Failed to import curl command."));
    }
    finally {
        setLoading(false);
    }
}
async function importPlugin() {
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
    }
    catch (error) {
        setPluginsStatus(errorMessage(error, "Failed to import plugin."), true);
    }
}
async function loadPlugins(options) {
    if (!options?.successMessage) {
        setPluginsStatus("Loading plugins...");
    }
    try {
        const response = await fetch("/api/plugins");
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(responseText || `Load failed (${response.status})`);
        }
        const parsed = JSON.parse(responseText);
        const manifests = Array.isArray(parsed.plugins) ? parsed.plugins : [];
        setImportedAggregationPluginManifests(manifests.map((plugin) => ({
            id: resolveAggregationPluginId(plugin.id),
            label: typeof plugin.label === "string" ? plugin.label : resolveAggregationPluginId(plugin.id),
            description: typeof plugin.description === "string" ? plugin.description : "",
            module_url: typeof plugin.module_url === "string" ? plugin.module_url : "",
            imported_at: typeof plugin.imported_at === "string" ? plugin.imported_at : "",
            format: plugin.format === "json" ? "json" : "js",
        })));
        renderImportedPlugins();
        renderAggregationPluginControls();
        renderCollections();
        renderEffectiveAggregationPlugin();
        setPluginsStatus(options?.successMessage ??
            (getImportedAggregationPluginManifests().length === 0
                ? 'Imported plugins are stored in "./.apishark/plugins.json".'
                : `Loaded ${getImportedAggregationPluginManifests().length} imported plugin${getImportedAggregationPluginManifests().length === 1 ? "" : "s"}.`));
    }
    catch (error) {
        renderImportedPlugins();
        renderAggregationPluginControls();
        renderCollections();
        renderEffectiveAggregationPlugin();
        setPluginsStatus(errorMessage(error, "Failed to load plugins."), true);
    }
}
function renderImportedPlugins() {
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
function renderAggregationPluginControls() {
    const currentValue = aggregationPluginInput.value || AGGREGATION_PLUGIN_OPENAI;
    renderPluginOptionsIntoSelect(aggregationPluginInput, currentValue, true);
}
function renderPluginOptionsIntoSelect(select, selectedValue, includeCollectionDefault = false) {
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
    const normalizedSelected = selectedValue === REQUEST_AGGREGATION_USE_COLLECTION
        ? REQUEST_AGGREGATION_USE_COLLECTION
        : resolveAggregationPluginId(selectedValue);
    const shouldAddMissingOption = normalizedSelected !== REQUEST_AGGREGATION_USE_COLLECTION &&
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
function selectedRequestUsesCollectionPlugin() {
    return aggregationPluginInput.value === REQUEST_AGGREGATION_USE_COLLECTION;
}
function selectedRequestAggregationPluginOverride() {
    return selectedRequestUsesCollectionPlugin()
        ? AGGREGATION_PLUGIN_NONE
        : resolveAggregationPluginId(aggregationPluginInput.value);
}
function selectedEffectiveAggregationPlugin() {
    return resolveEffectiveAggregationPlugin({
        requestPlugin: selectedRequestAggregationPluginOverride(),
        useCollectionPlugin: selectedRequestUsesCollectionPlugin(),
        collectionPlugin: findCollection(activeCollectionId)?.aggregation_plugin,
    });
}
function renderEffectiveAggregationPlugin() {
    const effective = selectedEffectiveAggregationPlugin();
    const activeCollection = findCollection(activeCollectionId);
    if (selectedRequestUsesCollectionPlugin()) {
        if (!activeCollection) {
            effectiveAggregationText.textContent = "Effective: None. No collection is selected.";
            return;
        }
        const suffix = effective.pluginId !== AGGREGATION_PLUGIN_NONE && !hasAggregationPlugin(effective.pluginId)
            ? " Missing plugin; raw output will still work."
            : "";
        effectiveAggregationText.textContent = `Effective: ${effective.label} via collection "${activeCollection.name}".${suffix}`;
        return;
    }
    const suffix = effective.pluginId !== AGGREGATION_PLUGIN_NONE && !hasAggregationPlugin(effective.pluginId)
        ? " Missing plugin; raw output will still work."
        : "";
    effectiveAggregationText.textContent = `Effective: ${effective.label} via request override.${suffix}`;
}
async function prepareAggregationRuntime() {
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
    }
    catch (error) {
        setError(`${errorMessage(error, "Failed to load aggregation plugin.")} Falling back to raw output.`);
        return {
            pluginId: AGGREGATION_PLUGIN_NONE,
            runtime: new ResponseAggregationRuntime(AGGREGATION_PLUGIN_NONE),
        };
    }
}
function setPluginsStatus(message, isError = false) {
    pluginsStatusText.textContent = message;
    pluginsStatusText.classList.toggle("error", isError);
}
async function exportCurl() {
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
    }
    catch (error) {
        setError(errorMessage(error, "Failed to export cURL command."));
    }
}
async function copyExportedCurl() {
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
async function copyRequestBody() {
    const body = bodyInput.value;
    if (!body) {
        setError("Request body is empty.");
        return;
    }
    if (await writeClipboardText(body)) {
        setSuccess("Request body copied to clipboard.");
        return;
    }
    focusBodyEditor(true);
    setError("Clipboard copy failed. Select the body text and copy it manually.");
}
async function copyRawResponse() {
    const text = snapshotRawResponseText();
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
async function copyAggregateResponse() {
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
async function copySelectedSsePayload() {
    const text = selectedSseLine?.payloadText ?? "";
    if (!text) {
        setError("Select an SSE line first.");
        return;
    }
    if (await writeClipboardText(text)) {
        setSuccess(`Copied payload from line ${selectedSseLine?.index}.`);
        return;
    }
    if (selectedSseLine?.isJSON) {
        setError("Clipboard copy failed. Use the JSON payload view to copy it manually.");
        return;
    }
    ssePayloadOutput.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(ssePayloadOutput);
    selection?.addRange(range);
    setError("Clipboard copy failed. Select the payload text and copy it manually.");
}
function snapshotRawResponseText() {
    if (rawResponseMode !== "sse") {
        return plainRawResponseBuffer.snapshotText();
    }
    return sseLineEntries.map((entry) => entry.rawLine).join("\n");
}
async function sendRequest() {
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
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            setError("Request aborted.");
        }
        else {
            setError(errorMessage(error, "Failed to send request."));
        }
    }
    finally {
        activeAbortController = null;
        finalizeResponseViews();
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
        buffer = consumeBufferedFrames(buffer);
    }
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    buffer = consumeBufferedFrames(buffer);
    if (buffer.trim()) {
        consumeFrame(buffer);
    }
}
function consumeBufferedFrames(buffer) {
    let frameIndex = buffer.indexOf("\n\n");
    while (frameIndex >= 0) {
        const frame = buffer.slice(0, frameIndex);
        buffer = buffer.slice(frameIndex + 2);
        consumeFrame(frame);
        frameIndex = buffer.indexOf("\n\n");
    }
    return buffer;
}
function consumeFrame(frame) {
    const dataParts = [];
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
        const event = JSON.parse(payload);
        consumeEvent(event);
    }
    catch {
        if (rawResponseMode === "sse") {
            appendSseLine(payload);
        }
        else {
            appendPlainRawText(`${payload}\n`);
        }
    }
}
function consumeEvent(event) {
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
function consumeRawEvent(event) {
    rawOutput.classList.remove("is-hidden");
    rawJsonViewer.classList.add("is-hidden");
    if (event.transport.mode === "sse") {
        if (event.rawChunk) {
            appendSseLine(event.rawChunk);
        }
    }
    else if (event.rawChunk) {
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
function finalizeAggregationRuntime() {
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
function applyAggregationRuntimeResult(result) {
    if ("replaceFragments" in result) {
        aggregateAppender.setFragments(result.replaceFragments ?? []);
        return;
    }
    if (result.appendFragments && result.appendFragments.length > 0) {
        aggregateAppender.enqueueFragments(result.appendFragments);
    }
}
function handleAggregationFailure(message) {
    aggregationRuntime = null;
    aggregateAppender.clear();
    setError(message);
}
function finalizeResponseViews() {
    renderSentHeaders(latestSentHeaders);
    renderResponseHeaders(latestResponseHeaders);
    if (rawResponseMode === "plain") {
        const rawText = plainRawResponseBuffer.snapshotText();
        rawOutput.textContent = rawText;
        renderRawJSONIfPossible(rawText);
    }
}
function clearOutputs() {
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
function setRawResponseMode(mode) {
    rawResponseMode = mode;
    const sseMode = mode === "sse";
    sseInspector.classList.toggle("is-visible", sseMode);
    rawOutput.classList.toggle("is-hidden", sseMode);
    rawJsonViewer.classList.toggle("is-hidden", true);
    rawCollapseBtn.disabled = true;
    rawExpandBtn.disabled = true;
}
function appendPlainRawText(text) {
    if (!text) {
        return;
    }
    plainRawResponseBuffer.append(text);
    rawAppender.enqueue(text);
}
function renderRawJSONIfPossible(text) {
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
function renderResponseHeaders(headers) {
    renderHeaderMap(headersOutput, headers);
}
function renderSentHeaders(headers) {
    renderHeaderMap(sentHeadersOutput, headers);
}
function renderHeaderMap(element, headers) {
    if (Object.keys(headers).length === 0) {
        element.textContent = "";
        return;
    }
    renderJSONValue(element, headers, { expandDepth: 1 });
}
function clearSseInspector() {
    sseLineEntries = [];
    selectedSseLine = null;
    sseLineCounter = 0;
    sseLineList.textContent = "";
    ssePayloadMeta.textContent = "Click a line to inspect payload.";
    copySsePayloadBtn.disabled = true;
    ssePayloadOutput.textContent = "";
    ssePayloadJsonViewer.textContent = "";
    ssePayloadJsonViewer.classList.add("is-hidden");
    ssePayloadOutput.classList.remove("is-hidden");
    ssePayloadCollapseBtn.disabled = true;
    ssePayloadExpandBtn.disabled = true;
}
function appendSseLine(rawLine) {
    const index = ++sseLineCounter;
    const payloadText = extractPayloadText(rawLine);
    const isJSON = prettifyJSONText(payloadText) !== null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sse-line-btn";
    button.title = rawLine;
    button.textContent = `${index}. ${summarizeLineForButton(rawLine, payloadText)}`;
    const entry = {
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
    copySsePayloadBtn.disabled = false;
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
function parseLegacyHeadersText(text) {
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
        headers.push(createHeaderRow(trimmed.slice(0, splitAt).trim(), trimmed.slice(splitAt + 1).trim(), true));
    }
    return headers;
}
function normalizeHeaderRows(rows) {
    const normalized = rows
        .map((row) => {
        const typed = row;
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
function createEnvironmentEntry(name, text) {
    return {
        id: makeId("env"),
        name,
        text,
    };
}
function createHeaderRow(key, value, enabled) {
    return {
        id: makeId("hdr"),
        key,
        value,
        enabled,
    };
}
function createEmptyHeaderRow() {
    return createHeaderRow("", "", true);
}
async function loadCollections() {
    setCollectionsStatus("Loading collections...");
    try {
        const response = await fetch("/api/collections");
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(responseText || `Load failed (${response.status})`);
        }
        const parsed = normalizeCollectionStore(JSON.parse(responseText));
        collectionStore = parsed;
        const hadServerEnvironments = parsed.environments.length > 0;
        const hadServerRequestDrafts = Object.keys(parsed.request_drafts).length > 0;
        environments = normalizeEnvironments(hadServerEnvironments ? parsed.environments : environments);
        activeEnvironmentId = resolveActiveEnvironmentId(environments, hadServerEnvironments ? parsed.active_environment_id : activeEnvironmentId);
        requestDrafts = hadServerRequestDrafts ? parsed.request_drafts : requestDrafts;
        const prunedDrafts = prunePersistedDrafts();
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
        restoreDraftForCurrentSelection(activeSavedRequest ? savedRequestToDraft(activeSavedRequest) : undefined);
        renderEnvironmentControls();
        renderCollections();
        renderEffectiveAggregationPlugin();
        persistState();
        if (!hadServerEnvironments || !hadServerRequestDrafts || prunedDrafts) {
            scheduleCollectionStateSave();
        }
        setCollectionsStatus(parsed.collections.length === 0
            ? "Collections are stored in ./collections.json."
            : `Loaded ${parsed.collections.length} collection${parsed.collections.length === 1 ? "" : "s"}.`);
    }
    catch (error) {
        renderCollections();
        setCollectionsStatus(errorMessage(error, "Failed to load collections."), true);
    }
}
async function createCollection() {
    const name = newCollectionNameInput.value.trim();
    if (!name) {
        setCollectionsStatus("Enter a collection name first.", true);
        return;
    }
    flushDraftAutosave();
    const previous = cloneCollectionStore(collectionStore);
    const nextCollection = {
        id: makeId("col"),
        name,
        aggregation_plugin: AGGREGATION_PLUGIN_NONE,
        requests: [],
    };
    collectionStore = {
        ...collectionStore,
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
async function saveCurrentRequestToCollection() {
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
        ...collectionStore,
        collections: collectionStore.collections.map((item) => {
            if (item.id !== activeCollectionId) {
                return item;
            }
            const existingIndex = item.requests.findIndex((request) => request.id === savedRequest.id);
            const requests = [...item.requests];
            if (existingIndex >= 0) {
                requests[existingIndex] = savedRequest;
            }
            else {
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
async function duplicateCurrentRequest() {
    flushDraftAutosave();
    const currentDraft = getCurrentSavedRequestDraft();
    const targetCollection = findCollection(activeCollectionId);
    const existingNames = targetCollection
        ? targetCollection.requests.map((request) => request.name)
        : collectionStore.collections.flatMap((collection) => collection.requests.map((request) => request.name));
    const duplicateDraft = createDuplicateRequestDraft(currentDraft, existingNames);
    if (!targetCollection || !activeCollectionId) {
        requestNameInput.value = duplicateDraft.name;
        activeSavedRequestId = null;
        renderPluginOptionsIntoSelect(aggregationPluginInput, duplicateDraft.use_collection_aggregation_plugin
            ? REQUEST_AGGREGATION_USE_COLLECTION
            : resolveAggregationPluginId(duplicateDraft.aggregation_plugin), true);
        renderEffectiveAggregationPlugin();
        persistState();
        persistCurrentRequestDraft();
        setCollectionsStatus(`Prepared duplicate "${duplicateDraft.name}". Select a collection and save it to keep both versions.`);
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
        ...collectionStore,
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
    setCollectionsStatus(`Duplicated "${sourceName}" to "${savedRequest.name}" in "${targetCollection.name}".`);
}
async function duplicateSavedRequest(collectionId, requestId) {
    const collection = findCollection(collectionId);
    const sourceRequest = collection?.requests.find((request) => request.id === requestId);
    if (!collection || !sourceRequest) {
        return;
    }
    const duplicateDraft = createDuplicateRequestDraft(savedRequestToDraft(sourceRequest), collection.requests.map((request) => request.name));
    const savedRequest = createSavedRequest({
        id: makeId("req"),
        draft: duplicateDraft,
    });
    const previous = cloneCollectionStore(collectionStore);
    collectionStore = {
        ...collectionStore,
        collections: collectionStore.collections.map((item) => {
            if (item.id !== collectionId) {
                return item;
            }
            return {
                ...item,
                requests: insertSavedRequest(item.requests, savedRequest, requestId),
            };
        }),
    };
    if (!(await saveCollectionsToServer(previous))) {
        return;
    }
    clearPersistedRequestDraft({ collectionId, requestId: savedRequest.id });
    renderCollections();
    persistState();
    setCollectionsStatus(`Duplicated "${sourceRequest.name}" to "${savedRequest.name}" in "${collection.name}".`);
}
function loadSavedRequest(collectionId, requestId) {
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
function loadCollectionScratch(collectionId) {
    const collection = findCollection(collectionId);
    if (!collection) {
        setCollectionsStatus("Collection no longer exists.", true);
        return;
    }
    flushDraftAutosave();
    activeCollectionId = collectionId;
    activeSavedRequestId = null;
    if (!restoreDraftForCurrentSelection()) {
        setCollectionsStatus(`No unsaved request draft exists in "${collection.name}".`, true);
        return;
    }
    renderCollections();
    renderEffectiveAggregationPlugin();
    persistState();
    setCollectionsStatus(`Loaded the unsaved request draft from "${collection.name}".`);
}
function showRequestContextMenu(clientX, clientY, target) {
    hideHeaderContextMenu();
    requestContextMenuTarget = target;
    requestContextDeleteBtn.disabled = false;
    requestContextMenu.hidden = false;
    const { innerWidth, innerHeight } = window;
    const menuWidth = 164;
    const menuHeight = 84;
    const left = Math.max(8, Math.min(clientX, innerWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(clientY, innerHeight - menuHeight - 8));
    requestContextMenu.style.left = `${left}px`;
    requestContextMenu.style.top = `${top}px`;
}
function hideRequestContextMenu() {
    requestContextMenuTarget = null;
    requestContextMenu.hidden = true;
}
async function handleRequestContextDuplicate() {
    const target = requestContextMenuTarget;
    hideRequestContextMenu();
    if (!target) {
        return;
    }
    await duplicateSavedRequest(target.collectionId, target.requestId);
}
async function handleRequestContextDelete() {
    const target = requestContextMenuTarget;
    hideRequestContextMenu();
    if (!target) {
        return;
    }
    await deleteSavedRequest(target.collectionId, target.requestId);
}
function showHeaderContextMenu(clientX, clientY, headerId) {
    hideRequestContextMenu();
    headerContextMenuTarget = { headerId };
    headerContextDeleteBtn.disabled = headerRows.length <= 1;
    headerContextMenu.hidden = false;
    const { innerWidth, innerHeight } = window;
    const menuWidth = 164;
    const menuHeight = 84;
    const left = Math.max(8, Math.min(clientX, innerWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(clientY, innerHeight - menuHeight - 8));
    headerContextMenu.style.left = `${left}px`;
    headerContextMenu.style.top = `${top}px`;
}
function hideHeaderContextMenu() {
    headerContextMenuTarget = null;
    headerContextMenu.hidden = true;
}
function handleHeaderContextDuplicate() {
    const target = headerContextMenuTarget;
    hideHeaderContextMenu();
    if (!target) {
        return;
    }
    duplicateHeader(target.headerId);
}
function handleHeaderContextDelete() {
    const target = headerContextMenuTarget;
    hideHeaderContextMenu();
    if (!target) {
        return;
    }
    removeHeader(target.headerId);
}
function showEnvironmentModal() {
    hideRequestContextMenu();
    hideHeaderContextMenu();
    environmentModalTrigger =
        document.activeElement instanceof HTMLElement ? document.activeElement : openEnvironmentModalBtn;
    environmentOverlay.hidden = false;
    environmentOverlay.setAttribute("aria-hidden", "false");
    window.requestAnimationFrame(() => {
        environmentSelect.focus();
    });
}
function hideEnvironmentModal(restoreFocus = false) {
    environmentOverlay.hidden = true;
    environmentOverlay.setAttribute("aria-hidden", "true");
    if (restoreFocus) {
        (environmentModalTrigger ?? openEnvironmentModalBtn).focus();
    }
    environmentModalTrigger = null;
}
function showImportModal() {
    hideCurlExport();
    hideRequestContextMenu();
    hideHeaderContextMenu();
    importModalTrigger =
        document.activeElement instanceof HTMLElement ? document.activeElement : openImportModalBtn;
    importCurlOverlay.hidden = false;
    importCurlOverlay.setAttribute("aria-hidden", "false");
    openImportModalBtn.setAttribute("aria-expanded", "true");
    window.requestAnimationFrame(() => {
        curlInput.focus();
        curlInput.select();
    });
}
function hideImportModal(restoreFocus = false) {
    importCurlOverlay.hidden = true;
    importCurlOverlay.setAttribute("aria-hidden", "true");
    openImportModalBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
        (importModalTrigger ?? openImportModalBtn).focus();
    }
    importModalTrigger = null;
}
async function deleteCollection(collectionId) {
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
        ...collectionStore,
        collections: collectionStore.collections.filter((item) => item.id !== collectionId),
    };
    if (activeCollectionId === collectionId) {
        activeCollectionId = collectionStore.collections[0]?.id ?? null;
        activeSavedRequestId = null;
    }
    if (!(await saveCollectionsToServer(previous))) {
        return;
    }
    if (prunePersistedDrafts()) {
        scheduleCollectionStateSave();
    }
    restoreDraftForCurrentSelection();
    renderCollections();
    renderEffectiveAggregationPlugin();
    persistState();
    setCollectionsStatus(`Deleted collection "${collection.name}".`);
}
async function deleteSavedRequest(collectionId, requestId) {
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
        ...collectionStore,
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
async function saveCollectionsToServer(previous) {
    try {
        const response = await fetch("/api/collections", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildCollectionStorePayload()),
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(responseText || `Save failed (${response.status})`);
        }
        collectionStore = normalizeCollectionStore(JSON.parse(responseText));
        const prunedDrafts = prunePersistedDrafts();
        if (activeCollectionId && !findCollection(activeCollectionId)) {
            activeCollectionId = collectionStore.collections[0]?.id ?? null;
            activeSavedRequestId = null;
        }
        if (activeSavedRequestId && !findSavedRequest(activeCollectionId, activeSavedRequestId)) {
            activeSavedRequestId = null;
        }
        renderDraftStatus();
        if (prunedDrafts) {
            scheduleCollectionStateSave();
        }
        return true;
    }
    catch (error) {
        collectionStore = previous;
        renderCollections();
        renderEffectiveAggregationPlugin();
        setCollectionsStatus(errorMessage(error, "Failed to save collections."), true);
        return false;
    }
}
async function updateCollectionAggregationPlugin(collectionId, pluginId) {
    const collection = findCollection(collectionId);
    if (!collection) {
        return;
    }
    if (collection.aggregation_plugin === pluginId) {
        return;
    }
    const previous = cloneCollectionStore(collectionStore);
    collectionStore = {
        ...collectionStore,
        collections: collectionStore.collections.map((item) => item.id === collectionId ? { ...item, aggregation_plugin: pluginId } : item),
    };
    if (!(await saveCollectionsToServer(previous))) {
        return;
    }
    renderCollections();
    renderEffectiveAggregationPlugin();
    persistState();
    setCollectionsStatus(`Collection "${collection.name}" now defaults to ${aggregationPluginLabel(pluginId)}.`);
}
function renderCollections() {
    hideRequestContextMenu();
    collectionsList.textContent = "";
    const normalizedSearch = requestSearchQuery.trim().toLowerCase();
    collapsedCollectionIds = pruneCollapsedCollectionIds(collapsedCollectionIds, collectionStore.collections);
    if (collectionStore.collections.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No collections yet. Create one, then save the current request into it.";
        collectionsList.appendChild(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    let renderedCollectionCount = 0;
    for (const collection of collectionStore.collections) {
        const collectionScratchDraft = getCollectionScratchDraft(requestDrafts, collection.id);
        const scratchMatches = collectionScratchDraft !== null &&
            matchesRequestSearch(collectionScratchDraft.draft, normalizedSearch);
        const matchingRequests = collection.requests.filter((request) => matchesRequestSearch(request, normalizedSearch));
        if (normalizedSearch !== "" && !scratchMatches && matchingRequests.length === 0) {
            continue;
        }
        const effectiveCollapsed = normalizedSearch === "" && collapsedCollectionIds.has(collection.id);
        const card = document.createElement("article");
        card.className = `collection-card${collection.id === activeCollectionId ? " is-selected" : ""}`;
        if (effectiveCollapsed) {
            card.classList.add("is-collapsed");
        }
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
        const collapseBtn = document.createElement("button");
        collapseBtn.type = "button";
        collapseBtn.className = "small-btn collection-collapse-btn";
        collapseBtn.textContent = effectiveCollapsed ? "▸" : "▾";
        collapseBtn.ariaLabel =
            normalizedSearch === ""
                ? `${effectiveCollapsed ? "Expand" : "Collapse"} collection ${collection.name}`
                : `Collection search is active for ${collection.name}`;
        collapseBtn.title =
            normalizedSearch === ""
                ? `${effectiveCollapsed ? "Expand" : "Collapse"} collection`
                : "Matching collections stay expanded while search is active";
        collapseBtn.setAttribute("aria-expanded", effectiveCollapsed ? "false" : "true");
        collapseBtn.disabled = normalizedSearch !== "";
        collapseBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleCollectionCollapsed(collection.id);
        });
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
        actions.append(collapseBtn, saveBtn, deleteBtn);
        head.append(selectBtn, actions);
        card.appendChild(head);
        const bindingRow = document.createElement("label");
        bindingRow.className = "collection-plugin-row";
        bindingRow.hidden = effectiveCollapsed;
        const bindingLabel = document.createElement("span");
        bindingLabel.className = "hint compact";
        bindingLabel.textContent = "Aggregation";
        const bindingSelect = document.createElement("select");
        bindingSelect.className = "collection-plugin-select";
        bindingSelect.disabled = requestIsLoading;
        renderPluginOptionsIntoSelect(bindingSelect, collection.aggregation_plugin);
        bindingSelect.addEventListener("change", () => {
            void updateCollectionAggregationPlugin(collection.id, resolveAggregationPluginId(bindingSelect.value));
        });
        bindingRow.append(bindingLabel, bindingSelect);
        card.appendChild(bindingRow);
        const requestList = document.createElement("div");
        requestList.className = "request-list";
        requestList.hidden = effectiveCollapsed;
        let requestItemCount = 0;
        if (collectionScratchDraft && scratchMatches) {
            const item = document.createElement("div");
            item.className = `request-item${collection.id === activeCollectionId && activeSavedRequestId === null ? " is-selected" : ""}`;
            const loadBtn = document.createElement("button");
            loadBtn.type = "button";
            loadBtn.className = "request-load-btn";
            loadBtn.addEventListener("click", () => loadCollectionScratch(collection.id));
            const requestName = document.createElement("strong");
            requestName.className = "request-title";
            requestName.textContent = collectionScratchDraft.draft.name || "Unsaved Request";
            loadBtn.append(requestName);
            item.appendChild(loadBtn);
            requestList.appendChild(item);
            requestItemCount += 1;
        }
        if (matchingRequests.length === 0 && requestItemCount === 0) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent =
                normalizedSearch === ""
                    ? "No saved requests in this collection yet."
                    : `No requests match "${requestSearchQuery.trim()}".`;
            requestList.appendChild(empty);
        }
        else {
            for (const request of matchingRequests) {
                const item = document.createElement("div");
                item.className = `request-item${request.id === activeSavedRequestId ? " is-selected" : ""}`;
                const loadBtn = document.createElement("button");
                loadBtn.type = "button";
                loadBtn.className = "request-load-btn";
                loadBtn.addEventListener("click", () => loadSavedRequest(collection.id, request.id));
                item.addEventListener("contextmenu", (event) => {
                    event.preventDefault();
                    showRequestContextMenu(event.clientX, event.clientY, {
                        collectionId: collection.id,
                        requestId: request.id,
                        name: request.name,
                    });
                });
                const requestName = document.createElement("strong");
                requestName.className = "request-title";
                requestName.textContent = request.name;
                loadBtn.append(requestName);
                item.append(loadBtn);
                requestList.appendChild(item);
                requestItemCount += 1;
            }
        }
        card.appendChild(requestList);
        fragment.appendChild(card);
        renderedCollectionCount += 1;
    }
    if (renderedCollectionCount === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = `No requests match "${requestSearchQuery.trim()}".`;
        collectionsList.appendChild(empty);
        return;
    }
    collectionsList.appendChild(fragment);
}
function matchesRequestSearch(request, normalizedSearch) {
    if (normalizedSearch === "") {
        return true;
    }
    return [request.name, request.method, request.url]
        .filter((value) => typeof value === "string")
        .some((value) => value.toLowerCase().includes(normalizedSearch));
}
function normalizeCollapsedCollectionIds(input) {
    if (!Array.isArray(input)) {
        return [];
    }
    return input
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value !== "");
}
function pruneCollapsedCollectionIds(collapsed, collections) {
    if (collapsed.size === 0) {
        return new Set();
    }
    const validIds = new Set(collections.map((collection) => collection.id));
    const next = new Set();
    for (const id of collapsed) {
        if (validIds.has(id)) {
            next.add(id);
        }
    }
    return next;
}
function toggleCollectionCollapsed(collectionId) {
    const next = new Set(collapsedCollectionIds);
    if (next.has(collectionId)) {
        next.delete(collectionId);
    }
    else {
        next.add(collectionId);
    }
    collapsedCollectionIds = next;
    renderCollections();
    persistState();
}
function normalizeCollectionStore(input) {
    const rawCollections = Array.isArray(input.collections) ? input.collections : [];
    const environments = Array.isArray(input.environments)
        ? input.environments
            .map((environment) => ({
            id: typeof environment.id === "string" ? environment.id : makeId("env"),
            name: typeof environment.name === "string" ? environment.name.trim() : "",
            text: typeof environment.text === "string" ? environment.text : "",
        }))
            .filter((environment) => environment.name !== "")
        : [];
    return {
        collections: rawCollections
            .map((collection) => ({
            id: typeof collection.id === "string" ? collection.id : makeId("col"),
            name: typeof collection.name === "string" ? collection.name : "Untitled Collection",
            aggregation_plugin: typeof collection.aggregation_plugin === "string"
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
                    aggregation_plugin: request.use_collection_aggregation_plugin === true
                        ? undefined
                        : typeof request.aggregation_plugin === "string"
                            ? resolveAggregationPluginId(request.aggregation_plugin)
                            : resolveAggregationPluginId(undefined, request.aggregate_openai_sse === true),
                    use_collection_aggregation_plugin: request.use_collection_aggregation_plugin === true,
                    aggregate_openai_sse: request.use_collection_aggregation_plugin === true
                        ? false
                        : resolveAggregationPluginId(typeof request.aggregation_plugin === "string"
                            ? request.aggregation_plugin
                            : undefined, request.aggregate_openai_sse === true) === AGGREGATION_PLUGIN_OPENAI,
                    timeout_seconds: typeof request.timeout_seconds === "number" && Number.isFinite(request.timeout_seconds)
                        ? request.timeout_seconds
                        : 120,
                    updated_at: typeof request.updated_at === "string" ? request.updated_at : undefined,
                }))
                : [],
        }))
            .filter((collection) => collection.name.trim() !== ""),
        environments,
        active_environment_id: typeof input.active_environment_id === "string" &&
            environments.some((environment) => environment.id === input.active_environment_id)
            ? input.active_environment_id
            : null,
        request_drafts: normalizePersistedRequestDraftStore(input.request_drafts),
    };
}
function normalizeSavedHeaders(headers) {
    if (!Array.isArray(headers)) {
        return [];
    }
    return headers.map((header) => {
        const typed = header;
        return {
            key: typeof typed.key === "string" ? typed.key : "",
            value: typeof typed.value === "string" ? typed.value : "",
            enabled: typeof typed.enabled === "boolean" ? typed.enabled : true,
        };
    });
}
function findCollection(id) {
    if (!id) {
        return undefined;
    }
    return collectionStore.collections.find((collection) => collection.id === id);
}
function findSavedRequest(collectionId, requestId) {
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
function setCollectionsStatus(message, isError = false) {
    collectionsStatusText.textContent = message;
    collectionsStatusText.classList.toggle("error", isError);
}
function formatCollectionMeta(collection) {
    return `${collection.requests.length} saved request${collection.requests.length === 1 ? "" : "s"} • ${aggregationPluginLabel(collection.aggregation_plugin)}`;
}
function setLoading(isLoading) {
    requestIsLoading = isLoading;
    sendBtn.disabled = isLoading;
    openImportModalBtn.disabled = isLoading;
    openImportModalFromSidebarBtn.disabled = isLoading;
    openEnvironmentModalBtn.disabled = isLoading;
    importCurlBtn.disabled = isLoading;
    importPluginBtn.disabled = isLoading;
    pluginImportInput.disabled = isLoading;
    exportCurlBtn.disabled = isLoading;
    requestNameInput.disabled = isLoading;
    methodInput.disabled = isLoading;
    urlInput.disabled = isLoading;
    bodyInput.disabled = isLoading;
    bodyEditorController.setEditable(!isLoading);
    bodyEditor.setAttribute("aria-disabled", isLoading ? "true" : "false");
    timeoutInput.disabled = isLoading;
    aggregationPluginInput.disabled = isLoading;
    addHeaderBtn.disabled = isLoading;
    copyBodyBtn.disabled = isLoading;
    bodyPrettifyBtn.disabled = isLoading;
    abortBtn.disabled = !isLoading;
    sendBtn.textContent = isLoading ? "Sending..." : "Send";
    syncEnvironmentEditor();
    renderHeaderRows();
    syncBodyEditor();
    renderCollections();
    renderEffectiveAggregationPlugin();
}
function setError(message) {
    errorText.textContent = message;
    errorText.classList.remove("success");
    errorText.classList.add("error");
}
function setSuccess(message) {
    errorText.textContent = message;
    errorText.classList.remove("error");
    errorText.classList.add("success");
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
function makeId(prefix) {
    if ("randomUUID" in crypto) {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function cloneCollectionStore(store) {
    return JSON.parse(JSON.stringify(store));
}
function getCurrentSavedRequestDraft() {
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
        aggregate_openai_sse: !useCollectionAggregationPlugin && aggregationPlugin === AGGREGATION_PLUGIN_OPENAI,
        timeout_seconds: toPositiveInt(timeoutInput.value, 120),
    };
}
function savedRequestToDraft(savedRequest) {
    const aggregationPlugin = resolveAggregationPluginId(savedRequest.aggregation_plugin, savedRequest.aggregate_openai_sse);
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
function createSavedRequest(input) {
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
function insertSavedRequest(requests, savedRequest, afterRequestId) {
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
function getCurrentRequestDraft() {
    return {
        method: methodInput.value.trim().toUpperCase() || "GET",
        url: urlInput.value.trim(),
        headers: headerRows
            .filter((header) => header.enabled && header.key.trim() !== "")
            .map((header) => ({ key: header.key, value: header.value })),
        body: bodyInput.value,
    };
}
function showCurlExport(command) {
    hideImportModal();
    curlExportOutput.value = command;
    curlExportOverlay.hidden = false;
    curlExportOverlay.setAttribute("aria-hidden", "false");
    exportCurlBtn.setAttribute("aria-expanded", "true");
}
function hideCurlExport(restoreFocus = false) {
    curlExportOverlay.hidden = true;
    curlExportOverlay.setAttribute("aria-hidden", "true");
    exportCurlBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
        exportCurlBtn.focus();
    }
}
async function writeClipboardText(text) {
    if (!navigator.clipboard?.writeText) {
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch {
        return false;
    }
}
function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing element with id ${id}`);
    }
    return element;
}
class BatchedBoundedAppender {
    constructor(element, maxChars, flushIntervalMs = OUTPUT_FLUSH_INTERVAL_MS) {
        this.chunks = [];
        this.pending = [];
        this.pendingChars = 0;
        this.totalChars = 0;
        this.currentText = "";
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
    snapshotText() {
        this.flushNow();
        return this.currentText;
    }
    clear() {
        this.cancelFlush();
        this.pending = [];
        this.pendingChars = 0;
        this.totalChars = 0;
        this.currentText = "";
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
        this.currentText += text;
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
    constructor(element, maxChars, flushIntervalMs = OUTPUT_FLUSH_INTERVAL_MS) {
        this.fragments = [];
        this.pending = [];
        this.pendingUnits = 0;
        this.flushTimer = null;
        this.element = element;
        this.maxChars = maxChars;
        this.flushIntervalMs = flushIntervalMs;
    }
    enqueue(text) {
        if (!text) {
            return;
        }
        this.enqueueFragments([{ kind: "content", text }]);
    }
    enqueueFragments(fragments) {
        const normalized = normalizeAggregateFragments(fragments);
        if (normalized.length === 0) {
            return;
        }
        this.pending.push(...normalized);
        this.pendingUnits += normalized.reduce((sum, fragment) => sum + aggregateFragmentSize(fragment), 0);
        this.scheduleFlush();
    }
    hasContent() {
        return this.fragments.length > 0 || this.pendingUnits > 0;
    }
    setText(text) {
        this.setFragments(text ? [{ kind: "content", text }] : []);
    }
    setFragments(fragments) {
        this.clear();
        this.enqueueFragments(fragments);
        this.flushNow();
    }
    snapshotText() {
        this.flushNow();
        return aggregateFragmentsToText(this.fragments);
    }
    clear() {
        this.cancelFlush();
        this.fragments = [];
        this.pending = [];
        this.pendingUnits = 0;
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
function renderAggregateFragments(element, fragments) {
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
function createAggregateMediaElement(fragment) {
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
    }
    else {
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
function isNearBottom(element) {
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    return remaining < 24;
}
plainRawResponseBuffer = new PlainRawResponseBuffer(RAW_OUTPUT_MAX_CHARS);
rawAppender = new BatchedBoundedAppender(rawOutput, RAW_OUTPUT_MAX_CHARS);
aggregateAppender = new BatchedAggregateAppender(aggregateOutput, AGGREGATE_OUTPUT_MAX_CHARS);
setRawResponseMode("plain");
clearSseInspector();
const initialState = loadState();
applyPaneLayoutState(loadPaneLayoutState());
utilitySectionsController = setupUtilitySections(document, handleUtilitySectionToggle);
setUtilitySidebarCollapsed(initialState.sidebarCollapsed, initialState.activeUtilityPanelId);
setupPaneResizeHandles();
setupTabs();
wireEvents();
void initializeApp(initialState);
async function initializeApp(initialState) {
    renderAggregationPluginControls();
    await loadPlugins();
    applyInitialState(initialState);
    await loadCollections();
}
