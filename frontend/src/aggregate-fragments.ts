export type AggregateTextFragmentKind = "content" | "thinking";
export type AggregateMediaFragmentKind = "image" | "video";
export type AggregateFragmentKind =
  | AggregateTextFragmentKind
  | AggregateMediaFragmentKind;

export type AggregateTextFragment = {
  kind: AggregateTextFragmentKind;
  text: string;
};

export type AggregateMediaFragment = {
  kind: AggregateMediaFragmentKind;
  url: string;
  mime?: string;
  alt?: string;
  title?: string;
};

export type AggregateFragment = AggregateTextFragment | AggregateMediaFragment;
type AggregateFragmentCandidate = {
  kind?: string;
  text?: string;
  url?: string;
  mime?: string;
  alt?: string;
  title?: string;
};

const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/;

export function normalizeAggregateFragmentKind(kind: string | undefined): AggregateFragmentKind {
  if (kind === "thinking" || kind === "image" || kind === "video") {
    return kind;
  }
  return "content";
}

export function isAggregateTextFragment(fragment: AggregateFragment): fragment is AggregateTextFragment {
  return fragment.kind === "content" || fragment.kind === "thinking";
}

export function isAggregateMediaFragment(
  fragment: AggregateFragment,
): fragment is AggregateMediaFragment {
  return fragment.kind === "image" || fragment.kind === "video";
}

export function aggregateFragmentSize(fragment: AggregateFragment): number {
  return isAggregateTextFragment(fragment) ? fragment.text.length : 1;
}

export function normalizeAggregateFragments(
  fragments: readonly AggregateFragment[],
): AggregateFragment[] {
  const normalized: AggregateFragment[] = [];

  for (const fragment of fragments) {
    const candidate = fragment as AggregateFragmentCandidate;
    const kind = normalizeAggregateFragmentKind(
      typeof candidate.kind === "string" ? candidate.kind : undefined,
    );

    if (kind === "image" || kind === "video") {
      const media = normalizeAggregateMediaFragment(kind, candidate);
      if (media) {
        normalized.push(media);
      }
      continue;
    }

    const text = typeof candidate.text === "string" ? candidate.text : "";
    if (!text) {
      continue;
    }

    const previous = normalized[normalized.length - 1];
    if (previous && isAggregateTextFragment(previous) && previous.kind === kind) {
      previous.text += text;
      continue;
    }

    normalized.push({ kind, text });
  }

  return normalized;
}

export function trimAggregateFragments(
  fragments: readonly AggregateFragment[],
  maxChars: number,
): AggregateFragment[] {
  if (maxChars <= 0) {
    return [];
  }

  const normalized = normalizeAggregateFragments(fragments);
  let totalChars = normalized.reduce((sum, fragment) => sum + aggregateFragmentSize(fragment), 0);
  if (totalChars <= maxChars) {
    return normalized;
  }

  const trimmed = normalized.map((fragment) => ({ ...fragment }));
  let overflow = totalChars - maxChars;
  while (overflow > 0 && trimmed.length > 0) {
    const first = trimmed[0];
    const size = aggregateFragmentSize(first);
    if (overflow >= size) {
      overflow -= size;
      trimmed.shift();
      continue;
    }

    if (isAggregateTextFragment(first)) {
      first.text = first.text.slice(overflow);
    }
    overflow = 0;
  }

  return trimmed;
}

export function aggregateFragmentsToText(fragments: readonly AggregateFragment[]): string {
  return fragments
    .filter(isAggregateTextFragment)
    .map((fragment) => fragment.text)
    .join("");
}

function normalizeAggregateMediaFragment(
  kind: AggregateMediaFragmentKind,
  fragment: AggregateFragmentCandidate,
): AggregateMediaFragment | null {
  const url = typeof fragment.url === "string" ? fragment.url.trim() : "";
  if (!url || CONTROL_CHARS_PATTERN.test(url)) {
    return null;
  }

  const normalizedMime = normalizeAggregateMediaMime(kind, fragment.mime);
  if (url.startsWith("data:")) {
    const normalized = normalizeAggregateDataURL(kind, url);
    if (!normalized) {
      return null;
    }
    return buildAggregateMediaFragment(kind, normalized.url, {
      mime: normalizedMime ?? normalized.mime,
      alt: normalizeAggregateMetadataText(fragment.alt),
      title: normalizeAggregateMetadataText(fragment.title),
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "blob:") {
    return null;
  }

  return buildAggregateMediaFragment(kind, parsed.toString(), {
    mime: normalizedMime,
    alt: normalizeAggregateMetadataText(fragment.alt),
    title: normalizeAggregateMetadataText(fragment.title),
  });
}

function normalizeAggregateMediaMime(
  kind: AggregateMediaFragmentKind,
  mime: unknown,
): string | undefined {
  if (typeof mime !== "string") {
    return undefined;
  }

  const normalized = mime.trim().toLowerCase();
  if (!normalized || CONTROL_CHARS_PATTERN.test(normalized)) {
    return undefined;
  }
  if (kind === "image") {
    if (!normalized.startsWith("image/") || normalized === "image/svg+xml") {
      return undefined;
    }
    return normalized;
  }
  if (!normalized.startsWith("video/")) {
    return undefined;
  }
  return normalized;
}

function normalizeAggregateDataURL(
  kind: AggregateMediaFragmentKind,
  url: string,
): { url: string; mime?: string } | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)*,/i.exec(url);
  if (!match) {
    return null;
  }

  const mime = normalizeAggregateMediaMime(kind, match[1]);
  if (!mime) {
    return null;
  }

  return { url, mime };
}

function normalizeAggregateMetadataText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function buildAggregateMediaFragment(
  kind: AggregateMediaFragmentKind,
  url: string,
  options: { mime?: string; alt?: string; title?: string },
): AggregateMediaFragment {
  const fragment: AggregateMediaFragment = { kind, url };
  if (options.mime) {
    fragment.mime = options.mime;
  }
  if (options.alt) {
    fragment.alt = options.alt;
  }
  if (options.title) {
    fragment.title = options.title;
  }
  return fragment;
}
