import assert from "node:assert/strict";
import test from "node:test";

import { PlainRawResponseBuffer } from "../dist/assets/raw-response-buffer.js";

test("PlainRawResponseBuffer keeps the full response after preview trimming", () => {
  const buffer = new PlainRawResponseBuffer(10);

  buffer.append("12345");
  buffer.append("67890");
  buffer.append("abc");

  assert.equal(buffer.previewText(), "4567890abc");
  assert.equal(buffer.snapshotText(), "1234567890abc");
});

test("PlainRawResponseBuffer clears both preview and full response text", () => {
  const buffer = new PlainRawResponseBuffer(4);

  buffer.append("response");
  buffer.clear();

  assert.equal(buffer.previewText(), "");
  assert.equal(buffer.snapshotText(), "");
});
