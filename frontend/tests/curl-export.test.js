import assert from "node:assert/strict";
import test from "node:test";

import { buildCurlCommand, shellEscapeForPOSIX } from "../dist/assets/curl-export.js";

test("shellEscapeForPOSIX wraps and escapes single quotes", () => {
  assert.equal(shellEscapeForPOSIX("it's\nfine"), `'it'"'"'s
fine'`);
});

test("buildCurlCommand omits explicit GET when there is no body", () => {
  const command = buildCurlCommand({
    method: "GET",
    url: "https://api.example.com/items?limit=10",
    headers: [
      { key: "Accept", value: "application/json" },
      { key: "Authorization", value: "Bearer hidden", enabled: false },
      { key: "", value: "ignored" },
    ],
    body: "",
  });

  assert.equal(
    command,
    `curl 'https://api.example.com/items?limit=10' -H 'Accept: application/json'`,
  );
  assert.doesNotMatch(command, /-X GET/);
  assert.doesNotMatch(command, /Authorization/);
});

test("buildCurlCommand preserves enabled request data in a multiline command", () => {
  const command = buildCurlCommand({
    method: "POST",
    url: "https://api.example.com/v1/chat/completions",
    headers: [
      { key: "Content-Type", value: "application/json" },
      { key: "X-Note", value: "it's multiline" },
    ],
    body: '{\n  "message": "it\'s working"\n}',
  });

  assert.equal(
    command,
    `curl \\
  -X POST \\
  'https://api.example.com/v1/chat/completions' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Note: it'"'"'s multiline' \\
  --data-raw '{
  "message": "it'"'"'s working"
}'`,
  );
});

test("buildCurlCommand keeps explicit GET when a body is present", () => {
  const command = buildCurlCommand({
    method: "GET",
    url: "https://api.example.com/search",
    headers: [],
    body: '{"q":"shark"}',
  });

  assert.equal(
    command,
    `curl \\
  -X GET \\
  'https://api.example.com/search' \\
  --data-raw '{"q":"shark"}'`,
  );
});

test("buildCurlCommand rejects an empty URL", () => {
  assert.throws(
    () =>
      buildCurlCommand({
        method: "POST",
        url: "   ",
        headers: [],
        body: "",
      }),
    /Request URL is required/,
  );
});
