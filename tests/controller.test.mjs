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
  controller.replaceState(applyWorkingPlacementTransform(controller.state, "P1", { x: 1.25 }));
  controller.replaceState(beginSave(controller.state, "op-late"));
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
  controller.replaceState(applyWorkingPlacementTransform(controller.state, "P1", { y: 1.4 }));
  controller.replaceState(beginSave(controller.state, "op-fail"));
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

