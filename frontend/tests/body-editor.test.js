import assert from "node:assert/strict";
import test from "node:test";

import {
  collapseJSONText,
  renderBodyEditor,
  resolveBodyEditorRenderOptions,
  tokenizeBodyEditorText,
} from "../dist/assets/body-editor.js";

class FakeNode {
  parentNode = null;
}

class FakeTextNode extends FakeNode {
  constructor(text) {
    super();
    this.nodeType = 3;
    this._text = text;
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value);
  }
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.tokens = new Set();
  }

  add(...tokens) {
    for (const token of tokens) {
      if (token) {
        this.tokens.add(token);
      }
    }
  }

  toggle(token, force) {
    if (force === true) {
      this.tokens.add(token);
      return true;
    }

    if (force === false) {
      this.tokens.delete(token);
      return false;
    }

    if (this.tokens.has(token)) {
      this.tokens.delete(token);
      return false;
    }

    this.tokens.add(token);
    return true;
  }

  contains(token) {
    return this.tokens.has(token);
  }

  setFromString(value) {
    this.tokens = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  toString() {
    return [...this.tokens].join(" ");
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.childNodes = [];
    this._textContent = "";
    this._classList = new FakeClassList(this);
    this.contentEditable = "inherit";
  }

  get classList() {
    return this._classList;
  }

  get className() {
    return this._classList.toString();
  }

  set className(value) {
    this._classList.setFromString(value);
  }

  get textContent() {
    if (this.childNodes.length === 0) {
      return this._textContent;
    }
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value);
    this.childNodes = [];
  }

  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    this._textContent = "";
    return node;
  }

  append(...nodes) {
    nodes.forEach((node) => {
      if (typeof node === "string") {
        this.appendChild(new FakeTextNode(node));
        return;
      }
      this.appendChild(node);
    });
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }
}

test("collapseJSONText keeps root keys while collapsing nested structures", () => {
  assert.equal(
    collapseJSONText('{"stream":true,"messages":[{"role":"user","content":"hi"}],"meta":{"n":1}}'),
    '{\n  "stream": true,\n  "messages": […],\n  "meta": {…}\n}',
  );
  assert.equal(collapseJSONText("not json"), null);
});

test("tokenizeBodyEditorText classifies JSON keys, values, punctuation, and fold placeholders", () => {
  const tokens = tokenizeBodyEditorText('{\n  "meta": {…},\n  "ok": false,\n  "count": 3,\n  "empty": null\n}');
  const classified = tokens.filter((token) => token.className !== null);

  assert.deepEqual(
    classified.map((token) => [token.text, token.className]),
    [
      ["{", "json-punctuation"],
      ['"meta"', "json-key"],
      [":", "json-punctuation"],
      ["{", "json-punctuation"],
      ["…", "json-fold-placeholder"],
      ["}", "json-punctuation"],
      [",", "json-punctuation"],
      ['"ok"', "json-key"],
      [":", "json-punctuation"],
      ["false", "json-boolean"],
      [",", "json-punctuation"],
      ['"count"', "json-key"],
      [":", "json-punctuation"],
      ["3", "json-number"],
      [",", "json-punctuation"],
      ['"empty"', "json-key"],
      [":", "json-punctuation"],
      ["null", "json-null"],
      ["}", "json-punctuation"],
    ],
  );
});

test("focused body editor keeps collapsed JSON until the user explicitly expands it", () => {
  const originalDocument = globalThis.document;
  globalThis.document = new FakeDocument();

  try {
    const container = document.createElement("div");
    const bodyText = '{"stream":true,"messages":[{"role":"user","content":"hi"}],"meta":{"n":1}}';

    const collapsed = renderBodyEditor(
      container,
      bodyText,
      resolveBodyEditorRenderOptions({
        requestedCollapsed: true,
        isActive: true,
        requestIsLoading: false,
      }),
    );

    assert.equal(collapsed.hasJSON, true);
    assert.equal(collapsed.isCollapsedView, true);
    assert.equal(container.contentEditable, "false");
    assert.equal(container.classList.contains("is-collapsed"), true);
    assert.equal(
      container.textContent,
      '{\n  "stream": true,\n  "messages": […],\n  "meta": {…}\n}',
    );

    const expanded = renderBodyEditor(
      container,
      bodyText,
      resolveBodyEditorRenderOptions({
        requestedCollapsed: false,
        isActive: true,
        requestIsLoading: false,
      }),
    );

    assert.equal(expanded.isCollapsedView, false);
    assert.equal(container.contentEditable, "true");
    assert.equal(container.classList.contains("is-collapsed"), false);
    assert.equal(container.textContent, bodyText);
  } finally {
    globalThis.document = originalDocument;
  }
});
