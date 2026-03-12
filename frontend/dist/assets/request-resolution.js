const STATIC_PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const DYNAMIC_CALL_PATTERN = /^([A-Za-z][A-Za-z0-9]*)\(([\s\S]*)\)$/;
const RANDOM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export class RequestResolutionError extends Error {
    constructor(message) {
        super(message);
        this.name = "RequestResolutionError";
    }
}
export function resolveTemplate(input, env, options = {}) {
    const context = createResolutionContext(env, options);
    return resolveTemplateWithContext(input, context);
}
export function resolveRequestDraft(draft, env, options = {}) {
    const context = createResolutionContext(env, options);
    return {
        ...draft,
        url: resolveTemplateWithContext(draft.url, context),
        headers: draft.headers.map((header) => ({
            key: resolveTemplateWithContext(header.key, context),
            value: resolveTemplateWithContext(header.value, context),
        })),
        body: resolveTemplateWithContext(draft.body, context),
    };
}
function createResolutionContext(env, options) {
    const nowOption = options.now;
    return {
        env,
        cache: new Map(),
        random: options.random ?? Math.random,
        uuid: options.uuid ?? defaultUUID,
        nowFactory: typeof nowOption === "function" ? nowOption : () => nowOption ?? new Date(),
        nowValue: null,
    };
}
function resolveTemplateWithContext(input, context) {
    if (!input) {
        return input;
    }
    const staticResolved = input.replace(STATIC_PLACEHOLDER_PATTERN, (match, key) => {
        return Object.prototype.hasOwnProperty.call(context.env, key) ? context.env[key] : match;
    });
    return resolveDynamicPlaceholders(staticResolved, context);
}
function resolveDynamicPlaceholders(input, context) {
    if (!input.includes("{{$")) {
        return input;
    }
    let output = "";
    let cursor = 0;
    while (cursor < input.length) {
        const start = input.indexOf("{{$", cursor);
        if (start < 0) {
            output += input.slice(cursor);
            break;
        }
        output += input.slice(cursor, start);
        const end = input.indexOf("}}", start + 3);
        if (end < 0) {
            throw new RequestResolutionError(`Invalid dynamic placeholder starting at "${input.slice(start)}": missing closing "}}".`);
        }
        const token = input.slice(start, end + 2);
        const expression = input.slice(start + 3, end).trim();
        output += resolveDynamicToken(token, expression, context);
        cursor = end + 2;
    }
    return output;
}
function resolveDynamicToken(token, expression, context) {
    const cached = context.cache.get(token);
    if (cached !== undefined) {
        return cached;
    }
    if (!expression) {
        throw new RequestResolutionError(`Invalid dynamic placeholder ${token}: expression is empty.`);
    }
    const resolved = evaluateDynamicExpression(token, expression, context);
    context.cache.set(token, resolved);
    return resolved;
}
function evaluateDynamicExpression(token, expression, context) {
    switch (expression) {
        case "uuid":
            return context.uuid();
        case "now":
            return String(Math.floor(getNow(context).getTime() / 1000));
        case "nowMs":
            return String(getNow(context).getTime());
        case "isoNow":
            return getNow(context).toISOString();
        default:
            break;
    }
    const callMatch = expression.match(DYNAMIC_CALL_PATTERN);
    if (!callMatch) {
        throw new RequestResolutionError(`Unsupported dynamic placeholder ${token}. Supported forms: {{$uuid}}, {{$now}}, {{$nowMs}}, {{$isoNow}}, {{$randInt(min,max)}}, {{$randStr(len)}}, {{$base64(text)}}, {{$urlencode(text)}}.`);
    }
    const [, name, rawArgs] = callMatch;
    switch (name) {
        case "uuid":
        case "now":
        case "nowMs":
        case "isoNow":
            if (rawArgs.trim() !== "") {
                throw new RequestResolutionError(`Invalid dynamic placeholder ${token}: ${name} does not accept arguments.`);
            }
            return evaluateDynamicExpression(token, name, context);
        case "randInt":
            return resolveRandInt(token, rawArgs, context);
        case "randStr":
            return resolveRandStr(token, rawArgs, context);
        case "base64":
            return encodeBase64Utf8(rawArgs);
        case "urlencode":
            return encodeURIComponent(rawArgs);
        default:
            throw new RequestResolutionError(`Unsupported dynamic placeholder ${token}. Function "${name}" is not allowed.`);
    }
}
function resolveRandInt(token, rawArgs, context) {
    const parts = rawArgs.split(",");
    if (parts.length !== 2) {
        throw new RequestResolutionError(`Invalid dynamic placeholder ${token}: randInt(min,max) expects two integer arguments.`);
    }
    const min = parseIntegerArg(parts[0], token, "randInt min");
    const max = parseIntegerArg(parts[1], token, "randInt max");
    if (min > max) {
        throw new RequestResolutionError(`Invalid dynamic placeholder ${token}: randInt(min,max) requires min <= max.`);
    }
    const randomValue = context.random();
    const normalized = Math.min(Math.max(randomValue, 0), 0.9999999999999999);
    return String(Math.floor(normalized * (max - min + 1)) + min);
}
function resolveRandStr(token, rawArgs, context) {
    const length = parseIntegerArg(rawArgs, token, "randStr len");
    if (length < 0) {
        throw new RequestResolutionError(`Invalid dynamic placeholder ${token}: randStr(len) requires len >= 0.`);
    }
    let output = "";
    for (let index = 0; index < length; index += 1) {
        const randomValue = context.random();
        const normalized = Math.min(Math.max(randomValue, 0), 0.9999999999999999);
        const charIndex = Math.floor(normalized * RANDOM_CHARS.length);
        output += RANDOM_CHARS[charIndex];
    }
    return output;
}
function parseIntegerArg(rawValue, token, label) {
    const value = rawValue.trim();
    if (!/^-?\d+$/.test(value)) {
        throw new RequestResolutionError(`Invalid dynamic placeholder ${token}: ${label} must be an integer.`);
    }
    return Number.parseInt(value, 10);
}
function getNow(context) {
    if (context.nowValue) {
        return context.nowValue;
    }
    context.nowValue = context.nowFactory();
    return context.nowValue;
}
function defaultUUID() {
    if (!globalThis.crypto?.randomUUID) {
        throw new RequestResolutionError("crypto.randomUUID() is unavailable in this browser.");
    }
    return globalThis.crypto.randomUUID();
}
function encodeBase64Utf8(input) {
    const bytes = new TextEncoder().encode(input);
    const buffer = globalThis.Buffer;
    if (buffer) {
        return buffer.from(bytes).toString("base64");
    }
    if (typeof globalThis.btoa === "function") {
        let binary = "";
        for (const byte of bytes) {
            binary += String.fromCharCode(byte);
        }
        return globalThis.btoa(binary);
    }
    throw new RequestResolutionError("Base64 encoding is unavailable in this runtime.");
}
