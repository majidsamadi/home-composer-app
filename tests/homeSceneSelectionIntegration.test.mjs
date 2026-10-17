import test from "node:test";
import assert from "node:assert/strict";

import { ComposerEntryController } from "../src/application/composerEntryController.js";
import { HomeSceneSelectionController } from "../src/application/homeSceneSelectionController.js";
import { applyWorkingPlacementTransform } from "../src/domain/designState.js";
import { createObjectIntent } from "../src/domain/entryIntent.js";
import { committedD1R1, designIntentD1, fixtureContexts } from "../src/fixtures/reviewFixtures.js";
import { createLocalHomeSceneAdapter } from "../src/fixtures/homeSceneFixtures.js";

test("scene review selection does not replace committed home, working revision or dirty edits", async () => {
  const composer = new ComposerEntryController();
  const token = composer.beginContext({ accountKey: "ACCOUNT-A", intent: designIntentD1, availability: fixtureContexts.ready });
  assert.equal(composer.acceptCommittedSnapshot(token, committedD1R1).accepted, true);
  const expected = composer.state;
  assert.equal(composer.replaceState(token, expected, applyWorkingPlacementTransform(expected, "P1", { x: 1.75 })).accepted, true);
  const dirty = composer.state;

  const scenes = new HomeSceneSelectionController({ adapter: createLocalHomeSceneAdapter("journey") });
  const sceneToken = scenes.beginContext({ accountKey: "ACCOUNT-A" });
  await scenes.load(sceneToken);
  const selected = scenes.select(sceneToken, "LOCAL-LIMITS-MISSING-H1-S2-V2");
  assert.equal(selected.accepted, true);

  assert.equal(composer.state, dirty);
  assert.equal(composer.state.committed.home.id, "H1");
  assert.equal(composer.state.committed.home.version, "v1");
  assert.equal(composer.state.committed.revision, "r1");
  assert.equal(composer.state.working.baseRevision, "r1");
  assert.equal(composer.state.working.placements[0].transform.x, 1.75);
  assert.equal(composer.state.dirty, true);
});

test("scene selection preserves an existing Object intent and cannot manufacture edit rights", async () => {
  const composer = new ComposerEntryController();
  const objectIntent = createObjectIntent({ objectId: "O1", objectRevision: "v1" });
  composer.beginContext({ accountKey: "ACCOUNT-A", intent: objectIntent, availability: fixtureContexts.ready });

  const scenes = new HomeSceneSelectionController({ adapter: createLocalHomeSceneAdapter("journey") });
  const sceneToken = scenes.beginContext({ accountKey: "ACCOUNT-A" });
  await scenes.load(sceneToken);
  const selected = scenes.select(sceneToken, "LOCAL-MEASURED-H1-S1-V1");
  assert.equal(selected.accepted, true);

  assert.equal(composer.state.intent, objectIntent);
  assert.equal(composer.state.committed, null);
  assert.equal(composer.state.working, null);
  assert.equal(composer.state.dirty, false);
});
