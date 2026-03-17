import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  type Range,
  RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  WidgetType,
  gutter,
  gutters,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";

import { prettifyJSONText } from "./json-view.js";

type BodyEditorTokenClass =
  | "json-key"
  | "json-string"
  | "json-number"
  | "json-boolean"
  | "json-null"
  | "json-punctuation";

export type BodyEditorToken = {
  text: string;
  className: BodyEditorTokenClass | null;
  from: number;
  to: number;
};

export type BodyEditorFoldTarget = {
  path: string;
  depth: number;
  isRoot: boolean;
  lineFrom: number;
  lineNumber: number;
  start: number;
  end: number;
  innerFrom: number;
  innerTo: number;
  placeholder: string;
};

export type BodyEditorSnapshot = {
  hasJSON: boolean;
  hasFoldedBlocks: boolean;
  isFullyCollapsed: boolean;
  lineCount: number;
  foldableBlockCount: number;
  foldedBlockCount: number;
  syntaxError: BodyEditorSyntaxError | null;
};

export type BodyEditorAnalysis = BodyEditorSnapshot & {
  tokens: BodyEditorToken[];
  foldTargets: BodyEditorFoldTarget[];
  foldedPaths: string[];
};

export type BodyEditorSyntaxError = {
  message: string;
  from: number;
  to: number;
  line: number;
  column: number;
};

export type BodyEditorChangeReason = "doc" | "fold" | "focus";
export type BodyEditorChangeSource = "user" | "api";

export type BodyEditorStateChangeEvent = {
  reason: BodyEditorChangeReason;
  source: BodyEditorChangeSource;
  snapshot: BodyEditorSnapshot;
};

export type CreateBodyEditorOptions = {
  parent: HTMLElement;
  input: HTMLTextAreaElement;
  placeholderText?: string;
  editable?: boolean;
  undoStorageKey?: string;
  ariaLabelledBy?: string;
  onStateChange?: (event: BodyEditorStateChangeEvent) => void;
};

