import test from "node:test";
import assert from "node:assert/strict";

import { ComposerCanonicalIdentityBridge, isCurrentReceipt } from "../src/application/canonicalIdentityBridge.js";
import { ComposerEntryController } from "../src/application/composerEntryController.js";
import { createDesignIntent } from "../src/domain/entryIntent.js";
import { fixtureContexts } from "../src/fixtures/reviewFixtures.js";
import { canonicalFixture, USER_A } from "./helpers/canonicalWebSessionFixture.mjs";

test("exact current canonical receipt is accepted with separately supplied availability", async () => {
  const f = canonicalFixture();
  const receipt = await f.session.restore();
  assert.equal(receipt.user_id, USER_A);
  assert.equal(isCurrentReceipt(f.session, receipt), true);

  const controller = new ComposerEntryController();
  const bridge = new ComposerCanonicalIdentityBridge({ controller, session: f.session });
  const intent = createDesignIntent({ designId: "D1", designRevision: "r1" });

  const result = await bridge.restoreContext({ intent, availability: fixtureContexts.wrongAccount });
  assert.equal(result.accepted, true);
  assert.equal(result.accountKey, USER_A);
  assert.equal(controller.state.accountKey, USER_A);
  assert.equal(controller.state.availability.kind, "wrong-account");
  assert.equal(controller.state.committed, null);
});

test("stale same-user receipt is rejected after actual canonical clear and reestablishment", async () => {
  const f = canonicalFixture();
  const firstReceipt = await f.session.restore(true);
  assert.equal(isCurrentReceipt(f.session, firstReceipt), true);

  f.session.clear();
  const secondReceipt = await f.session.restore(true);
  assert.equal(secondReceipt.user_id, firstReceipt.user_id);
  assert.notEqual(secondReceipt, firstReceipt);
  assert.equal(isCurrentReceipt(f.session, firstReceipt), false);
  assert.equal(isCurrentReceipt(f.session, secondReceipt), true);

  // Simulate delivery of the already-captured old receipt after a same-user
  // reestablishment. Currentness is still decided by the real canonical session.
  const liveRestore = f.session.restore.bind(f.session);
  f.session.restore = async () => firstReceipt;

  const controller = new ComposerEntryController();
  const bridge = new ComposerCanonicalIdentityBridge({ controller, session: f.session });
  const intent = createDesignIntent({ designId: "D1", designRevision: "r1" });
  const result = await bridge.restoreContext({ intent, availability: fixtureContexts.ready });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "canonical-session-changed");
  assert.equal(controller.state, null);
  assert.equal(f.session.userId, USER_A);
  assert.equal(isCurrentReceipt(f.session, secondReceipt), true);

  f.session.restore = liveRestore;
});
