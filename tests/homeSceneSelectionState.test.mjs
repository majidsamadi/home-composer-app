import test from "node:test";
import assert from "node:assert/strict";

import {
  SceneActionStatus,
  SceneEnvironmentKind,
  SceneLimitStatus,
  SceneListOutcome,
  SceneSourceStatus,
  createSceneRow,
  normalizeSceneSelectionResult,
  selectSceneRow
} from "../src/domain/homeSceneSelectionState.js";

const measuredRow = ({
  rowId = "ROW-CURRENT",
  sceneVersion = "v1",
  sourceStatus = SceneSourceStatus.AVAILABLE,
  actionStatus = SceneActionStatus.ALLOWED,
  scaleStatus = SceneLimitStatus.MEASURED,
  coverageStatus = SceneLimitStatus.PARTIAL
} = {}) => ({
  rowId,
  environmentKind: SceneEnvironmentKind.MEASURED_PROPERTY,
  property: { supplied: true, id: "H1", version: "v1" },
  scene: { supplied: true, id: "SCENE-H1", version: sceneVersion },
  sourceStatus,
  currentActionStatus: actionStatus,
  scale: { status: scaleStatus, detail: "synthetic scale detail" },
  coverage: { status: coverageStatus, detail: "synthetic coverage detail" }
});

test("measured-property row preserves exact property, scene and version plus limitations", () => {
  const row = createSceneRow(measuredRow());
  assert.deepEqual(row.property, { supplied: true, id: "H1", version: "v1" });
  assert.deepEqual(row.scene, { supplied: true, id: "SCENE-H1", version: "v1" });
  assert.equal(row.sourceStatus, SceneSourceStatus.AVAILABLE);
  assert.equal(row.scale.status, SceneLimitStatus.MEASURED);
  assert.equal(row.coverage.status, SceneLimitStatus.PARTIAL);
});

test("illustrative sandbox is structurally distinct and cannot bind a property master", () => {
  const sandbox = createSceneRow({
    rowId: "SANDBOX",
    environmentKind: SceneEnvironmentKind.ILLUSTRATIVE_SANDBOX,
    property: { supplied: false },
    scene: { supplied: true, id: "SYN-SANDBOX", version: "v1" },
    sourceStatus: SceneSourceStatus.AVAILABLE,
    currentActionStatus: SceneActionStatus.ALLOWED,
    scale: { status: SceneLimitStatus.ILLUSTRATIVE, detail: "illustrative only" },
    coverage: { status: SceneLimitStatus.UNKNOWN, detail: "unknown" }
  });
  assert.equal(sandbox.property.supplied, false);
  assert.equal(sandbox.environmentKind, SceneEnvironmentKind.ILLUSTRATIVE_SANDBOX);
  assert.throws(() => createSceneRow({
    ...sandbox,
    property: { supplied: true, id: "H1", version: "v1" }
  }), /cannot create or bind a property/);
});

test("withdrawn exact version remains visible metadata but cannot be selected or replaced", () => {
  const state = normalizeSceneSelectionResult({
    outcome: SceneListOutcome.READY,
    rows: [measuredRow({ rowId: "WITHDRAWN", sceneVersion: "v0", sourceStatus: SceneSourceStatus.WITHDRAWN, actionStatus: SceneActionStatus.BLOCKED })]
  }, "ACCOUNT-A");
  assert.equal(state.rows[0].scene.version, "v0");
  const selected = selectSceneRow(state, "WITHDRAWN");
  assert.equal(selected.accepted, false);
  assert.equal(selected.reason, "current-action-blocked");
  assert.equal(state.selection, null);
});

test("missing scale and unresolved coverage remain explicit without a fit claim", () => {
  const state = normalizeSceneSelectionResult({
    outcome: SceneListOutcome.READY,
    rows: [measuredRow({
      rowId: "LIMITS",
      sceneVersion: "v2",
      scaleStatus: SceneLimitStatus.NOT_SUPPLIED,
      coverageStatus: SceneLimitStatus.UNKNOWN
    })]
  }, "ACCOUNT-A");
  const selected = selectSceneRow(state, "LIMITS");
  assert.equal(selected.accepted, true);
  assert.equal(selected.selection.scene.version, "v2");
  assert.equal(selected.selection.scale.status, SceneLimitStatus.NOT_SUPPLIED);
  assert.equal(selected.selection.coverage.status, SceneLimitStatus.UNKNOWN);
  assert.equal(selected.selection.requiresIndependentComposerAvailability, true);
});

test("empty, restricted, missing-dependency and unavailable scene outcomes stay distinct", () => {
  for (const outcome of [
    SceneListOutcome.EMPTY,
    SceneListOutcome.RESTRICTED,
    SceneListOutcome.MISSING_DEPENDENCY,
    SceneListOutcome.UNAVAILABLE
  ]) {
    const state = normalizeSceneSelectionResult({ outcome, rows: [] }, "ACCOUNT-A");
    assert.equal(state.outcome, outcome);
    assert.equal(state.rows.length, 0);
    assert.equal(state.selection, null);
  }
});
