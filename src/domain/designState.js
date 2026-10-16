import { assertEntryIntent } from "./entryIntent.js";
import {
  cloneSnapshot,
  createCommittedSnapshot,
  samePinnedSources
} from "./designSnapshot.js";

export const AvailabilityKind = Object.freeze({
  READY: "ready",
  WRONG_ACCOUNT: "wrong-account",
  WITHDRAWN_HOME: "withdrawn-home",
  MISSING_DEPENDENCY: "missing-dependency",
  PENDING_INVITATION: "pending-invitation"
});

const UNAVAILABLE = new Set([
  AvailabilityKind.WRONG_ACCOUNT,
  AvailabilityKind.WITHDRAWN_HOME,
  AvailabilityKind.MISSING_DEPENDENCY,
  AvailabilityKind.PENDING_INVITATION
]);

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function cloneAvailability(input) {
  if (!input || typeof input.kind !== "string") {
    throw new TypeError("availability kind is required");
  }
  if (input.kind !== AvailabilityKind.READY && !UNAVAILABLE.has(input.kind)) {
    throw new TypeError(`unsupported availability: ${input.kind}`);
  }
  return Object.freeze({
    kind: input.kind,
    reason: input.reason === undefined ? Object.freeze({ supplied: false }) : Object.freeze({ supplied: true, value: String(input.reason) })
  });
}

function workingFromCommitted(committed) {
  if (!committed) return null;
  const copy = cloneSnapshot(committed);
  return {
    designId: copy.designId,
    baseRevision: copy.revision,
    home: copy.home,
    placements: copy.placements
  };
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    working: state.working ? Object.freeze({
      ...state.working,
      home: Object.freeze({ ...state.working.home }),
      placements: Object.freeze(state.working.placements.map(item => Object.freeze({
        ...item,
        object: Object.freeze({ ...item.object }),
        transform: Object.freeze({ ...item.transform })
      })))
    }) : null,
    save: Object.freeze({ ...state.save })
  });
}

export function committedSnapshotMismatchReason(intent, committedSnapshot) {
  assertEntryIntent(intent);
  if (!committedSnapshot) return null;
  if (intent.kind !== "design") return "object-intent-has-no-design-destination";
  if (intent.reference.id !== committedSnapshot.designId) return "design-id-mismatch";
  if (intent.reference.revision.supplied && intent.reference.revision.value !== committedSnapshot.revision) {
    return "design-revision-mismatch";
  }
  return null;
}

export function initializeDesignState({
  contextId,
  accountKey,
  intent,
  availability = { kind: AvailabilityKind.READY },
  committedSnapshot = null
}) {
  assertEntryIntent(intent);
  const normalizedAvailability = cloneAvailability(availability);
  const mismatchReason = committedSnapshotMismatchReason(intent, committedSnapshot);
  if (mismatchReason === "object-intent-has-no-design-destination") {
    throw new Error("Object ID intent does not identify a Composer design");
  }
  if (mismatchReason === "design-id-mismatch") {
    throw new Error("committed design does not match incoming Design ID");
  }
  if (mismatchReason === "design-revision-mismatch") {
    throw new Error("committed design does not match incoming Design revision");
  }
  if (committedSnapshot && normalizedAvailability.kind !== AvailabilityKind.READY) {
    throw new Error("unavailable context cannot initialize cached committed design content");
  }
  const committed = committedSnapshot
    ? createCommittedSnapshot(committedSnapshot)
    : null;
  return freezeState({
    contextId: requiredText(contextId, "contextId"),
    accountKey: requiredText(accountKey, "accountKey"),
    intent,
    availability: normalizedAvailability,
    committed,
    working: workingFromCommitted(committed),
    dirty: false,
    save: { status: "idle", operationId: null, error: null },
    lastRejectedAsyncResult: null
  });
}

export function canEdit(state) {
  return state.availability.kind === AvailabilityKind.READY && Boolean(state.committed);
}

export function applyWorkingPlacementTransform(state, placementId, transformPatch) {
  if (!canEdit(state)) throw new Error(`editing disabled while ${state.availability.kind}`);
  const index = state.working.placements.findIndex(item => item.placementId === placementId);
  if (index < 0) throw new Error(`unknown placement ${placementId}`);
  const allowed = new Set(["x", "y", "rotationDegrees"]);
  for (const key of Object.keys(transformPatch ?? {})) {
    if (!allowed.has(key)) throw new Error(`working update cannot mutate source reference field ${key}`);
    if (typeof transformPatch[key] !== "number" || !Number.isFinite(transformPatch[key])) {
      throw new TypeError(`transform ${key} must be finite`);
    }
  }
  const placements = state.working.placements.map((item, i) => i === index
    ? { ...item, object: { ...item.object }, transform: { ...item.transform, ...transformPatch } }
    : { ...item, object: { ...item.object }, transform: { ...item.transform } });
  return freezeState({
    ...state,
    working: { ...state.working, placements },
    dirty: true,
    save: { status: "idle", operationId: null, error: null }
  });
}

export function beginSave(state, operationId) {
  if (!canEdit(state)) throw new Error(`save disabled while ${state.availability.kind}`);
  if (!state.dirty) throw new Error("nothing to save");
  return freezeState({
    ...state,
    save: { status: "pending", operationId: requiredText(operationId, "operationId"), error: null }
  });
}

export function rejectSave(state, { operationId, error = "save-not-confirmed" }) {
  if (state.save.status !== "pending" || state.save.operationId !== operationId) {
    return state;
  }
  return freezeState({
    ...state,
    save: { status: "failed", operationId, error: String(error) },
    dirty: true
  });
}

export function acknowledgeSave(state, { operationId, authoritativeSnapshot }) {
  if (state.save.status !== "pending" || state.save.operationId !== operationId) {
    return Object.freeze({ accepted: false, reason: "stale-operation", state });
  }
  const authoritative = createCommittedSnapshot(authoritativeSnapshot);
  if (!state.committed || authoritative.designId !== state.committed.designId) {
    return Object.freeze({ accepted: false, reason: "design-mismatch", state });
  }
  const workingAsSnapshot = createCommittedSnapshot({
    designId: state.working.designId,
    revision: state.committed.revision,
    home: state.working.home,
    placements: state.working.placements
  });
  if (!samePinnedSources(workingAsSnapshot, authoritative)) {
    return Object.freeze({ accepted: false, reason: "source-version-mismatch", state });
  }
  const committed = authoritative;
  const next = freezeState({
    ...state,
    committed,
    working: workingFromCommitted(committed),
    dirty: false,
    save: { status: "acknowledged", operationId, error: null }
  });
  return Object.freeze({ accepted: true, reason: null, state: next });
}

export function viewStatus(state) {
  if (!state.committed) {
    return Object.freeze({ label: "No committed design loaded", committed: false, dirty: state.dirty });
  }
  if (state.dirty) {
    if (state.save.status === "pending") return Object.freeze({ label: "Unsaved changes · save pending", committed: false, dirty: true });
    if (state.save.status === "failed") return Object.freeze({ label: "Unsaved changes · save not confirmed", committed: false, dirty: true });
    return Object.freeze({ label: "Unsaved changes", committed: false, dirty: true });
  }
  return Object.freeze({ label: `Committed ${state.committed.revision}`, committed: true, dirty: false });
}
