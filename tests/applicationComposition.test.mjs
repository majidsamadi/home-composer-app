import test from "node:test";
import assert from "node:assert/strict";

import { createComposerApplication } from "../src/application/applicationComposition.js";
import { createDesignIntent } from "../src/domain/entryIntent.js";
import { fixtureContexts } from "../src/fixtures/reviewFixtures.js";

test("default application composition is disconnected for identity and library", async () => {
  const app = createComposerApplication();
  assert.equal(app.identityBridge.sessionConnected, false);
  assert.equal(app.libraryController.adapterConnected, false);
  assert.equal(app.sceneController.adapterConnected, false);
  assert.equal(app.controller.state, null);
  assert.equal(app.libraryController.state.outcome, "disconnected");
  assert.equal(app.sceneController.state.outcome, "disconnected");

  const identity = await app.identityBridge.restoreContext({
    intent: createDesignIntent({ designId: "D1", designRevision: "r1" }),
    availability: fixtureContexts.ready
  });
  assert.equal(identity.accepted, false);
  assert.equal(identity.reason, "canonical-session-missing");
  assert.equal(app.controller.state, null);

  const libraryToken = app.libraryController.beginContext({ accountKey: "LOCAL-NO-ADAPTER" });
  const library = await app.libraryController.load(libraryToken);
  assert.equal(library.accepted, false);
  assert.equal(library.reason, "library-adapter-not-connected");
  assert.equal(app.libraryController.state.rows.length, 0);

  const sceneToken = app.sceneController.beginContext({ accountKey: "LOCAL-NO-SCENE-ADAPTER" });
  const scenes = await app.sceneController.load(sceneToken);
  assert.equal(scenes.accepted, false);
  assert.equal(scenes.reason, "scene-adapter-not-connected");
  assert.equal(app.sceneController.state.rows.length, 0);
});
