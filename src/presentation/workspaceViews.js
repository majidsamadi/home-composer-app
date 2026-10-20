// Workspace status and text-alternative placement list. Status: component-tested.
import { el, uniqueId } from "./dom.js";
import { GeometryState, Phase, placementLabel } from "../application/workspaceController.js";
import { describeFit } from "./fitPresentation.js";

export const WorkspaceViewKind = Object.freeze({
  IDLE: "idle", LOADING: "loading", OFFLINE: "offline", DENIED: "denied", CONFLICT: "conflict", STALE: "stale",
  WITHDRAWN_SOURCE: "withdrawn-source", UNSUPPORTED_RENDERER: "unsupported-renderer", DEVICE_LOST: "device-lost",
  EMPTY: "empty", SAVING: "saving", UNSAVED: "unsaved", SAVED: "saved"
});

const WORKING_TEXT = Object.freeze({
  unsaved: "Unsaved changes",
  saving: "Saving…",
  saved: "All changes saved",
  conflict: "Conflict — someone else saved a newer revision"
});

export function workingStatusText(status) {
  return WORKING_TEXT[status] ?? "";
}

// One headline per state; each state has distinct text.
export function workspaceStatus(view) {
  const K = WorkspaceViewKind;
  if (view.phase === Phase.IDLE || view.phase === Phase.DISPOSED) return { kind: K.IDLE, text: "No design open." };
  if (view.phase === Phase.LOADING) return { kind: K.LOADING, text: "Loading design…" };
  if (view.phase === Phase.OFFLINE) return { kind: K.OFFLINE, text: "Offline — the Composer service can't be reached. Nothing was loaded." };
  if (view.phase === Phase.NOT_FOUND) return { kind: K.DENIED, text: "This design isn't available to you. It may not exist or may not be shared with you." };
  if (view.workingStatus === "conflict") {
    return { kind: K.CONFLICT, text: `Conflict — revision ${view.conflict.serverRevision} was saved by ${view.conflict.serverChangedBy ?? "someone else"}. Your unsaved edits are kept separately.` };
  }
  if (view.offline) return { kind: K.OFFLINE, text: "Offline — changes can't be saved right now. Your unsaved edits are kept." };
  if (view.problemCode === "action_denied") return { kind: K.DENIED, text: `Not allowed — your role (${view.role}) can't do that here.` };
  if (view.staleHead) return { kind: K.STALE, text: `Out of date — revision ${view.staleHead} is available; you're viewing revision ${view.revision}.` };
  if (view.geometry.state === GeometryState.DEVICE_LOST) return { kind: K.DEVICE_LOST, text: "3D view lost — Reload view. Your design and unsaved edits are kept." };
  if (view.geometry.state === GeometryState.UNSUPPORTED) return { kind: K.UNSUPPORTED_RENDERER, text: "3D view not supported on this device yet — placements are listed as text." };
  if ((view.geometry.sources ?? []).some(item => item.outcome === "withdrawn")) {
    return { kind: K.WITHDRAWN_SOURCE, text: "A source in this design was withdrawn by its owner — it's listed but not drawn." };
  }
  if (view.workingStatus === "saving") return { kind: K.SAVING, text: "Saving…" };
  if (view.workingStatus === "unsaved") return { kind: K.UNSAVED, text: `Unsaved changes (${view.pendingCount}).` };
  if (view.phase === Phase.EMPTY || !view.placements.length) return { kind: K.EMPTY, text: "This design has no placements yet. Add an object by its Object ID." };
  return { kind: K.SAVED, text: `All changes saved · revision ${view.revision}.` };
}

// Text alternative for the 3D view: every placement is listed and selectable.
export function renderPlacementList(container, { doc, view, onSelect, onFocus }) {
  const headingId = uniqueId("placement-list-heading");
  const list = el(doc, "ul", { "aria-labelledby": headingId, class: "placement-list" });
  for (const item of view.placements) {
    const selected = item.placement_id === view.selection;
    const [x, y, z] = item.transform.position_m;
    const fit = describeFit(view.fits[item.placement_id]);
    const outcome = (view.geometry.sources ?? []).find(source => source.kind === "object" && source.id === item.object_source.object_id)?.outcome;
    list.append(el(doc, "li", { "data-placement-id": item.placement_id },
      el(doc, "button", {
        type: "button", "aria-pressed": selected ? "true" : "false",
        text: `${placementLabel(item)} at x ${x.toFixed(2)}, y ${y.toFixed(2)}, z ${z.toFixed(2)} m, ${item.transform.rotation_deg_y}°`,
        on: { click: () => onSelect(item.placement_id) }
      }),
      el(doc, "button", { type: "button", text: "Focus", "aria-label": `Focus ${placementLabel(item)} in the 3D view`, on: { click: () => onFocus(item.placement_id) } }),
      el(doc, "span", { class: "note", text: [
        item.scale_mode === "illustrative" ? "Illustrative scale — not real size" : "Real size",
        item.hidden ? "hidden" : null,
        outcome && outcome !== "accessible" ? `source ${outcome.replace(/_/g, " ")}` : null,
        `fit: ${fit.label}`
      ].filter(Boolean).join(" · ") })
    ));
  }
  if (!view.placements.length) list.append(el(doc, "li", { text: "No placements." }));
  container.replaceChildren(el(doc, "h3", { id: headingId, text: "Placements (text view)" }), list);
  return list;
}
