import { prettifyJSONText } from "./json-view.js";
export function resolveBodyEditorRenderOptions(input) {
    return {
        collapsed: input.requestedCollapsed,
        editable: !input.requestIsLoading,
    };
}
export function renderBodyEditor(container, text, options = {}) {
    const projection = buildBodyEditorProjection(text, Boolean(options.collapsed));
    const displayText = projection.displayText;
    container.textContent = "";
    container.classList.add("body-code-editor");
    container.classList.toggle("is-collapsed", projection.isCollapsedView);
    container.classList.toggle("is-empty", displayText.length === 0);
    container.classList.toggle("is-readonly", !options.editable || projection.isCollapsedView);
    container.setAttribute("data-mode", projection.isCollapsedView ? "folded" : "editor");
    for (const segment of projection.segments) {
        appendSegmentTokens(container, segment);
    }
    return {
        hasJSON: projection.hasJSON,
        isCollapsedView: projection.isCollapsedView,
        displayText,
        lineCount: countDisplayLines(displayText),
    };
}
export function collapseJSONText(text) {
    const projection = buildBodyEditorProjection(text, true);
    if (!projection.hasJSON) {
        return null;
    }
    return projection.displayText;
}
export function tokenizeBodyEditorText(text) {
    const tokens = [];
    let index = 0;
    while (index < text.length) {
        const char = text[index];
        if (char === '"') {
            const end = scanJSONStringEnd(text, index);
            const value = text.slice(index, end);
            const next = skipWhitespace(text, end);
            tokens.push({
                text: value,
                className: text[next] === ":" ? "json-key" : "json-string",
            });
            index = end;
            continue;
        }
        if (/\s/.test(char)) {
            const end = scanWhile(text, index, (value) => /\s/.test(value));
            tokens.push({ text: text.slice(index, end), className: null });
            index = end;
            continue;
        }
        if ("{}[]:,".includes(char)) {
            tokens.push({ text: char, className: "json-punctuation" });
            index += 1;
            continue;
        }
        if (text.startsWith("...", index) || text.startsWith("…", index)) {
            const placeholder = text.startsWith("...", index) ? "..." : "…";
            tokens.push({ text: placeholder, className: "json-fold-placeholder" });
            index += placeholder.length;
            continue;
        }
        if (isBoundaryToken(text, index, "true")) {
            tokens.push({ text: "true", className: "json-boolean" });
            index += 4;
            continue;
        }
        if (isBoundaryToken(text, index, "false")) {
            tokens.push({ text: "false", className: "json-boolean" });
            index += 5;
            continue;
        }
        if (isBoundaryToken(text, index, "null")) {
            tokens.push({ text: "null", className: "json-null" });
            index += 4;
            continue;
        }
        const numberMatch = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (numberMatch) {
            tokens.push({ text: numberMatch[0], className: "json-number" });
            index += numberMatch[0].length;
            continue;
        }
        tokens.push({ text: char, className: null });
        index += 1;
    }
    return tokens;
}
function appendSegmentTokens(container, segment) {
    if (segment.kind === "placeholder") {
        const span = document.createElement("span");
        span.className = "json-fold-placeholder";
        span.textContent = segment.text;
        span.setAttribute("aria-label", "Folded JSON block");
        container.append(span);
        return;
    }
    for (const token of tokenizeBodyEditorText(segment.text)) {
        if (!token.className) {
            container.append(document.createTextNode(token.text));
            continue;
        }
        const span = document.createElement("span");
        span.className = token.className;
        span.textContent = token.text;
        container.append(span);
    }
}
function buildBodyEditorProjection(text, collapsed) {
    const parsed = parseJSONWithRanges(text);
    if (!parsed) {
        return {
            hasJSON: false,
            isCollapsedView: false,
            displayText: text,
            segments: text ? [{ kind: "visible", text }] : [],
        };
    }
    if (!collapsed) {
        return {
            hasJSON: true,
            isCollapsedView: false,
            displayText: text,
            segments: text ? [{ kind: "visible", text }] : [],
        };
    }
    const prettyText = prettifyJSONText(text) ?? text;
    const prettyParsed = parseJSONWithRanges(prettyText);
    const segments = prettyParsed
        ? buildCollapsedProjectionSegments(prettyText, prettyParsed)
        : buildCollapsedProjectionSegments(text, parsed);
    const displayText = segments.map((segment) => segment.text).join("");
    return {
        hasJSON: true,
        isCollapsedView: true,
        displayText,
        segments,
    };
}
function buildCollapsedProjectionSegments(text, root) {
    const segments = [];
    if (root.start > 0) {
        segments.push({ kind: "visible", text: text.slice(0, root.start) });
    }
    if (isCompositeNode(root)) {
        segments.push(...buildCollapsedCompositeSegments(text, root));
    }
    else {
        segments.push({ kind: "visible", text: text.slice(root.start, root.end) });
    }
    if (root.end < text.length) {
        segments.push({ kind: "visible", text: text.slice(root.end) });
    }
    return segments.filter((segment) => segment.text.length > 0);
}
function buildCollapsedCompositeSegments(text, node) {
    const compositeChildren = node.type === "object"
        ? node.entries.map((entry) => entry.value).filter(isCompositeNode)
        : node.items.filter(isCompositeNode);
    if (compositeChildren.length === 0) {
        return [{ kind: "visible", text: text.slice(node.start, node.end) }];
    }
    const segments = [];
    let cursor = node.start;
    for (const child of compositeChildren) {
        if (cursor < child.start) {
            segments.push({ kind: "visible", text: text.slice(cursor, child.start) });
        }
        segments.push({
            kind: "placeholder",
            text: placeholderTextForNode(child),
        });
        cursor = child.end;
    }
    if (cursor < node.end) {
        segments.push({ kind: "visible", text: text.slice(cursor, node.end) });
    }
    return segments.filter((segment) => segment.text.length > 0);
}
function placeholderTextForNode(node) {
    return node.type === "array" ? "[...]" : "{...}";
}
function countDisplayLines(text) {
    if (!text) {
        return 1;
    }
    return text.split("\n").length;
}
function isCompositeNode(node) {
    return node.type === "object" || node.type === "array";
}
function parseJSONWithRanges(text) {
    if (!text.trim()) {
        return null;
    }
    try {
        JSON.parse(text);
        return new JsonRangeParser(text).parseDocument();
    }
    catch {
        return null;
    }
}
class JsonRangeParser {
    constructor(text) {
        this.index = 0;
        this.text = text;
    }
    parseDocument() {
        this.skipWhitespace();
        const value = this.parseValue();
        this.skipWhitespace();
        if (this.index !== this.text.length) {
            throw new Error("Unexpected trailing content.");
        }
        return value;
    }
    parseValue() {
        this.skipWhitespace();
        const char = this.text[this.index];
        if (char === "{") {
            return this.parseObject();
        }
        if (char === "[") {
            return this.parseArray();
        }
        if (char === '"') {
            return this.parseString();
        }
        if (char === "-" || /\d/.test(char ?? "")) {
            return this.parseNumber();
        }
        if (this.text.startsWith("true", this.index)) {
            return this.parseLiteral("true", "boolean");
        }
        if (this.text.startsWith("false", this.index)) {
            return this.parseLiteral("false", "boolean");
        }
        if (this.text.startsWith("null", this.index)) {
            return this.parseLiteral("null", "null");
        }
        throw new Error("Unexpected JSON token.");
    }
    parseObject() {
        const start = this.index;
        this.index += 1;
        this.skipWhitespace();
        const entries = [];
        if (this.text[this.index] === "}") {
            this.index += 1;
            return { type: "object", start, end: this.index, entries };
        }
        while (this.index < this.text.length) {
            const key = this.parseString();
            this.skipWhitespace();
            this.expect(":");
            this.index += 1;
            const value = this.parseValue();
            entries.push({ key, value });
            this.skipWhitespace();
            if (this.text[this.index] === "}") {
                this.index += 1;
                return { type: "object", start, end: this.index, entries };
            }
            this.expect(",");
            this.index += 1;
            this.skipWhitespace();
        }
        throw new Error("Unterminated object.");
    }
    parseArray() {
        const start = this.index;
        this.index += 1;
        this.skipWhitespace();
        const items = [];
        if (this.text[this.index] === "]") {
            this.index += 1;
            return { type: "array", start, end: this.index, items };
        }
        while (this.index < this.text.length) {
            items.push(this.parseValue());
            this.skipWhitespace();
            if (this.text[this.index] === "]") {
                this.index += 1;
                return { type: "array", start, end: this.index, items };
            }
            this.expect(",");
            this.index += 1;
            this.skipWhitespace();
        }
        throw new Error("Unterminated array.");
    }
    parseString() {
        const start = this.index;
        if (this.text[this.index] !== '"') {
            throw new Error("Expected string.");
        }
        this.index += 1;
        while (this.index < this.text.length) {
            const char = this.text[this.index];
            if (char === "\\") {
                this.index += 2;
                continue;
            }
            if (char === '"') {
                this.index += 1;
                return { type: "string", start, end: this.index };
            }
            this.index += 1;
        }
        throw new Error("Unterminated string.");
    }
    parseNumber() {
        const start = this.index;
        const numberMatch = this.text.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (!numberMatch) {
            throw new Error("Invalid number.");
        }
        this.index += numberMatch[0].length;
        return { type: "number", start, end: this.index };
    }
    parseLiteral(literal, type) {
        const start = this.index;
        this.expect(literal);
        this.index += literal.length;
        return { type, start, end: this.index };
    }
    skipWhitespace() {
        while (this.index < this.text.length && /\s/.test(this.text[this.index])) {
            this.index += 1;
        }
    }
    expect(value) {
        if (!this.text.startsWith(value, this.index)) {
            throw new Error(`Expected ${value}.`);
        }
    }
}
function scanJSONStringEnd(text, start) {
    let index = start + 1;
    while (index < text.length) {
        const char = text[index];
        if (char === "\\") {
            index += 2;
            continue;
        }
        if (char === '"') {
            return index + 1;
        }
        index += 1;
    }
    return text.length;
}
function scanWhile(text, start, predicate) {
    let index = start;
    while (index < text.length && predicate(text[index])) {
        index += 1;
    }
    return index;
}
function skipWhitespace(text, start) {
    return scanWhile(text, start, (value) => /\s/.test(value));
}
function isBoundaryToken(text, start, value) {
    if (!text.startsWith(value, start)) {
        return false;
    }
    const before = text[start - 1];
    const after = text[start + value.length];
    return !/[A-Za-z0-9_$]/.test(before ?? "") && !/[A-Za-z0-9_$]/.test(after ?? "");
}
