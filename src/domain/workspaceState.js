// Composer workspace state (HCA-04.4, HCA-06.1, HCA-06.4). Pure functions only.
// Status: component-tested (synthetic data only).
//
// The server revision is never edited in place. Local edits are an ordered list of
// pending commands replayed on top of the last server revision, so undo is
// nondestructive and a conflict never silently overwrites the other writer.

export const WorkingStatus = Object.freeze({ UNSAVED: "unsaved", SAVING: "saving", SAVED: "saved", CONFLICT: "conflict" });

export const COMMAND_TYPES = Object.freeze(["add", "move", "rotate", "hide", "duplicate", "remove", "setScaleMode"]);
const EDIT_ROLES = new Set(["owner", "editor"]);

const clone = value => structuredClone(value);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function finiteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 500);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function canEditWorkspace(state) {
  return EDIT_ROLES.has(state.role);
}

export function createWorkspaceState({ design, branch, revision }) {
  if (!design?.design_id || !branch?.branch_id || !revision || !Number.isInteger(revision.revision)) {
    throw new TypeError("design, branch and revision are required");
  }
  return deepFreeze({
    designId: design.design_id,
    title: design.title,
    role: design.role,
    homeSource: clone(design.home_source),
    branchId: branch.branch_id,
    branches: clone(design.branches ?? [branch]),
    server: { revision: revision.revision, placements: clone(revision.placements), createdBy: revision.created_by ?? null },
    pending: [],
    saving: false,
    conflict: null,
    history: [{ revision: revision.revision, createdBy: revision.created_by ?? null, createdAt: revision.created_at ?? null, restoredFrom: null }],
    selection: null,
    localSeq: 0,
    lastDropped: [],
    lastError: null
  });
}

function update(state, patch) {
  return deepFreeze({ ...clone(state), ...clone(patch) });
}

// Apply one command to a placements list. Returns null when the target no longer exists.
function applyOne(placements, command) {
  const list = clone(placements);
  const index = command.placementId === undefined ? -1 : list.findIndex(item => item.placement_id === command.placementId);
  if (command.type !== "add" && index < 0) return null;
  const target = list[index];
  switch (command.type) {
    case "add":
      list.push({
        placement_id: command.newPlacementId,
        object_source: clone(command.object_source),
        transform: { position_m: [...command.position_m], rotation_deg_y: command.rotation_deg_y },
        scale_mode: command.scale_mode,
        illustrative_scale: command.scale_mode === "illustrative" ? command.illustrative_scale : null,
        dimensions_m: command.dimensions_m === null ? null : [...command.dimensions_m],
        scale_claim: command.scale_claim,
        hidden: false
      });
      break;
    case "move": target.transform.position_m = [...command.position_m]; break;
    case "rotate": target.transform.rotation_deg_y = command.rotation_deg_y; break;
    case "hide": target.hidden = command.hidden; break;
    case "duplicate": {
      const copy = clone(target);
      copy.placement_id = command.newPlacementId;
      copy.transform.position_m = copy.transform.position_m.map((value, axis) => value + command.offset_m[axis]);
      list.push(copy);
      break;
    }
    case "remove": list.splice(index, 1); break;
    case "setScaleMode":
      // Recorded dimensions are never changed by the scale mode.
      target.scale_mode = command.scale_mode;
      target.illustrative_scale = command.scale_mode === "illustrative" ? command.illustrative_scale : null;
      break;
    default: return null;
  }
  return list;
}

export function replayCommands(placements, commands) {
  let current = clone(placements);
  const dropped = [];
  for (const command of commands) {
    const next = applyOne(current, command);
    if (next === null) dropped.push(command);
    else current = next;
  }
  return { placements: current, dropped };
}

export function workingPlacements(state) {
  return replayCommands(state.server.placements, state.pending).placements;
}

function validateCommand(state, command, placements) {
  if (!COMMAND_TYPES.includes(command?.type)) throw new TypeError(`unknown command ${command?.type}`);
  const target = command.type === "add" ? null : placements.find(item => item.placement_id === command.placementId);
  if (command.type !== "add" && !target) throw new TypeError(`unknown placement ${command.placementId}`);
  if ((command.type === "add" || command.type === "move") && !finiteVector(command.position_m)) {
    throw new TypeError("position must be three finite numbers within 500 m");
  }
  if ((command.type === "add" || command.type === "rotate") && !finite(command.rotation_deg_y)) throw new TypeError("rotation must be finite");
  if (command.type === "duplicate" && !finiteVector(command.offset_m)) throw new TypeError("offset must be three finite numbers");
  if (command.type === "duplicate" && !finiteVector(target.transform.position_m.map((value, axis) => value + command.offset_m[axis]))) {
    throw new TypeError("duplicate would be placed outside 500 m");
  }
  if (command.type === "hide" && typeof command.hidden !== "boolean") throw new TypeError("hidden must be boolean");
  if (command.type === "add" || command.type === "setScaleMode") {
    if (!["real", "illustrative"].includes(command.scale_mode)) throw new TypeError("scale mode must be real or illustrative");
    if (command.scale_mode === "illustrative" && !(finite(command.illustrative_scale) && command.illustrative_scale >= 0.1 && command.illustrative_scale <= 10)) {
      throw new TypeError("illustrative scale must be between 0.1 and 10");
    }
    const claim = command.type === "add" ? command.scale_claim : target.scale_claim;
    const dims = command.type === "add" ? command.dimensions_m : target.dimensions_m;
    if (command.scale_mode === "real" && claim === "unknown" && !dims) throw new TypeError("real size needs recorded dimensions");
  }
}

