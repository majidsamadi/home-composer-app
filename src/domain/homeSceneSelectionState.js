export const SceneListOutcome = Object.freeze({
  DISCONNECTED: "disconnected",
  LOADING: "loading",
  READY: "ready",
  EMPTY: "empty",
  RESTRICTED: "restricted",
  MISSING_DEPENDENCY: "missing-dependency",
  UNAVAILABLE: "unavailable"
});

export const SceneEnvironmentKind = Object.freeze({
  MEASURED_PROPERTY: "measured-property",
  ILLUSTRATIVE_SANDBOX: "illustrative-sandbox"
});

export const SceneSourceStatus = Object.freeze({
  AVAILABLE: "available",
  UNKNOWN: "unknown",
  WITHDRAWN: "withdrawn",
  MISSING_DEPENDENCY: "missing-dependency",
  UNAVAILABLE: "unavailable"
});

export const SceneActionStatus = Object.freeze({
  ALLOWED: "allowed",
  BLOCKED: "blocked",
  NOT_SUPPLIED: "not-supplied"
});

export const SceneLimitStatus = Object.freeze({
  MEASURED: "measured",
  PARTIAL: "partial",
  UNKNOWN: "unknown",
  NOT_SUPPLIED: "not-supplied",
  ILLUSTRATIVE: "illustrative"
});

const OUTCOMES = new Set(Object.values(SceneListOutcome));
const ENVIRONMENTS = new Set(Object.values(SceneEnvironmentKind));
const SOURCE_STATUSES = new Set(Object.values(SceneSourceStatus));
const ACTION_STATUSES = new Set(Object.values(SceneActionStatus));
const LIMIT_STATUSES = new Set(Object.values(SceneLimitStatus));

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function exactReference(value, label) {
  if (!value || value.supplied !== true) throw new TypeError(`${label} must be explicitly supplied`);
  return Object.freeze({
    supplied: true,
    id: requiredText(value.id, `${label} id`),
    version: requiredText(value.version, `${label} version`)
  });
}

function optionalReference(value, label) {
  if (value === undefined || value === null || value.supplied === false) return Object.freeze({ supplied: false });
  return exactReference(value, label);
}

function limitation(value, label) {
  if (!value || !LIMIT_STATUSES.has(value.status)) throw new TypeError(`${label} status is required`);
  return Object.freeze({
    status: value.status,
    detail: value.detail === undefined ? null : String(value.detail)
  });
}

export function createSceneRow(value) {
  if (!value || !ENVIRONMENTS.has(value.environmentKind)) throw new TypeError("scene environment kind is required");
  if (!SOURCE_STATUSES.has(value.sourceStatus)) throw new TypeError("scene source status is required");
  if (!ACTION_STATUSES.has(value.currentActionStatus)) throw new TypeError("scene current-action status is required");

  const property = optionalReference(value.property, "property");
  const scene = exactReference(value.scene, "scene");
  const scale = limitation(value.scale, "scale");
  const coverage = limitation(value.coverage, "coverage");

  if (value.environmentKind === SceneEnvironmentKind.MEASURED_PROPERTY && !property.supplied) {
    throw new Error("measured-property scene requires an exact supplied property reference");
  }
  if (value.environmentKind === SceneEnvironmentKind.ILLUSTRATIVE_SANDBOX && property.supplied) {
    throw new Error("illustrative sandbox cannot create or bind a property reference");
  }
  if (value.environmentKind === SceneEnvironmentKind.ILLUSTRATIVE_SANDBOX && scale.status !== SceneLimitStatus.ILLUSTRATIVE) {
    throw new Error("illustrative sandbox must declare illustrative scale");
  }

  return Object.freeze({
    rowId: requiredText(value.rowId, "scene rowId"),
    environmentKind: value.environmentKind,
    property,
    scene,
    sourceStatus: value.sourceStatus,
    currentActionStatus: value.currentActionStatus,
    scale,
    coverage,
    fixtureLabel: value.fixtureLabel === undefined ? null : String(value.fixtureLabel)
  });
}

export function createSceneSelectionState({
  outcome = SceneListOutcome.DISCONNECTED,
  accountKey = null,
  rows = [],
  selection = null,
  note = null
} = {}) {
  if (!OUTCOMES.has(outcome)) throw new TypeError(`unsupported scene outcome: ${outcome}`);
  const normalizedRows = outcome === SceneListOutcome.READY ? rows.map(createSceneRow) : [];
  if (outcome === SceneListOutcome.READY && normalizedRows.length === 0) {
    throw new Error("ready scene outcome requires at least one explicitly supplied row");
  }
  if (outcome === SceneListOutcome.EMPTY && rows.length !== 0) {
    throw new Error("empty scene outcome cannot carry rows");
  }
  return Object.freeze({
    outcome,
    accountKey,
    rows: Object.freeze(normalizedRows),
    selection,
    note: note === null ? null : String(note)
  });
}

export function normalizeSceneSelectionResult(value, accountKey) {
  if (!value || !OUTCOMES.has(value.outcome)) throw new TypeError("scene adapter must supply an explicit outcome");
  if ([SceneListOutcome.DISCONNECTED, SceneListOutcome.LOADING].includes(value.outcome)) {
    throw new TypeError("adapter cannot return internal disconnected/loading outcomes");
  }
  return createSceneSelectionState({
    outcome: value.outcome,
    accountKey,
    rows: value.rows ?? [],
    note: value.note ?? null
  });
}

export function sceneSelectionReason(row) {
  if (row.currentActionStatus !== SceneActionStatus.ALLOWED) return `current-action-${row.currentActionStatus}`;
  if (row.sourceStatus !== SceneSourceStatus.AVAILABLE) return `source-${row.sourceStatus}`;
  return null;
}

export function selectSceneRow(state, rowId) {
  if (state.outcome !== SceneListOutcome.READY) {
    return Object.freeze({ accepted: false, reason: `scene-list-${state.outcome}`, state });
  }
  const row = state.rows.find(item => item.rowId === rowId);
  if (!row) return Object.freeze({ accepted: false, reason: "scene-row-not-found", state });
  const blocked = sceneSelectionReason(row);
  if (blocked) return Object.freeze({ accepted: false, reason: blocked, state });

  const selection = Object.freeze({
    rowId: row.rowId,
    environmentKind: row.environmentKind,
    property: row.property,
    scene: row.scene,
    sourceStatus: row.sourceStatus,
    scale: row.scale,
    coverage: row.coverage,
    requiresIndependentComposerAvailability: true
  });
  const next = Object.freeze({ ...state, selection });
  return Object.freeze({ accepted: true, reason: null, row, selection, state: next });
}
