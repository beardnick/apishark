import assert from "node:assert/strict";
import test from "node:test";

import {
  createDuplicateRequestDraft,
  nextDuplicateRequestName,
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
  assert.equal(duplicate.aggregate_openai_sse, source.aggregate_openai_sse);
  assert.equal(duplicate.timeout_seconds, source.timeout_seconds);
  assert.equal(source.headers[0].key, "Authorization");
});