export type BodyEditorController = {
  destroy(): void;
  focus(selectAll?: boolean): void;
  getText(): string;
  setText(text: string): void;
  setEditable(editable: boolean): void;
  canUndo(): boolean;
  undo(): boolean;
  getSnapshot(): BodyEditorSnapshot;
  collapseAll(): boolean;
  expandAll(): boolean;
  prettify(): string | null;
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

type BodyEditorComputedState = {
  analysis: BodyEditorAnalysis;
  decorations: DecorationSet;
};

type BodyEditorSelectionSnapshot = {
  anchor: number;
  head: number;
};

type BodyEditorUndoEntry = {
  text: string;
  foldedPaths: string[];
  selection: BodyEditorSelectionSnapshot;
};

const setFoldedPathsEffect = StateEffect.define<readonly string[]>();

const editableCompartment = new Compartment();
const MAX_UNDO_ENTRIES = 100;

export function createBodyEditor(options: CreateBodyEditorOptions): BodyEditorController {
  let dispatchSource: BodyEditorChangeSource = "user";
  let undoStack = loadUndoStack(options.undoStorageKey);
  let suppressNextUndoCapture = false;
  let runUndoCommand = (_view: EditorView): boolean => false;

  const state = EditorState.create({
    doc: options.input.value,
    extensions: [
      highlightSpecialChars(),
      gutters({ fixed: true }),
      bodyEditorFoldGutter(),
      lineNumbers(),
      placeholder(options.placeholderText ?? options.input.placeholder ?? ""),
      EditorView.lineWrapping,
      editableCompartment.of(EditorView.editable.of(options.editable ?? true)),
      bodyEditorComputedField,
      bodyEditorKeymap((view) => runUndoCommand(view)),
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

        if (update.docChanged && source === "user" && !suppressNextUndoCapture) {
          undoStack = pushUndoEntry(undoStack, getUndoEntry(update.startState));
          persistUndoStack(options.undoStorageKey, undoStack);
        }
        suppressNextUndoCapture = false;

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

  runUndoCommand = (view) => {
    if (undoStack.length === 0 || !view.state.facet(EditorView.editable)) {
      return false;
    }

    const { entry, stack } = popUndoEntry(undoStack);
    undoStack = stack;
    persistUndoStack(options.undoStorageKey, undoStack);
    suppressNextUndoCapture = true;
    dispatchSource = "user";
    try {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: entry.text,
        },
        effects: setFoldedPathsEffect.of(entry.foldedPaths),
        selection: selectionFromSnapshot(entry.selection, entry.text.length),
      });
    } finally {
      dispatchSource = "user";
    }
    options.input.value = entry.text;
    return true;
  };

  function dispatchWithSource(spec: Parameters<EditorView["dispatch"]>[0], source: BodyEditorChangeSource): void {
    dispatchSource = source;
    try {
      view.dispatch(spec);
    } finally {
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

      dispatchWithSource(
        {
          selection: EditorSelection.create([EditorSelection.range(0, view.state.doc.length)]),
        },
        "api",
      );
    },
    getText() {
      return view.state.doc.toString();
    },
    setText(text: string) {
      undoStack = [];
      persistUndoStack(options.undoStorageKey, undoStack);
      if (text === view.state.doc.toString()) {
        options.input.value = text;
        return;
      }

      dispatchWithSource(
        {
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: text,
          },
          effects: setFoldedPathsEffect.of([]),
        },
        "api",
      );
      options.input.value = text;
    },
    setEditable(editable: boolean) {
      dispatchWithSource(
        {
          effects: editableCompartment.reconfigure(EditorView.editable.of(editable)),
        },
        "api",
      );
    },
    canUndo() {
      return undoStack.length > 0;
    },
    undo() {
      return runUndoCommand(view);
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
      dispatchWithSource(
        {
          effects: setFoldedPathsEffect.of(nextPaths),
        },
        "api",
      );
      return nextPaths.length > 0;
    },
    expandAll() {
      const analysis = view.state.field(bodyEditorComputedField).analysis;
      if (!analysis.hasJSON || analysis.foldedBlockCount === 0) {
        return false;
      }

      dispatchWithSource(
        {
          effects: setFoldedPathsEffect.of([]),
        },
        "api",
      );
      return true;
    },
    prettify() {
      const pretty = prettifyJSONText(view.state.doc.toString());
      if (!pretty) {
        return null;
      }

      undoStack = pushUndoEntry(undoStack, getUndoEntry(view.state));
      persistUndoStack(options.undoStorageKey, undoStack);

      dispatchWithSource(
        {
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: pretty,
          },
          effects: setFoldedPathsEffect.of([]),
        },
        "api",
      );
      options.input.value = pretty;
      return pretty;
    },
  };
}

export function analyzeBodyEditorText(text: string, foldedPaths: Iterable<string> = []): BodyEditorAnalysis {
  const lineStarts = computeLineStarts(text);
  const jsonResult = parseJSONWithRanges(text);
  const parsed = jsonResult.node;
  const foldTargets = parsed ? collectFoldTargets(parsed, lineStarts, text) : [];
  const foldTargetPaths = new Set(foldTargets.map((target) => target.path));
  const normalizedFoldedPaths = Array.from(new Set(foldedPaths)).filter((path) => foldTargetPaths.has(path));
  const defaultCollapsibleTargets = foldTargets.filter((target) => !target.isRoot);

  return {
    hasJSON: parsed !== null,
    hasFoldedBlocks: normalizedFoldedPaths.length > 0,
    isFullyCollapsed:
      defaultCollapsibleTargets.length > 0 &&
      defaultCollapsibleTargets.every((target) => normalizedFoldedPaths.includes(target.path)),
    lineCount: countDisplayLines(text),
    foldableBlockCount: defaultCollapsibleTargets.length,
    foldedBlockCount: normalizedFoldedPaths.length,
    tokens: parsed ? tokenizeBodyEditorText(text) : [],
    foldTargets,
    foldedPaths: normalizedFoldedPaths,
    syntaxError: parsed ? null : jsonResult.error,
  };
}

