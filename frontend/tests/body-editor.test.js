import assert from "node:assert/strict";
import test from "node:test";

import { collapseJSONText, tokenizeBodyEditorText } from "../dist/assets/body-editor.js";

test("collapseJSONText keeps root keys while collapsing nested structures", () => {
  assert.equal(
    collapseJSONText('{"stream":true,"messages":[{"role":"user","content":"hi"}],"meta":{"n":1}}'),
    '{\n  "stream": true,\n  "messages": […],\n  "meta": {…}\n}',
  );
  assert.equal(collapseJSONText("not json"), null);
});

test("tokenizeBodyEditorText classifies JSON keys, values, punctuation, and fold placeholders", () => {
  const tokens = tokenizeBodyEditorText('{\n  "meta": {…},\n  "ok": false,\n  "count": 3,\n  "empty": null\n}');
  const classified = tokens.filter((token) => token.className !== null);

  assert.deepEqual(
    classified.map((token) => [token.text, token.className]),
    [
      ["{", "json-punctuation"],
      ['"meta"', "json-key"],
      [":", "json-punctuation"],
      ["{", "json-punctuation"],
      ["…", "json-fold-placeholder"],
      ["}", "json-punctuation"],
      [",", "json-punctuation"],
      ['"ok"', "json-key"],
      [":", "json-punctuation"],
      ["false", "json-boolean"],
      [",", "json-punctuation"],
      ['"count"', "json-key"],
      [":", "json-punctuation"],
      ["3", "json-number"],
      [",", "json-punctuation"],
      ['"empty"', "json-key"],
      [":", "json-punctuation"],
      ["null", "json-null"],
      ["}", "json-punctuation"],
    ],
  );
});
