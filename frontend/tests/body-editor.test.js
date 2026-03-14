import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeBodyEditorText,
  collapseJSONText,
  tokenizeBodyEditorText,
} from "../dist/assets/body-editor.js";

test("collapseJSONText formats folded JSON into a readable preview", () => {
  assert.equal(
    collapseJSONText('{"stream":true,"messages":[{"role":"user","content":"hi"}],"meta":{"n":1}}'),
    '{\n  "stream": true,\n  "messages": [...],\n  "meta": {...}\n}',
  );
  assert.equal(collapseJSONText("not json"), null);
});

test("tokenizeBodyEditorText classifies JSON keys, values, and punctuation with offsets", () => {
  const tokens = tokenizeBodyEditorText('{\n  "meta": {"ok": false},\n  "count": 3,\n  "empty": null\n}');
  const classified = tokens.filter((token) => token.className !== null);

  assert.deepEqual(
    classified.map((token) => [token.text, token.className, token.from, token.to]),
    [
      ["{", "json-punctuation", 0, 1],
      ['"meta"', "json-key", 4, 10],
      [":", "json-punctuation", 10, 11],
      ["{", "json-punctuation", 12, 13],
      ['"ok"', "json-key", 13, 17],
      [":", "json-punctuation", 17, 18],
      ["false", "json-boolean", 19, 24],
      ["}", "json-punctuation", 24, 25],
      [",", "json-punctuation", 25, 26],
      ['"count"', "json-key", 29, 36],
      [":", "json-punctuation", 36, 37],
      ["3", "json-number", 38, 39],
      [",", "json-punctuation", 39, 40],
      ['"empty"', "json-key", 43, 50],
      [":", "json-punctuation", 50, 51],
      ["null", "json-null", 52, 56],
      ["}", "json-punctuation", 57, 58],
    ],
  );
});

test("analyzeBodyEditorText collects fold targets and tracks normalized fold state", () => {
  const bodyText =
    '{\n  "stream": true,\n  "messages": [\n    {\n      "role": "user"\n    }\n  ],\n  "meta": {\n    "n": 1\n  }\n}';

  const analysis = analyzeBodyEditorText(bodyText);

  assert.equal(analysis.hasJSON, true);
  assert.equal(analysis.hasFoldedBlocks, false);
  assert.equal(analysis.foldableBlockCount, 3);
  assert.equal(analysis.lineCount, 11);
  assert.deepEqual(
    analysis.foldTargets.map((target) => [target.path, target.lineNumber, target.placeholder, target.isRoot]),
    [
      ["$", 1, "{...}", true],
      ["$.messages", 3, "[...]", false],
      ["$.messages.0", 4, "{...}", false],
      ["$.meta", 8, "{...}", false],
    ],
  );

  const folded = analyzeBodyEditorText(bodyText, ["$.messages", "$.missing", "$.meta"]);
  assert.equal(folded.hasFoldedBlocks, true);
  assert.equal(folded.foldedBlockCount, 2);
  assert.equal(folded.isFullyCollapsed, false);
  assert.deepEqual(folded.foldedPaths, ["$.messages", "$.meta"]);
});

test("analyzeBodyEditorText treats invalid JSON as plain text with no fold controls", () => {
  const analysis = analyzeBodyEditorText('{"stream": true,,}');

  assert.equal(analysis.hasJSON, false);
  assert.equal(analysis.hasFoldedBlocks, false);
  assert.equal(analysis.foldableBlockCount, 0);
  assert.equal(analysis.foldTargets.length, 0);
  assert.equal(analysis.lineCount, 1);
});
