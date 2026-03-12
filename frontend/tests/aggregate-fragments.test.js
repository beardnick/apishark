import assert from "node:assert/strict";
import test from "node:test";

import {
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