export function insertBodyEditorText(
  view: Pick<EditorView, "state" | "dispatch">,
  text: string,
): boolean {
  if (!view.state.facet(EditorView.editable)) {
    return true;
  }

  view.dispatch(view.state.replaceSelection(text));
  return true;
}

export function toggleBodyEditorFoldedPath(foldedPaths: Iterable<string>, path: string): string[] {
  const nextPaths = new Set(foldedPaths);
  if (nextPaths.has(path)) {
    nextPaths.delete(path);
  } else {
    nextPaths.add(path);
  }

  return [...nextPaths];
}

export function resolveBodyEditorFoldTarget<T extends Pick<BodyEditorFoldTarget, "path" | "lineFrom">>(
  foldTargets: Iterable<T>,
  options: {
    path?: string | null;
    lineFrom?: number | null;
  },
): T | null {
  if (options.path) {
    for (const target of foldTargets) {
      if (target.path === options.path) {
        return target;
      }
    }
  }

  if (typeof options.lineFrom === "number") {
    for (const target of foldTargets) {
      if (target.lineFrom === options.lineFrom) {
        return target;
      }
    }
  }

  return null;
}

export function collapseJSONText(text: string): string | null {
  const projection = buildBodyEditorProjection(text, true);
  return projection;
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

const bodyEditorComputedField = StateField.define<BodyEditorComputedState>({
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

function bodyEditorFoldGutter(): Extension {
  return gutter({
    class: "cm-body-fold-gutter",
    markers(view) {
      const ranges: Range<GutterMarker>[] = [];
      const computed = view.state.field(bodyEditorComputedField);

      for (const target of computed.analysis.foldTargets) {
        const isFolded = computed.analysis.foldedPaths.includes(target.path);
        ranges.push(new FoldGutterMarker(target.path, isFolded).range(target.lineFrom));
      }

      return RangeSet.of(ranges, true);
    },
    initialSpacer() {
      return new FoldGutterMarker("", false);
    },
    lineMarkerChange(update) {
      return update.docChanged || hasFoldChange(update.transactions);
    },
    domEventHandlers: {
      mousedown(view, line, event) {
        if (!view.state.facet(EditorView.editable)) {
          return false;
        }

        const computed = view.state.field(bodyEditorComputedField);
        const targetPath =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-fold-target-path]")?.dataset.foldTargetPath
            : null;
        const target = resolveBodyEditorFoldTarget(computed.analysis.foldTargets, {
          path: targetPath,
          lineFrom: line.from,
        });
        if (!target) {
          return false;
        }

        event.preventDefault();
        view.dispatch({
          effects: setFoldedPathsEffect.of(
            toggleBodyEditorFoldedPath(computed.analysis.foldedPaths, target.path),
          ),
        });
        return true;
      },
    },
  });
}

function bodyEditorKeymap(runUndo: (view: EditorView) => boolean): Extension {
  return keymap.of([
    {
      key: "Enter",
      run(view) {
        return insertBodyEditorText(view, "\n");
      },
    },
    {
      key: "Shift-Enter",
      run(view) {
        return insertBodyEditorText(view, "\n");
      },
    },
    {
      key: "Mod-z",
      run(view) {
        runUndo(view);
        return true;
      },
    },
    {
      key: "Tab",
      run(view) {
        return insertBodyEditorText(view, "  ");
      },
    },
  ]);
}

export function createBodyEditorSelectionSnapshot(input: {
  anchor: number;
  head: number;
}): BodyEditorSelectionSnapshot {
  return {
    anchor: Math.max(0, Math.trunc(input.anchor)),
    head: Math.max(0, Math.trunc(input.head)),
  };
}

export function pushUndoEntry(
  stack: readonly BodyEditorUndoEntry[],
  entry: BodyEditorUndoEntry,
  maxEntries = MAX_UNDO_ENTRIES,
): BodyEditorUndoEntry[] {
  const normalizedEntry = normalizeUndoEntry(entry);
  if (!normalizedEntry) {
    return [...stack];
  }
  const lastEntry = stack[stack.length - 1];
  if (lastEntry && bodyEditorUndoEntriesEqual(lastEntry, normalizedEntry)) {
    return [...stack];
  }

  const nextStack = [...stack, normalizedEntry];
  if (nextStack.length <= maxEntries) {
    return nextStack;
  }
  return nextStack.slice(nextStack.length - maxEntries);
}

export function popUndoEntry(
  stack: readonly BodyEditorUndoEntry[],
): { entry: BodyEditorUndoEntry; stack: BodyEditorUndoEntry[] } {
  const entry = stack[stack.length - 1];
  if (!entry) {
    throw new Error("Undo stack is empty.");
  }

  return {
    entry,
    stack: stack.slice(0, -1),
  };
}

function getUndoEntry(state: EditorState): BodyEditorUndoEntry {
  return {
    text: state.doc.toString(),
    foldedPaths: [...state.field(bodyEditorComputedField).analysis.foldedPaths],
    selection: createBodyEditorSelectionSnapshot({
      anchor: state.selection.main.anchor,
      head: state.selection.main.head,
    }),
  };
}

function loadUndoStack(storageKey: string | undefined): BodyEditorUndoEntry[] {
  if (!storageKey || typeof sessionStorage === "undefined") {
    return [];
  }

  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .map(normalizeUndoEntry)
      .filter((entry): entry is BodyEditorUndoEntry => entry !== null);
  } catch {
    return [];
  }
}

function persistUndoStack(storageKey: string | undefined, stack: readonly BodyEditorUndoEntry[]): void {
  if (!storageKey || typeof sessionStorage === "undefined") {
    return;
  }

  try {
    if (stack.length === 0) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    sessionStorage.setItem(storageKey, JSON.stringify(stack));
  } catch {
    // Ignore storage failures so the editor keeps working even in restricted browsers.
  }
}

function normalizeUndoEntry(input: unknown): BodyEditorUndoEntry | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const typed = input as Partial<BodyEditorUndoEntry>;
  return {
    text: typeof typed.text === "string" ? typed.text : "",
    foldedPaths: Array.isArray(typed.foldedPaths)
      ? typed.foldedPaths.filter((value): value is string => typeof value === "string")
      : [],
    selection: createBodyEditorSelectionSnapshot({
      anchor:
        typeof typed.selection?.anchor === "number" && Number.isFinite(typed.selection.anchor)
          ? typed.selection.anchor
          : 0,
      head:
        typeof typed.selection?.head === "number" && Number.isFinite(typed.selection.head)
          ? typed.selection.head
          : 0,
    }),
  };
}

