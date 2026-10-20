// Placement controls (HCA-04.1, HCA-04.2). Status: component-tested (DOM stub).
// Keyboard: arrows nudge 0.01 m (Shift 0.10 m), [ / ] rotate 15°, H hide/show,
// D duplicate, Delete remove after confirmation. Buttons cover touch and mouse.
import { el, uniqueId, withReason } from "./dom.js";
import { formatDimensions } from "../application/objectIdEntryController.js";

export const NUDGE_M = 0.01;
export const NUDGE_SHIFT_M = 0.1;
export const ROTATE_STEP_DEG = 15;
export const REAL_LABEL = "Real size (recorded dimensions)";
export const ILLUSTRATIVE_LABEL = "Illustrative scale — not real size";
export const KEYBOARD_HELP = "Arrow keys move 0.01 m (hold Shift for 0.10 m). [ and ] rotate 15°. H hides or shows. D duplicates. Delete removes after you confirm.";

const round = value => Math.round(value * 1000) / 1000;

function moved(placement, axis, delta) {
  const position = [...placement.transform.position_m];
  position[axis] = round(position[axis] + delta);
  return { type: "move", placementId: placement.placement_id, position_m: position };
}

function rotated(placement, delta) {
  const next = (((placement.transform.rotation_deg_y + delta) % 360) + 360) % 360;
  return { type: "rotate", placementId: placement.placement_id, rotation_deg_y: next };
}

// Pure key mapping. Returns a command, { confirmRemove: true } or null.
export function keyCommand(placement, event) {
  if (!placement) return null;
  const step = event.shiftKey ? NUDGE_SHIFT_M : NUDGE_M;
  switch (event.key) {
    case "ArrowLeft": return moved(placement, 0, -step);
    case "ArrowRight": return moved(placement, 0, step);
    case "ArrowUp": return moved(placement, 2, -step);
    case "ArrowDown": return moved(placement, 2, step);
    case "[": return rotated(placement, -ROTATE_STEP_DEG);
    case "]": return rotated(placement, ROTATE_STEP_DEG);
    case "h": case "H": return { type: "hide", placementId: placement.placement_id, hidden: !placement.hidden };
    case "d": case "D": return { type: "duplicate", placementId: placement.placement_id, offset_m: [0.5, 0, 0] };
    case "Delete": return { confirmRemove: true };
    default: return null;
  }
}

