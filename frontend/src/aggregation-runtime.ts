import {
  aggregateFragmentsToText,
  normalizeAggregateFragmentKind,
  normalizeAggregateFragments,
  type AggregateFragment,
} from "./aggregate-fragments.js";

export const AGGREGATION_PLUGIN_NONE = "none";
export const AGGREGATION_PLUGIN_OPENAI = "openai";

export type AggregationPluginId =
  | typeof AGGREGATION_PLUGIN_NONE
  | typeof AGGREGATION_PLUGIN_OPENAI;

export type RawTransportMode = "body" | "sse";

export type RawTransportMetadata = {
  mode: RawTransportMode;
  contentType?: string;
  field?: string;
};

export type RawEvent = {
  seq: number;
  transport: RawTransportMetadata;
  rawChunk: string;
  sseData?: string;
  parsedJson?: unknown;
  done: boolean;
  ts: string;
};

export type NormalizedEvent = {
  kind: "json_payload";
  seq: number;
  transport: RawTransportMetadata;
  parsedJson: unknown;
  rawEvent: RawEvent;
  done: boolean;
  ts: string;
};

type AggregationPluginUpdate = {
  append?: AggregateFragment[];
  replace?: AggregateFragment[];
};

export type AggregationRuntimeResult = {
  appendFragments?: AggregateFragment[];
  replaceFragments?: AggregateFragment[];
  error?: string;
};

export interface AggregationPlugin {
  init?(): AggregationPluginUpdate | void;
  onRawEvent?(event: RawEvent): AggregationPluginUpdate | void;
  onNormalizedEvent?(event: NormalizedEvent): AggregationPluginUpdate | void;
  onDone?(): AggregationPluginUpdate | void;
  finalize?(): AggregationPluginUpdate | void;
}

type AggregationPluginDefinition = {
  id: AggregationPluginId;
  label: string;
  description: string;
  create(): AggregationPlugin;
};

const aggregationPluginDefinitions: readonly AggregationPluginDefinition[] = [
  {
    id: AGGREGATION_PLUGIN_NONE,
    label: "None",
    description: "Show raw response output only.",
    create: () => ({}),
  },
  {
    id: AGGREGATION_PLUGIN_OPENAI,
    label: "OpenAI",
    description: "Aggregate OpenAI-style SSE and JSON responses into rendered text fragments.",
    create: () => new OpenAIAggregationPlugin(),
  },
];

export function listAggregationPlugins(): readonly AggregationPluginDefinition[] {
  return aggregationPluginDefinitions;
}

export function resolveAggregationPluginId(
  pluginId: string | null | undefined,
  legacyOpenAIEnabled = false,
): AggregationPluginId {
  const normalized = pluginId?.trim().toLowerCase();
  if (normalized === AGGREGATION_PLUGIN_OPENAI) {
    return AGGREGATION_PLUGIN_OPENAI;
  }
  if (normalized === AGGREGATION_PLUGIN_NONE) {
    return AGGREGATION_PLUGIN_NONE;
  }
  return legacyOpenAIEnabled ? AGGREGATION_PLUGIN_OPENAI : AGGREGATION_PLUGIN_NONE;
}

export class ResponseAggregationRuntime {
  private readonly pluginId: string;
  private readonly plugin: AggregationPlugin | null;
  private fragments: AggregateFragment[] = [];
  private failedMessage: string | null = null;
  private doneHandled = false;
  private finalized = false;

  constructor(
    pluginId: string | null | undefined,
    options?: {
      legacyOpenAIEnabled?: boolean;
      pluginOverride?: AggregationPlugin;
    },
  ) {
    this.pluginId = options?.pluginOverride
      ? pluginId?.trim() || "custom"
      : resolveAggregationPluginId(pluginId, options?.legacyOpenAIEnabled);
    this.plugin =
      options?.pluginOverride ??
      (this.pluginId === AGGREGATION_PLUGIN_NONE
        ? null
        : this.definitionFor(this.pluginId)?.create() ?? null);

    if (this.plugin) {
      const initResult = this.runPluginMethod(() => this.plugin?.init?.());
      if (initResult.error) {
        this.failedMessage = initResult.error;
      }
    }
  }

  isEnabled(): boolean {
    return this.plugin !== null;
  }

