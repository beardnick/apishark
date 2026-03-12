export type AggregateFragmentKind = "content" | "thinking";

export type AggregateFragment = {
  kind: AggregateFragmentKind;
  text: string;
};

export function normalizeAggregateFragmentKind(kind: string | undefined): AggregateFragmentKind {
  return kind === "thinking" ? "thinking" : "content";
}

export function normalizeAggregateFragments(
  fragments: readonly AggregateFragment[],
): AggregateFragment[] {
  const normalized: AggregateFragment[] = [];

  for (const fragment of fragments) {
    if (!fragment.text) {
      continue;
    }

    const kind = normalizeAggregateFragmentKind(fragment.kind);
    const previous = normalized[normalized.length - 1];
    if (previous && previous.kind === kind) {
      previous.text += fragment.text;
      continue;
    }

    normalized.push({ kind, text: fragment.text });
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
  let totalChars = normalized.reduce((sum, fragment) => sum + fragment.text.length, 0);
  if (totalChars <= maxChars) {
    return normalized;
  }

  const trimmed = normalized.map((fragment) => ({ ...fragment }));
  let overflow = totalChars - maxChars;
  while (overflow > 0 && trimmed.length > 0) {
    const first = trimmed[0];
    if (overflow >= first.text.length) {
      overflow -= first.text.length;
      trimmed.shift();
      continue;
    }

    first.text = first.text.slice(overflow);
    overflow = 0;
  }

  return trimmed;
}

export function aggregateFragmentsToText(fragments: readonly AggregateFragment[]): string {
  return fragments.map((fragment) => fragment.text).join("");
}
