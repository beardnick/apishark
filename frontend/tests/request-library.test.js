import assert from "node:assert/strict";
import test from "node:test";

import {
  createRequestDraftKey,
  createDuplicateRequestDraft,
  deletePersistedRequestDraft,
  getCollectionScratchDraft,
  getPersistedRequestDraft,
  normalizePersistedRequestDraftStore,
  nextDuplicateRequestName,
  prunePersistedRequestDraftStore,
  requestLibraryDraftsEqual,
  resolveEffectiveAggregationPlugin,
  serializePersistedRequestDraftStore,
  setPersistedRequestDraft,
} from "../dist/assets/request-library.js";

test("nextDuplicateRequestName increments within the same request family", () => {
  assert.equal(
    nextDuplicateRequestName("Streaming chat", [
      "Streaming chat",
      "Streaming chat copy",
      "Streaming chat copy 2",
    ]),
    "Streaming chat copy 3",
  );
});

test("nextDuplicateRequestName keeps incrementing when duplicating a copy", () => {
  assert.equal(
    nextDuplicateRequestName("Streaming chat copy", [
      "Streaming chat",
      "Streaming chat copy",
      "Streaming chat copy 2",
    ]),
    "Streaming chat copy 3",
  );
});

test("createDuplicateRequestDraft clones request fields without reusing header references", () => {
  const source = {
    name: "Streaming chat",
    method: "POST",
    url: "https://api.example.test/v1/chat/completions",
    headers: [{ key: "Authorization", value: "Bearer {{TOKEN}}", enabled: true }],
    body: "{\"stream\":true}",
    aggregation_plugin: "openai",
    use_collection_aggregation_plugin: false,
    aggregate_openai_sse: true,
    timeout_seconds: 45,
  };

  const duplicate = createDuplicateRequestDraft(source, ["Streaming chat"]);
  duplicate.headers[0].key = "X-Test";

  assert.equal(duplicate.name, "Streaming chat copy");
  assert.equal(duplicate.method, source.method);
  assert.equal(duplicate.url, source.url);
  assert.equal(duplicate.body, source.body);
  assert.equal(duplicate.aggregation_plugin, source.aggregation_plugin);
  assert.equal(
    duplicate.use_collection_aggregation_plugin,
    source.use_collection_aggregation_plugin,
  );
  assert.equal(duplicate.aggregate_openai_sse, source.aggregate_openai_sse);
  assert.equal(duplicate.timeout_seconds, source.timeout_seconds);
  assert.equal(source.headers[0].key, "Authorization");
});

test("request draft keys include the collection when a saved request is selected", () => {
  assert.equal(
    createRequestDraftKey({ collectionId: "col_alpha", requestId: "req_123" }),
    "collection:col_alpha:request:req_123",
  );
  assert.equal(
    createRequestDraftKey({ collectionId: "col_alpha", requestId: null }),
    "collection:col_alpha:unsaved",
  );
  assert.equal(createRequestDraftKey({ collectionId: null, requestId: null }), "workspace:unsaved");
});

test("persisted request drafts restore the right request after switching", () => {
  const baseDraft = {
    name: "Streaming chat",
    method: "POST",
    url: "https://api.example.test/v1/chat/completions",
    headers: [{ key: "Authorization", value: "Bearer {{TOKEN}}", enabled: true }],
    body: "{\"stream\":true}",
    aggregation_plugin: "openai",
    aggregate_openai_sse: true,
    timeout_seconds: 45,
  };

  let store = {};
  store = setPersistedRequestDraft(store, {
    scope: { collectionId: "col_alpha", requestId: "req_one" },
    draft: { ...baseDraft, name: "Req 1 draft", body: "{\"request\":1}" },
    updatedAt: "2026-03-13T10:00:00.000Z",
  });
  store = setPersistedRequestDraft(store, {
    scope: { collectionId: "col_alpha", requestId: "req_two" },
    draft: { ...baseDraft, name: "Req 2 draft", body: "{\"request\":2}" },
    updatedAt: "2026-03-13T10:01:00.000Z",
  });

  assert.equal(
    getPersistedRequestDraft(store, {
      collectionId: "col_alpha",
      requestId: "req_one",
    })?.draft.body,
    "{\"request\":1}",
  );
  assert.equal(
    getPersistedRequestDraft(store, {
      collectionId: "col_alpha",
      requestId: "req_two",
    })?.draft.body,
    "{\"request\":2}",
  );
});

