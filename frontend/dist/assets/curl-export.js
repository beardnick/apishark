export function shellEscapeForPOSIX(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
export function buildCurlCommand(request) {
    const method = normalizeMethod(request.method);
    const url = request.url.trim();
    const bodyMode = normalizeBodyMode(request.body_mode);
    const bodyFields = normalizeBodyFields(request.body_fields);
    if (!url) {
        throw new Error("Request URL is required.");
    }
    const args = [];
    const hasBody = bodyMode === "raw"
        ? request.body !== ""
        : bodyFields.some((field) => field.enabled !== false && field.key.trim() !== "");
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
        switch (bodyMode) {
            case "form_urlencoded":
                for (const field of bodyFields) {
                    if (field.enabled === false || !field.key.trim()) {
                        continue;
                    }
                    args.push(`--data-urlencode ${shellEscapeForPOSIX(`${field.key}=${field.value}`)}`);
                }
                break;
            case "multipart":
                for (const field of bodyFields) {
                    if (field.enabled === false || !field.key.trim()) {
                        continue;
                    }
                    args.push(`-F ${shellEscapeForPOSIX(`${field.key}=${field.value}`)}`);
                }
                break;
            default:
                args.push(`--data-raw ${shellEscapeForPOSIX(request.body)}`);
                break;
        }
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
function normalizeBodyMode(value) {
    switch (value) {
        case "form_urlencoded":
        case "multipart":
            return value;
        default:
            return "raw";
    }
}
function normalizeBodyFields(fields) {
    if (!Array.isArray(fields)) {
        return [];
    }
    return fields.map((field) => ({
        key: typeof field?.key === "string" ? field.key : "",
        value: typeof field?.value === "string" ? field.value : "",
        enabled: typeof field?.enabled === "boolean" ? field.enabled : true,
    }));
}
