import test from "node:test";
import assert from "node:assert/strict";

import { ComposerEntryController } from "../src/application/composerEntryController.js";
import { DesignLibraryController } from "../src/application/designLibraryController.js";
import { ArrangementStatus, LibraryOutcome, LibrarySourceStatus } from "../src/domain/designLibraryState.js";
import { applyWorkingPlacementTransform, canEdit } from "../src/domain/designState.js";
import { createObjectIntent } from "../src/domain/entryIntent.js";
import { committedD1R1, designIntentD1, fixtureContexts } from "../src/fixtures/reviewFixtures.js";

const libraryResult = {
  outcome: LibraryOutcome.READY,
  rows: [{
    rowId: "SELECT-D2-R3",
    arrangementStatus: ArrangementStatus.SHARED,
    design: { supplied: true, id: "D2", revision: "r3" },
    sourceStatus: LibrarySourceStatus.AVAILABLE,
    sources: [{ kind: "home", service: "home-service", id: "H2", version: "v2" }],
    fixtureLabel: "Local synthetic fixture"
  }]
};

test("library selection returns exact Design intent without replacing an active Object intent", async () => {
  const composer = new ComposerEntryController();
  const objectIntent = createObjectIntent({ objectId: "O1", objectRevision: "v1" });
  composer.beginContext({ accountKey: "ACCOUNT-A", intent: objectIntent, availability: fixtureContexts.ready });

  const library = new DesignLibraryController({ adapter: { readLibrary: async () => libraryResult } });
  const token = library.beginContext({ accountKey: "ACCOUNT-A" });
  await library.load(token);
  const selected = library.select(token, "SELECT-D2-R3");

  assert.equal(selected.accepted, true);
  assert.equal(selected.intent.kind, "design");
  assert.equal(selected.intent.reference.id, "D2");
  assert.equal(selected.intent.reference.revision.value, "r3");
  assert.equal(composer.state.intent, objectIntent);
  assert.equal(composer.state.committed, null);
  assert.equal(canEdit(composer.state), false);
});

test("library selection cannot overwrite dirty committed/working Composer state", async () => {
  const composer = new ComposerEntryController();
  const composerToken = composer.beginContext({ accountKey: "ACCOUNT-A", intent: designIntentD1, availability: fixtureContexts.ready });
  assert.equal(composer.acceptCommittedSnapshot(composerToken, committedD1R1).accepted, true);
  const before = composer.state;
  assert.equal(composer.replaceState(composerToken, before, applyWorkingPlacementTransform(before, "P1", { x: 1.75 })).accepted, true);
  const dirty = composer.state;

  const library = new DesignLibraryController({ adapter: { readLibrary: async () => libraryResult } });
  const token = library.beginContext({ accountKey: "ACCOUNT-A" });
  await library.load(token);
  assert.equal(library.select(token, "SELECT-D2-R3").accepted, true);

  assert.equal(composer.state, dirty);
  assert.equal(composer.state.committed.designId, "D1");
  assert.equal(composer.state.committed.revision, "r1");
  assert.equal(composer.state.working.placements[0].transform.x, 1.75);
  assert.equal(composer.state.dirty, true);
});
