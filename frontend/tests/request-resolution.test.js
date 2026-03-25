import assert from "node:assert/strict";
import test from "node:test";

import {
  RequestResolutionError,
  resolveRequestDraft,
  resolveTemplate,
} from "../dist/assets/request-resolution.js";

test("resolveTemplate preserves static env placeholders and leaves missing vars unchanged", () => {
  const output = resolveTemplate("Bearer {{TOKEN}} / {{MISSING}}", {
    TOKEN: "secret-token",
  });

  assert.equal(output, "Bearer secret-token / {{MISSING}}");
});

test("resolveRequestDraft resolves dynamic placeholders with shared per-action values", () => {
  const resolved = resolveRequestDraft(
    {
      method: "POST",
      url: "https://api.example.test/{{$uuid}}?at={{TOKEN}}&ts={{$now}}",
      headers: [
        { key: "X-Trace", value: "req-{{$uuid}}" },
        { key: "X-NowMs", value: "{{$nowMs}}" },
      ],
      body: JSON.stringify({
        id: "{{$uuid}}",
        iso: "{{$isoNow}}",
        count: "{{$randInt(3,5)}}",
        code: "{{$randStr(4)}}",
        token: "{{TOKEN}}",
      }),
    },
    { TOKEN: "static-token" },
    {
      now: new Date("2026-03-12T01:02:03.456Z"),
      random: (() => {
        const values = [0.25, 0.5, 0.0, 0.98, 0.4];
        let index = 0;
        return () => values[index++] ?? 0;
      })(),
      uuid: () => "123e4567-e89b-42d3-a456-426614174000",
    },
  );

  assert.equal(
    resolved.url,
    "https://api.example.test/123e4567-e89b-42d3-a456-426614174000?at=static-token&ts=1773277323",
  );
  assert.deepEqual(resolved.headers, [
    { key: "X-Trace", value: "req-123e4567-e89b-42d3-a456-426614174000" },
    { key: "X-NowMs", value: "1773277323456" },
  ]);
  assert.equal(
    resolved.body,
    JSON.stringify({
      id: "123e4567-e89b-42d3-a456-426614174000",
      iso: "2026-03-12T01:02:03.456Z",
      count: "3",
      code: "fA8Y",
      token: "static-token",
    }),
  );
});

test("resolveRequestDraft resolves structured body fields", () => {
  const resolved = resolveRequestDraft(
    {
      method: "POST",
      url: "https://api.example.test/forms/{{$uuid}}",
      headers: [],
      body_mode: "form_urlencoded",
      body: "",
      body_fields: [
        { key: "token", value: "{{TOKEN}}", enabled: true },
        { key: "trace", value: "{{$uuid}}", enabled: true },
        { key: "disabled", value: "{{TOKEN}}", enabled: false },
      ],
    },
    { TOKEN: "secret-token" },
    {
      uuid: () => "123e4567-e89b-42d3-a456-426614174000",
    },
  );

  assert.equal(resolved.body_mode, "form_urlencoded");
  assert.deepEqual(resolved.body_fields, [
    { key: "token", value: "secret-token", enabled: true },
    { key: "trace", value: "123e4567-e89b-42d3-a456-426614174000", enabled: true },
    { key: "disabled", value: "secret-token", enabled: false },
  ]);
});

test("resolveTemplate supports base64 and urlencode helpers", () => {
  const output = resolveTemplate("{{$base64(shark)}} {{$urlencode(a b+c/?)}}", {});
  assert.equal(output, "c2hhcms= a%20b%2Bc%2F%3F");
});

test("resolveTemplate throws a readable error for invalid dynamic placeholders", () => {
  assert.throws(
    () => resolveTemplate("{{$randInt(one,2)}}", {}),
    (error) =>
      error instanceof RequestResolutionError &&
      error.message ===
        'Invalid dynamic placeholder {{$randInt(one,2)}}: randInt min must be an integer.',
  );
});