function parseNumber(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function renderPlacementControls(container, { doc, placement, label, canEdit, editReason, onCommand }) {
  const headingId = uniqueId("placement-heading");
  const root = el(doc, "section", { class: "placement-controls", "aria-labelledby": headingId });
  container.replaceChildren(root);
  if (!placement) {
    root.append(el(doc, "h3", { id: headingId, text: "Placement controls" }), el(doc, "p", { class: "note", text: "Select a placement to move, rotate or resize it." }));
    return { root, handleKey: () => null };
  }
  const send = command => { if (canEdit) onCommand(command); };
  root.append(el(doc, "h3", { id: headingId, text: `Placement: ${label}` }));
  if (!canEdit) root.append(el(doc, "p", { class: "note", role: "note", text: editReason ?? "You can't edit placements in this design." }));

  // Keyboard surface.
  const helpId = uniqueId("placement-help");
  const confirmId = uniqueId("placement-confirm");
  const surface = el(doc, "div", {
    class: "placement-surface", "data-placement-surface": true, tabindex: canEdit ? "0" : "-1", role: "group",
    "aria-label": `Keyboard placement controls for ${label}`, "aria-describedby": helpId
  }, el(doc, "p", { id: helpId, class: "note", text: KEYBOARD_HELP }));

  const confirm = el(doc, "div", { id: confirmId, class: "placement-confirm", role: "group", "aria-label": "Confirm removal", hidden: true });
  const confirmRemove = el(doc, "button", { type: "button", text: `Remove ${label}` });
  const cancelRemove = el(doc, "button", { type: "button", text: "Cancel" });
  confirm.append(el(doc, "p", { text: `Remove ${label} from this design? Only this placement is removed; the object itself is kept.` }), confirmRemove, cancelRemove);
  const askRemove = () => { confirm.hidden = false; confirmRemove.focus(); };
  confirmRemove.addEventListener("click", () => { confirm.hidden = true; send({ type: "remove", placementId: placement.placement_id }); });
  cancelRemove.addEventListener("click", () => { confirm.hidden = true; surface.focus(); });

  const handleKey = event => {
    if (!canEdit) return null;
    const command = keyCommand(placement, event);
    if (!command) return null;
    event.preventDefault?.();
    if (command.confirmRemove) { askRemove(); return command; }
    send(command);
    return command;
  };
  surface.addEventListener("keydown", handleKey);

  // Touch/mouse buttons.
  const button = (text, command) => el(doc, "button", {
    type: "button", text, disabled: !canEdit,
    on: { click: () => (command === "remove" ? askRemove() : send(command())) }
  });
  const buttons = el(doc, "div", { class: "controls", role: "group", "aria-label": `Move and rotate ${label}` },
    button("Move left 0.01 m", () => moved(placement, 0, -NUDGE_M)),
    button("Move right 0.01 m", () => moved(placement, 0, NUDGE_M)),
    button("Move back 0.01 m", () => moved(placement, 2, -NUDGE_M)),
    button("Move forward 0.01 m", () => moved(placement, 2, NUDGE_M)),
    button("Rotate left 15°", () => rotated(placement, -ROTATE_STEP_DEG)),
    button("Rotate right 15°", () => rotated(placement, ROTATE_STEP_DEG)),
    button(placement.hidden ? "Show" : "Hide", () => ({ type: "hide", placementId: placement.placement_id, hidden: !placement.hidden })),
    button("Duplicate", () => ({ type: "duplicate", placementId: placement.placement_id, offset_m: [0.5, 0, 0] })),
    button("Remove…", "remove")
  );

  // Numeric inputs.
  const fields = el(doc, "div", { class: "placement-fields" });
  const numeric = (text, value, toCommand) => {
    const id = uniqueId("placement-field");
    const errorId = `${id}-error`;
    const input = el(doc, "input", { id, type: "number", step: "0.01", inputmode: "decimal", value: String(value), disabled: !canEdit, "aria-describedby": errorId });
    const error = el(doc, "p", { id: errorId, class: "field-error" });
    input.addEventListener("change", () => {
      const parsed = parseNumber(input.value);
      const command = parsed === null ? null : toCommand(parsed);
      if (!command) {
        input.setAttribute("aria-invalid", "true");
        error.textContent = `${text}: enter a number${text.endsWith("(m)") ? " between −500 and 500" : ""}.`;
        return;
      }
      input.removeAttribute("aria-invalid");
      error.textContent = "";
      send(command);
    });
    fields.append(el(doc, "label", { for: id, text }), input, error);
    return input;
  };
  ["x (m)", "y (m)", "z (m)"].forEach((text, axis) => numeric(text, placement.transform.position_m[axis], parsed => {
    if (Math.abs(parsed) > 500) return null;
    const position = [...placement.transform.position_m];
    position[axis] = parsed;
    return { type: "move", placementId: placement.placement_id, position_m: position };
  }));
  numeric("rotation (°)", placement.transform.rotation_deg_y, parsed => ({ type: "rotate", placementId: placement.placement_id, rotation_deg_y: parsed }));

  // HCA-04.2 scale mode. Recorded dimensions are shown unchanged in both modes.
  const groupName = uniqueId("scale-mode");
  const realAvailable = !(placement.scale_claim === "unknown" && !placement.dimensions_m);
  const legendId = uniqueId("scale-legend");
  const scale = el(doc, "fieldset", { class: "scale-mode", "aria-labelledby": legendId }, el(doc, "legend", { id: legendId, text: "Size shown" }));
  const radio = (value, text, disabled) => {
    const id = uniqueId("scale-option");
    const input = el(doc, "input", { id, type: "radio", name: groupName, value, checked: placement.scale_mode === value, disabled: !canEdit || disabled });
    const wrapper = el(doc, "div", {}, input, el(doc, "label", { for: id, text }));
    input.addEventListener("change", () => {
      if (!input.checked) return;
      send({ type: "setScaleMode", placementId: placement.placement_id, scale_mode: value, illustrative_scale: value === "illustrative" ? (placement.illustrative_scale ?? 1) : null });
    });
    return { input, wrapper };
  };
  const real = radio("real", REAL_LABEL, !realAvailable);
  const illustrative = radio("illustrative", ILLUSTRATIVE_LABEL, false);
  const realReason = withReason(doc, real.input, realAvailable ? null : "Real size unavailable: this object has no recorded dimensions.", "real-reason").slice(1);
  scale.append(real.wrapper, illustrative.wrapper, ...realReason);
  if (placement.scale_mode === "illustrative") {
    const factorId = uniqueId("illustrative-factor");
    const factorError = `${factorId}-error`;
    const factor = el(doc, "input", { id: factorId, type: "number", min: "0.1", max: "10", step: "0.1", value: String(placement.illustrative_scale ?? 1), disabled: !canEdit, "aria-describedby": factorError });
    const error = el(doc, "p", { id: factorError, class: "field-error" });
    factor.addEventListener("change", () => {
      const parsed = parseNumber(factor.value);
      if (parsed === null || parsed < 0.1 || parsed > 10) {
        factor.setAttribute("aria-invalid", "true");
        error.textContent = "Illustrative scale factor: enter a number from 0.1 to 10.";
        return;
      }
      factor.removeAttribute("aria-invalid");
      error.textContent = "";
      send({ type: "setScaleMode", placementId: placement.placement_id, scale_mode: "illustrative", illustrative_scale: parsed });
    });
    scale.append(el(doc, "label", { for: factorId, text: "Illustrative scale factor (0.1–10)" }), factor, error);
  }
  const dims = el(doc, "p", { class: "placement-dimensions", "data-dimensions": "" },
    `Recorded dimensions: ${formatDimensions(placement.dimensions_m)}`,
    placement.scale_mode === "illustrative" ? ` · shown at illustrative scale ×${placement.illustrative_scale ?? 1}, not real size` : ""
  );

  root.append(surface, buttons, fields, scale, dims, confirm);
  return { root, handleKey, surface, confirm };
}
