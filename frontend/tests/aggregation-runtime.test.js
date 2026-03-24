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

test("ResponseAggregationRuntime aggregates OpenAI media fragments natively", () => {
  const runtime = new ResponseAggregationRuntime(AGGREGATION_PLUGIN_OPENAI);

  const result = runtime.consumeRawEvent({
    seq: 1,
    transport: { mode: "sse", contentType: "text/event-stream", field: "data" },
    rawChunk:
      'data: {"output":[{"content":[{"type":"output_text","text":"caption "},{"type":"output_image","image_url":{"url":"https://cdn.example.test/cat.png","mime_type":"image/png"},"alt":"cat","title":"Cat"},{"type":"output_video","video_url":"https://cdn.example.test/cat.mp4","mime_type":"video/mp4","title":"Clip"}]}]}',
    sseData:
      '{"output":[{"content":[{"type":"output_text","text":"caption "},{"type":"output_image","image_url":{"url":"https://cdn.example.test/cat.png","mime_type":"image/png"},"alt":"cat","title":"Cat"},{"type":"output_video","video_url":"https://cdn.example.test/cat.mp4","mime_type":"video/mp4","title":"Clip"}]}]}',
    parsedJson: {
      output: [
        {
          content: [
            { type: "output_text", text: "caption " },
            {
              type: "output_image",
              image_url: { url: "https://cdn.example.test/cat.png", mime_type: "image/png" },
              alt: "cat",
              title: "Cat",
            },
            {
              type: "output_video",
              video_url: "https://cdn.example.test/cat.mp4",
              mime_type: "video/mp4",
              title: "Clip",
            },
          ],
        },
      ],
    },
    done: false,
    ts: "2026-03-12T00:00:00Z",
  });

  assert.deepEqual(result.appendFragments, [
    { kind: "content", text: "caption " },
    {
      kind: "image",
      url: "https://cdn.example.test/cat.png",
      mime: "image/png",
      alt: "cat",
      title: "Cat",
    },
    {
      kind: "video",
      url: "https://cdn.example.test/cat.mp4",
      mime: "video/mp4",
      title: "Clip",
    },
  ]);
  assert.deepEqual(runtime.snapshotFragments(), result.appendFragments);
  assert.equal(runtime.snapshotText(), "caption ");
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

test("ResponseAggregationRuntime accepts plugin media append and replace updates", () => {
  const runtime = new ResponseAggregationRuntime("custom", {
    pluginOverride: {
      onRawEvent() {
        return {
          append: [
            { kind: "content", text: "intro " },
            { kind: "image", url: "https://cdn.example.test/one.png", title: "One" },
            { kind: "image", url: "javascript:alert(1)" },
          ],
        };
      },
      finalize() {
        return {
          replace: [
            { kind: "thinking", text: "plan " },
            { kind: "video", url: "data:video/mp4;base64,AAAA", title: "Clip" },
            { kind: "content", text: "done" },
          ],
        };
      },
    },
  });

  const first = runtime.consumeRawEvent({
    seq: 1,
    transport: { mode: "body", contentType: "application/json" },
    rawChunk: "{}",
    parsedJson: {},
    done: false,
    ts: "2026-03-12T00:00:00Z",
  });
  assert.deepEqual(first.appendFragments, [
    { kind: "content", text: "intro " },
    { kind: "image", url: "https://cdn.example.test/one.png", title: "One" },
  ]);

  const final = runtime.finalize();
  assert.deepEqual(final.replaceFragments, [
    { kind: "thinking", text: "plan " },
    {
      kind: "video",
      url: "data:video/mp4;base64,AAAA",
      mime: "video/mp4",
      title: "Clip",
    },
    { kind: "content", text: "done" },
  ]);
  assert.equal(runtime.snapshotText(), "plan done");
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

test("ensureAggregationPluginLoaded accepts embedded plugin source from collections", async () => {
  setImportedAggregationPluginManifests([
    {
      id: "vendor.embedded",
      label: "Vendor Embedded",
      description: "Loads from collection source",
      imported_at: "2026-03-24T00:00:00Z",
      format: "js",
      source: `
        export function create() {
          return {
            onRawEvent() {
              return { append: [{ kind: "content", text: "embedded" }] };
            },
          };
        }
      `,
    },
  ]);

  await ensureAggregationPluginLoaded("vendor.embedded");

  const plugin = listAggregationPlugins().find((item) => item.id === "vendor.embedded");
  assert.equal(plugin?.loaded, true);
});
