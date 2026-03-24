import {
  aggregateFragmentsToText,
  normalizeAggregateFragmentKind,
  normalizeAggregateFragments,
  type AggregateTextFragmentKind,
  type AggregateFragment,
} from "./aggregate-fragments.js";

export const AGGREGATION_PLUGIN_NONE = "none";
export const AGGREGATION_PLUGIN_OPENAI = "openai";

const CUSTOM_PLUGIN_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const BUILTIN_PLUGIN_IDS = new Set([AGGREGATION_PLUGIN_NONE, AGGREGATION_PLUGIN_OPENAI]);

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

export type AggregationPluginDefinition = {
  id: string;
  label: string;
  description: string;
  create(): AggregationPlugin;
};

export type AggregationPluginDescriptor = {
  id: string;
  label: string;
  description: string;
  builtin: boolean;
  loaded: boolean;
};

export type ImportedAggregationPluginFormat = "json" | "js";

export type ImportedAggregationPluginManifest = {
  id: string;
  label: string;
  description: string;
  module_url?: string;
  imported_at: string;
  format: ImportedAggregationPluginFormat;
  source?: string;
};

export type ImportedAggregationPluginPayload = {
  file_name: string;
  id: string;
  label: string;
  description: string;
  source: string;
  format: ImportedAggregationPluginFormat;
};

type ValidatedPluginModule = {
  id?: string;
  label?: string;
  description?: string;
  create: () => AggregationPlugin;
};

const builtInAggregationPlugins = new Map<string, AggregationPluginDefinition>([
  [
    AGGREGATION_PLUGIN_NONE,
    {
      id: AGGREGATION_PLUGIN_NONE,
      label: "None",
      description: "Show raw response output only.",
      create: () => ({}),
    },
  ],
  [
    AGGREGATION_PLUGIN_OPENAI,
    {
      id: AGGREGATION_PLUGIN_OPENAI,
      label: "OpenAI",
      description: "Aggregate OpenAI-style SSE and JSON responses into rendered text fragments.",
      create: () => new OpenAIAggregationPlugin(),
    },
  ],
]);

const importedPluginManifests = new Map<string, ImportedAggregationPluginManifest>();
const importedPluginDefinitions = new Map<string, AggregationPluginDefinition>();
const importedPluginLoads = new Map<string, Promise<AggregationPluginDefinition>>();

