export type CurlExportHeader = {
  key: string;
  value: string;
  enabled?: boolean;
};

export type CurlExportRequest = {
  method: string;
  url: string;
  headers: CurlExportHeader[];
  body: string;
};

export function shellEscapeForPOSIX(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildCurlCommand(request: CurlExportRequest): string {
  const method = normalizeMethod(request.method);
  const url = request.url.trim();

  if (!url) {
    throw new Error("Request URL is required.");
  }

  const args: string[] = [];
  const hasBody = request.body !== "";

  if (method !== "GET" || hasBody) {
    args.push(`-X ${method}`);
  }

  args.push(shellEscapeForPOSIX(url));

  for (const header of request.headers) {
    if (header.enabled === false || !header.key.trim()) {
      continue;
    }
    args.push(`-H ${shellEscapeForPOSIX(`${header.key}: ${header.value}`)}`);
  }

  if (hasBody) {
    args.push(`--data-raw ${shellEscapeForPOSIX(request.body)}`);
  }

  if (request.body.includes("\n") || args.length > 2) {
    return `curl \\\n  ${args.join(" \\\n  ")}`;
  }

  return `curl ${args.join(" ")}`;
}

function normalizeMethod(value: string): string {
  const method = value.trim().toUpperCase();
  return method || "GET";
}
