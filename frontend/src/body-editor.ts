type BodyEditorTokenClass =
  | "json-key"
  | "json-string"
  | "json-number"
  | "json-boolean"
  | "json-null"
  | "json-punctuation"
  | "json-fold-placeholder";

type BodyEditorToken = {
  text: string;
  className: BodyEditorTokenClass | null;
};

type BodyEditorRenderSegment =
  | {
      kind: "visible";
      text: string;
    }
  | {
      kind: "placeholder";
      text: string;
      sourceText: string;
    };

type BodyEditorProjection = {
  hasJSON: boolean;
  isCollapsedView: boolean;
  segments: BodyEditorRenderSegment[];
};

type JsonRangeNode =
  | JsonRangeObjectNode
  | JsonRangeArrayNode
  | JsonRangePrimitiveNode;

type JsonRangeObjectNode = {
  type: "object";
  start: number;
  end: number;
  entries: Array<{
    key: JsonRangePrimitiveNode;
    value: JsonRangeNode;
  }>;
};

type JsonRangeArrayNode = {
  type: "array";
  start: number;
  end: number;
  items: JsonRangeNode[];
};

type JsonRangePrimitiveNode = {
  type: "string" | "number" | "boolean" | "null";
  start: number;
  end: number;
};

type BodyEditorTextCarrier = {
  __bodyEditorSourceText?: string;
};

const BODY_EDITOR_SOURCE_TEXT_KEY = "__bodyEditorSourceText";
const TEXT_NODE = 3;

export type BodyEditorSelection = {
  start: number;
  end: number;
};

export type BodyEditorRenderResult = {
  hasJSON: boolean;
  isCollapsedView: boolean;
};

export type BodyEditorRenderOptions = {
  collapsed?: boolean;
  editable?: boolean;
};

export type ResolveBodyEditorRenderOptionsInput = {
  requestedCollapsed: boolean;
  isActive: boolean;
  requestIsLoading: boolean;
};

export function resolveBodyEditorRenderOptions(
  input: ResolveBodyEditorRenderOptionsInput,
): BodyEditorRenderOptions {
  return {
    collapsed: input.requestedCollapsed,
    editable: !input.requestIsLoading,
  };
}

