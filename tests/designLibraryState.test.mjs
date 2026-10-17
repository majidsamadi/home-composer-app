import test from "node:test";
import assert from "node:assert/strict";

import {
  ArrangementStatus,
  LibraryOutcome,
  LibrarySourceStatus,
  createLibraryRow,
  createLibraryState,
  normalizeLibraryResult,
  selectLibraryRow
} from "../src/domain/designLibraryState.js";

const exactRow = ({ rowId = "R1", status = ArrangementStatus.PRIVATE, sourceStatus = LibrarySourceStatus.AVAILABLE, designId = "D1", revision = "r1" } = {}) => ({
  rowId,
  arrangementStatus: status,
  design: { supplied: true, id: designId, revision },
  sourceStatus,
  sources: [{ kind: "home", service: "home-service", id: "H1", version: "v1" }],
  fixtureLabel: "Local synthetic fixture"
});

test("library rows preserve arrangement status, exact Design revision and pinned source version", () => {
  for (const status of Object.values(ArrangementStatus)) {
    const row = createLibraryRow(exactRow({ rowId: `ROW-${status}`, status }));
    assert.equal(row.arrangementStatus, status);
    assert.equal(row.design.supplied, true);
    assert.equal(row.design.id, "D1");
    assert.equal(row.design.revision, "r1");
    assert.deepEqual(row.sources[0], { kind: "home", service: "home-service", id: "H1", version: "v1" });
  }
});

test("unknown and unavailable source states are neither healthy nor empty", () => {
  const state = normalizeLibraryResult({
    outcome: LibraryOutcome.READY,
    rows: [
      exactRow({ rowId: "UNKNOWN", sourceStatus: LibrarySourceStatus.UNKNOWN }),
      exactRow({ rowId: "UNAVAILABLE", sourceStatus: LibrarySourceStatus.UNAVAILABLE })
    ]
  }, "ACCOUNT-A");
  assert.equal(state.outcome, LibraryOutcome.READY);
  assert.equal(state.rows.length, 2);
  assert.equal(selectLibraryRow(state, "UNKNOWN").reason, "source-unknown");
  assert.equal(selectLibraryRow(state, "UNAVAILABLE").reason, "source-unavailable");
});

test("explicit empty, restricted, missing-dependency and unavailable outcomes remain distinct", () => {
  for (const outcome of [LibraryOutcome.EMPTY, LibraryOutcome.RESTRICTED, LibraryOutcome.MISSING_DEPENDENCY, LibraryOutcome.UNAVAILABLE]) {
    const state = normalizeLibraryResult({ outcome, rows: [] }, "ACCOUNT-A");
    assert.equal(state.outcome, outcome);
    assert.equal(state.rows.length, 0);
    assert.equal(state.selection, null);
  }
  assert.throws(() => createLibraryState({ outcome: LibraryOutcome.EMPTY, rows: [exactRow()] }), /cannot carry rows/);
});

test("withdrawn exact Design revision is retained but never restored as selectable", () => {
  const state = normalizeLibraryResult({
    outcome: LibraryOutcome.READY,
    rows: [exactRow({ rowId: "WITHDRAWN", sourceStatus: LibrarySourceStatus.WITHDRAWN, revision: "r2" })]
  }, "ACCOUNT-A");
  assert.equal(state.rows[0].design.revision, "r2");
  const selection = selectLibraryRow(state, "WITHDRAWN");
  assert.equal(selection.accepted, false);
  assert.equal(selection.reason, "source-withdrawn");
  assert.equal(state.selection, null);
});

test("available exact row yields only a Design intent and independent-availability marker", () => {
  const state = normalizeLibraryResult({ outcome: LibraryOutcome.READY, rows: [exactRow()] }, "ACCOUNT-A");
  const selection = selectLibraryRow(state, "R1");
  assert.equal(selection.accepted, true);
  assert.equal(selection.intent.kind, "design");
  assert.equal(selection.intent.reference.id, "D1");
  assert.equal(selection.intent.reference.revision.supplied, true);
  assert.equal(selection.intent.reference.revision.value, "r1");
  assert.equal(selection.state.selection.requiresIndependentAvailability, true);
});
