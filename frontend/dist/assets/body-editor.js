export function renderBodyEditor(container, text, options = {}) {
    const collapsedText = options.collapsed ? collapseJSONText(text) : null;
    const displayText = collapsedText ?? text;
    const hasJSON = text.trim() !== "" && collapsedText !== null;
    container.textContent = "";
    container.classList.add("body-code-editor");
    container.classList.toggle("is-collapsed", collapsedText !== null);
    container.classList.toggle("is-empty", displayText.length === 0);
    container.contentEditable = String(Boolean(options.editable) && collapsedText === null);
    container.setAttribute("aria-readonly", container.contentEditable === "false" ? "true" : "false");
    for (const token of tokenizeBodyEditorText(displayText)) {
        if (!token.className) {
            container.append(document.createTextNode(token.text));
            continue;
        }
        const span = document.createElement("span");
        span.className = token.className;
        span.textContent = token.text;
        container.append(span);
    }
    return {
        hasJSON,
        isCollapsedView: collapsedText !== null,
    };
}
export function readBodyEditorText(container) {
    return container.innerText.replace(/\r\n?/g, "\n");
}
export function captureBodyEditorSelection(container) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return null;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
        return null;
    }
    return {
        start: rangeOffsetFromRoot(container, range.startContainer, range.startOffset),
        end: rangeOffsetFromRoot(container, range.endContainer, range.endOffset),
    };
}
export function restoreBodyEditorSelection(container, selection) {
    if (!selection) {
        return;
    }
    const start = resolveSelectionPoint(container, selection.start);
    const end = resolveSelectionPoint(container, selection.end);
    if (!start || !end) {
        return;
    }
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const currentSelection = window.getSelection();
    currentSelection?.removeAllRanges();
    currentSelection?.addRange(range);
}
export function focusBodyEditor(container, selectAll = false) {
    container.focus();
    if (!selectAll) {
        return;
    }
    selectAllBodyEditorText(container);
}
export function selectAllBodyEditorText(container) {
    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}
export function insertTextAtBodyEditorSelection(container, text) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
        return;
    }
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}
export function collapseJSONText(text) {
    if (!text.trim()) {
        return null;
    }
    try {
        return renderCollapsedJSON(JSON.parse(text), 0, true);
    }
    catch {
        return null;
    }
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
        if (text.startsWith("…", index) || text.startsWith("...", index)) {
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
function renderCollapsedJSON(value, depth, isRoot) {
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return "[]";
        }
        if (!isRoot) {
            return "[…]";
        }
        const indent = indentFor(depth);
        const childIndent = indentFor(depth + 1);
        return `[\n${value
            .map((item) => `${childIndent}${renderCollapsedJSON(item, depth + 1, false)}`)
            .join(",\n")}\n${indent}]`;
    }
    if (isPlainObject(value)) {
        const entries = Object.entries(value);
        if (entries.length === 0) {
            return "{}";
        }
        if (!isRoot) {
            return "{…}";
        }
        const indent = indentFor(depth);
        const childIndent = indentFor(depth + 1);
        return `{\n${entries
            .map(([key, childValue]) => `${childIndent}${JSON.stringify(key)}: ${renderCollapsedJSON(childValue, depth + 1, false)}`)
            .join(",\n")}\n${indent}}`;
    }
    return formatPrimitiveJSON(value);
}
function formatPrimitiveJSON(value) {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (value === null) {
        return "null";
    }
    return String(value);
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function indentFor(depth) {
    return "  ".repeat(depth);
}
function scanJSONStringEnd(text, start) {
    let index = start + 1;
    while (index < text.length) {
        if (text[index] === "\\") {
            index += 2;
            continue;
        }
        if (text[index] === '"') {
            return index + 1;
        }
        index += 1;
    }
    return text.length;
}
function scanWhile(text, start, matches) {
    let index = start;
    while (index < text.length && matches(text[index])) {
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
    const next = text[start + value.length];
    return next === undefined || /[\s,\]}]/.test(next);
}
function rangeOffsetFromRoot(root, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
}
function resolveSelectionPoint(root, targetOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = targetOffset;
    let current = walker.nextNode();
    while (current) {
        const textLength = current.textContent?.length ?? 0;
        if (remaining <= textLength) {
            return { node: current, offset: remaining };
        }
        remaining -= textLength;
        current = walker.nextNode();
    }
    if (root.lastChild) {
        const lastTextNode = deepestTextNode(root.lastChild);
        if (lastTextNode) {
            return {
                node: lastTextNode,
                offset: lastTextNode.textContent?.length ?? 0,
            };
        }
        return {
            node: root,
            offset: root.childNodes.length,
        };
    }
    return {
        node: root,
        offset: 0,
    };
}
function deepestTextNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return node;
    }
    let current = node.lastChild;
    while (current) {
        const match = deepestTextNode(current);
        if (match) {
            return match;
        }
        current = current.previousSibling;
    }
    return null;
}
