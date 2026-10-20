// Alternatives, compare and revision history (HCA-06.2, HCA-06.3, HCA-04.4).
// Status: component-tested (DOM stub).
import { el, uniqueId, withReason } from "./dom.js";
import { shortId } from "../application/workspaceController.js";

export const CHANGE_TEXT = Object.freeze({
  added: "added",
  removed: "removed",
  moved: "moved",
  rotated: "rotated",
  scale_changed: "size mode changed",
  hidden_changed: "shown/hidden changed"
});

export function differenceText(difference) {
  return `Placement ${shortId(difference.placement_id)}: ${CHANGE_TEXT[difference.change] ?? difference.change}`;
}

export function renderAlternatives(container, { doc, view, onCreate, onSwitch, onCompare, onRestore }) {
  const headingId = uniqueId("alternatives-heading");
  const root = el(doc, "section", { class: "alternatives", "aria-labelledby": headingId }, el(doc, "h3", { id: headingId, text: "Alternatives and history" }));
  container.replaceChildren(root);
  const switchReason = view.pendingCount ? "Save or undo your unsaved changes before switching alternatives." : null;

  const list = el(doc, "ul", { "aria-label": "Design alternatives" });
  for (const branch of view.branches) {
    const current = branch.branch_id === view.branchId;
    const show = el(doc, "button", {
      type: "button", text: current ? `Showing ${branch.name}` : `Show ${branch.name}`,
      disabled: current || Boolean(switchReason), "aria-current": current ? "true" : null,
      on: { click: () => onSwitch(branch.branch_id) }
    });
    list.append(el(doc, "li", {},
      `${branch.name} · revision ${branch.head_revision} (from revision ${branch.base_revision})`,
      ...(current ? [show] : withReason(doc, show, switchReason, "switch-reason"))
    ));
  }
  root.append(list);

  const nameId = uniqueId("alternative-name");
  const name = el(doc, "input", { id: nameId, type: "text", value: "", disabled: !view.canEdit });
  const create = el(doc, "button", {
    type: "button", text: `Create alternative from revision ${view.revision}`, disabled: !view.canEdit,
    on: { click: () => { const text = name.value.trim(); if (text) onCreate(text); } }
  });
  root.append(el(doc, "div", { class: "controls" },
    el(doc, "label", { for: nameId, text: "Alternative name" }), name,
    ...withReason(doc, create, view.canEdit ? null : `Your role (${view.role}) can't create alternatives.`, "create-reason")
  ));

  // Compare any two branch heads (C11 a/b = <branch_id>@<rev>).
  const refs = view.branches.map(branch => ({ value: `${branch.branch_id}@${branch.head_revision}`, text: `${branch.name} @ revision ${branch.head_revision}` }));
  for (const item of view.history) {
    const value = `${view.branchId}@${item.revision}`;
    if (!refs.some(ref => ref.value === value)) refs.push({ value, text: `Current alternative @ revision ${item.revision}` });
  }
  const select = (text) => {
    const id = uniqueId("compare-ref");
    const control = el(doc, "select", { id }, ...refs.map(ref => el(doc, "option", { value: ref.value, text: ref.text })));
    return { control, label: el(doc, "label", { for: id, text }) };
  };
  const from = select("Compare from");
  const to = select("Compare to");
  if (refs.length > 1) to.control.value = refs[1].value;
  const compare = el(doc, "button", { type: "button", text: "Compare", on: { click: () => onCompare(from.control.value, to.control.value) } });
  root.append(el(doc, "div", { class: "controls" }, from.label, from.control, to.label, to.control, compare));

  if (view.comparison) {
    const resultId = uniqueId("compare-result");
    const items = view.comparison.differences.length
      ? view.comparison.differences.map(item => el(doc, "li", { text: differenceText(item) }))
      : [el(doc, "li", { text: "No differences." })];
    root.append(
      el(doc, "h4", { id: resultId, text: `Differences from ${view.comparison.a} to ${view.comparison.b}` }),
      el(doc, "ul", { "aria-labelledby": resultId, class: "compare-differences" }, ...items)
    );
  }

  // Nondestructive history: restoring creates a new revision; earlier ones stay listed.
  const history = el(doc, "ol", { "aria-label": "Revision history (kept)" });
  for (const item of view.history) {
    const current = item.revision === view.revision;
    const restore = el(doc, "button", {
      type: "button", text: `Restore revision ${item.revision} as a new revision`,
      disabled: current || !view.canEdit || Boolean(view.pendingCount),
      on: { click: () => onRestore(item.revision) }
    });
    history.append(el(doc, "li", {},
      `Revision ${item.revision}${item.createdBy ? ` by ${item.createdBy}` : ""}${item.restoredFrom ? ` (restored from revision ${item.restoredFrom})` : ""}${current ? " · current" : ""}`,
      current ? null : restore
    ));
  }
  root.append(el(doc, "h4", { text: "Revision history" }), history);
  return root;
}