export function renderBodyEditor(
  container: HTMLElement,
  text: string,
  options: BodyEditorRenderOptions = {},
): BodyEditorRenderResult {
  const projection = buildBodyEditorProjection(text, Boolean(options.collapsed));

  container.textContent = "";
  container.classList.add("body-code-editor");
  container.classList.toggle("is-collapsed", projection.isCollapsedView);
  container.classList.toggle("is-empty", projection.segments.length === 0);
  container.contentEditable = String(Boolean(options.editable));
  container.setAttribute("aria-readonly", container.contentEditable === "false" ? "true" : "false");

  for (const segment of projection.segments) {
    if (segment.kind === "placeholder") {
      const span = document.createElement("span");
      span.className = "json-fold-placeholder";
      span.textContent = segment.text;
      span.contentEditable = "false";
      span.setAttribute("aria-label", "Folded JSON block");
      (span as HTMLElement & BodyEditorTextCarrier)[BODY_EDITOR_SOURCE_TEXT_KEY] = segment.sourceText;
      container.append(span);
      continue;
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

  return {
    hasJSON: projection.hasJSON,
    isCollapsedView: projection.isCollapsedView,
  };
}

export function readBodyEditorText(container: HTMLElement): string {
  return readBodyEditorNodeText(container).replace(/\r\n?/g, "\n");
}

export function captureBodyEditorSelection(container: HTMLElement): BodyEditorSelection | null {
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

export function restoreBodyEditorSelection(
  container: HTMLElement,
  selection: BodyEditorSelection | null,
): void {
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

export function focusBodyEditor(container: HTMLElement, selectAll = false): void {
  container.focus();
  if (!selectAll) {
    return;
  }
  selectAllBodyEditorText(container);
}

export function selectAllBodyEditorText(container: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function insertTextAtBodyEditorSelection(container: HTMLElement, text: string): void {
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

export function collapseJSONText(text: string): string | null {
  const projection = buildBodyEditorProjection(text, true);
  if (!projection.hasJSON) {
    return null;
  }

  return projection.segments.map((segment) => segment.text).join("");
}

export function tokenizeBodyEditorText(text: string): BodyEditorToken[] {
  const tokens: BodyEditorToken[] = [];
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

function buildBodyEditorProjection(text: string, collapsed: boolean): BodyEditorProjection {
  const parsed = parseJSONWithRanges(text);
  if (!parsed) {
    return {
      hasJSON: false,
      isCollapsedView: false,
      segments: text ? [{ kind: "visible", text }] : [],
    };
  }

  if (!collapsed) {
    return {
      hasJSON: true,
      isCollapsedView: false,
      segments: text ? [{ kind: "visible", text }] : [],
    };
  }

  return {
    hasJSON: true,
    isCollapsedView: true,
    segments: buildCollapsedProjectionSegments(text, parsed),
  };
}

function buildCollapsedProjectionSegments(text: string, root: JsonRangeNode): BodyEditorRenderSegment[] {
  const segments: BodyEditorRenderSegment[] = [];

  if (root.start > 0) {
    segments.push({ kind: "visible", text: text.slice(0, root.start) });
  }

  if (isCompositeNode(root)) {
    segments.push(...buildCollapsedCompositeSegments(text, root));
  } else {
    segments.push({ kind: "visible", text: text.slice(root.start, root.end) });
  }

  if (root.end < text.length) {
    segments.push({ kind: "visible", text: text.slice(root.end) });
  }

  return segments.filter((segment) => segment.text.length > 0);
}

function buildCollapsedCompositeSegments(
  text: string,
  node: JsonRangeObjectNode | JsonRangeArrayNode,
): BodyEditorRenderSegment[] {
  const compositeChildren =
    node.type === "object"
      ? node.entries.map((entry) => entry.value).filter(isCompositeNode)
      : node.items.filter(isCompositeNode);

  if (compositeChildren.length === 0) {
    return [{ kind: "visible", text: text.slice(node.start, node.end) }];
  }

  const segments: BodyEditorRenderSegment[] = [];
  let cursor = node.start;

  for (const child of compositeChildren) {
    if (cursor < child.start) {
      segments.push({ kind: "visible", text: text.slice(cursor, child.start) });
    }

    segments.push({
      kind: "placeholder",
      text: placeholderTextForNode(child),
      sourceText: text.slice(child.start, child.end),
    });
    cursor = child.end;
  }

  if (cursor < node.end) {
    segments.push({ kind: "visible", text: text.slice(cursor, node.end) });
  }

  return segments.filter((segment) => segment.text.length > 0);
}

function placeholderTextForNode(node: JsonRangeObjectNode | JsonRangeArrayNode): string {
  return node.type === "array" ? "[…]" : "{…}";
}

function isCompositeNode(node: JsonRangeNode): node is JsonRangeObjectNode | JsonRangeArrayNode {
  return node.type === "object" || node.type === "array";
}

function parseJSONWithRanges(text: string): JsonRangeNode | null {
  if (!text.trim()) {
    return null;
  }

  try {
    JSON.parse(text);
    return new JsonRangeParser(text).parseDocument();
  } catch {
    return null;
  }
}

class JsonRangeParser {
  private readonly text: string;
  private index = 0;

  constructor(text: string) {
    this.text = text;
  }

  parseDocument(): JsonRangeNode {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      throw new Error("Unexpected trailing content.");
    }
    return value;
  }

  private parseValue(): JsonRangeNode {
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

  private parseObject(): JsonRangeObjectNode {
    const start = this.index;
    this.index += 1;
    this.skipWhitespace();

    const entries: JsonRangeObjectNode["entries"] = [];
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

  private parseArray(): JsonRangeArrayNode {
    const start = this.index;
    this.index += 1;
    this.skipWhitespace();

    const items: JsonRangeArrayNode["items"] = [];
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

  private parseString(): JsonRangePrimitiveNode {
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

  private parseNumber(): JsonRangePrimitiveNode {
    const start = this.index;
    const match = this.text
      .slice(this.index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) {
      throw new Error("Invalid number.");
    }

    this.index += match[0].length;
    return { type: "number", start, end: this.index };
  }

  private parseLiteral(
    value: "true" | "false" | "null",
    type: JsonRangePrimitiveNode["type"],
  ): JsonRangePrimitiveNode {
    const start = this.index;
    this.index += value.length;
    return { type, start, end: this.index };
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && /\s/.test(this.text[this.index])) {
      this.index += 1;
    }
  }

  private expect(token: string): void {
    if (this.text[this.index] !== token) {
      throw new Error(`Expected "${token}".`);
    }
  }
}

function readBodyEditorNodeText(node: Node): string {
  const carriedText = (node as Node & BodyEditorTextCarrier)[BODY_EDITOR_SOURCE_TEXT_KEY];
  if (typeof carriedText === "string") {
    return carriedText;
  }

  if (node.nodeType === TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.childNodes.length === 0) {
    return node.textContent ?? "";
  }

  let text = "";
  for (const child of Array.from(node.childNodes)) {
    text += readBodyEditorNodeText(child);
  }
  return text;
}

function scanJSONStringEnd(text: string, start: number): number {
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

function scanWhile(text: string, start: number, matches: (value: string) => boolean): number {
  let index = start;
  while (index < text.length && matches(text[index])) {
    index += 1;
  }
  return index;
}

function skipWhitespace(text: string, start: number): number {
  return scanWhile(text, start, (value) => /\s/.test(value));
}

function isBoundaryToken(text: string, start: number, value: string): boolean {
  if (!text.startsWith(value, start)) {
    return false;
  }

  const next = text[start + value.length];
  return next === undefined || /[\s,\]}]/.test(next);
}

function rangeOffsetFromRoot(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function resolveSelectionPoint(
  root: HTMLElement,
  targetOffset: number,
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = targetOffset;
  let current: Node | null = walker.nextNode();

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

function deepestTextNode(node: Node): Node | null {
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