export function listAggregationPlugins(): readonly AggregationPluginDescriptor[] {
  const descriptors: AggregationPluginDescriptor[] = [];

  for (const definition of builtInAggregationPlugins.values()) {
    descriptors.push({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      builtin: true,
      loaded: true,
    });
  }

  const imported = [...importedPluginManifests.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
  for (const manifest of imported) {
    descriptors.push({
      id: manifest.id,
      label: manifest.label,
      description: manifest.description,
      builtin: false,
      loaded: importedPluginDefinitions.has(manifest.id),
    });
  }

  return descriptors;
}

export function setImportedAggregationPluginManifests(
  manifests: readonly ImportedAggregationPluginManifest[],
): void {
  importedPluginManifests.clear();
  importedPluginDefinitions.clear();
  importedPluginLoads.clear();

  for (const manifest of manifests) {
    const id = normalizeImportedAggregationPluginId(manifest.id);
    if (!id) {
      continue;
    }
    importedPluginManifests.set(id, {
      ...manifest,
      id,
      label: manifest.label.trim(),
      description: manifest.description.trim(),
      module_url: manifest.module_url?.trim() || undefined,
      source: manifest.source?.trim() || undefined,
    });
  }
}

export async function ensureAggregationPluginLoaded(pluginId: string | null | undefined): Promise<void> {
  const resolved = resolveAggregationPluginId(pluginId);
  if (resolved === AGGREGATION_PLUGIN_NONE || builtInAggregationPlugins.has(resolved)) {
    return;
  }

  if (importedPluginDefinitions.has(resolved)) {
    return;
  }

  const manifest = importedPluginManifests.get(resolved);
  if (!manifest) {
    return;
  }

  const existing = importedPluginLoads.get(resolved);
  if (existing) {
    await existing;
    return;
  }

  const loadPromise = loadImportedAggregationPlugin(manifest);
  importedPluginLoads.set(resolved, loadPromise);

  try {
    const definition = await loadPromise;
    importedPluginDefinitions.set(resolved, definition);
  } finally {
    importedPluginLoads.delete(resolved);
  }
}

export function getImportedAggregationPluginManifests(): readonly ImportedAggregationPluginManifest[] {
  return [...importedPluginManifests.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export function aggregationPluginLabel(pluginId: string | null | undefined): string {
  const resolved = resolveAggregationPluginId(pluginId);
  return definitionForPlugin(resolved)?.label ?? importedPluginManifests.get(resolved)?.label ?? resolved;
}

export function hasAggregationPlugin(pluginId: string | null | undefined): boolean {
  const resolved = resolveAggregationPluginId(pluginId);
  return builtInAggregationPlugins.has(resolved) || importedPluginManifests.has(resolved);
}

export function resolveAggregationPluginId(
  pluginId: string | null | undefined,
  legacyOpenAIEnabled = false,
): string {
  const normalized = pluginId?.trim().toLowerCase() ?? "";
  if (normalized === AGGREGATION_PLUGIN_OPENAI) {
    return AGGREGATION_PLUGIN_OPENAI;
  }
  if (normalized === AGGREGATION_PLUGIN_NONE) {
    return AGGREGATION_PLUGIN_NONE;
  }
  if (CUSTOM_PLUGIN_ID_PATTERN.test(normalized)) {
    return normalized;
  }
  return legacyOpenAIEnabled ? AGGREGATION_PLUGIN_OPENAI : AGGREGATION_PLUGIN_NONE;
}

export async function parseImportedAggregationPluginFile(
  fileName: string,
  source: string,
): Promise<ImportedAggregationPluginPayload> {
  const trimmedFileName = fileName.trim() || "plugin.js";
  const trimmedSource = source.trim();
  if (!trimmedSource) {
    throw new Error("Plugin file is empty.");
  }

  if (trimmedFileName.toLowerCase().endsWith(".json")) {
    return parseJSONPluginDefinition(trimmedFileName, trimmedSource);
  }
  if (
    trimmedFileName.toLowerCase().endsWith(".js") ||
    trimmedFileName.toLowerCase().endsWith(".mjs")
  ) {
    return parseJavaScriptPluginDefinition(trimmedFileName, trimmedSource);
  }

  throw new Error("Plugin import only supports .json, .js, or .mjs files.");
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
        : definitionForPlugin(this.pluginId)?.create() ?? null);

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
    return aggregationPluginLabel(this.pluginId);
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

  private runPluginMethod(run: () => AggregationPluginUpdate | void): AggregationRuntimeResult {
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

async function parseJSONPluginDefinition(
  fileName: string,
  source: string,
): Promise<ImportedAggregationPluginPayload> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Plugin JSON is invalid: ${error instanceof Error && error.message ? error.message : "parse error"}`,
    );
  }

  const data = asRecord(parsed);
  if (!data) {
    throw new Error("Plugin JSON must be an object.");
  }

  const id = normalizeImportedAggregationPluginId(stringValue(data.id));
  if (!id) {
    throw new Error("Plugin JSON must include a lowercase id like \"vendor.profile\".");
  }
  if (BUILTIN_PLUGIN_IDS.has(id)) {
    throw new Error(`Plugin id "${id}" is reserved by a built-in profile.`);
  }

  const label = stringValue(data.label)?.trim() ?? "";
  if (!label) {
    throw new Error("Plugin JSON must include a non-empty label.");
  }

  const description = stringValue(data.description)?.trim() ?? "";
  const moduleSource = stringValue(data.source)?.trim() ?? "";
  if (!moduleSource) {
    throw new Error("Plugin JSON must include a non-empty source field containing ESM code.");
  }

  await validateAggregationPluginSource(moduleSource, {
    id,
    label,
    description,
  });

  return {
    file_name: fileName,
    id,
    label,
    description,
    source: moduleSource,
    format: "json",
  };
}

async function parseJavaScriptPluginDefinition(
  fileName: string,
  source: string,
): Promise<ImportedAggregationPluginPayload> {
  const module = await validateAggregationPluginSource(source);
  const id = normalizeImportedAggregationPluginId(module.id);
  if (!id) {
    throw new Error("Plugin JS must export a lowercase id like \"vendor.profile\".");
  }
  if (BUILTIN_PLUGIN_IDS.has(id)) {
    throw new Error(`Plugin id "${id}" is reserved by a built-in profile.`);
  }

  const label = module.label?.trim() ?? "";
  if (!label) {
    throw new Error("Plugin JS must export a non-empty label.");
  }

  return {
    file_name: fileName,
    id,
    label,
    description: module.description?.trim() ?? "",
    source,
    format: "js",
  };
}

async function validateAggregationPluginSource(
  source: string,
  metadata?: { id: string; label: string; description: string },
): Promise<ValidatedPluginModule> {
  let loadedModule: unknown;
  try {
    loadedModule = await import(/* @vite-ignore */ toJavaScriptDataURL(source));
  } catch (error) {
    throw new Error(
      `Plugin module could not be loaded: ${error instanceof Error && error.message ? error.message : "unknown module error"}`,
    );
  }

  const validated = validateAggregationPluginModuleExports(loadedModule);
  const plugin = validated.create();
  validateAggregationPluginInstance(plugin);

  if (metadata) {
    if (validated.id && normalizeImportedAggregationPluginId(validated.id) !== metadata.id) {
      throw new Error(
        `Plugin source id "${validated.id}" does not match JSON id "${metadata.id}".`,
      );
    }
    if (validated.label && validated.label.trim() !== metadata.label) {
      throw new Error(
        `Plugin source label "${validated.label}" does not match JSON label "${metadata.label}".`,
      );
    }
  }

  return validated;
}

async function loadImportedAggregationPlugin(
  manifest: ImportedAggregationPluginManifest,
): Promise<AggregationPluginDefinition> {
  const moduleURL = manifest.module_url?.trim() || (manifest.source ? toJavaScriptDataURL(manifest.source) : "");
  if (!moduleURL) {
    throw new Error(`Failed to load aggregation plugin "${manifest.label}": missing module source.`);
  }

  let loadedModule: unknown;
  try {
    loadedModule = await import(/* @vite-ignore */ moduleURL);
  } catch (error) {
    throw new Error(
      `Failed to load aggregation plugin "${manifest.label}": ${error instanceof Error && error.message ? error.message : "unknown module error"}`,
    );
  }

  const validated = validateAggregationPluginModuleExports(loadedModule);
  return {
    id: manifest.id,
    label: manifest.label,
    description: manifest.description,
    create: validated.create,
  };
}

function validateAggregationPluginModuleExports(moduleValue: unknown): ValidatedPluginModule {
  const moduleRecord = asRecord(moduleValue);
  if (!moduleRecord) {
    throw new Error("Plugin module did not export an object.");
  }

  const preferredRoot = pickPluginExportRoot(moduleRecord);
  const create = functionValue(preferredRoot.create) ?? functionValue(moduleRecord.create);
  if (!create) {
    throw new Error("Plugin module must export a create() factory.");
  }

  return {
    id: stringValue(preferredRoot.id) ?? stringValue(moduleRecord.id) ?? undefined,
    label: stringValue(preferredRoot.label) ?? stringValue(moduleRecord.label) ?? undefined,
    description:
      stringValue(preferredRoot.description) ?? stringValue(moduleRecord.description) ?? undefined,
    create,
  };
}

function validateAggregationPluginInstance(pluginValue: unknown): void {
  const plugin = asRecord(pluginValue);
  if (!plugin) {
    throw new Error("Plugin create() must return an object.");
  }

  const allowedMethods = ["init", "onRawEvent", "onNormalizedEvent", "onDone", "finalize"];
  for (const method of allowedMethods) {
    const candidate = plugin[method];
    if (candidate !== undefined && typeof candidate !== "function") {
      throw new Error(`Plugin method "${method}" must be a function.`);
    }
  }
}

function pickPluginExportRoot(moduleRecord: Record<string, unknown>): Record<string, unknown> {
  const defaultExport = asRecord(moduleRecord.default);
  if (defaultExport && ("create" in defaultExport || "id" in defaultExport || "label" in defaultExport)) {
    return defaultExport;
  }
  return moduleRecord;
}

function definitionForPlugin(pluginId: string): AggregationPluginDefinition | undefined {
  return builtInAggregationPlugins.get(pluginId) ?? importedPluginDefinitions.get(pluginId);
}

function normalizeImportedAggregationPluginId(pluginId: string | null | undefined): string | null {
  const normalized = pluginId?.trim().toLowerCase() ?? "";
  if (!CUSTOM_PLUGIN_ID_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function toJavaScriptDataURL(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return `data:text/javascript;base64,${btoa(binary)}`;
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

  const directMedia = extractMediaFragment(data);
  if (directMedia) {
    parts.push(directMedia);
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
  const keys: Array<{ name: string; kind: AggregateTextFragmentKind }> = [
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
  defaultKind: AggregateTextFragmentKind,
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
      const media = extractMediaFragment(record);
      if (media) {
        out.push(media);
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
  const media = extractMediaFragment(record);
  if (media) {
    out.push(media);
  }
  if (typeof record.text === "string") {
    out.push({ kind, text: record.text });
  }
  return normalizeAggregateFragments(out);
}

function inferFragmentKind(
  container: Record<string, unknown>,
  fallback: AggregateTextFragmentKind,
): AggregateTextFragmentKind {
  const eventType = stringValue(container.type)?.toLowerCase() ?? "";
  if (eventType.includes("reason") || eventType.includes("thinking")) {
    return "thinking";
  }
  return fallback === "thinking" ? "thinking" : "content";
}

function extractMediaFragment(container: Record<string, unknown>): AggregateFragment | null {
  const mediaKind = inferMediaKind(container);
  if (!mediaKind) {
    return null;
  }

  const details = extractMediaDetails(container, mediaKind);
  if (!details) {
    return null;
  }

  return {
    kind: mediaKind,
    url: details.url,
    mime: details.mime,
    alt: details.alt,
    title: details.title,
  };
}

function inferMediaKind(
  container: Record<string, unknown>,
): "image" | "video" | null {
  const eventType = stringValue(container.type)?.toLowerCase() ?? "";
  if (eventType.includes("image")) {
    return "image";
  }
  if (eventType.includes("video")) {
    return "video";
  }
  if ("image_url" in container || "image" in container || "b64_json" in container) {
    return "image";
  }
  if ("video_url" in container || "video" in container) {
    return "video";
  }
  return null;
}

function extractMediaDetails(
  container: Record<string, unknown>,
  kind: "image" | "video",
): {
  url: string;
  mime?: string;
  alt?: string;
  title?: string;
} | null {
  const fieldCandidates = kind === "image" ? ["image_url", "image", "url", "src"] : ["video_url", "video", "url", "src"];
  for (const field of fieldCandidates) {
    const details = mediaDetailsFromValue(container[field], {
      mime: pickFirstString(container.mime_type, container.mime),
      alt: pickFirstString(container.alt, container.alt_text),
      title: pickFirstString(container.title, container.name),
    });
    if (details) {
      return details;
    }
  }

  if (kind === "image") {
    const dataURL = base64ToDataURL(
      stringValue(container.b64_json),
      pickFirstString(container.mime_type, container.mime) ?? "image/png",
    );
    if (dataURL) {
      return {
        url: dataURL,
        mime: pickFirstString(container.mime_type, container.mime) ?? "image/png",
        alt: normalizeOptionalString(pickFirstString(container.alt, container.alt_text)),
        title: normalizeOptionalString(pickFirstString(container.title, container.name)),
      };
    }
  }

  return null;
}

function mediaDetailsFromValue(
  value: unknown,
  defaults: { mime?: string | null; alt?: string | null; title?: string | null },
): {
  url: string;
  mime?: string;
  alt?: string;
  title?: string;
} | null {
  if (typeof value === "string") {
    const url = value.trim();
    if (!url) {
      return null;
    }
    return {
      url,
      mime: normalizeOptionalString(defaults.mime),
      alt: normalizeOptionalString(defaults.alt),
      title: normalizeOptionalString(defaults.title),
    };
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const url = pickFirstString(record.url, record.uri, record.src, record.href);
  if (!url) {
    return null;
  }

  return {
    url,
    mime: normalizeOptionalString(pickFirstString(record.mime_type, record.mime) ?? defaults.mime),
    alt: normalizeOptionalString(pickFirstString(record.alt, record.alt_text) ?? defaults.alt),
    title: normalizeOptionalString(pickFirstString(record.title, record.name) ?? defaults.title),
  };
}

function base64ToDataURL(base64: string | null, mime: string): string | null {
  const normalized = base64?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  return `data:${mime};base64,${normalized}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function functionValue(value: unknown): (() => AggregationPlugin) | null {
  return typeof value === "function" ? (value as () => AggregationPlugin) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}
