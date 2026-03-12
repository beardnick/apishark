const duplicateSuffixPattern = /^(.*?)(?: copy(?: (\d+))?)?$/;
export function nextDuplicateRequestName(name, existingNames) {
    const normalizedName = name.trim() || "Untitled Request";
    const baseName = duplicateBaseName(normalizedName);
    const usedIndexes = new Set();
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
export function createDuplicateRequestDraft(draft, existingNames) {
    return {
        ...draft,
        name: nextDuplicateRequestName(draft.name, existingNames),
        headers: draft.headers.map((header) => ({ ...header })),
    };
}
function duplicateBaseName(name) {
    const match = name.match(duplicateSuffixPattern);
    const baseName = match?.[1]?.trim();
    return baseName || "Untitled Request";
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