test("persisted request drafts support collection-scoped unsaved work and cleanup", () => {
  const draft = {
    name: "Untitled Request",
    method: "GET",
    url: "https://api.example.test/health",
    headers: [],
    body: "",
    aggregation_plugin: "none",
    aggregate_openai_sse: false,
    timeout_seconds: 120,
  };

  let store = {};
  store = setPersistedRequestDraft(store, {
    scope: { collectionId: "col_alpha", requestId: null },
    draft,
  });
  store = setPersistedRequestDraft(store, {
    scope: { collectionId: "col_alpha", requestId: "req_keep" },
    draft: { ...draft, name: "Saved request draft" },
  });
  store = setPersistedRequestDraft(store, {
    scope: { collectionId: "col_remove", requestId: "req_remove" },
    draft: { ...draft, name: "Delete me" },
  });

  store = prunePersistedRequestDraftStore(store, {
    collectionIds: ["col_alpha"],
    requestIds: ["req_keep"],
  });

  assert.ok(
    getPersistedRequestDraft(store, {
      collectionId: "col_alpha",
      requestId: null,
    }),
  );
  assert.equal(getCollectionScratchDraft(store, "col_alpha")?.collection_id, "col_alpha");
  assert.equal(getCollectionScratchDraft(store, "col_missing"), null);
  assert.ok(
    getPersistedRequestDraft(store, {
      collectionId: "col_alpha",
      requestId: "req_keep",
    }),
  );
  assert.equal(
    getPersistedRequestDraft(store, {
      collectionId: "col_remove",
      requestId: "req_remove",
    }),
    null,
  );

  const withoutUnsaved = deletePersistedRequestDraft(store, {
    collectionId: "col_alpha",
    requestId: null,
  });
  assert.equal(
    getPersistedRequestDraft(withoutUnsaved, {
      collectionId: "col_alpha",
      requestId: null,
    }),
    null,
  );
});

test("requestLibraryDraftsEqual compares draft payloads deeply", () => {
  const left = {
    name: "Streaming chat",
    method: "POST",
    url: "https://api.example.test/v1/chat/completions",
    headers: [{ key: "Authorization", value: "Bearer {{TOKEN}}", enabled: true }],
    body: "{\"stream\":true}",
    aggregation_plugin: "openai",
    aggregate_openai_sse: true,
    timeout_seconds: 45,
  };

  const right = {
    ...left,
    headers: left.headers.map((header) => ({ ...header })),
  };

  assert.equal(requestLibraryDraftsEqual(left, right), true);
  assert.equal(
    requestLibraryDraftsEqual(left, {
      ...right,
      headers: [{ key: "Authorization", value: "Bearer changed", enabled: true }],
    }),
    false,
  );
});

test("normalizePersistedRequestDraftStore ignores invalid draft entries", () => {
  const normalized = normalizePersistedRequestDraftStore({
    valid: {
      collection_id: "col_alpha",
      request_id: "req_one",
      updated_at: "2026-03-13T10:00:00.000Z",
      draft: {
        name: "Req 1 draft",
        method: "POST",
        url: "https://api.example.test/v1/chat/completions",
        headers: [{ key: "Authorization", value: "Bearer {{TOKEN}}", enabled: true }],
        body: "{\"stream\":true}",
        aggregation_plugin: "openai",
        aggregate_openai_sse: true,
        timeout_seconds: 45,
      },
    },
    invalid: {
      collection_id: "col_alpha",
      draft: null,
    },
  });

  assert.deepEqual(Object.keys(normalized), ["collection:col_alpha:request:req_one"]);
  assert.equal(normalized["collection:col_alpha:request:req_one"].draft.name, "Req 1 draft");
});

test("normalizePersistedRequestDraftStore accepts serialized draft arrays", () => {
  const normalized = normalizePersistedRequestDraftStore([
    {
      key: "collection:col_alpha:unsaved",
      collection_id: "col_alpha",
      request_id: null,
      updated_at: "2026-03-13T10:00:00.000Z",
      draft: {
        name: "Unsaved draft",
        method: "POST",
        url: "https://api.example.test/v1/chat/completions",
        headers: [],
        body: "{\"stream\":true}",
        aggregation_plugin: "openai",
        use_collection_aggregation_plugin: false,
        aggregate_openai_sse: true,
        timeout_seconds: 45,
      },
    },
  ]);

  assert.equal(
    normalized["collection:col_alpha:unsaved"]?.draft.name,
    "Unsaved draft",
  );
});

test("serializePersistedRequestDraftStore emits sorted cloned entries", () => {
  let store = {};
  store = setPersistedRequestDraft(store, {
    scope: { collectionId: "col_beta", requestId: null },
    draft: {
      name: "Later draft",
      method: "GET",
      url: "",
      headers: [],
      body: "",
      aggregation_plugin: "none",
      use_collection_aggregation_plugin: false,
      aggregate_openai_sse: false,
      timeout_seconds: 120,
    },
    updatedAt: "2026-03-13T10:01:00.000Z",
  });
  store = setPersistedRequestDraft(store, {
    scope: { collectionId: "col_alpha", requestId: null },
    draft: {
      name: "Earlier draft",
      method: "GET",
      url: "",
      headers: [],
      body: "",
      aggregation_plugin: "none",
      use_collection_aggregation_plugin: false,
      aggregate_openai_sse: false,
      timeout_seconds: 120,
    },
    updatedAt: "2026-03-13T10:00:00.000Z",
  });

  const serialized = serializePersistedRequestDraftStore(store);
  serialized[0].draft.name = "Changed";

  assert.deepEqual(
    serialized.map((entry) => entry.key),
    ["collection:col_alpha:unsaved", "collection:col_beta:unsaved"],
  );
  assert.equal(store["collection:col_alpha:unsaved"].draft.name, "Earlier draft");
});

test("resolveEffectiveAggregationPlugin prefers collection binding when request inherits", () => {
  const effective = resolveEffectiveAggregationPlugin({
    requestPlugin: "openai",
    useCollectionPlugin: true,
    collectionPlugin: "vendor.custom",
  });

  assert.equal(effective.pluginId, "vendor.custom");
  assert.equal(effective.source, "collection");
  assert.equal(effective.label, "vendor.custom");
});
