import assert from "node:assert/strict";
import test from "node:test";

import { buildCurlCommand, shellEscapeForPOSIX } from "../dist/assets/curl-export.js";
import { resolveRequestDraft } from "../dist/assets/request-resolution.js";

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

test("buildCurlCommand uses resolved dynamic placeholders for export", () => {
  const resolved = resolveRequestDraft(
    {
      method: "POST",
      url: "https://api.example.com/items/{{$uuid}}?q={{$urlencode(shark teeth)}}",
      headers: [{ key: "X-At", value: "{{$isoNow}}" }],
      body: '{"trace":"{{$uuid}}","stamp":"{{$now}}"}',
    },
    {},
    {
      now: new Date("2026-03-12T01:02:03.456Z"),
      uuid: () => "123e4567-e89b-42d3-a456-426614174000",
    },
  );

  const command = buildCurlCommand(resolved);

  assert.equal(
    command,
    `curl \\
  -X POST \\
  'https://api.example.com/items/123e4567-e89b-42d3-a456-426614174000?q=shark%20teeth' \\
  -H 'X-At: 2026-03-12T01:02:03.456Z' \\
  --data-raw '{"trace":"123e4567-e89b-42d3-a456-426614174000","stamp":"1773277323"}'`,
  );
});
