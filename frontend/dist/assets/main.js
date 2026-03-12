import { prettifyJSONText, renderJSONText, renderJSONValue, } from "./json-view.js";
import { buildCurlCommand } from "./curl-export.js";
const STORAGE_KEY = "apishark.state.v2";
const RAW_OUTPUT_MAX_CHARS = 220000;
const AGGREGATE_OUTPUT_MAX_CHARS = 120000;
const OUTPUT_FLUSH_INTERVAL_MS = 50;
const SSE_MAX_LINES = 1200;
const environmentSelect = byId("environmentSelect");
const createEnvironmentBtn = byId("createEnvironmentBtn");
const renameEnvironmentBtn = byId("renameEnvironmentBtn");
const deleteEnvironmentBtn = byId("deleteEnvironmentBtn");
const envInput = byId("envInput");
const curlInput = byId("curlInput");
const importCurlBtn = byId("importCurlBtn");
const requestNameInput = byId("requestNameInput");
const methodInput = byId("methodInput");
const urlInput = byId("urlInput");
const addHeaderBtn = byId("addHeaderBtn");
const headersEditor = byId("headersEditor");
const bodyInput = byId("bodyInput");
const bodyPrettifyBtn = byId("bodyPrettifyBtn");
const bodyCollapseBtn = byId("bodyCollapseBtn");
const bodyExpandBtn = byId("bodyExpandBtn");
const bodyJsonPanel = byId("bodyJsonPanel");
const bodyJsonMeta = byId("bodyJsonMeta");
const bodyJsonPreview = byId("bodyJsonPreview");
const aggregateInput = byId("aggregateInput");
const timeoutInput = byId("timeoutInput");
const exportCurlBtn = byId("exportCurlBtn");
const copyExportCurlBtn = byId("copyExportCurlBtn");
const closeExportCurlBtn = byId("closeExportCurlBtn");
const curlExportPanel = byId("curlExportPanel");
const curlExportOutput = byId("curlExportOutput");
const sendBtn = byId("sendBtn");
const abortBtn = byId("abortBtn");
const clearOutputBtn = byId("clearOutputBtn");
const reloadCollectionsBtn = byId("reloadCollectionsBtn");
const createCollectionBtn = byId("createCollectionBtn");
const saveRequestBtn = byId("saveRequestBtn");
const newCollectionNameInput = byId("newCollectionNameInput");
const collectionsStatusText = byId("collectionsStatusText");
const collectionsList = byId("collectionsList");
const statusText = byId("statusText");
const errorText = byId("errorText");
const headersOutput = byId("headersOutput");
const rawJsonMeta = byId("rawJsonMeta");
const rawCollapseBtn = byId("rawCollapseBtn");
const rawExpandBtn = byId("rawExpandBtn");
const rawJsonViewer = byId("rawJsonViewer");
const rawOutput = byId("rawOutput");
const aggregateOutput = byId("aggregateOutput");
const sseInspector = byId("sseInspector");
const sseLineList = byId("sseLineList");
const ssePayloadMeta = byId("ssePayloadMeta");
const ssePayloadCollapseBtn = byId("ssePayloadCollapseBtn");
const ssePayloadExpandBtn = byId("ssePayloadExpandBtn");
const ssePayloadJsonViewer = byId("ssePayloadJsonViewer");
const ssePayloadOutput = byId("ssePayloadOutput");
let activeAbortController = null;
let rawAppender;
let aggregateAppender;
let rawResponseMode = "plain";
let requestIsLoading = false;
let environments = [];
let activeEnvironmentId = null;
let headerRows = [];
let collectionStore = { collections: [] };
let activeCollectionId = null;
let activeSavedRequestId = null;
let latestResponseHeaders = {};
let rawJsonController = null;
let bodyJsonController = null;
let ssePayloadJsonController = null;
let sseLineEntries = [];
let selectedSseLine = null;
let sseLineCounter = 0;
function wireEvents() {
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
    const persistTargets = [
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
        aggregateOpenAISse: true,
        timeoutSeconds: 120,
        activeCollectionId: null,
        activeSavedRequestId: null,
    };
}
function applyInitialState() {
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
            aggregateOpenAISse: typeof parsed.aggregateOpenAISse === "boolean"
                ? parsed.aggregateOpenAISse
                : fallback.aggregateOpenAISse,
            timeoutSeconds: typeof parsed.timeoutSeconds === "number" && Number.isFinite(parsed.timeoutSeconds)
                ? parsed.timeoutSeconds
                : fallback.timeoutSeconds,
            activeCollectionId: typeof parsed.activeCollectionId === "string" ? parsed.activeCollectionId : null,
            activeSavedRequestId: typeof parsed.activeSavedRequestId === "string" ? parsed.activeSavedRequestId : null,
        };
    }
    catch {
        return fallback;
    }
}
function persistState() {
    const state = {
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
}
function syncEnvironmentEditor() {
    const activeEnvironment = getActiveEnvironment();
    envInput.value = activeEnvironment?.text ?? "";
    environmentSelect.disabled = requestIsLoading || environments.length === 0;
    createEnvironmentBtn.disabled = requestIsLoading;
    renameEnvironmentBtn.disabled = requestIsLoading || !activeEnvironment;
    deleteEnvironmentBtn.disabled = requestIsLoading || environments.length <= 1 || !activeEnvironment;
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
    environments = environments.map((environment) => environment.id === activeEnvironment.id ? { ...environment, ...patch } : environment);
    persistState();
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
        actions.append(createHeaderActionButton("＋", "Insert header below", () => insertHeaderAfter(header.id), requestIsLoading), createHeaderActionButton("⎘", "Duplicate header", () => duplicateHeader(header.id), requestIsLoading), createHeaderActionButton("✕", "Delete header", () => removeHeader(header.id), requestIsLoading, true));
        row.append(toggleLabel, keyInput, valueInput, actions);
        fragment.appendChild(row);
    }
    headersEditor.textContent = "";
    headersEditor.appendChild(fragment);
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
function updateHeaderRow(id, patch) {
    headerRows = headerRows.map((header) => (header.id === id ? { ...header, ...patch } : header));
    renderHeaderRows();
    persistState();
}
function patchHeaderRow(id, patch) {
    headerRows = headerRows.map((header) => (header.id === id ? { ...header, ...patch } : header));
    persistState();
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
    persistState();
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
    persistState();
}
function removeHeader(id) {
    if (headerRows.length === 1) {
        headerRows = [createEmptyHeaderRow()];
    }
    else {
        headerRows = headerRows.filter((header) => header.id !== id);
    }
    renderHeaderRows();
    persistState();
}
function updateBodyJsonPreview() {
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
function prettifyBodyJSON() {
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
        methodInput.value = parsed.method || "GET";
        urlInput.value = parsed.url || "";
        headerRows = normalizeHeaderRows((parsed.headers || []).map((header) => ({ ...header, enabled: true })));
        bodyInput.value = parsed.body || "";
        activeSavedRequestId = null;
        renderHeaderRows();
        updateBodyJsonPreview();
        persistState();
    }
    catch (error) {
        setError(errorMessage(error, "Failed to import curl command."));
    }
    finally {
        setLoading(false);
    }
}
async function exportCurl() {
    setError("");
    try {
        const command = buildCurlCommand(getCurrentRequestDraft());
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
    const payload = {
        method: draft.method,
        url: draft.url,
        headers: draft.headers,
        body: draft.body,
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
            rawAppender.enqueue(`${payload}\n`);
        }
    }
}
function consumeEvent(event) {
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
            }
            else {
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
function finalizeResponseViews() {
    renderResponseHeaders(latestResponseHeaders);
    if (rawResponseMode === "plain") {
        const rawText = rawAppender.snapshotText();
        renderRawJSONIfPossible(rawText);
    }
}
function clearOutputs() {
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
function setRawResponseMode(mode) {
    rawResponseMode = mode;
    const sseMode = mode === "sse";
    sseInspector.classList.toggle("is-visible", sseMode);
    rawOutput.classList.toggle("is-hidden", sseMode);
    rawJsonViewer.classList.toggle("is-hidden", true);
    rawCollapseBtn.disabled = true;
    rawExpandBtn.disabled = true;
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
    if (Object.keys(headers).length === 0) {
        headersOutput.textContent = "";
        return;
    }
    renderJSONValue(headersOutput, headers, { expandDepth: 1 });
}
function clearSseInspector() {
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
    const previous = cloneCollectionStore(collectionStore);
    const nextCollection = {
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
async function saveCurrentRequestToCollection() {
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
    const savedRequest = {
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
    persistState();
    setCollectionsStatus(`Saved "${requestName}" to "${collection.name}".`);
}
function loadSavedRequest(collectionId, requestId) {
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
async function deleteCollection(collectionId) {
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
async function deleteSavedRequest(collectionId, requestId) {
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
async function saveCollectionsToServer(previous) {
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
        collectionStore = normalizeCollectionStore(JSON.parse(responseText));
        if (activeCollectionId && !findCollection(activeCollectionId)) {
            activeCollectionId = collectionStore.collections[0]?.id ?? null;
            activeSavedRequestId = null;
        }
        return true;
    }
    catch (error) {
        collectionStore = previous;
        renderCollections();
        setCollectionsStatus(errorMessage(error, "Failed to save collections."), true);
        return false;
    }
}
function renderCollections() {
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
        saveBtn.textContent = "↥";
        saveBtn.ariaLabel = `Save current request to ${collection.name}`;
        saveBtn.title = `Save current request to ${collection.name}`;
        saveBtn.addEventListener("click", () => {
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
        const requestList = document.createElement("div");
        requestList.className = "request-list";
        if (collection.requests.length === 0) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "No saved requests in this collection yet.";
            requestList.appendChild(empty);
        }
        else {
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
                requestMeta.textContent = formatSavedRequestMeta(request);
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
function normalizeCollectionStore(input) {
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
                    aggregate_openai_sse: typeof request.aggregate_openai_sse === "boolean"
                        ? request.aggregate_openai_sse
                        : false,
                    timeout_seconds: typeof request.timeout_seconds === "number" && Number.isFinite(request.timeout_seconds)
                        ? request.timeout_seconds
                        : 120,
                    updated_at: typeof request.updated_at === "string" ? request.updated_at : undefined,
                }))
                : [],
        }))
            .filter((collection) => collection.name.trim() !== ""),
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
function setCollectionsStatus(message, isError = false) {
    collectionsStatusText.textContent = message;
    collectionsStatusText.classList.toggle("error", isError);
}
function formatSavedRequestMeta(request) {
    const url = request.url.trim() || "(no URL)";
    if (!request.updated_at) {
        return url;
    }
    const parsed = new Date(request.updated_at);
    if (Number.isNaN(parsed.getTime())) {
        return url;
    }
    return `${url} • ${parsed.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })}`;
}
function setLoading(isLoading) {
    requestIsLoading = isLoading;
    sendBtn.disabled = isLoading;
    importCurlBtn.disabled = isLoading;
    exportCurlBtn.disabled = isLoading;
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
    curlExportOutput.value = command;
    curlExportPanel.classList.remove("is-hidden");
}
function hideCurlExport() {
    curlExportPanel.classList.add("is-hidden");
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
function isNearBottom(element) {
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
