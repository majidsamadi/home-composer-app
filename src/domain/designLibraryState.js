import { createDesignIntent } from "./entryIntent.js";

export const LibraryOutcome = Object.freeze({
  DISCONNECTED: "disconnected",
  LOADING: "loading",
  READY: "ready",
  EMPTY: "empty",
  RESTRICTED: "restricted",
  MISSING_DEPENDENCY: "missing-dependency",
  UNAVAILABLE: "unavailable"
});

export const ArrangementStatus = Object.freeze({
  PRIVATE: "private",
  SHARED: "shared",
  ARCHIVED: "archived",
  PUBLISHED: "published"
});

export const LibrarySourceStatus = Object.freeze({
  AVAILABLE: "available",
  UNKNOWN: "unknown",
  WITHDRAWN: "withdrawn",
  MISSING_DEPENDENCY: "missing-dependency",
  UNAVAILABLE: "unavailable",
  NOT_SUPPLIED: "not-supplied"
});

const OUTCOMES = new Set(Object.values(LibraryOutcome));
const ARRANGEMENT_STATUSES = new Set(Object.values(ArrangementStatus));
const SOURCE_STATUSES = new Set(Object.values(LibrarySourceStatus));

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function suppliedDesign(value) {
  if (value === undefined || value === null || value.supplied === false) {
    return Object.freeze({ supplied: false });
  }
  if (value.supplied !== true) throw new TypeError("design presence must be explicit");
  return Object.freeze({
    supplied: true,
    id: requiredText(value.id, "design id"),
    revision: requiredText(value.revision, "design revision")
  });
}

function sourceReference(value) {
  if (!value || !["home", "object"].includes(value.kind)) {
    throw new TypeError("source reference kind must be home or object");
  }
  return Object.freeze({
    kind: value.kind,
    service: requiredText(value.service, "source service"),
    id: requiredText(value.id, "source id"),
    version: requiredText(value.version, "source version")
  });
}

export function createLibraryRow(value) {
  if (!value || !ARRANGEMENT_STATUSES.has(value.arrangementStatus)) {
    throw new TypeError("library arrangement status is required");
  }
  if (!SOURCE_STATUSES.has(value.sourceStatus)) {
    throw new TypeError("library source status is required");
  }
  const design = suppliedDesign(value.design);
  const sources = Object.freeze((value.sources ?? []).map(sourceReference));
  return Object.freeze({
    rowId: requiredText(value.rowId, "rowId"),
    arrangementStatus: value.arrangementStatus,
    design,
    sourceStatus: value.sourceStatus,
    sources,
    fixtureLabel: value.fixtureLabel === undefined ? null : requiredText(value.fixtureLabel, "fixtureLabel")
  });
}

export function createLibraryState({
  outcome = LibraryOutcome.DISCONNECTED,
  accountKey = null,
  rows = [],
  selection = null,
  note = null
} = {}) {
  if (!OUTCOMES.has(outcome)) throw new TypeError(`unsupported library outcome: ${outcome}`);
  const normalizedRows = outcome === LibraryOutcome.READY ? rows.map(createLibraryRow) : [];
  if (outcome === LibraryOutcome.READY && normalizedRows.length === 0) {
    throw new Error("ready library outcome requires at least one explicit row");
  }
  if (outcome === LibraryOutcome.EMPTY && rows.length !== 0) {
    throw new Error("empty library outcome cannot carry rows");
  }
  return Object.freeze({
    outcome,
    accountKey,
    rows: Object.freeze(normalizedRows),
    selection,
    note: note === null ? null : String(note)
  });
}

export function normalizeLibraryResult(value, accountKey) {
  if (!value || !OUTCOMES.has(value.outcome)) {
    throw new TypeError("library adapter must supply an explicit outcome");
  }
  if ([LibraryOutcome.DISCONNECTED, LibraryOutcome.LOADING].includes(value.outcome)) {
    throw new TypeError("adapter cannot return internal disconnected/loading outcomes");
  }
  return createLibraryState({
    outcome: value.outcome,
    accountKey,
    rows: value.rows ?? [],
    note: value.note ?? null
  });
}

export function rowSelectionReason(row) {
  if (!row.design.supplied) return "design-reference-not-supplied";
  if (row.sourceStatus !== LibrarySourceStatus.AVAILABLE) {
    return `source-${row.sourceStatus}`;
  }
  return null;
}

export function selectLibraryRow(state, rowId) {
  if (state.outcome !== LibraryOutcome.READY) {
    return Object.freeze({ accepted: false, reason: `library-${state.outcome}`, state });
  }
  const row = state.rows.find(item => item.rowId === rowId);
  if (!row) return Object.freeze({ accepted: false, reason: "library-row-not-found", state });
  const blocked = rowSelectionReason(row);
  if (blocked) return Object.freeze({ accepted: false, reason: blocked, state });

  const intent = createDesignIntent({
    designId: row.design.id,
    designRevision: row.design.revision
  });
  const selection = Object.freeze({
    rowId: row.rowId,
    intent,
    sourceStatus: row.sourceStatus,
    requiresIndependentAvailability: true
  });
  const next = Object.freeze({ ...state, selection });
  return Object.freeze({ accepted: true, reason: null, intent, row, state: next });
}
