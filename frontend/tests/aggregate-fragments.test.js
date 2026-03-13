import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateFragmentSize,
  aggregateFragmentsToText,
  normalizeAggregateFragments,
  trimAggregateFragments,
} from "../dist/assets/aggregate-fragments.js";

test("normalizeAggregateFragments merges adjacent fragments by kind", () => {
  const fragments = normalizeAggregateFragments([
    { kind: "thinking", text: "plan" },
    { kind: "thinking", text: " more" },
    { kind: "content", text: "answer" },
    { kind: "content", text: "" },
    { kind: "invalid", text: "!" },
  ]);

  assert.deepEqual(fragments, [
    { kind: "thinking", text: "plan more" },
    { kind: "content", text: "answer!" },
  ]);
});

test("normalizeAggregateFragments keeps safe media fragments and drops unsafe ones", () => {
  const fragments = normalizeAggregateFragments([
    { kind: "content", text: "before " },
    {
      kind: "image",
      url: "https://cdn.example.test/cat.png",
      mime: "image/png",
      alt: " cat ",
      title: " Cat ",
    },
    { kind: "image", url: "javascript:alert(1)", mime: "image/png" },
    { kind: "video", url: "data:video/mp4;base64,AAAA", title: " clip " },
    { kind: "image", url: "data:image/svg+xml;base64,PHN2Zz4=", mime: "image/svg+xml" },
    { kind: "content", text: "after" },
  ]);

  assert.deepEqual(fragments, [
    { kind: "content", text: "before " },
    {
      kind: "image",
      url: "https://cdn.example.test/cat.png",
      mime: "image/png",
      alt: "cat",
      title: "Cat",
    },
    {
      kind: "video",
      url: "data:video/mp4;base64,AAAA",
      mime: "video/mp4",
      title: "clip",
    },
    { kind: "content", text: "after" },
  ]);
});

test("trimAggregateFragments keeps the newest characters and preserves kinds", () => {
  const fragments = trimAggregateFragments(
    [
      { kind: "thinking", text: "abcdef" },
      { kind: "content", text: "ghij" },
    ],
    7,
  );

  assert.deepEqual(fragments, [
    { kind: "thinking", text: "def" },
    { kind: "content", text: "ghij" },
  ]);
  assert.equal(aggregateFragmentsToText(fragments), "defghij");
});

test("trimAggregateFragments counts media items while aggregateFragmentsToText ignores them", () => {
  const fragments = trimAggregateFragments(
    [
      { kind: "content", text: "abcd" },
      { kind: "image", url: "https://cdn.example.test/one.png" },
      { kind: "content", text: "ef" },
    ],
    3,
  );

  assert.equal(aggregateFragmentSize({ kind: "image", url: "https://cdn.example.test/x.png" }), 1);
  assert.deepEqual(fragments, [
    { kind: "image", url: "https://cdn.example.test/one.png" },
    { kind: "content", text: "ef" },
  ]);
  assert.equal(aggregateFragmentsToText(fragments), "ef");
});
