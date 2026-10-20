import test from "node:test";
import assert from "node:assert/strict";

import { ComposerCanonicalIdentityBridge } from "../src/application/canonicalIdentityBridge.js";
import { ComposerEntryController } from "../src/application/composerEntryController.js";
import { createDesignIntent, createObjectIntent } from "../src/domain/entryIntent.js";
import { applyWorkingPlacementTransform, beginSave, canEdit } from "../src/domain/designState.js";
import { committedD1R1, fixtureContexts } from "../src/fixtures/reviewFixtures.js";
import { canonicalFixture, USER_A, USER_B } from "./helpers/canonicalWebSessionFixture.mjs";

test("authenticated canonical identity does not synthesize resource availability", async () => {
  const f = canonicalFixture();
  const controller = new ComposerEntryController();
  const bridge = new ComposerCanonicalIdentityBridge({ controller, session: f.session });
  const intent = createDesignIntent({ designId: "D1", designRevision: "r1" });

  const missingAvailability = await bridge.restoreContext({ intent });
  assert.equal(missingAvailability.accepted, false);
  assert.equal(missingAvailability.reason, "resource-availability-required");
  assert.equal(f.calls.length, 0);
  assert.equal(controller.state, null);

  const blocked = await bridge.restoreContext({ intent, availability: fixtureContexts.wrongAccount });
  assert.equal(blocked.accepted, true);
  assert.equal(controller.state.accountKey, USER_A);
  assert.equal(controller.state.availability.kind, "wrong-account");
  assert.equal(controller.state.committed, null);
  assert.equal(canEdit(controller.state), false);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.calls.some(call => /\/(?:start|logout)$/.test(call.path)), false);
});

test("pending/return preserves exact Design and Object intents without converting them into authority", async () => {
  const f = canonicalFixture();
  const controller = new ComposerEntryController();
  const bridge = new ComposerCanonicalIdentityBridge({ controller, session: f.session });

  const designIntent = createDesignIntent({ designId: "D1", designRevision: "r1" });
  let result = await bridge.restoreContext({ intent: designIntent, availability: fixtureContexts.ready });
  assert.equal(result.accepted, true);
  assert.equal(controller.state.intent, designIntent);
  assert.equal(controller.state.intent.reference.id, "D1");
  assert.equal(controller.state.intent.reference.revision.value, "r1");
  assert.equal(controller.state.committed, null);
  assert.equal(controller.acceptCommittedSnapshot(result.token, committedD1R1).accepted, true);

  const objectIntent = createObjectIntent({ objectId: "O1", objectRevision: "v1" });
  result = await bridge.restoreContext({ intent: objectIntent, availability: fixtureContexts.ready });
  assert.equal(result.accepted, true);
  assert.equal(controller.state.intent, objectIntent);
  assert.equal(controller.state.intent.reference.id, "O1");
  assert.equal(controller.state.intent.reference.revision.value, "v1");
  const load = controller.acceptCommittedSnapshot(result.token, committedD1R1);
  assert.equal(load.accepted, false);
  assert.equal(load.reason, "object-intent-has-no-design-destination");
});

test("canonical account transition clears private state and invalidates old load/edit/save tokens", async () => {
  const f = canonicalFixture();
  const controller = new ComposerEntryController();
  const bridge = new ComposerCanonicalIdentityBridge({ controller, session: f.session });
  const intent = createDesignIntent({ designId: "D1", designRevision: "r1" });

  const first = await bridge.restoreContext({ intent, availability: fixtureContexts.ready });
  assert.equal(first.accepted, true);
  assert.equal(controller.acceptCommittedSnapshot(first.token, committedD1R1).accepted, true);
  let expected = controller.state;
  assert.equal(controller.replaceState(first.token, expected, applyWorkingPlacementTransform(expected, "P1", { x: 1.5 })).accepted, true);
  expected = controller.state;
  assert.equal(controller.replaceState(first.token, expected, beginSave(expected, "old-save")).accepted, true);
  const oldState = controller.state;
  const oldSaveToken = controller.saveToken("old-save");

  f.session.clear();
  f.setUser(USER_B);
  const second = await bridge.restoreContext({ intent, availability: fixtureContexts.wrongAccount });
  assert.equal(second.accepted, true);
  assert.equal(controller.state.accountKey, USER_B);
  assert.equal(controller.state.availability.kind, "wrong-account");
  assert.equal(controller.state.committed, null);
  assert.equal(controller.state.working, null);

  assert.equal(controller.acceptCommittedSnapshot(first.token, committedD1R1).reason, "stale-context");
  assert.equal(controller.replaceState(first.token, oldState, oldState).reason, "stale-context");
  assert.equal(controller.acceptSaveAcknowledgement(oldSaveToken, { ...committedD1R1, revision: "r2" }).reason, "stale-context");
});
