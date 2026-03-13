export class PlainRawResponseBuffer {
  private readonly maxPreviewChars: number;
  private readonly fullChunks: string[] = [];
  private previewTextValue = "";

  constructor(maxPreviewChars: number) {
    this.maxPreviewChars = Math.max(0, maxPreviewChars);
  }

  append(text: string): void {
    if (!text) {
      return;
    }

    this.fullChunks.push(text);
    this.previewTextValue += text;
    const overflow = this.previewTextValue.length - this.maxPreviewChars;
    if (overflow > 0) {
      this.previewTextValue = this.previewTextValue.slice(overflow);
    }
  }

  snapshotText(): string {
    return this.fullChunks.join("");
  }

  previewText(): string {
    return this.previewTextValue;
  }

  clear(): void {
    this.fullChunks.length = 0;
    this.previewTextValue = "";
  }
}
