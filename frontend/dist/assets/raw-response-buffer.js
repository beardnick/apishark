export class PlainRawResponseBuffer {
    constructor(maxPreviewChars) {
        this.fullChunks = [];
        this.previewTextValue = "";
        this.maxPreviewChars = Math.max(0, maxPreviewChars);
    }
    append(text) {
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
    snapshotText() {
        return this.fullChunks.join("");
    }
    previewText() {
        return this.previewTextValue;
    }
    clear() {
        this.fullChunks.length = 0;
        this.previewTextValue = "";
    }
}
