import test from "node:test";
import assert from "node:assert/strict";
import {
  ILLUSTRATIVE_LABEL,
  REAL_LABEL,
  keyCommand,
  renderPlacementControls
} from "../src/presentation/placementControls.js";
import { createWorkspaceState, applyPlacementCommand, workingPlacements } from "../src/domain/workspaceState.js";
import { SYNTHETIC, syntheticWorkspaceSeed } from "../src/fixtures/workspaceFixtures.js";
import { accessibleName, createDocument, createEvent, describedBy, findAll, tabOrder } from "./helpers/domStub.mjs";

const { p1 } = SYNTHETIC.placements;

function placementP1() {
  return structuredClone(syntheticWorkspaceSeed().designs[0].branches[0].revisions[1].placements[0]);
}

function mount(placement, { canEdit = true } = {}) {
  const doc = createDocument();
  const container = doc.createElement("div");
  doc.body.append(container);
  const commands = [];
  const controls = renderPlacementControls(container, { doc, placement, label: "Object obj_…0001 v1", canEdit, onCommand: command => commands.push(command) });
  return { doc, container, commands, controls };
}

const key = (surface, keyName, shiftKey = false) => surface.dispatchEvent(createEvent("keydown", { key: keyName, shiftKey }));
const byName = (root, tag, name) => findAll(root, item => item.localName === tag && accessibleName(item) === name)[0];

test("HCA-04.1 keyboard nudges and numeric input", () => {
  const { container, commands } = mount(placementP1());
  const surface = container.querySelector("[data-placement-surface]");
  key(surface, "ArrowRight");
  key(surface, "ArrowLeft", true);
  key(surface, "ArrowUp");
  key(surface, "ArrowDown", true);
  key(surface, "]");
  key(surface, "[");
  key(surface, "h");
  key(surface, "D");
  key(surface, "x");
  assert.deepEqual(commands, [
    { type: "move", placementId: p1, position_m: [1.01, 0, 1] },
    { type: "move", placementId: p1, position_m: [0.9, 0, 1] },
    { type: "move", placementId: p1, position_m: [1, 0, 0.99] },
    { type: "move", placementId: p1, position_m: [1, 0, 1.1] },
    { type: "rotate", placementId: p1, rotation_deg_y: 105 },
    { type: "rotate", placementId: p1, rotation_deg_y: 75 },
    { type: "hide", placementId: p1, hidden: true },
    { type: "duplicate", placementId: p1, offset_m: [0.5, 0, 0] }
  ]);

  // Delete asks for confirmation first; nothing is removed until confirmed.
  commands.length = 0;
  key(surface, "Delete");
  const confirm = container.querySelector(".placement-confirm");
  assert.equal(confirm.hidden, false);
  assert.equal(commands.length, 0);
  byName(confirm, "button", "Cancel").click();
  assert.equal(confirm.hidden, true);
  key(surface, "Delete");
  byName(confirm, "button", "Remove Object obj_…0001 v1").click();
  assert.deepEqual(commands, [{ type: "remove", placementId: p1 }]);

  // Numeric input with validation feedback.
  commands.length = 0;
  const x = byName(container, "input", "x (m)");
  x.value = "2.25";
  x.dispatchEvent(createEvent("change"));
  const rotation = byName(container, "input", "rotation (°)");
  rotation.value = "45";
  rotation.dispatchEvent(createEvent("change"));
  assert.deepEqual(commands, [
    { type: "move", placementId: p1, position_m: [2.25, 0, 1] },
    { type: "rotate", placementId: p1, rotation_deg_y: 45 }
  ]);
  x.value = "abc";
  x.dispatchEvent(createEvent("change"));
  assert.equal(x.getAttribute("aria-invalid"), "true");
  assert.match(describedBy(x), /enter a number between −500 and 500/);
  x.value = "900";
  x.dispatchEvent(createEvent("change"));
  assert.equal(commands.length, 2, "invalid values send nothing");

  // Touch/mouse buttons produce the same commands.
  byName(container, "button", "Move right 0.01 m").click();
  byName(container, "button", "Rotate right 15°").click();
  assert.deepEqual(commands.slice(2), [
    { type: "move", placementId: p1, position_m: [1.01, 0, 1] },
    { type: "rotate", placementId: p1, rotation_deg_y: 105 }
  ]);
  assert.equal(keyCommand(null, { key: "ArrowLeft" }), null);
});

