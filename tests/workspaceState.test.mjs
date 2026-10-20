import test from "node:test";
import assert from "node:assert/strict";
import {
  acknowledgeCommand,
  applyPlacementCommand,
  beginSaving,
  createWorkspaceState,
  finishSaving,
  rebaseAfterConflict,
  resolveConflict,
  undoLastLocalEdit,
  workingPlacements,
  workingStatus
} from "../src/domain/workspaceState.js";
import { SYNTHETIC, syntheticWorkspaceSeed } from "../src/fixtures/workspaceFixtures.js";

const { p1, p2 } = SYNTHETIC.placements;

function initial(role = "owner") {
  const seed = syntheticWorkspaceSeed();
  const design = seed.designs[0];
  const record = design.branches[0].revisions[1];
  return createWorkspaceState({
    design: { design_id: design.design_id, title: design.title, role, home_source: design.home_source, branches: [{ branch_id: "main", name: "Main", base_revision: 1, head_revision: 2 }] },
    branch: { branch_id: "main", name: "Main", base_revision: 1, head_revision: 2 },
    revision: record
  });
}

const moveP1 = { type: "move", placementId: p1, position_m: [1.5, 0, 1] };

test("HCA-06.1 unsaved/saving/saved/conflict", () => {
  let state = initial();
  assert.equal(workingStatus(state), "saved");
  state = applyPlacementCommand(state, moveP1);
  assert.equal(workingStatus(state), "unsaved");
  state = beginSaving(state);
  assert.equal(workingStatus(state), "saving");
  assert.throws(() => applyPlacementCommand(state, moveP1), /paused while saving/);
  state = acknowledgeCommand(state, { seq: state.pending[0].seq, revision: 3 });
  assert.equal(workingStatus(state), "saving", "still saving until the authoritative revision arrives");
  const record = { revision: 3, placements: workingPlacements(state), created_by: "USER-A", created_at: "2026-10-20T00:00:03Z" };
  state = finishSaving(state, record);
  assert.equal(workingStatus(state), "saved");
  assert.equal(state.server.revision, 3);
  state = applyPlacementCommand(state, { type: "rotate", placementId: p1, rotation_deg_y: 105 });
  state = rebaseAfterConflict(beginSaving(state), { revision: 4, placements: record.placements, created_by: "USER-D" });
  assert.equal(workingStatus(state), "conflict");
});

test("HCA-06.4 conflict shows server revision, keeps local edits separate", () => {
  let state = applyPlacementCommand(initial(), moveP1);
  state = applyPlacementCommand(state, { type: "hide", placementId: p2, hidden: true });
  const before = structuredClone(state.server.placements);
  // Another editor moved P1 and removed P2 in revision 3.
  const serverP1 = { ...structuredClone(before[0]), transform: { position_m: [0, 0, 0], rotation_deg_y: 90 } };
  state = rebaseAfterConflict(beginSaving(state), { revision: 3, placements: [serverP1], created_by: "USER-D" });

  assert.equal(state.conflict.serverRevision, 3);
  assert.equal(state.conflict.previousRevision, 2);
  assert.equal(state.conflict.serverChangedBy, "USER-D");
  assert.deepEqual(state.conflict.serverChanges.map(item => [item.placementId, item.change]).sort(), [[p1, "changed"], [p2, "removed"]].sort());
  assert.deepEqual(state.server.placements, [serverP1], "server revision is shown as-is");
  assert.equal(state.pending.length, 2, "local edits are kept, not sent and not merged");
  assert.deepEqual(state.conflict.localPlacements.find(item => item.placement_id === p1).transform.position_m, [1.5, 0, 1]);
  assert.throws(() => applyPlacementCommand(state, moveP1), /resolve the conflict/);

  const reapplied = resolveConflict(state, "reapply");
  assert.equal(reapplied.conflict, null);
  assert.equal(reapplied.pending.length, 1, "the hide of removed P2 no longer applies");
  assert.equal(reapplied.lastDropped[0].placementId, p2);
  assert.deepEqual(workingPlacements(reapplied)[0].transform.position_m, [1.5, 0, 1]);
  assert.equal(workingStatus(reapplied), "unsaved");

  const discarded = resolveConflict(state, "discard");
  assert.equal(discarded.pending.length, 0);
  assert.deepEqual(workingPlacements(discarded), [serverP1]);
  assert.equal(workingStatus(discarded), "saved");
});

test("HCA-04.4 nondestructive history", () => {
  const start = initial();
  const serverSnapshot = structuredClone(start.server.placements);
  let state = applyPlacementCommand(start, moveP1);
  state = applyPlacementCommand(state, { type: "duplicate", placementId: p1, offset_m: [0.5, 0, 0] });
  state = applyPlacementCommand(state, { type: "remove", placementId: p2 });
  assert.equal(workingPlacements(state).length, 2);
  assert.ok(Object.isFrozen(state.server.placements[0].transform.position_m));
  assert.deepEqual(state.server.placements, serverSnapshot, "local edits never touch the server revision");

  state = undoLastLocalEdit(state);
  assert.equal(workingPlacements(state).length, 3, "undo brings the removed placement back");
  state = undoLastLocalEdit(undoLastLocalEdit(state));
  assert.deepEqual(workingPlacements(state), serverSnapshot);
  assert.equal(workingStatus(state), "saved");

  // Restoring an old revision is a new revision; earlier entries stay in history.
  state = finishSaving(state, { revision: 3, placements: [], created_by: "USER-A" });
  state = finishSaving(state, { revision: 4, placements: serverSnapshot, created_by: "USER-A" }, { restoredFrom: 2 });
  assert.deepEqual(state.history.map(item => [item.revision, item.restoredFrom]), [[2, null], [3, null], [4, 2]]);
});

test("invalid commands and non-editing roles are refused before anything is queued", () => {
  const state = initial();
  assert.throws(() => applyPlacementCommand(state, { type: "move", placementId: p1, position_m: [Number.NaN, 0, 0] }), /finite/);
  assert.throws(() => applyPlacementCommand(state, { type: "move", placementId: p1, position_m: [501, 0, 0] }), /500 m/);
  assert.throws(() => applyPlacementCommand(state, { type: "setScaleMode", placementId: p1, scale_mode: "illustrative", illustrative_scale: 20 }), /0\.1 and 10/);
  assert.throws(() => applyPlacementCommand(state, { type: "move", placementId: "plc_missing", position_m: [0, 0, 0] }), /unknown placement/);
  assert.throws(() => applyPlacementCommand(initial("commenter"), moveP1), /cannot edit/);
  assert.throws(() => applyPlacementCommand(initial("viewer"), moveP1), /cannot edit/);
  assert.equal(state.pending.length, 0);
});

test("acknowledged add replaces the local id in later commands", () => {
  let state = applyPlacementCommand(initial(), {
    type: "add", object_source: { object_id: SYNTHETIC.objects.box, version: "1" }, dimensions_m: [1, 1, 1],
    scale_claim: "reference-supported", scale_mode: "real", position_m: [0, 0, 0], rotation_deg_y: 0
  });
  const localId = state.pending[0].newPlacementId;
  state = applyPlacementCommand(state, { type: "rotate", placementId: localId, rotation_deg_y: 45 });
  state = acknowledgeCommand(beginSaving(state), { seq: state.pending[0].seq, revision: 3, placementId: "plc_01HZYSYNTH0000000000009999" });
  assert.equal(state.pending[0].placementId, "plc_01HZYSYNTH0000000000009999");
  assert.ok(state.server.placements.some(item => item.placement_id === "plc_01HZYSYNTH0000000000009999"));
});