function bodyEditorUndoEntriesEqual(left: BodyEditorUndoEntry, right: BodyEditorUndoEntry): boolean {
  return (
    left.text === right.text &&
    left.selection.anchor === right.selection.anchor &&
    left.selection.head === right.selection.head &&
    left.foldedPaths.length === right.foldedPaths.length &&
    left.foldedPaths.every((path, index) => path === right.foldedPaths[index])
  );
}

function selectionFromSnapshot(
  selection: BodyEditorSelectionSnapshot,
  docLength: number,
): EditorSelection {
  return EditorSelection.single(
    clampSelectionPosition(selection.anchor, docLength),
    clampSelectionPosition(selection.head, docLength),
  );
}

function clampSelectionPosition(position: number, docLength: number): number {
  return Math.max(0, Math.min(docLength, Math.trunc(position)));
}

function buildComputedState(text: string, foldedPaths: Iterable<string>): BodyEditorComputedState {
  const analysis = analyzeBodyEditorText(text, foldedPaths);
  const foldedPathSet = new Set(analysis.foldedPaths);
  const ranges: Range<Decoration>[] = [];

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

      ranges.push(
        Decoration.replace({
          widget: new FoldPlaceholderWidget(target.placeholder),
          inclusive: false,
        }).range(target.innerFrom, target.innerTo),
      );
    }
  }

  if (analysis.syntaxError) {
    ranges.push(
      Decoration.mark({ class: "cm-body-json-error" }).range(
        analysis.syntaxError.from,
        analysis.syntaxError.to,
      ),
    );
  }

  return {
    analysis,
    decorations: Decoration.set(ranges, true),
  };
}

