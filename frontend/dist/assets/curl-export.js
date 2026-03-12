export function shellEscapeForPOSIX(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
export function buildCurlCommand(request) {
    const method = normalizeMethod(request.method);
    const url = request.url.trim();
    if (!url) {
        throw new Error("Request URL is required.");
    }
    const args = [];
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
function normalizeMethod(value) {
    const method = value.trim().toUpperCase();
    return method || "GET";
}
