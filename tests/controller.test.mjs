import test from "node:test";
import assert from "node:assert/strict";
import { ComposerEntryController } from "../src/application/composerEntryController.js";
import { createDesignIntent } from "../src/domain/entryIntent.js";
import { applyWorkingPlacementTransform, beginSave } from "../src/domain/designState.js";
import { committedD1R1, designIntentD1, fixtureContexts, objectIntentO1V1 } from "../src/fixtures/reviewFixtures.js";

test("late committed load is rejected after context switch", () => {
  const controller = new ComposerEntryController();
  const first = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: designIntentD1, availability: fixtureContexts.ready });
  controller.beginContext({ accountKey: "OTHER", intent: objectIntentO1V1, availability: fixtureContexts.wrongAccount });
  const result = controller.acceptCommittedSnapshot(first, committedD1R1);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "stale-context");
  assert.equal(controller.state.accountKey, "OTHER");
  assert.equal(controller.state.committed, null);
});

test("late authoritative save acknowledgement is rejected after account/context switch", () => {
  const controller = new ComposerEntryController();
  const first = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: designIntentD1, availability: fixtureContexts.ready });
  controller.acceptCommittedSnapshot(first, committedD1R1);
  let expected = controller.state;
  assert.equal(controller.replaceState(first, expected, applyWorkingPlacementTransform(expected, "P1", { x: 1.25 })).accepted, true);
  expected = controller.state;
  assert.equal(controller.replaceState(first, expected, beginSave(expected, "op-late")).accepted, true);
  const saveToken = controller.saveToken("op-late");
  controller.beginContext({ accountKey: "OTHER", intent: designIntentD1, availability: fixtureContexts.wrongAccount });
  const result = controller.acceptSaveAcknowledgement(saveToken, { ...committedD1R1, revision: "r2" });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "stale-context");
  assert.equal(controller.state.accountKey, "OTHER");
  assert.equal(controller.state.committed, null);
});

test("save failure token from current context does not mutate committed state", () => {
  const controller = new ComposerEntryController();
  const ctx = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: designIntentD1, availability: fixtureContexts.ready });
  controller.acceptCommittedSnapshot(ctx, committedD1R1);
  let expected = controller.state;
  assert.equal(controller.replaceState(ctx, expected, applyWorkingPlacementTransform(expected, "P1", { y: 1.4 })).accepted, true);
  expected = controller.state;
  assert.equal(controller.replaceState(ctx, expected, beginSave(expected, "op-fail")).accepted, true);
  const result = controller.acceptSaveFailure(controller.saveToken("op-fail"), "synthetic-failure");
  assert.equal(result.accepted, true);
  assert.equal(controller.state.committed.revision, "r1");
  assert.equal(controller.state.committed.placements[0].transform.y, 1);
  assert.equal(controller.state.working.placements[0].transform.y, 1.4);
});

test("current wrong-account context cannot load a cached committed design", () => {
  const controller = new ComposerEntryController();
  const token = controller.beginContext({ accountKey: "OTHER", intent: designIntentD1, availability: fixtureContexts.wrongAccount });
  const result = controller.acceptCommittedSnapshot(token, committedD1R1);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "availability-blocked");
  assert.equal(controller.state.committed, null);
});

test("Object ID intent does not imply a Composer design destination", () => {
  const controller = new ComposerEntryController();
  const token = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: objectIntentO1V1, availability: fixtureContexts.ready });
  const result = controller.acceptCommittedSnapshot(token, committedD1R1);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "object-intent-has-no-design-destination");
  assert.equal(controller.state.committed, null);
});
test("controller preserves a matching committed load when a later explicit revision mismatches", () => {
  const controller = new ComposerEntryController();
  const intent = createDesignIntent({ designId: "D1", designRevision: "r1" });
  const token = controller.beginContext({ accountKey: "SYNTHETIC-A", intent, availability: fixtureContexts.ready });
  const matching = controller.acceptCommittedSnapshot(token, committedD1R1);
  assert.equal(matching.accepted, true);
  assert.equal(controller.state.committed.revision, "r1");

  const mismatched = controller.acceptCommittedSnapshot(token, { ...committedD1R1, revision: "r2" });
  assert.equal(mismatched.accepted, false);
  assert.equal(mismatched.reason, "design-revision-mismatch");
  assert.equal(controller.state.intent.reference.revision.value, "r1");
  assert.equal(controller.state.committed.revision, "r1");
  assert.equal(controller.state.working.baseRevision, "r1");
});

