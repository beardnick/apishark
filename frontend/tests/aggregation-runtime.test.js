import assert from "node:assert/strict";
import test from "node:test";

import {
  AGGREGATION_PLUGIN_OPENAI,
  ResponseAggregationRuntime,
  ensureAggregationPluginLoaded,
  listAggregationPlugins,
  parseImportedAggregationPluginFile,
  setImportedAggregationPluginManifests,
} from "../dist/assets/aggregation-runtime.js";

test("ResponseAggregationRuntime aggregates OpenAI SSE raw events incrementally", () => {
  const runtime = new ResponseAggregationRuntime(AGGREGATION_PLUGIN_OPENAI);

  const first = runtime.consumeRawEvent({
    seq: 1,
    transport: { mode: "sse", contentType: "text/event-stream", field: "data" },
    rawChunk: `data: {"choices":[{"delta":{"reasoning":"plan "}}]}`,
    sseData: `{"choices":[{"delta":{"reasoning":"plan "}}]}`,
    parsedJson: { choices: [{ delta: { reasoning: "plan " } }] },
    done: false,
    ts: "2026-03-12T00:00:00Z",
  });
  assert.deepEqual(first.appendFragments, [{ kind: "thinking", text: "plan " }]);

  const second = runtime.consumeRawEvent({
    seq: 2,
    transport: { mode: "sse", contentType: "text/event-stream", field: "data" },
    rawChunk: `data: {"choices":[{"delta":{"content":"answer"}}]}`,
    sseData: `{"choices":[{"delta":{"content":"answer"}}]}`,
    parsedJson: { choices: [{ delta: { content: "answer" } }] },
    done: false,
    ts: "2026-03-12T00:00:01Z",
  });
  assert.deepEqual(second.appendFragments, [{ kind: "content", text: "answer" }]);

  runtime.consumeRawEvent({
    seq: 3,
    transport: { mode: "sse", contentType: "text/event-stream", field: "data" },
    rawChunk: "data: [DONE]",
    sseData: "[DONE]",
    done: false,
    ts: "2026-03-12T00:00:02Z",
  });

  const done = runtime.consumeRawEvent({
    seq: 4,
    transport: { mode: "sse", contentType: "text/event-stream" },
    rawChunk: "",
    done: true,
    ts: "2026-03-12T00:00:03Z",
  });
  assert.deepEqual(done, {});
  assert.deepEqual(runtime.snapshotFragments(), [
    { kind: "thinking", text: "plan " },
    { kind: "content", text: "answer" },
  ]);
  assert.equal(runtime.snapshotText(), "plan answer");
});

test("ResponseAggregationRuntime aggregates non-stream JSON once body completes", () => {
  const runtime = new ResponseAggregationRuntime(AGGREGATION_PLUGIN_OPENAI);

  runtime.consumeRawEvent({
    seq: 1,
    transport: { mode: "body", contentType: "application/json" },
    rawChunk: '{"output":[{"content":[{"type":"reasoning","text":"considering"}',
    done: false,
    ts: "2026-03-12T00:00:00Z",
  });
  runtime.consumeRawEvent({
    seq: 2,
    transport: { mode: "body", contentType: "application/json" },
    rawChunk: ',{"type":"output_text","text":" final"}]}]}',
    done: false,
    ts: "2026-03-12T00:00:01Z",
  });

  const done = runtime.consumeRawEvent({
    seq: 3,
    transport: { mode: "body", contentType: "application/json" },
    rawChunk: "",
    done: true,
    ts: "2026-03-12T00:00:02Z",
  });

  assert.deepEqual(done.replaceFragments, [
    { kind: "thinking", text: "considering" },
    { kind: "content", text: " final" },
  ]);
  assert.equal(runtime.snapshotText(), "considering final");
});

test("ResponseAggregationRuntime turns plugin failures into readable errors", () => {
  const runtime = new ResponseAggregationRuntime("custom", {
    pluginOverride: {
      onRawEvent() {
        throw new Error("boom");
      },
    },
  });

  const result = runtime.consumeRawEvent({
    seq: 1,
    transport: { mode: "sse", contentType: "text/event-stream", field: "data" },
    rawChunk: "data: hello",
    sseData: "hello",
    done: false,
    ts: "2026-03-12T00:00:00Z",
  });

  assert.equal(result.error, 'Aggregation plugin "custom" failed: boom');
  assert.deepEqual(runtime.finalize(), {});
});

test("parseImportedAggregationPluginFile accepts JSON-wrapped plugin modules", async () => {
  const plugin = await parseImportedAggregationPluginFile(
    "vendor-plugin.json",
    JSON.stringify({
      id: "vendor.example",
      label: "Vendor Example",
      description: "Test plugin",
      source: `
        export function create() {
          return {
            onRawEvent() {
              return { append: [{ kind: "content", text: "ok" }] };
            },
          };
        }
      `,
    }),
  );

  assert.equal(plugin.id, "vendor.example");
  assert.equal(plugin.label, "Vendor Example");
  assert.equal(plugin.format, "json");
});

test("ensureAggregationPluginLoaded registers imported plugin manifests", async () => {
  setImportedAggregationPluginManifests([
    {
      id: "vendor.loaded",
      label: "Vendor Loaded",
      description: "Loads on demand",
      module_url: `data:text/javascript;base64,${Buffer.from(`
        export function create() {
          return {
            onRawEvent() {
              return { append: [{ kind: "content", text: "loaded" }] };
            },
          };
        }
      `).toString("base64")}`,
      imported_at: "2026-03-12T00:00:00Z",
      format: "js",
    },
  ]);

  await ensureAggregationPluginLoaded("vendor.loaded");

  const plugin = listAggregationPlugins().find((item) => item.id === "vendor.loaded");
  assert.equal(plugin?.loaded, true);
});
