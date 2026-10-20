import test from "node:test";
import assert from "node:assert/strict";

import { ComposerCanonicalIdentityBridge } from "../src/application/canonicalIdentityBridge.js";
import { ComposerEntryController } from "../src/application/composerEntryController.js";
import { createDesignIntent, createObjectIntent } from "../src/domain/entryIntent.js";
import { fixtureContexts } from "../src/fixtures/reviewFixtures.js";
import { canonicalFixture } from "./helpers/canonicalWebSessionFixture.mjs";

test("delayed canonical restore cannot reattach after clear/invalidation", async () => {
  const f = canonicalFixture({ holdBootstrap: true });
  const controller = new ComposerEntryController();
  const bridge = new ComposerCanonicalIdentityBridge({ controller, session: f.session });
  const intent = createDesignIntent({ designId: "D1", designRevision: "r1" });

  const pending = bridge.restoreContext({ intent, availability: fixtureContexts.ready });
  await f.bootstrapStarted;
  f.session.clear();
  bridge.invalidate("canonical-session-cleared");
  f.releaseBootstrap();
  const result = await pending;

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "superseded-restore");
  assert.equal(controller.state, null);
  assert.equal(f.navigations.length, 0);
});

test("a superseded restore cannot overwrite the newer canonical context", async () => {
  const f = canonicalFixture({ holdBootstrap: true });
  const controller = new ComposerEntryController();
  const bridge = new ComposerCanonicalIdentityBridge({ controller, session: f.session });
  const firstIntent = createDesignIntent({ designId: "D1", designRevision: "r1" });
  const secondIntent = createObjectIntent({ objectId: "O1", objectRevision: "v1" });

  const first = bridge.restoreContext({ intent: firstIntent, availability: fixtureContexts.ready });
  await f.bootstrapStarted;
  const second = bridge.restoreContext({ intent: secondIntent, availability: fixtureContexts.missingDependency });
  f.releaseBootstrap();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.accepted, false);
  assert.equal(firstResult.reason, "superseded-restore");
  assert.equal(secondResult.accepted, true);
  assert.equal(controller.state.intent, secondIntent);
  assert.equal(controller.state.availability.kind, "missing-dependency");
  assert.equal(controller.state.committed, null);
});