test("stale account context cannot restore an old private state", () => {
  const controller = new ComposerEntryController();
  const tokenA = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: designIntentD1, availability: fixtureContexts.ready });
  controller.acceptCommittedSnapshot(tokenA, committedD1R1);
  const stale = controller.state;

  controller.beginContext({ accountKey: "SYNTHETIC-B", intent: designIntentD1, availability: fixtureContexts.wrongAccount });
  const activeBefore = controller.state;
  const result = controller.replaceState(tokenA, stale, stale);

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "stale-context");
  assert.equal(controller.state, activeBefore);
  assert.equal(controller.state.accountKey, "SYNTHETIC-B");
  assert.equal(controller.state.availability.kind, "wrong-account");
  assert.equal(controller.state.committed, null);
});

test("same account newer context rejects an older-context replacement", () => {
  const controller = new ComposerEntryController();
  const first = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: designIntentD1, availability: fixtureContexts.ready });
  controller.acceptCommittedSnapshot(first, committedD1R1);
  const stale = controller.state;
  const second = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: designIntentD1, availability: fixtureContexts.ready });
  const activeBefore = controller.state;

  const result = controller.replaceState(first, stale, stale);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "stale-context");
  assert.equal(controller.state, activeBefore);
  assert.equal(second.epoch > first.epoch, true);
});

test("replacement cannot switch Object-vs-Design intent inside the current context", () => {
  const controller = new ComposerEntryController();
  const token = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: objectIntentO1V1, availability: fixtureContexts.ready });
  const expected = controller.state;
  const forged = { ...expected, intent: designIntentD1 };

  const result = controller.replaceState(token, expected, forged);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "replacement-intent-mismatch");
  assert.equal(controller.state, expected);
  assert.equal(controller.state.intent.kind, "object");
});

test("delayed old update cannot replace a newer state in the same context", () => {
  const controller = new ComposerEntryController();
  const token = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: designIntentD1, availability: fixtureContexts.ready });
  controller.acceptCommittedSnapshot(token, committedD1R1);
  const oldState = controller.state;
  const firstUpdate = applyWorkingPlacementTransform(oldState, "P1", { x: 1.25 });
  assert.equal(controller.replaceState(token, oldState, firstUpdate).accepted, true);
  const current = controller.state;

  const delayed = applyWorkingPlacementTransform(oldState, "P1", { x: 9 });
  const result = controller.replaceState(token, oldState, delayed);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "stale-state");
  assert.equal(controller.state, current);
  assert.equal(controller.state.working.placements[0].transform.x, 1.25);
});

test("current-context replacement preserves edit, begin-save, failure and authoritative acknowledgement flows", () => {
  const controller = new ComposerEntryController();
  const token = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: designIntentD1, availability: fixtureContexts.ready });
  controller.acceptCommittedSnapshot(token, committedD1R1);

  let expected = controller.state;
  let result = controller.replaceState(token, expected, applyWorkingPlacementTransform(expected, "P1", { x: 1.5 }));
  assert.equal(result.accepted, true);

  expected = controller.state;
  result = controller.replaceState(token, expected, beginSave(expected, "op-current-fail"));
  assert.equal(result.accepted, true);
  assert.equal(controller.acceptSaveFailure(controller.saveToken("op-current-fail"), "synthetic-failure").accepted, true);
  assert.equal(controller.state.committed.revision, "r1");
  assert.equal(controller.state.dirty, true);

  expected = controller.state;
  result = controller.replaceState(token, expected, beginSave(expected, "op-current-ack"));
  assert.equal(result.accepted, true);
  const ack = controller.acceptSaveAcknowledgement(controller.saveToken("op-current-ack"), {
    ...committedD1R1,
    revision: "r2",
    placements: controller.state.working.placements.map(item => ({
      placementId: item.placementId,
      object: { ...item.object },
      transform: { ...item.transform }
    }))
  });
  assert.equal(ack.accepted, true);
  assert.equal(controller.state.committed.revision, "r2");
  assert.equal(controller.state.dirty, false);
});