function getSnapshot(state: EditorState): BodyEditorSnapshot {
  const analysis = state.field(bodyEditorComputedField).analysis;
  return {
    hasJSON: analysis.hasJSON,
    hasFoldedBlocks: analysis.hasFoldedBlocks,
    isFullyCollapsed: analysis.isFullyCollapsed,
    lineCount: analysis.lineCount,
    foldableBlockCount: analysis.foldableBlockCount,
    foldedBlockCount: analysis.foldedBlockCount,
    syntaxError: analysis.syntaxError,
  };
}

function hasFoldChange(transactions: readonly { effects: readonly StateEffect<unknown>[] }[]): boolean {
  return transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setFoldedPathsEffect)));
}

function collectFoldTargets(root: JsonRangeNode, lineStarts: number[], text: string): BodyEditorFoldTarget[] {
  const targets: BodyEditorFoldTarget[] = [];

  function visit(node: JsonRangeNode, path: string, depth: number, isRoot: boolean): void {
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

function appendPath(path: string, segment: string): string {
  return `${path}.${segment}`;
}

function placeholderTextForNode(node: JsonRangeObjectNode | JsonRangeArrayNode): string {
  return node.type === "array" ? "[...]" : "{...}";
}

function buildBodyEditorProjection(text: string, collapsed: boolean): string | null {
  const parsed = parseJSONWithRanges(text).node;
  if (!parsed) {
    return null;
  }

  if (!collapsed) {
    return text;
  }

  const prettyText = prettifyJSONText(text) ?? text;
  const prettyParsed = parseJSONWithRanges(prettyText).node;
  const segments = prettyParsed
    ? buildCollapsedProjectionSegments(prettyText, prettyParsed)
    : buildCollapsedProjectionSegments(text, parsed);
  return segments.join("");
}

function buildCollapsedProjectionSegments(text: string, root: JsonRangeNode): string[] {
  const segments: string[] = [];

  if (root.start > 0) {
    segments.push(text.slice(0, root.start));
  }

  if (isCompositeNode(root)) {
    segments.push(...buildCollapsedCompositeSegments(text, root));
  } else {
    segments.push(text.slice(root.start, root.end));
  }

  if (root.end < text.length) {
    segments.push(text.slice(root.end));
  }

  return segments.filter((segment) => segment.length > 0);
}

function buildCollapsedCompositeSegments(text: string, node: JsonRangeObjectNode | JsonRangeArrayNode): string[] {
  const compositeChildren =
    node.type === "object"
      ? node.entries.map((entry) => entry.value).filter(isCompositeNode)
      : node.items.filter(isCompositeNode);

  if (compositeChildren.length === 0) {
    return [text.slice(node.start, node.end)];
  }

  const segments: string[] = [];
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

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineIndexForPosition(lineStarts: number[], position: number): number {
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

function countDisplayLines(text: string): number {
  if (!text) {
    return 1;
  }

  return text.split("\n").length;
}

function isCompositeNode(node: JsonRangeNode): node is JsonRangeObjectNode | JsonRangeArrayNode {
  return node.type === "object" || node.type === "array";
}

function parseJSONWithRanges(text: string): {
  node: JsonRangeNode | null;
  error: BodyEditorSyntaxError | null;
} {
  if (!text.trim()) {
    return { node: null, error: null };
  }

  if (!looksLikeJSONObjectOrArray(text)) {
    return { node: null, error: null };
  }

  try {
    return {
      node: new JsonRangeParser(text).parseDocument(),
      error: null,
    };
  } catch (error) {
    if (error instanceof JsonRangeParseError) {
      return {
        node: null,
        error: createBodyEditorSyntaxError(text, error),
      };
    }

    return {
      node: null,
      error: null,
    };
  }
}

function looksLikeJSONObjectOrArray(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function createBodyEditorSyntaxError(
  text: string,
  error: JsonRangeParseError,
): BodyEditorSyntaxError {
  const lineStarts = computeLineStarts(text);
  const boundedPosition = clampSelectionPosition(error.position, text.length);
  const lineIndex = lineIndexForPosition(lineStarts, boundedPosition);
  const lineStart = lineStarts[lineIndex] ?? 0;
  const range = syntaxErrorRangeForPosition(text, boundedPosition);

  return {
    message: error.message,
    from: range.from,
    to: range.to,
    line: lineIndex + 1,
    column: boundedPosition - lineStart + 1,
  };
}

function syntaxErrorRangeForPosition(
  text: string,
  position: number,
): {
  from: number;
  to: number;
} {
  if (text.length === 0) {
    return { from: 0, to: 0 };
  }

  if (position < text.length) {
    return { from: position, to: position + 1 };
  }

  return {
    from: Math.max(0, text.length - 1),
    to: text.length,
  };
}

class JsonRangeParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = "JsonRangeParseError";
    this.position = position;
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
      throw this.error("Unexpected trailing content.");
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

    throw this.error("Unexpected JSON token.");
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

    throw this.error("Unterminated object.");
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

    throw this.error("Unterminated array.");
  }

  private parseString(): JsonRangePrimitiveNode {
    const start = this.index;
    if (this.text[this.index] !== '"') {
      throw this.error("Expected string.");
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

    throw this.error("Unterminated string.");
  }

  private parseNumber(): JsonRangePrimitiveNode {
    const start = this.index;
    const numberMatch = this.text.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!numberMatch) {
      throw this.error("Invalid number.");
    }

    this.index += numberMatch[0].length;
    return { type: "number", start, end: this.index };
  }

  private parseLiteral(
    literal: "true" | "false" | "null",
    type: JsonRangePrimitiveNode["type"],
  ): JsonRangePrimitiveNode {
    const start = this.index;
    this.expect(literal);
    this.index += literal.length;
    return { type, start, end: this.index };
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && /\s/.test(this.text[this.index])) {
      this.index += 1;
    }
  }

  private expect(value: string): void {
    if (!this.text.startsWith(value, this.index)) {
      throw this.error(`Expected ${value}.`);
    }
  }

  private error(message: string): JsonRangeParseError {
    return new JsonRangeParseError(message, this.index);
  }
}

function scanJSONStringEnd(text: string, start: number): number {
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

function scanWhile(text: string, start: number, predicate: (char: string) => boolean): number {
  let index = start;
  while (index < text.length && predicate(text[index])) {
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

  const before = text[start - 1];
  const after = text[start + value.length];
  return !/[A-Za-z0-9_$]/.test(before ?? "") && !/[A-Za-z0-9_$]/.test(after ?? "");
}

function readJSONStringLiteral(text: string, node: JsonRangePrimitiveNode): string {
  return JSON.parse(text.slice(node.start, node.end)) as string;
}

class FoldPlaceholderWidget extends WidgetType {
  private readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  eq(other: FoldPlaceholderWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "json-fold-placeholder";
    element.textContent = this.text;
    element.setAttribute("aria-label", "Folded JSON block");
    return element;
  }
}

class FoldGutterMarker extends GutterMarker {
  readonly elementClass = "cm-body-fold-marker-wrap";
  private readonly path: string;
  private readonly folded: boolean;

  constructor(path: string, folded: boolean) {
    super();
    this.path = path;
    this.folded = folded;
  }

  eq(other: FoldGutterMarker): boolean {
    return other.path === this.path && other.folded === this.folded;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-body-fold-marker";
    element.textContent = this.folded ? "▸" : "▾";
    element.dataset.foldTargetPath = this.path;
    element.setAttribute("aria-hidden", "true");
    return element;
  }
}
