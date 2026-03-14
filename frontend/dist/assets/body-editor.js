import { Compartment, EditorSelection, EditorState, RangeSet, StateEffect, StateField, } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, gutters, highlightSpecialChars, keymap, lineNumbers, placeholder, } from "@codemirror/view";
import { prettifyJSONText } from "./json-view.js";
const setFoldedPathsEffect = StateEffect.define();
const editableCompartment = new Compartment();
export function createBodyEditor(options) {
    let dispatchSource = "user";
    const state = EditorState.create({
        doc: options.input.value,
        extensions: [
            highlightSpecialChars(),
            gutters({ fixed: true }),
            bodyEditorFoldGutter(),
            lineNumbers(),
            placeholder(options.placeholderText ?? options.input.placeholder ?? ""),
            editableCompartment.of(EditorView.editable.of(options.editable ?? true)),
            bodyEditorComputedField,
            bodyEditorKeymap(),
            EditorView.contentAttributes.of({
                ...(options.ariaLabelledBy ? { "aria-labelledby": options.ariaLabelledBy } : {}),
                "aria-multiline": "true",
                spellcheck: "false",
            }),
            EditorView.updateListener.of((update) => {
                const source = dispatchSource;
                dispatchSource = "user";
                if (!update.docChanged && !hasFoldChange(update.transactions)) {
                    return;
                }
                options.input.value = update.state.doc.toString();
                options.onStateChange?.({
                    reason: update.docChanged ? "doc" : "fold",
                    source,
                    snapshot: getSnapshot(update.state),
                });
            }),
            EditorView.domEventHandlers({
                focus() {
                    options.onStateChange?.({
                        reason: "focus",
                        source: "user",
                        snapshot: getSnapshot(view.state),
                    });
                    return false;
                },
                blur() {
                    window.setTimeout(() => {
                        options.onStateChange?.({
                            reason: "focus",
                            source: "user",
                            snapshot: getSnapshot(view.state),
                        });
                    }, 0);
                    return false;
                },
            }),
        ],
    });
    const view = new EditorView({
        state,
        parent: options.parent,
    });
    options.parent.classList.add("body-code-editor");
    options.input.value = view.state.doc.toString();
    function dispatchWithSource(spec, source) {
        dispatchSource = source;
        try {
            view.dispatch(spec);
        }
        finally {
            dispatchSource = "user";
        }
    }
    return {
        destroy() {
            view.destroy();
        },
        focus(selectAll = false) {
            view.focus();
            if (!selectAll) {
                return;
            }
            dispatchWithSource({
                selection: EditorSelection.create([EditorSelection.range(0, view.state.doc.length)]),
            }, "api");
        },
        getText() {
            return view.state.doc.toString();
        },
        setText(text) {
            if (text === view.state.doc.toString()) {
                options.input.value = text;
                return;
            }
            dispatchWithSource({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: text,
                },
                effects: setFoldedPathsEffect.of([]),
            }, "api");
            options.input.value = text;
        },
        setEditable(editable) {
            dispatchWithSource({
                effects: editableCompartment.reconfigure(EditorView.editable.of(editable)),
            }, "api");
        },
        getSnapshot() {
            return getSnapshot(view.state);
        },
        collapseAll() {
            const analysis = view.state.field(bodyEditorComputedField).analysis;
            if (!analysis.hasJSON) {
                return false;
            }
            const nextPaths = analysis.foldTargets.filter((target) => !target.isRoot).map((target) => target.path);
            dispatchWithSource({
                effects: setFoldedPathsEffect.of(nextPaths),
            }, "api");
            return nextPaths.length > 0;
        },
        expandAll() {
            const analysis = view.state.field(bodyEditorComputedField).analysis;
            if (!analysis.hasJSON || analysis.foldedBlockCount === 0) {
                return false;
            }
            dispatchWithSource({
                effects: setFoldedPathsEffect.of([]),
            }, "api");
            return true;
        },
        prettify() {
            const pretty = prettifyJSONText(view.state.doc.toString());
            if (!pretty) {
                return null;
            }
            dispatchWithSource({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: pretty,
                },
                effects: setFoldedPathsEffect.of([]),
            }, "api");
            options.input.value = pretty;
            return pretty;
        },
    };
}
export function analyzeBodyEditorText(text, foldedPaths = []) {
    const lineStarts = computeLineStarts(text);
    const parsed = parseJSONWithRanges(text);
    const foldTargets = parsed ? collectFoldTargets(parsed, lineStarts, text) : [];
    const foldTargetPaths = new Set(foldTargets.map((target) => target.path));
    const normalizedFoldedPaths = Array.from(new Set(foldedPaths)).filter((path) => foldTargetPaths.has(path));
    const defaultCollapsibleTargets = foldTargets.filter((target) => !target.isRoot);
    return {
        hasJSON: parsed !== null,
        hasFoldedBlocks: normalizedFoldedPaths.length > 0,
        isFullyCollapsed: defaultCollapsibleTargets.length > 0 &&
            defaultCollapsibleTargets.every((target) => normalizedFoldedPaths.includes(target.path)),
        lineCount: countDisplayLines(text),
        foldableBlockCount: defaultCollapsibleTargets.length,
        foldedBlockCount: normalizedFoldedPaths.length,
        tokens: parsed ? tokenizeBodyEditorText(text) : [],
        foldTargets,
        foldedPaths: normalizedFoldedPaths,
    };
}
export function collapseJSONText(text) {
    const projection = buildBodyEditorProjection(text, true);
    return projection;
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
                from: index,
                to: end,
            });
            index = end;
            continue;
        }
        if (/\s/.test(char)) {
            const end = scanWhile(text, index, (value) => /\s/.test(value));
            tokens.push({ text: text.slice(index, end), className: null, from: index, to: end });
            index = end;
            continue;
        }
        if ("{}[]:,".includes(char)) {
            tokens.push({ text: char, className: "json-punctuation", from: index, to: index + 1 });
            index += 1;
            continue;
        }
        if (isBoundaryToken(text, index, "true")) {
            tokens.push({ text: "true", className: "json-boolean", from: index, to: index + 4 });
            index += 4;
            continue;
        }
        if (isBoundaryToken(text, index, "false")) {
            tokens.push({ text: "false", className: "json-boolean", from: index, to: index + 5 });
            index += 5;
            continue;
        }
        if (isBoundaryToken(text, index, "null")) {
            tokens.push({ text: "null", className: "json-null", from: index, to: index + 4 });
            index += 4;
            continue;
        }
        const numberMatch = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (numberMatch) {
            tokens.push({
                text: numberMatch[0],
                className: "json-number",
                from: index,
                to: index + numberMatch[0].length,
            });
            index += numberMatch[0].length;
            continue;
        }
        tokens.push({ text: char, className: null, from: index, to: index + 1 });
        index += 1;
    }
    return tokens;
}
const bodyEditorComputedField = StateField.define({
    create(state) {
        return buildComputedState(state.doc.toString(), []);
    },
    update(value, transaction) {
        let nextFoldedPaths = value.analysis.foldedPaths;
        let foldChanged = false;
        for (const effect of transaction.effects) {
            if (effect.is(setFoldedPathsEffect)) {
                nextFoldedPaths = [...effect.value];
                foldChanged = true;
            }
        }
        if (!transaction.docChanged && !foldChanged) {
            return value;
        }
        return buildComputedState(transaction.state.doc.toString(), nextFoldedPaths);
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
function bodyEditorFoldGutter() {
    return gutter({
        class: "cm-body-fold-gutter",
        markers(view) {
            const ranges = [];
            const computed = view.state.field(bodyEditorComputedField);
            for (const target of computed.analysis.foldTargets) {
                const isFolded = computed.analysis.foldedPaths.includes(target.path);
                ranges.push(new FoldGutterMarker(isFolded).range(target.lineFrom));
            }
            return RangeSet.of(ranges, true);
        },
        initialSpacer() {
            return new FoldGutterMarker(false);
        },
        lineMarkerChange(update) {
            return update.docChanged || hasFoldChange(update.transactions);
        },
        domEventHandlers: {
            mousedown(view, line, event) {
                const target = view.state.field(bodyEditorComputedField).foldTargetsByLine.get(line.from);
                if (!target || !view.state.facet(EditorView.editable)) {
                    return false;
                }
                event.preventDefault();
                const computed = view.state.field(bodyEditorComputedField);
                const foldedPaths = new Set(computed.analysis.foldedPaths);
                if (foldedPaths.has(target.path)) {
                    foldedPaths.delete(target.path);
                }
                else {
                    foldedPaths.add(target.path);
                }
                view.dispatch({
                    effects: setFoldedPathsEffect.of([...foldedPaths]),
                });
                return true;
            },
        },
    });
}
function bodyEditorKeymap() {
    return keymap.of([
        {
            key: "Tab",
            run(view) {
                if (!view.state.facet(EditorView.editable)) {
                    return true;
                }
                view.dispatch(view.state.replaceSelection("  "));
                return true;
            },
        },
    ]);
}
function buildComputedState(text, foldedPaths) {
    const analysis = analyzeBodyEditorText(text, foldedPaths);
    const foldTargetsByLine = new Map();
    for (const target of analysis.foldTargets) {
        foldTargetsByLine.set(target.lineFrom, target);
    }
    const foldedPathSet = new Set(analysis.foldedPaths);
    const ranges = [];
    if (analysis.hasJSON) {
        for (const token of analysis.tokens) {
            if (!token.className) {
                continue;
            }
            ranges.push(Decoration.mark({ class: token.className }).range(token.from, token.to));
        }
        for (const target of analysis.foldTargets) {
            if (!foldedPathSet.has(target.path) || target.innerFrom >= target.innerTo) {
                continue;
            }
            ranges.push(Decoration.replace({
                widget: new FoldPlaceholderWidget(target.placeholder),
                inclusive: false,
            }).range(target.innerFrom, target.innerTo));
        }
    }
    return {
        analysis,
        decorations: Decoration.set(ranges, true),
        foldTargetsByLine,
    };
}
function getSnapshot(state) {
    const analysis = state.field(bodyEditorComputedField).analysis;
    return {
        hasJSON: analysis.hasJSON,
        hasFoldedBlocks: analysis.hasFoldedBlocks,
        isFullyCollapsed: analysis.isFullyCollapsed,
        lineCount: analysis.lineCount,
        foldableBlockCount: analysis.foldableBlockCount,
        foldedBlockCount: analysis.foldedBlockCount,
    };
}
function hasFoldChange(transactions) {
    return transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setFoldedPathsEffect)));
}
function collectFoldTargets(root, lineStarts, text) {
    const targets = [];
    function visit(node, path, depth, isRoot) {
        if (!isCompositeNode(node)) {
            return;
        }
        if ((node.type === "object" && node.entries.length > 0) || (node.type === "array" && node.items.length > 0)) {
            targets.push({
                path,
                depth,
                isRoot,
                lineFrom: lineStarts[lineIndexForPosition(lineStarts, node.start)],
                lineNumber: lineIndexForPosition(lineStarts, node.start) + 1,
                start: node.start,
                end: node.end,
                innerFrom: node.start + 1,
                innerTo: node.end - 1,
                placeholder: placeholderTextForNode(node),
            });
        }
        if (node.type === "object") {
            for (const entry of node.entries) {
                visit(entry.value, appendPath(path, readJSONStringLiteral(text, entry.key)), depth + 1, false);
            }
            return;
        }
        for (let index = 0; index < node.items.length; index += 1) {
            visit(node.items[index], appendPath(path, String(index)), depth + 1, false);
        }
    }
    if (isCompositeNode(root)) {
        visit(root, "$", 0, true);
    }
    return targets;
}
function appendPath(path, segment) {
    return `${path}.${segment}`;
}
function placeholderTextForNode(node) {
    return node.type === "array" ? "[...]" : "{...}";
}
function buildBodyEditorProjection(text, collapsed) {
    const parsed = parseJSONWithRanges(text);
    if (!parsed) {
        return null;
    }
    if (!collapsed) {
        return text;
    }
    const prettyText = prettifyJSONText(text) ?? text;
    const prettyParsed = parseJSONWithRanges(prettyText);
    const segments = prettyParsed
        ? buildCollapsedProjectionSegments(prettyText, prettyParsed)
        : buildCollapsedProjectionSegments(text, parsed);
    return segments.join("");
}
function buildCollapsedProjectionSegments(text, root) {
    const segments = [];
    if (root.start > 0) {
        segments.push(text.slice(0, root.start));
    }
    if (isCompositeNode(root)) {
        segments.push(...buildCollapsedCompositeSegments(text, root));
    }
    else {
        segments.push(text.slice(root.start, root.end));
    }
    if (root.end < text.length) {
        segments.push(text.slice(root.end));
    }
    return segments.filter((segment) => segment.length > 0);
}
function buildCollapsedCompositeSegments(text, node) {
    const compositeChildren = node.type === "object"
        ? node.entries.map((entry) => entry.value).filter(isCompositeNode)
        : node.items.filter(isCompositeNode);
    if (compositeChildren.length === 0) {
        return [text.slice(node.start, node.end)];
    }
    const segments = [];
    let cursor = node.start;
    for (const child of compositeChildren) {
        if (cursor < child.start) {
            segments.push(text.slice(cursor, child.start));
        }
        segments.push(placeholderTextForNode(child));
        cursor = child.end;
    }
    if (cursor < node.end) {
        segments.push(text.slice(cursor, node.end));
    }
    return segments.filter((segment) => segment.length > 0);
}
function computeLineStarts(text) {
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === "\n") {
            starts.push(index + 1);
        }
    }
    return starts;
}
function lineIndexForPosition(lineStarts, position) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const start = lineStarts[mid];
        const nextStart = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
        if (position < start) {
            high = mid - 1;
            continue;
        }
        if (position >= nextStart) {
            low = mid + 1;
            continue;
        }
        return mid;
    }
    return lineStarts.length - 1;
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
function readJSONStringLiteral(text, node) {
    return JSON.parse(text.slice(node.start, node.end));
}
class FoldPlaceholderWidget extends WidgetType {
    constructor(text) {
        super();
        this.text = text;
    }
    eq(other) {
        return other.text === this.text;
    }
    toDOM() {
        const element = document.createElement("span");
        element.className = "json-fold-placeholder";
        element.textContent = this.text;
        element.setAttribute("aria-label", "Folded JSON block");
        return element;
    }
}
class FoldGutterMarker extends GutterMarker {
    constructor(folded) {
        super();
        this.elementClass = "cm-body-fold-marker-wrap";
        this.folded = folded;
    }
    eq(other) {
        return other.folded === this.folded;
    }
    toDOM() {
        const element = document.createElement("span");
        element.className = "cm-body-fold-marker";
        element.textContent = this.folded ? "▸" : "▾";
        element.setAttribute("aria-hidden", "true");
        return element;
    }
}