  pluginLabel(): string {
    return this.definitionFor(this.pluginId)?.label ?? this.pluginId;
  }

  snapshotFragments(): AggregateFragment[] {
    return this.fragments.map((fragment) => ({ ...fragment }));
  }

  snapshotText(): string {
    return aggregateFragmentsToText(this.fragments);
  }

  consumeRawEvent(event: RawEvent): AggregationRuntimeResult {
    if (!this.plugin || this.failedMessage) {
      return this.noopResult();
    }

    const result = this.runPluginMethod(() => this.plugin?.onRawEvent?.(event));
    if (result.error) {
      return result;
    }

    const normalized = normalizeRawEvent(event);
    if (normalized) {
      const normalizedResult = this.runPluginMethod(() => this.plugin?.onNormalizedEvent?.(normalized));
      if (normalizedResult.error) {
        return normalizedResult;
      }
      mergeRuntimeResults(result, normalizedResult);
    }

    if (event.done && !this.doneHandled) {
      this.doneHandled = true;
      const doneResult = this.runPluginMethod(() => this.plugin?.onDone?.());
      if (doneResult.error) {
        return doneResult;
      }
      mergeRuntimeResults(result, doneResult);
    }

    return result;
  }

  finalize(): AggregationRuntimeResult {
    if (!this.plugin || this.failedMessage || this.finalized) {
      return this.noopResult();
    }

    this.finalized = true;
    const result = this.noopResult();

    if (!this.doneHandled) {
      this.doneHandled = true;
      const doneResult = this.runPluginMethod(() => this.plugin?.onDone?.());
      if (doneResult.error) {
        return doneResult;
      }
      mergeRuntimeResults(result, doneResult);
    }

    const finalizeResult = this.runPluginMethod(() => this.plugin?.finalize?.());
    if (finalizeResult.error) {
      return finalizeResult;
    }
    mergeRuntimeResults(result, finalizeResult);
    return result;
  }

  private definitionFor(pluginId: string): AggregationPluginDefinition | undefined {
    return aggregationPluginDefinitions.find((definition) => definition.id === pluginId);
  }

  private runPluginMethod(
    run: () => AggregationPluginUpdate | void,
  ): AggregationRuntimeResult {
    try {
      return this.applyUpdate(run());
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Unknown plugin error.";
      this.failedMessage = `Aggregation plugin "${this.pluginLabel()}" failed: ${message}`;
      return { error: this.failedMessage };
    }
  }

  private applyUpdate(update: AggregationPluginUpdate | void): AggregationRuntimeResult {
    if (!update) {
      return this.noopResult();
    }

    if (update.replace) {
      const replaceFragments = normalizeAggregateFragments(update.replace);
      this.fragments = replaceFragments.map((fragment) => ({ ...fragment }));
      return { replaceFragments };
    }

    if (update.append) {
      const appendFragments = normalizeAggregateFragments(update.append);
      if (appendFragments.length === 0) {
        return this.noopResult();
      }
      this.fragments = normalizeAggregateFragments([...this.fragments, ...appendFragments]);
      return { appendFragments };
    }

    return this.noopResult();
  }

  private noopResult(): AggregationRuntimeResult {
    return {};
  }
}

function mergeRuntimeResults(
  target: AggregationRuntimeResult,
  incoming: AggregationRuntimeResult,
): AggregationRuntimeResult {
  if (incoming.error) {
    target.error = incoming.error;
  }
  if (incoming.replaceFragments) {
    delete target.appendFragments;
    target.replaceFragments = incoming.replaceFragments;
  } else if (incoming.appendFragments) {
    target.appendFragments = [
      ...(target.appendFragments ?? []),
      ...incoming.appendFragments,
    ];
  }
  return target;
}

function normalizeRawEvent(event: RawEvent): NormalizedEvent | null {
  if (event.parsedJson === undefined) {
    return null;
  }

  return {
    kind: "json_payload",
    seq: event.seq,
    transport: event.transport,
    parsedJson: event.parsedJson,
    rawEvent: event,
    done: event.done,
    ts: event.ts,
  };
}

class OpenAIAggregationPlugin implements AggregationPlugin {
  private readonly bodyChunks: string[] = [];