// Pure: returns the next state with the command appended to the pending list.
export function applyPlacementCommand(state, command) {
  if (!canEditWorkspace(state)) throw new Error(`role ${state.role} cannot edit placements`);
  if (state.saving) throw new Error("editing is paused while saving");
  if (state.conflict) throw new Error("resolve the conflict before editing");
  const placements = workingPlacements(state);
  validateCommand(state, command, placements);
  const localSeq = state.localSeq + 1;
  const stored = { ...clone(command), seq: localSeq };
  if (command.type === "add" || command.type === "duplicate") stored.newPlacementId = `local-${localSeq}`;
  if (command.type === "add" && command.illustrative_scale === undefined) stored.illustrative_scale = null;
  const selection = stored.newPlacementId ?? (command.type === "remove" ? null : command.placementId);
  return update(state, { pending: [...state.pending, stored], localSeq, selection, lastError: null, lastDropped: [] });
}

export function undoLastLocalEdit(state) {
  if (state.saving || !state.pending.length) return state;
  return update(state, { pending: state.pending.slice(0, -1), lastDropped: [] });
}

export function selectPlacement(state, placementId) {
  if (placementId !== null && !workingPlacements(state).some(item => item.placement_id === placementId)) return state;
  return update(state, { selection: placementId });
}

export function workingStatus(state) {
  if (state.conflict) return WorkingStatus.CONFLICT;
  if (state.saving) return WorkingStatus.SAVING;
  if (state.pending.length) return WorkingStatus.UNSAVED;
  return WorkingStatus.SAVED;
}

export function beginSaving(state) {
  if (!state.pending.length || state.conflict) return state;
  return update(state, { saving: true, lastError: null });
}

// One pending command was accepted by the service at `revision`. A server-assigned
// placement id replaces the local id in every later command.
export function acknowledgeCommand(state, { seq, revision, placementId = null }) {
  const [command, ...rest] = state.pending;
  if (!command || command.seq !== seq) throw new Error("acknowledgement does not match the next pending command");
  const applied = { ...command };
  const localId = command.newPlacementId;
  if (localId && placementId) applied.newPlacementId = placementId;
  const server = { ...state.server, revision, placements: applyOne(state.server.placements, applied) ?? state.server.placements };
  const remap = item => {
    if (!localId || !placementId) return item;
    const next = { ...item };
    if (next.placementId === localId) next.placementId = placementId;
    return next;
  };
  const selection = state.selection === localId && placementId ? placementId : state.selection;
  return update(state, { server, pending: rest.map(remap), selection });
}

function pushHistory(history, record, restoredFrom = null) {
  if (history.some(item => item.revision === record.revision)) return history;
  return [...history, { revision: record.revision, createdBy: record.created_by ?? null, createdAt: record.created_at ?? null, restoredFrom }];
}

// The authoritative revision record replaces the optimistic server copy.
export function finishSaving(state, record, { restoredFrom = null } = {}) {
  return update(state, {
    saving: false,
    server: { revision: record.revision, placements: clone(record.placements), createdBy: record.created_by ?? null },
    history: pushHistory(state.history, record, restoredFrom)
  });
}

export function saveFailed(state, message) {
  return update(state, { saving: false, lastError: String(message) });
}

function summariseChanges(before, after) {
  const changes = [];
  const old = new Map(before.map(item => [item.placement_id, item]));
  for (const item of after) {
    const prior = old.get(item.placement_id);
    if (!prior) changes.push({ placementId: item.placement_id, change: "added" });
    else if (JSON.stringify(prior) !== JSON.stringify(item)) changes.push({ placementId: item.placement_id, change: "changed" });
  }
  const now = new Set(after.map(item => item.placement_id));
  for (const item of before) if (!now.has(item.placement_id)) changes.push({ placementId: item.placement_id, change: "removed" });
  return changes;
}

// HCA-06.4: show the server's newer revision, keep local edits separate. Nothing is
// re-sent until the user chooses resolveConflict(state, "reapply").
export function rebaseAfterConflict(state, serverRecord) {
  const localPlacements = workingPlacements(state);
  return update(state, {
    saving: false,
    conflict: {
      previousRevision: state.server.revision,
      serverRevision: serverRecord.revision,
      serverChangedBy: serverRecord.created_by ?? null,
      serverChanges: summariseChanges(state.server.placements, serverRecord.placements),
      localPlacements
    },
    server: { revision: serverRecord.revision, placements: clone(serverRecord.placements), createdBy: serverRecord.created_by ?? null },
    history: pushHistory(state.history, serverRecord)
  });
}

export function resolveConflict(state, choice) {
  if (!state.conflict) return state;
  if (choice === "discard") return update(state, { conflict: null, pending: [], lastDropped: [] });
  if (choice !== "reapply") throw new TypeError("choice must be reapply or discard");
  const { dropped } = replayCommands(state.server.placements, state.pending);
  const droppedSeq = new Set(dropped.map(item => item.seq));
  return update(state, {
    conflict: null,
    pending: state.pending.filter(item => !droppedSeq.has(item.seq)),
    lastDropped: dropped
  });
}

// Switch to another branch's revision (alternatives). Only allowed with no local edits.
export function switchBranch(state, { branch, revision, branches }) {
  if (state.pending.length || state.saving || state.conflict) throw new Error("save or discard local edits before switching");
  return update(state, {
    branchId: branch.branch_id,
    branches: branches ?? state.branches,
    server: { revision: revision.revision, placements: clone(revision.placements), createdBy: revision.created_by ?? null },
    history: [{ revision: revision.revision, createdBy: revision.created_by ?? null, createdAt: revision.created_at ?? null, restoredFrom: null }],
    selection: null
  });
}

export function withBranches(state, branches) {
  return update(state, { branches });
}
