// Minimal dependency-free DOM stub for presentation tests (HCA C-R3).
// It supports exactly what src/presentation/* uses: element creation, attributes,
// text, children, events, simple selectors, accessible names and tab order.
// It is not a browser: no layout, no CSS, no screen reader. A manual
// screen-reader/keyboard pass is still outstanding (see hca-notes.md).

const BOOLEAN_PROPS = ["disabled", "hidden", "checked", "required", "multiple"];
const VOID = new Set(["meta", "link", "br", "hr", "img", "input", "source", "wbr", "area", "base", "col", "embed", "param", "track"]);
const RAW_TEXT = new Set(["script", "style"]);

class StubText {
  constructor(text) {
    this.nodeType = 3;
    this.data = String(text);
    this.parentNode = null;
  }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

function kebab(name) {
  return name.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`);
}

class StubElement {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.localName = String(tagName).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
    this._value = undefined;
    const element = this;
    this.dataset = new Proxy({}, {
      get: (_, key) => element.getAttribute(`data-${kebab(String(key))}`) ?? undefined,
      set: (_, key, value) => { element.setAttribute(`data-${kebab(String(key))}`, value); return true; },
      has: (_, key) => element.hasAttribute(`data-${kebab(String(key))}`)
    });
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get id() { return this.getAttribute("id") ?? ""; }
  set id(value) { this.setAttribute("id", value); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(value) { this.setAttribute("class", value); }
  get type() { return this.getAttribute("type") ?? (this.localName === "button" ? "submit" : this.localName === "input" ? "text" : ""); }
  set type(value) { this.setAttribute("type", value); }
  get name() { return this.getAttribute("name") ?? ""; }
  set name(value) { this.setAttribute("name", value); }
  get htmlFor() { return this.getAttribute("for") ?? ""; }
  set htmlFor(value) { this.setAttribute("for", value); }
  get title() { return this.getAttribute("title") ?? ""; }
  set title(value) { this.setAttribute("title", value); }
  get tabIndex() {
    const raw = this.getAttribute("tabindex");
    if (raw !== null) return Number(raw);
    if (["button", "input", "select", "textarea"].includes(this.localName)) return 0;
    if (this.localName === "a" && this.hasAttribute("href")) return 0;
    return -1;
  }
  set tabIndex(value) { this.setAttribute("tabindex", String(value)); }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.localName === "select") {
      const options = this.querySelectorAll("option");
      const selected = options.find(option => option.hasAttribute("selected")) ?? options[0];
      return selected ? (selected.getAttribute("value") ?? selected.textContent) : "";
    }
    return this.getAttribute("value") ?? "";
  }
  set value(value) {
    // As in the DOM, option.value reflects the attribute; input/select keep a live value.
    if (this.localName === "option") this.setAttribute("value", value);
    else this._value = String(value);
  }
  get textContent() {
    return this.childNodes.map(node => node.textContent).join("");
  }
  set textContent(value) {
    this.replaceChildren();
    if (value !== null && value !== undefined && String(value) !== "") this.append(String(value));
  }
  setAttribute(name, value) { this.attributes.set(String(name).toLowerCase(), String(value)); }
  getAttribute(name) {
    const key = String(name).toLowerCase();
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }
  hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
  removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()); }
  toggleAttribute(name, force) {
    const on = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (on) this.setAttribute(name, ""); else this.removeAttribute(name);
    return on;
  }
  append(...nodes) {
    for (const raw of nodes) {
      const node = typeof raw === "string" ? new StubText(raw) : raw;
      if (node.parentNode) node.parentNode.removeChild(node);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    let node = this;
    while (node && !event.propagationStopped) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners?.get(event.type) ?? [])]) listener(event);
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }
  click() {
    if (this.disabled) return;
    if (this.localName === "input" && (this.type === "radio" || this.type === "checkbox")) {
      this.checked = this.type === "radio" ? true : !this.checked;
      this.dispatchEvent(createEvent("change"));
    }
    this.dispatchEvent(createEvent("click"));
  }
  focus() { this.ownerDocument.activeElement = this; }
  closest(selector) {
    let node = this;
    while (node && node.nodeType === 1) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  matches(selector) { return matches(this, selector); }
  querySelectorAll(selector) {
    const out = [];
    walk(this, element => { if (element !== this && matches(element, selector, this)) out.push(element); });
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

for (const prop of BOOLEAN_PROPS) {
  Object.defineProperty(StubElement.prototype, prop, {
    get() { return this.hasAttribute(prop); },
    set(value) { this.toggleAttribute(prop, Boolean(value)); }
  });
}

export function createEvent(type, init = {}) {
  return {
    type,
    key: init.key,
    shiftKey: Boolean(init.shiftKey),
    target: init.target ?? null,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };
}

function walk(root, visit) {
  for (const child of root.childNodes) {
    if (child.nodeType !== 1) continue;
    visit(child);
    walk(child, visit);
  }
}

function matchesCompound(element, compound) {
  const parts = compound.match(/^([a-z0-9-]*)((?:#[\w-]+|\.[\w-]+|\[[^\]]+\])*)$/i);
  if (!parts) throw new Error(`unsupported selector: ${compound}`);
  if (parts[1] && element.localName !== parts[1].toLowerCase()) return false;
  for (const token of parts[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) ?? []) {
    if (token.startsWith("#") && element.id !== token.slice(1)) return false;
    if (token.startsWith(".") && !element.className.split(/\s+/).includes(token.slice(1))) return false;
    if (token.startsWith("[")) {
      const attr = token.slice(1, -1).match(/^([\w-]+)(?:="([^"]*)")?$/);
      if (!attr) throw new Error(`unsupported attribute selector: ${token}`);
      if (!element.hasAttribute(attr[1])) return false;
      if (attr[2] !== undefined && element.getAttribute(attr[1]) !== attr[2]) return false;
    }
  }
  return true;
}

function matches(element, selector, scope = null) {
  return selector.split(",").some(group => {
    const steps = group.trim().split(/\s+/);
    if (!matchesCompound(element, steps[steps.length - 1])) return false;
    let node = element.parentNode;
    for (let i = steps.length - 2; i >= 0; i -= 1) {
      while (node && node !== scope && node.nodeType === 1 && !matchesCompound(node, steps[i])) node = node.parentNode;
      if (!node || node === scope || node.nodeType !== 1) return false;
      node = node.parentNode;
    }
    return true;
  });
}

export function createDocument() {
  const doc = {
    activeElement: null,
    createElement: tag => new StubElement(tag, doc),
    createTextNode: text => new StubText(text),
    getElementById: id => {
      let found = null;
      walk(doc.documentElement, element => { if (!found && element.id === id) found = element; });
      return found;
    },
    querySelector: selector => doc.documentElement.querySelector(selector),
    querySelectorAll: selector => doc.documentElement.querySelectorAll(selector)
  };
  doc.documentElement = new StubElement("html", doc);
  doc.body = new StubElement("body", doc);
  doc.documentElement.append(doc.body);
  return doc;
}

// Parse the well-formed static markup of index.html into stub elements under doc.body.
export function parseHtml(html, doc = createDocument()) {
  const stack = [doc.body];
  const pattern = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z0-9-]+)\s*>|<([a-z0-9-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const top = stack[stack.length - 1];
    if (match[5] !== undefined) {
      if (match[5].trim()) top.append(decode(match[5]));
      continue;
    }
    if (match[1]) {
      const name = match[1].toLowerCase();
      if (["html", "head", "body"].includes(name)) continue;
      while (stack.length > 1 && stack[stack.length - 1].localName !== name) stack.pop();
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (!match[2]) continue;
    const name = match[2].toLowerCase();
    if (["html", "head", "body"].includes(name)) continue;
    const element = doc.createElement(name);
    for (const attr of match[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      element.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ""));
    }
    top.append(element);
    if (RAW_TEXT.has(name)) {
      const close = html.indexOf(`</${name}`, pattern.lastIndex);
      pattern.lastIndex = close < 0 ? html.length : close;
      continue;
    }
    if (!VOID.has(name) && !match[4]) stack.push(element);
  }
  return doc;
}

function decode(text) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function rootOf(element) {
  let node = element;
  while (node.parentNode) node = node.parentNode;
  return node;
}

function byIdFrom(element, id) {
  const root = rootOf(element);
  if (root.id === id) return root;
  return root.querySelector(`#${id}`);
}

export function normalise(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

// Accessible name, following the order used by browsers for these simple cases.
export function accessibleName(element) {
  const labelledby = element.getAttribute("aria-labelledby");
  if (labelledby) {
    return normalise(labelledby.split(/\s+/).map(id => byIdFrom(element, id)?.textContent ?? "").join(" "));
  }
  const label = element.getAttribute("aria-label");
  if (label) return normalise(label);
  if (["input", "select", "textarea"].includes(element.localName)) {
    if (element.id) {
      const root = rootOf(element);
      const explicit = root.querySelectorAll("label").find(item => item.htmlFor === element.id);
      if (explicit) return normalise(explicit.textContent);
    }
    const wrapping = element.closest("label");
    if (wrapping) return normalise(wrapping.textContent);
    return "";
  }
  return normalise(element.textContent);
}

export function describedBy(element) {
  const ids = element.getAttribute("aria-describedby");
  if (!ids) return "";
  return normalise(ids.split(/\s+/).map(id => byIdFrom(element, id)?.textContent ?? "").join(" "));
}

function hiddenFromTree(element) {
  let node = element;
  while (node && node.nodeType === 1) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return true;
    node = node.parentNode;
  }
  return false;
}

// Sequential focus order: tabindex >= 0, not disabled, not hidden, DOM order
// (positive tabindex values are rejected by the a11y tests instead of sorted).
export function tabOrder(root) {
  const out = [];
  walk(root, element => {
    if (element.tabIndex < 0 || element.disabled || hiddenFromTree(element)) return;
    out.push(element);
  });
  return out;
}

export function findAll(root, predicate) {
  const out = [];
  walk(root, element => { if (predicate(element)) out.push(element); });
  return out;
}