test("HCA-04.2 illustrative label distinct and dimensions unchanged", () => {
  const seed = syntheticWorkspaceSeed();
  const design = seed.designs[0];
  let state = createWorkspaceState({
    design: { ...design, role: "owner" }, branch: { branch_id: "main", name: "Main", base_revision: 1, head_revision: 2 },
    revision: design.branches[0].revisions[1]
  });
  const real = mount(workingPlacements(state)[0]);
  const radios = findAll(real.container, item => item.localName === "input" && item.type === "radio");
  assert.deepEqual(radios.map(accessibleName), [REAL_LABEL, ILLUSTRATIVE_LABEL]);
  assert.notEqual(REAL_LABEL, ILLUSTRATIVE_LABEL);
  assert.match(ILLUSTRATIVE_LABEL, /not real size/);
  assert.equal(radios[0].checked, true);
  const dimsText = real.container.querySelector("[data-dimensions]").textContent;
  assert.equal(dimsText, "Recorded dimensions: 1.00 × 1.00 × 1.00 m (W × H × D)");

  radios[1].click();
  assert.deepEqual(real.commands, [{ type: "setScaleMode", placementId: p1, scale_mode: "illustrative", illustrative_scale: 1 }]);
  state = applyPlacementCommand(state, { ...real.commands[0], illustrative_scale: 1.5 });
  const after = workingPlacements(state)[0];
  assert.deepEqual(after.dimensions_m, [1, 1, 1], "recorded dimensions are unchanged");
  const illustrative = mount(after);
  assert.match(illustrative.container.querySelector("[data-dimensions]").textContent,
    /^Recorded dimensions: 1\.00 × 1\.00 × 1\.00 m \(W × H × D\) · shown at illustrative scale ×1\.5, not real size$/);
  const factor = byName(illustrative.container, "input", "Illustrative scale factor (0.1–10)");
  factor.value = "11";
  factor.dispatchEvent(createEvent("change"));
  assert.equal(factor.getAttribute("aria-invalid"), "true");
  assert.equal(illustrative.commands.length, 0);

  // No recorded size: real size is disabled with a visible reason.
  const unknown = mount({ ...after, placement_id: "plc_x", scale_claim: "unknown", dimensions_m: null });
  const realRadio = byName(unknown.container, "input", REAL_LABEL);
  assert.equal(realRadio.disabled, true);
  assert.equal(describedBy(realRadio), "Real size unavailable: this object has no recorded dimensions.");
  assert.equal(unknown.container.querySelector("[data-dimensions]").textContent.startsWith("Recorded dimensions: Not recorded"), true);
});

test("accessible names present", () => {
  const { container } = mount(placementP1());
  const controls = findAll(container, item => ["button", "input", "select", "textarea"].includes(item.localName));
  assert.ok(controls.length >= 16);
  for (const control of controls) assert.ok(accessibleName(control).length > 0, `${control.localName} ${control.type} has a name`);
  const surface = container.querySelector("[data-placement-surface]");
  assert.equal(accessibleName(surface), "Keyboard placement controls for Object obj_…0001 v1");
  assert.match(describedBy(surface), /Arrow keys move 0\.01 m/);
  const order = tabOrder(container);
  assert.equal(order[0], surface, "keyboard surface is first in tab order");
  assert.ok(order.every(item => item.tabIndex >= 0 && item.tabIndex <= 0), "no positive tabindex");
  assert.equal(container.querySelector("section").getAttribute("aria-labelledby"), container.querySelector("h3").id);

  // Read-only roles: controls disabled, surface not focusable, reason shown.
  const readOnly = mount(placementP1(), { canEdit: false });
  assert.equal(tabOrder(readOnly.container).length, 0);
  assert.match(readOnly.container.textContent, /can't edit placements/);
  key(readOnly.container.querySelector("[data-placement-surface]"), "ArrowLeft");
  assert.equal(readOnly.commands.length, 0);
});
