import test from "node:test";
import assert from "node:assert/strict";
import { EntryOutcome, ObjectIdEntryController, validateObjectEntry } from "../src/application/objectIdEntryController.js";
import { SYNTHETIC } from "../src/fixtures/workspaceFixtures.js";
import { createHarness } from "./helpers/workspaceHarness.mjs";

const { designId, objects, sceneId } = SYNTHETIC;

async function setup(user = "USER-A") {
  const h = createHarness({ user });
  await h.controller.open({ designId });
  const entry = new ObjectIdEntryController({ objectReader: h.fake.objectReader(user), workspace: h.controller });
  return { ...h, entry };
}

test("HCA-03.1 invalid id", async () => {
  assert.deepEqual(validateObjectEntry({ objectId: `  ${objects.box}  `, version: " 1 " }), { ok: true, objectId: objects.box, version: "1", errors: {} });
  const { entry, fake } = await setup();
  for (const objectId of ["", "obj_123", "dsg_01HZYSYNTH0000000000000001", "obj_01hzysynth0000000000000001", "obj_01HZYSYNTH000000000000000I"]) {
    const state = await entry.resolve({ objectId, version: "1" });
    assert.equal(state.outcome, EntryOutcome.INVALID, objectId);
    assert.ok(state.errors.objectId, objectId);
  }
  const badVersion = await entry.resolve({ objectId: objects.box, version: "latest" });
  assert.equal(badVersion.errors.version, "Versions are whole numbers, for example 1.");
  assert.equal(fake.objectReads.length, 0, "invalid input never reaches the reader");
});

test("HCA-03.1 not found non-disclosing", async () => {
  const { entry } = await setup();
  const missing = await entry.resolve({ objectId: "obj_01HZYSYNTH0000000000000099", version: "1" });
  const hidden = await entry.resolve({ objectId: objects.hidden, version: "1" });
  assert.equal(missing.outcome, EntryOutcome.NOT_FOUND);
  assert.equal(hidden.outcome, EntryOutcome.NOT_FOUND);
  assert.equal(missing.message, hidden.message, "missing and not-shared read the same");
  assert.equal(missing.message, "No object found for that ID and version, or it isn't shared with you.");
  assert.equal(missing.preview, null);

  const withdrawn = await entry.resolve({ objectId: objects.withdrawn, version: "1" });
  assert.equal(withdrawn.outcome, EntryOutcome.WITHDRAWN);
  const viewOnly = await entry.resolve({ objectId: objects.viewOnly, version: "1" });
  assert.equal(viewOnly.outcome, EntryOutcome.NO_PLACE_RIGHT);
  assert.match(viewOnly.message, /hasn't allowed you to place it/);
  assert.equal(await entry.addToWorkspace(), false, "no place right: nothing is added");
});

test("HCA-03.2 preview shows evidence class", async () => {
  const { entry } = await setup();
  const box = await entry.resolve({ objectId: objects.box, version: "1" });
  assert.equal(box.outcome, EntryOutcome.PREVIEW);
  assert.equal(box.preview.exactVersion, `${objects.box} · version 1`);
  assert.equal(box.preview.dimensionsText, "1.00 × 1.00 × 1.00 m (W × H × D)");
  assert.equal(box.preview.scaleClaim, "reference-supported");
  assert.equal(box.preview.evidenceText, "Size supported by a reference measurement");
  assert.deepEqual(box.preview.evidenceClasses, ["creator-measured"]);
  assert.deepEqual(box.preview.variants.map(item => [item.linkStatus, item.colour, item.package]), [["declared", "Not supplied", "Not supplied"]]);
  assert.deepEqual(box.preview.allowedUse, ["view", "place"]);

  const shelf = await entry.resolve({ objectId: objects.shelf, version: "1" });
  assert.equal(shelf.preview.evidenceText, "Seller-declared size (not independently checked)");
  const lamp = await entry.resolve({ objectId: objects.lamp, version: "1" });
  assert.equal(lamp.preview.evidenceText, "Scale unknown — no recorded size");
  assert.equal(lamp.preview.dimensionsText, "Not recorded");
  assert.equal(lamp.preview.realSizeAvailable, false);
  assert.equal(lamp.preview.defaultScaleMode, "illustrative");
});

test("HCA-03.3 add placement real size default", async () => {
  const { entry, controller, fake } = await setup();
  await entry.resolve({ objectId: objects.box, version: "1" });
  assert.equal(await entry.addToWorkspace(), true);
  assert.equal(entry.state.outcome, EntryOutcome.ADDED);
  assert.match(entry.state.message, /real size \(unsaved\)/);
  let view = controller.view();
  const added = view.placements.find(item => item.placement_id.startsWith("local-"));
  assert.equal(added.scale_mode, "real");
  assert.deepEqual(added.dimensions_m, [1, 1, 1]);
  assert.deepEqual(added.object_source, { object_id: objects.box, version: "1" });
  assert.equal(view.workingStatus, "unsaved");
  await controller.save();
  view = controller.view();
  assert.equal(view.workingStatus, "saved");
  const sent = fake.calls.find(call => call.operation === "addPlacement");
  assert.equal(sent.body.scale_mode, "real");
  assert.equal(sent.body.expected_revision, 2);
  assert.ok(view.placements.every(item => !item.placement_id.startsWith("local-")));
  assert.equal(view.fits[view.selection].outcome, "unverified_fit");

  // Unknown scale with no dimensions is added at illustrative scale, never real.
  await entry.resolve({ objectId: objects.lamp, version: "1" });
  assert.equal(await entry.addToWorkspace({ scaleMode: "real" }), false);
  assert.match(entry.state.message, /Real size isn't available/);
  assert.equal(await entry.addToWorkspace(), true);
  assert.equal(controller.view().placements.at(-1).scale_mode, "illustrative");
});

test("HCA-03.4 seller object id adds without exposing home", async () => {
  // USER-D (editor) enters a seller-declared Object ID received outside the design.
  const { entry, fake, controller } = await setup("USER-D");
  await entry.resolve({ objectId: ` ${objects.shelf} `, version: "1" });
  assert.equal(await entry.addToWorkspace(), true);
  assert.equal(fake.objectReads.length, 1);
  const sent = fake.objectReads[0];
  assert.deepEqual(Object.keys(sent.request).sort(), ["object_id", "version"]);
  assert.deepEqual(sent.request, { object_id: objects.shelf, version: "1" });
  const serialized = JSON.stringify(sent);
  for (const secret of [sceneId, designId, "PROP-VIRTUAL-1", "position_m", "placement"]) {
    assert.equal(serialized.includes(secret), false, `${secret} must not reach the object read`);
  }
  assert.equal(controller.view().placements.at(-1).scale_claim, "seller-declared");
});
