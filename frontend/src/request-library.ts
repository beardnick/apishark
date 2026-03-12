export type RequestLibraryHeader = {
  key: string;
  value: string;
  enabled: boolean;
};

export type RequestLibraryDraft = {
  name: string;
  method: string;
  url: string;
  headers: RequestLibraryHeader[];
  body: string;
  aggregation_plugin: string;
  aggregate_openai_sse: boolean;
  timeout_seconds: number;
};

const duplicateSuffixPattern = /^(.*?)(?: copy(?: (\d+))?)?$/;

export function nextDuplicateRequestName(name: string, existingNames: string[]): string {
  const normalizedName = name.trim() || "Untitled Request";
  const baseName = duplicateBaseName(normalizedName);
  const usedIndexes = new Set<number>();

  for (const existingName of existingNames) {
    const trimmed = existingName.trim();
    if (trimmed === baseName) {
      usedIndexes.add(0);
      continue;
    }

    if (trimmed === `${baseName} copy`) {
      usedIndexes.add(1);
      continue;
    }

    const match = trimmed.match(new RegExp(`^${escapeRegExp(baseName)} copy (\\d+)$`));
    if (!match) {
      continue;
    }

    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index) && index > 1) {
      usedIndexes.add(index);
    }
  }

  let nextIndex = 1;
  while (usedIndexes.has(nextIndex)) {
    nextIndex += 1;
  }

  return nextIndex === 1 ? `${baseName} copy` : `${baseName} copy ${nextIndex}`;
}

export function createDuplicateRequestDraft(
  draft: RequestLibraryDraft,
  existingNames: string[],
): RequestLibraryDraft {
  return {
    ...draft,
    name: nextDuplicateRequestName(draft.name, existingNames),
    headers: draft.headers.map((header) => ({ ...header })),
  };
}

function duplicateBaseName(name: string): string {
  const match = name.match(duplicateSuffixPattern);
  const baseName = match?.[1]?.trim();
  return baseName || "Untitled Request";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
