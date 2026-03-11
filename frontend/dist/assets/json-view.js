const NOOP_CONTROLLER = {
    hasJSON: false,
    expandAll: () => undefined,
    collapseAll: () => undefined,
};
export function prettifyJSONText(text) {
    if (!text.trim()) {
        return null;
    }
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    }
    catch {
        return null;
    }
}
export function renderJSONText(container, text, options = {}) {
    if (!text.trim()) {
        container.textContent = "";
        return NOOP_CONTROLLER;
    }
    try {
        const value = JSON.parse(text);
        return renderJSONValue(container, value, options);
    }
    catch {
        container.textContent = "";
        return NOOP_CONTROLLER;
    }
}
export function renderJSONValue(container, value, options = {}) {
    container.textContent = "";
    container.classList.add("json-viewer");
    const expandDepth = options.expandDepth ?? 1;
    container.appendChild(renderNode(value, null, 0, expandDepth));
    return {
        hasJSON: true,
        expandAll: () => {
            for (const details of container.querySelectorAll("details")) {
                details.open = true;
            }
        },
        collapseAll: () => {
            const allDetails = [...container.querySelectorAll("details")];
            allDetails.forEach((details, index) => {
                details.open = index === 0;
            });
        },
    };
}
function renderNode(value, key, depth, expandDepth) {
    if (Array.isArray(value)) {
        return renderCompositeNode(value, key, depth, expandDepth, "[", "]", `${value.length} items`);
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        return renderCompositeNode(value, key, depth, expandDepth, "{", "}", `${keys.length} keys`);
    }
    const row = document.createElement("div");
    row.className = "json-leaf";
    if (key !== null) {
        row.appendChild(createKeyLabel(key));
    }
    row.appendChild(createValueNode(value));
    return row;
}
function renderCompositeNode(value, key, depth, expandDepth, openBracket, closeBracket, metaText) {
    const details = document.createElement("details");
    details.className = "json-node";
    details.open = depth < expandDepth;
    const summary = document.createElement("summary");
    if (key !== null) {
        summary.appendChild(createKeyLabel(key));
    }
    const summaryValue = document.createElement("span");
    summaryValue.className = "json-summary-value";
    summaryValue.appendChild(createPunctuation(openBracket));
    const meta = document.createElement("span");
    meta.className = "json-meta";
    meta.textContent = metaText;
    summaryValue.appendChild(meta);
    summaryValue.appendChild(createPunctuation(closeBracket));
    summary.appendChild(summaryValue);
    const children = document.createElement("div");
    children.className = "json-children";
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            children.appendChild(renderNode(item, String(index), depth + 1, expandDepth));
        });
    }
    else {
        Object.entries(value).forEach(([childKey, childValue]) => {
            children.appendChild(renderNode(childValue, childKey, depth + 1, expandDepth));
        });
    }
    if (children.childElementCount === 0) {
        details.open = true;
    }
    details.append(summary, children);
    return details;
}
function createKeyLabel(key) {
    const wrapper = document.createElement("span");
    wrapper.className = "json-key-wrap";
    const keyNode = document.createElement("span");
    keyNode.className = "json-key";
    keyNode.textContent = `"${key}"`;
    wrapper.append(keyNode, document.createTextNode(": "));
    return wrapper;
}
function createValueNode(value) {
    const span = document.createElement("span");
    span.className = `json-value ${valueClassName(value)}`;
    span.textContent = formatPrimitive(value);
    return span;
}
function createPunctuation(value) {
    const span = document.createElement("span");
    span.className = "json-punctuation";
    span.textContent = value;
    return span;
}
function formatPrimitive(value) {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (value === null) {
        return "null";
    }
    return String(value);
}
function valueClassName(value) {
    if (typeof value === "string") {
        return "json-string";
    }
    if (typeof value === "number") {
        return "json-number";
    }
    if (typeof value === "boolean") {
        return "json-boolean";
    }
    return "json-null";
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
