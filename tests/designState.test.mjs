import test from "node:test";
import assert from "node:assert/strict";
import { createDesignIntent } from "../src/domain/entryIntent.js";
import {
  AvailabilityKind,
  acknowledgeSave,
  applyWorkingPlacementTransform,
  beginSave,
  canEdit,
  initializeDesignState,
  rejectSave,
  viewStatus
} from "../src/domain/designState.js";
import { committedD1R1, fixtureContexts } from "../src/fixtures/reviewFixtures.js";

const make = (availability = fixtureContexts.ready) => initializeDesignState({
  contextId: "ctx-1",
  accountKey: "SYNTHETIC-A",
  intent: createDesignIntent({ designId: "D1" }),
  availability,
  committedSnapshot: availability.kind === AvailabilityKind.READY ? committedD1R1 : null
});

test("direct initialization accepts an exact supplied Design revision", () => {
  const state = initializeDesignState({
    contextId: "ctx-exact",
    accountKey: "SYNTHETIC-A",
    intent: createDesignIntent({ designId: "D1", designRevision: "r1" }),
    availability: fixtureContexts.ready,
    committedSnapshot: committedD1R1
  });
  assert.equal(state.intent.reference.revision.supplied, true);
  assert.equal(state.intent.reference.revision.value, "r1");
  assert.equal(state.committed.revision, "r1");
});

test("direct initialization rejects an explicit Design revision mismatch", () => {
  assert.throws(() => initializeDesignState({
    contextId: "ctx-revision-mismatch",
    accountKey: "SYNTHETIC-A",
    intent: createDesignIntent({ designId: "D1", designRevision: "r1" }),
    availability: fixtureContexts.ready,
    committedSnapshot: { ...committedD1R1, revision: "r2" }
  }), /Design revision/);
});

test("direct initialization rejects a wrong Design ID", () => {
  assert.throws(() => initializeDesignState({
    contextId: "ctx-id-mismatch",
    accountKey: "SYNTHETIC-A",
    intent: createDesignIntent({ designId: "D2", designRevision: "r1" }),
    availability: fixtureContexts.ready,
    committedSnapshot: committedD1R1
  }), /Design ID/);
});

test("revision-not-supplied stays explicit and does not select a revision", () => {
  const state = make();
  assert.equal(state.intent.reference.revision.supplied, false);
  assert.equal("value" in state.intent.reference.revision, false);
  assert.equal(state.committed.revision, "r1");
});

test("working update never mutates loaded committed snapshot or source references", () => {
  const state = make();
  const committedBefore = JSON.stringify(state.committed);
  const next = applyWorkingPlacementTransform(state, "P1", { x: 1.25 });
  assert.equal(JSON.stringify(state.committed), committedBefore);
  assert.equal(state.committed.placements[0].transform.x, 1);
  assert.equal(next.working.placements[0].transform.x, 1.25);
  assert.equal(next.working.placements[0].object.version, "v1");
  assert.equal(next.dirty, true);
  assert.equal(viewStatus(next).committed, false);
});

test("unsuccessful save remains dirty and never displays committed success", () => {
  let state = applyWorkingPlacementTransform(make(), "P1", { x: 1.25 });
  state = beginSave(state, "op-1");
  state = rejectSave(state, { operationId: "op-1", error: "timeout" });
  assert.equal(state.committed.revision, "r1");
  assert.equal(state.dirty, true);
  assert.equal(state.save.status, "failed");
  assert.equal(viewStatus(state).label, "Unsaved changes · save not confirmed");
});

test("authoritative acknowledgement is the only transition that promotes working data", () => {
  let state = applyWorkingPlacementTransform(make(), "P1", { x: 1.25 });
  state = beginSave(state, "op-2");
  const result = acknowledgeSave(state, {
    operationId: "op-2",
    authoritativeSnapshot: {
      ...committedD1R1,
      revision: "r2",
      placements: state.working.placements.map(item => ({ placementId: item.placementId, object: { ...item.object }, transform: { ...item.transform } }))
    }
  });
  assert.equal(result.accepted, true);
  assert.equal(result.state.committed.revision, "r2");
  assert.equal(result.state.committed.placements[0].transform.x, 1.25);
  assert.equal(result.state.dirty, false);
  assert.equal(viewStatus(result.state).label, "Committed r2");
});

test("source-version mismatch is rejected and committed revision stays pinned", () => {
  let state = applyWorkingPlacementTransform(make(), "P1", { x: 1.25 });
  state = beginSave(state, "op-3");
  const mismatch = {
    ...committedD1R1,
    revision: "r2",
    home: { ...committedD1R1.home, version: "v2" },
    placements: state.working.placements.map(item => ({ placementId: item.placementId, object: { ...item.object }, transform: { ...item.transform } }))
  };
  const result = acknowledgeSave(state, { operationId: "op-3", authoritativeSnapshot: mismatch });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "source-version-mismatch");
  assert.equal(result.state.committed.revision, "r1");
  assert.equal(result.state.committed.home.version, "v1");
  assert.equal(result.state.dirty, true);
});

for (const [name, availability] of [
  ["wrong account", fixtureContexts.wrongAccount],
  ["withdrawn home", fixtureContexts.withdrawnHome],
  ["missing dependency", fixtureContexts.missingDependency],
  ["pending invitation", fixtureContexts.pendingInvitation]
]) {
  test(`${name} remains a distinct edit-disabled input`, () => {
    const state = make(availability);
    assert.equal(state.availability.kind, availability.kind);
    assert.equal(canEdit(state), false);
    assert.equal(state.committed, null);
    assert.throws(() => applyWorkingPlacementTransform(state, "P1", { x: 2 }), /editing disabled/);
  });
}