  onRawEvent(event: RawEvent): AggregationPluginUpdate | void {
    if (event.transport.mode === "body") {
      if (!event.done && event.rawChunk) {
        this.bodyChunks.push(event.rawChunk);
      }
      return;
    }

    if (!event.sseData || event.sseData === "[DONE]") {
      return;
    }

    return {
      append: extractOpenAIFragments(event.parsedJson),
    };
  }

  onDone(): AggregationPluginUpdate | void {
    const bodyText = this.bodyChunks.join("");
    if (!bodyText.trim()) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return;
    }

    const fragments = extractOpenAIFragments(parsed);
    if (fragments.length === 0) {
      return;
    }

    return { replace: fragments };
  }
}

function extractOpenAIFragments(payload: unknown): AggregateFragment[] {
  const data = asRecord(payload);
  if (!data) {
    return [];
  }

  const parts: AggregateFragment[] = [];
  const eventType = stringValue(data.type);
  if (eventType?.endsWith(".delta")) {
    if (typeof data.delta === "string") {
      parts.push({ kind: "content", text: data.delta });
    }
    const delta = asRecord(data.delta);
    if (delta) {
      parts.push(...extractTextFragments(delta));
    }
  }

  if (typeof data.output_text === "string") {
    parts.push({ kind: "content", text: data.output_text });
  }

  const message = asRecord(data.message);
  if (message) {
    parts.push(...extractTextFragments(message));
  }

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      const outputItem = asRecord(item);
      if (outputItem) {
        parts.push(...extractTextFragments(outputItem));
      }
    }
  }

  if (Array.isArray(data.choices)) {
    for (const item of data.choices) {
      const choice = asRecord(item);
      if (!choice) {
        continue;
      }

      if (typeof choice.text === "string") {
        parts.push({ kind: "content", text: choice.text });
      }

      const delta = asRecord(choice.delta);
      if (delta) {
        parts.push(...extractTextFragments(delta));
      }

      const choiceMessage = asRecord(choice.message);
      if (choiceMessage) {
        parts.push(...extractTextFragments(choiceMessage));
      }
    }
  }

  return normalizeAggregateFragments(parts);
}

function extractTextFragments(container: Record<string, unknown>): AggregateFragment[] {
  const keys: Array<{ name: string; kind: AggregateFragment["kind"] }> = [
    { name: "reasoning_content", kind: "thinking" },
    { name: "reasoning", kind: "thinking" },
    { name: "thinking", kind: "thinking" },
    { name: "content", kind: "content" },
  ];

  const parts: AggregateFragment[] = [];
  for (const key of keys) {
    if (!(key.name in container)) {
      continue;
    }
    parts.push(...contentToFragments(container[key.name], key.kind));
  }
  return parts;
}

function contentToFragments(
  value: unknown,
  defaultKind: AggregateFragment["kind"],
): AggregateFragment[] {
  if (typeof value === "string") {
    return value ? [{ kind: defaultKind, text: value }] : [];
  }

  if (Array.isArray(value)) {
    const out: AggregateFragment[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        if (item) {
          out.push({ kind: defaultKind, text: item });
        }
        continue;
      }

      const record = asRecord(item);
      if (!record) {
        continue;
      }

      const nested = extractTextFragments(record);
      if (nested.length > 0) {
        out.push(...nested);
        continue;
      }

      const kind = inferFragmentKind(record, defaultKind);
      if (typeof record.output_text === "string") {
        out.push({ kind: "content", text: record.output_text });
      }
      if (typeof record.text === "string") {
        out.push({ kind, text: record.text });
      }
    }
    return normalizeAggregateFragments(out);
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const nested = extractTextFragments(record);
  if (nested.length > 0) {
    return nested;
  }

  const kind = inferFragmentKind(record, defaultKind);
  const out: AggregateFragment[] = [];
  if (typeof record.output_text === "string") {
    out.push({ kind: "content", text: record.output_text });
  }
  if (typeof record.text === "string") {
    out.push({ kind, text: record.text });
  }
  return normalizeAggregateFragments(out);
}

function inferFragmentKind(
  container: Record<string, unknown>,
  fallback: AggregateFragment["kind"],
): AggregateFragment["kind"] {
  const eventType = stringValue(container.type)?.toLowerCase() ?? "";
  if (eventType.includes("reason") || eventType.includes("thinking")) {
    return "thinking";
  }
  return normalizeAggregateFragmentKind(fallback);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
