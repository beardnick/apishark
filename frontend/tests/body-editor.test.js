import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeBodyEditorText,
  collectBodyEditorTemplateRanges,
  collapseJSONText,
  createBodyEditorSelectionSnapshot,
  insertBodyEditorText,
  popUndoEntry,
  pushUndoEntry,
  resolveBodyEditorFoldTarget,
  toggleBodyEditorFoldedPath,
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
  assert.deepEqual(analysis.syntaxError, {
    message: "Expected string.",
    from: 16,
    to: 17,
    line: 1,
    column: 17,
  });
});

test("analyzeBodyEditorText does not flag arbitrary plain text as invalid JSON", () => {
  const analysis = analyzeBodyEditorText("hello world");

  assert.equal(analysis.hasJSON, false);
  assert.equal(analysis.syntaxError, null);
});

test("collectBodyEditorTemplateRanges marks env and dynamic placeholders separately", () => {
  const text = '{\n  "url": "{{BASE_URL}}",\n  "requestId": "{{$uuid}}"\n}';

  assert.deepEqual(
    collectBodyEditorTemplateRanges(text),
    [
      { from: 12, to: 24, className: "cm-template-env" },
      { from: 43, to: 52, className: "cm-template-dynamic" },
    ],
  );
});

test("insertBodyEditorText dispatches inserted text only when the editor is editable", () => {
  const dispatched = [];
  const transaction = { changes: { insert: "\n" } };
  const editableView = {
    state: {
      facet() {
        return true;
      },
      replaceSelection(text) {
        assert.equal(text, "\n");
        return transaction;
      },
    },
    dispatch(spec) {
      dispatched.push(spec);
    },
  };

  assert.equal(insertBodyEditorText(editableView, "\n"), true);
  assert.deepEqual(dispatched, [transaction]);

  const readOnlyView = {
    state: {
      facet() {
        return false;
      },
      replaceSelection() {
        throw new Error("replaceSelection should not be called for read-only editors");
      },
    },
    dispatch() {
      throw new Error("dispatch should not be called for read-only editors");
    },
  };

  assert.equal(insertBodyEditorText(readOnlyView, "\n"), true);
});

test("toggleBodyEditorFoldedPath adds and removes a folded JSON path", () => {
  assert.deepEqual(toggleBodyEditorFoldedPath([], "$.messages"), ["$.messages"]);
  assert.deepEqual(toggleBodyEditorFoldedPath(["$.messages"], "$.messages"), []);
  assert.deepEqual(
    toggleBodyEditorFoldedPath(["$.messages"], "$.meta"),
    ["$.messages", "$.meta"],
  );
});

test("resolveBodyEditorFoldTarget prefers an explicit marker path before falling back to line selection", () => {
  const foldTargets = [
    { path: "$", lineFrom: 0 },
    { path: "$.messages", lineFrom: 18 },
    { path: "$.messages.0", lineFrom: 18 },
  ];

  assert.deepEqual(
    resolveBodyEditorFoldTarget(foldTargets, {
      path: "$.messages.0",
      lineFrom: 18,
    }),
    { path: "$.messages.0", lineFrom: 18 },
  );
  assert.deepEqual(
    resolveBodyEditorFoldTarget(foldTargets, {
      lineFrom: 18,
    }),
    { path: "$.messages", lineFrom: 18 },
  );
  assert.equal(resolveBodyEditorFoldTarget(foldTargets, { path: "$.missing", lineFrom: 999 }), null);
});

test("pushUndoEntry keeps multiple steps and avoids duplicating identical snapshots", () => {
  let stack = [];
  stack = pushUndoEntry(stack, {
    text: "",
    foldedPaths: [],
    selection: createBodyEditorSelectionSnapshot({ anchor: 0, head: 0 }),
  });
  stack = pushUndoEntry(stack, {
    text: "a",
    foldedPaths: [],
    selection: createBodyEditorSelectionSnapshot({ anchor: 1, head: 1 }),
  });
  stack = pushUndoEntry(stack, {
    text: "a",
    foldedPaths: [],
    selection: createBodyEditorSelectionSnapshot({ anchor: 1, head: 1 }),
  });

  assert.deepEqual(
    stack.map((entry) => [entry.text, entry.selection.anchor, entry.selection.head]),
    [
      ["", 0, 0],
      ["a", 1, 1],
    ],
  );
});

test("popUndoEntry returns the latest snapshot with cursor selection intact", () => {
  const originalEntry = {
    text: '{\n  "value": 1\n}',
    foldedPaths: ["$.value"],
    selection: createBodyEditorSelectionSnapshot({ anchor: 5, head: 9 }),
  };
  const { entry, stack } = popUndoEntry([
    {
      text: "",
      foldedPaths: [],
      selection: createBodyEditorSelectionSnapshot({ anchor: 0, head: 0 }),
    },
    originalEntry,
  ]);

  assert.deepEqual(entry, originalEntry);
  assert.equal(stack.length, 1);
  assert.deepEqual(stack[0].selection, { anchor: 0, head: 0 });
});
