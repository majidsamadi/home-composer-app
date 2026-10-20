// Tiny element builder shared by the presentation modules. `doc` is injected so
// the same code runs in the browser and against tests/helpers/domStub.mjs.
let uid = 0;
export function uniqueId(prefix) {
  uid += 1;
  return `${prefix}-${uid}`;
}

export function el(doc, tag, attrs = {}, ...children) {
  const element = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "text") element.textContent = value;
    else if (key === "on") for (const [type, listener] of Object.entries(value)) element.addEventListener(type, listener);
    else if (key === "disabled" || key === "hidden" || key === "checked") element[key] = Boolean(value);
    else if (key === "value") element.value = value;
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

// A disabled control keeps a visible reason linked with aria-describedby.
export function withReason(doc, control, reason, prefix = "reason") {
  if (!reason) return [control];
  const id = uniqueId(prefix);
  control.setAttribute("aria-describedby", id);
  return [control, el(doc, "p", { id, class: "note", text: reason })];
}
