import { AGGREGATION_PLUGIN_NONE, aggregationPluginLabel, resolveAggregationPluginId, } from "./aggregation-runtime.js";
const duplicateSuffixPattern = /^(.*?)(?: copy(?: (\d+))?)?$/;
export function nextDuplicateRequestName(name, existingNames) {
    const normalizedName = name.trim() || "Untitled Request";
    const baseName = duplicateBaseName(normalizedName);
    const usedIndexes = new Set();
    for (const existingName of existingNames) {
        const trimmed = existingName.trim();
        if (trimmed === baseName) {
            usedIndexes.add(0);
            continue;
        }
        if (trimmed === `${baseName} copy`) {
            usedIndexes.add(1);
            continue;
        }
        const match = trimmed.match(new RegExp(`^${escapeRegExp(baseName)} copy (\\d+)$`));
        if (!match) {
            continue;
        }
        const index = Number.parseInt(match[1], 10);
        if (Number.isFinite(index) && index > 1) {
            usedIndexes.add(index);
        }
    }
    let nextIndex = 1;
    while (usedIndexes.has(nextIndex)) {
        nextIndex += 1;
    }
    return nextIndex === 1 ? `${baseName} copy` : `${baseName} copy ${nextIndex}`;
}
export function createDuplicateRequestDraft(draft, existingNames) {
    return {
        ...draft,
        name: nextDuplicateRequestName(draft.name, existingNames),
        headers: draft.headers.map((header) => ({ ...header })),
    };
}
export function createRequestDraftKey(scope) {
    if (scope.collectionId && scope.requestId) {
        return `collection:${scope.collectionId}:request:${scope.requestId}`;
    }
    if (scope.requestId) {
        return `request:${scope.requestId}`;
    }
    if (scope.collectionId) {
        return `collection:${scope.collectionId}:unsaved`;
    }
    return "workspace:unsaved";
}
export function getPersistedRequestDraft(store, scope) {
    return store[createRequestDraftKey(scope)] ?? null;
}
export function setPersistedRequestDraft(store, input) {
    const key = createRequestDraftKey(input.scope);
    return {
        ...store,
        [key]: {
            key,
            collection_id: input.scope.collectionId,
            request_id: input.scope.requestId,
            updated_at: input.updatedAt ?? new Date().toISOString(),
            draft: cloneRequestLibraryDraft(input.draft),
        },
    };
}
export function deletePersistedRequestDraft(store, scope) {
    const key = createRequestDraftKey(scope);
    if (!Object.prototype.hasOwnProperty.call(store, key)) {
        return store;
    }
    const next = { ...store };
    delete next[key];
    return next;
}
export function prunePersistedRequestDraftStore(store, input) {
    const validCollectionIds = new Set(input.collectionIds);
    const validRequestIds = new Set(input.requestIds);
    let next = null;
    for (const [key, entry] of Object.entries(store)) {
        const isSavedRequestDraft = typeof entry.request_id === "string" && entry.request_id.length > 0;
        const isCollectionScratch = !isSavedRequestDraft &&
            typeof entry.collection_id === "string" &&
            entry.collection_id.length > 0;
        const requestId = isSavedRequestDraft ? entry.request_id : null;
        const collectionId = isCollectionScratch ? entry.collection_id : null;
        if (requestId && validRequestIds.has(requestId)) {
            continue;
        }
        if (collectionId && validCollectionIds.has(collectionId)) {
            continue;
        }
        if (!isSavedRequestDraft && !isCollectionScratch) {
            continue;
        }
        if (!next) {
            next = { ...store };
        }
        delete next[key];
    }
    return next ?? store;
}
export function requestLibraryDraftsEqual(left, right) {
    if (left.name !== right.name ||
        left.method !== right.method ||
        left.url !== right.url ||
        left.body !== right.body ||
        left.aggregation_plugin !== right.aggregation_plugin ||
        left.aggregate_openai_sse !== right.aggregate_openai_sse ||
        left.timeout_seconds !== right.timeout_seconds ||
        left.headers.length !== right.headers.length) {
        return false;
    }
    return left.headers.every((header, index) => {
        const other = right.headers[index];
        return (header.key === other.key &&
            header.value === other.value &&
            header.enabled === other.enabled);
    });
}
export function normalizePersistedRequestDraftStore(input) {
    if (!input || typeof input !== "object") {
        return {};
    }
    const entries = Array.isArray(input) ? input : Object.values(input);
    const normalizedEntries = entries
        .map(normalizePersistedRequestDraft)
        .filter((entry) => entry !== null);
    return Object.fromEntries(normalizedEntries.map((entry) => [entry.key, entry]));
}
export function serializePersistedRequestDraftStore(store) {
    return Object.values(store)
        .map((entry) => ({
        ...entry,
        draft: cloneRequestLibraryDraft(entry.draft),
    }))
        .sort((left, right) => {
        if (left.updated_at === right.updated_at) {
            return left.key.localeCompare(right.key);
        }
        return left.updated_at.localeCompare(right.updated_at);
    });
}
export function resolveEffectiveAggregationPlugin(input) {
    if (input.useCollectionPlugin) {
        const collectionPlugin = resolveAggregationPluginId(input.collectionPlugin);
        return {
            pluginId: collectionPlugin,
            source: collectionPlugin === AGGREGATION_PLUGIN_NONE ? "none" : "collection",
            label: aggregationPluginLabel(collectionPlugin),
        };
    }
    const requestPlugin = resolveAggregationPluginId(input.requestPlugin);
    return {
        pluginId: requestPlugin,
        source: requestPlugin === AGGREGATION_PLUGIN_NONE ? "none" : "request",
        label: aggregationPluginLabel(requestPlugin),
    };
}
function duplicateBaseName(name) {
    const match = name.match(duplicateSuffixPattern);
    const baseName = match?.[1]?.trim();
    return baseName || "Untitled Request";
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizePersistedRequestDraft(input) {
    if (!input || typeof input !== "object") {
        return null;
    }
    const typed = input;
    const requestId = typeof typed.request_id === "string" && typed.request_id.trim() ? typed.request_id : null;
    const collectionId = typeof typed.collection_id === "string" && typed.collection_id.trim()
        ? typed.collection_id
        : null;
    const key = typeof typed.key === "string" && typed.key.trim()
        ? typed.key
        : createRequestDraftKey({ collectionId, requestId });
    const draft = normalizeRequestLibraryDraft(typed.draft);
    if (!draft) {
        return null;
    }
    return {
        key,
        collection_id: collectionId,
        request_id: requestId,
        updated_at: typeof typed.updated_at === "string" && typed.updated_at.trim()
            ? typed.updated_at
            : new Date(0).toISOString(),
        draft,
    };
}
function normalizeRequestLibraryDraft(input) {
    if (!input || typeof input !== "object") {
        return null;
    }
    return {
        name: typeof input.name === "string" && input.name.trim() ? input.name : "Untitled Request",
        method: typeof input.method === "string" && input.method.trim() ? input.method : "GET",
        url: typeof input.url === "string" ? input.url : "",
        headers: Array.isArray(input.headers)
            ? input.headers.map((header) => ({
                key: typeof header?.key === "string" ? header.key : "",
                value: typeof header?.value === "string" ? header.value : "",
                enabled: typeof header?.enabled === "boolean" ? header.enabled : true,
            }))
            : [],
        body: typeof input.body === "string" ? input.body : "",
        aggregation_plugin: typeof input.aggregation_plugin === "string" ? input.aggregation_plugin : "none",
        use_collection_aggregation_plugin: input.use_collection_aggregation_plugin !== false,
        aggregate_openai_sse: input.aggregate_openai_sse === true,
        timeout_seconds: typeof input.timeout_seconds === "number" && Number.isFinite(input.timeout_seconds)
            ? input.timeout_seconds
            : 120,
    };
}
function cloneRequestLibraryDraft(draft) {
    return {
        ...draft,
        headers: draft.headers.map((header) => ({ ...header })),
    };
}
