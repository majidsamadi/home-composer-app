import test from "node:test";
import assert from "node:assert/strict";
import { GeometryState, Phase } from "../src/application/workspaceController.js";
import { RENDERER_LABELS } from "../src/viewer/viewerPort.js";
import { SYNTHETIC } from "../src/fixtures/workspaceFixtures.js";
import { createHarness, flush } from "./helpers/workspaceHarness.mjs";

const { designId, sceneId, objects, placements } = SYNTHETIC;
const methods = viewer => viewer.calls.map(call => call.method);

test("HCA-02.1 loads exact scene version via view-session then viewer.load", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  const ops = h.fake.calls.map(call => call.operation);
  assert.deepEqual(ops.slice(0, 3), ["getDesign", "getRevision", "createViewSession"]);
  const session = h.fake.calls[2];
  assert.deepEqual(session.body, { branch_id: "main", revision: 2 });
  assert.match(session.idempotencyKey, /^[A-Za-z0-9_-]{8,128}$/);

  const load = h.viewer.calls.find(call => call.method === "load");
  assert.equal(load.args[0].envelope.asset_id, sceneId);
  assert.equal(load.args[0].envelope.version, "1");
  assert.equal(load.args[0].envelope.kind, "home");
  assert.ok(methods(h.viewer).indexOf("load") < methods(h.viewer).indexOf("setInstances"));
  const instances = h.viewer.instances;
  assert.deepEqual(instances.map(item => [item.instanceId, item.source.envelope.asset_id, item.source.envelope.version]), [
    [placements.p1, objects.box, "1"],
    [placements.p2, objects.shelf, "1"]
  ]);
  assert.deepEqual(instances[0].position_m, [1, 0, 1]);
  assert.equal(instances[0].rotationDegY, 90);
  assert.equal(instances[0].scaleMode, "real");
  const view = h.controller.view();
  assert.equal(view.phase, Phase.READY);
  assert.equal(view.geometry.state, GeometryState.COMPLETE);
  assert.equal(view.revision, 2);
  assert.ok(h.viewer.overlays.some(item => item.kind === "unobserved"), "home unobserved regions are shown");
  assert.ok(h.viewer.overlays.some(item => item.kind === "estimated" && item.regionId === placements.p2), "seller-declared size is marked estimated");
});

test("HCA-02.2 orbit/zoom/top/focus delegate to viewer", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  h.viewer.calls.length = 0;
  h.controller.orbit(0.2, -0.1);
  h.controller.zoom(1.25);
  h.controller.setTopView(true);
  h.controller.setTopView(false);
  h.controller.focusPlacement(placements.p1);
  h.controller.focusHome();
  const calls = h.viewer.calls.filter(call => call.method !== "capability" && call.method !== "describe");
  assert.deepEqual(calls.map(call => [call.method, ...call.args]), [
    ["orbit", 0.2, -0.1],
    ["zoom", 1.25],
    ["setCameraMode", "top"],
    ["setCameraMode", "orbit"],
    ["focus", { bounds: { min: [0.5, 0, 0.5], max: [1.5, 1, 1.5] } }],
    ["focus", { bounds: { min: [-2, 0, -2], max: [2, 2.5, 2] } }]
  ]);
  assert.equal(h.controller.view().selection, placements.p1);
});

test("HCA-02.3 partial/unsupported geometry states from view-session outcomes", async () => {
  const partial = createHarness();
  partial.fake.scenario.objectOutcomes[`${objects.shelf}@1`] = "withdrawn";
  await partial.controller.open({ designId });
  let view = partial.controller.view();
  assert.equal(view.geometry.state, GeometryState.PARTIAL);
  assert.match(view.geometry.text, /Partial view: Object obj_…0002 v1 withdrawn by its owner/);
  assert.deepEqual(partial.viewer.instances.map(item => item.instanceId), [placements.p1], "withdrawn source is not drawn");
  assert.equal(view.placements.length, 2, "but it is still listed");

  const noHome = createHarness();
  noHome.fake.scenario.homeOutcome = "source_access_denied";
  await noHome.controller.open({ designId });
  view = noHome.controller.view();
  assert.equal(view.geometry.state, GeometryState.HOME_UNAVAILABLE);
  assert.match(view.geometry.text, /Home not shown: Home not available to you/);
  assert.equal(methods(noHome.viewer).includes("load"), false);

  const unsupported = createHarness({ renderer: "unsupported" });
  await unsupported.controller.open({ designId });
  view = unsupported.controller.view();
  assert.equal(view.geometry.state, GeometryState.UNSUPPORTED);
  assert.equal(methods(unsupported.viewer).includes("load"), false);
  assert.equal(view.placements.length, 2);
  assert.equal(await unsupported.controller.apply({ type: "move", placementId: placements.p1, position_m: [0, 0, 0] }), true, "editing still works without 3D");

  const failed = createHarness({ viewerOptions: { failLoad: "PARSE_FAILED" } });
  await failed.controller.open({ designId });
  assert.equal(failed.controller.view().geometry.state, GeometryState.FAILED);
  assert.match(failed.controller.view().geometry.text, /could not load \(PARSE_FAILED\)/);
});

test("HCA-02.4 device-lost shows reload, state kept", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  await h.controller.apply({ type: "move", placementId: placements.p1, position_m: [1.2, 0, 1] });
  h.viewer.emit("device-lost", { reason: "synthetic", recoverable: true });
  let view = h.controller.view();
  assert.equal(view.geometry.state, GeometryState.DEVICE_LOST);
  assert.equal(view.geometry.text, "3D view lost — Reload view. Your design and unsaved edits are kept.");
  assert.equal(view.pendingCount, 1);
  assert.equal(view.workingStatus, "unsaved");
  const loadsBefore = methods(h.viewer).filter(method => method === "load").length;
  await h.controller.reloadView();
  view = h.controller.view();
  assert.equal(view.geometry.state, GeometryState.COMPLETE);
  assert.equal(methods(h.viewer).filter(method => method === "load").length, loadsBefore + 1);
  assert.equal(view.pendingCount, 1, "unsaved edit survives the reload");
  assert.deepEqual(h.viewer.instances.find(item => item.instanceId === placements.p1).position_m, [1.2, 0, 1]);
});

test("HCA-02.4 dispose on account change", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  const first = h.viewer;
  await h.controller.changeAccount("USER-B");
  assert.equal(first.disposeCount, 1);
  let view = h.controller.view();
  assert.equal(view.phase, Phase.IDLE);
  assert.equal(view.designId, null);
  assert.deepEqual(view.placements, []);

  // A result that arrives after the account change is dropped, not shown.
  const release = h.fake.hold();
  const pending = h.controller.open({ designId });
  await flush();
  await h.controller.changeAccount("USER-C");
  release();
  await pending;
  view = h.controller.view();
  assert.equal(view.phase, Phase.IDLE);
  assert.equal(view.designId, null);
  assert.ok(h.controller.lateResultsDropped >= 1);

  await h.controller.open({ designId });
  const second = h.viewer;
  assert.notEqual(second, first, "a new viewer is created after disposal");
  await h.controller.navigateAway();
  await h.controller.navigateAway();
  assert.equal(second.disposeCount, 1, "navigation disposes once");
  assert.equal(h.controller.view().phase, Phase.DISPOSED);
});

test("compatibility label shown verbatim, never \"WebGPU\"", async () => {
  const h = createHarness({ renderer: "webgl2-compatibility" });
  await h.controller.open({ designId });
  const view = h.controller.view();
  assert.equal(view.renderer.label, RENDERER_LABELS["webgl2-compatibility"]);
  assert.equal(view.renderer.text, "Compatibility view (WebGL2) — not WebGPU");
  assert.equal(view.renderer.countsAsWebGPU, false);
  assert.doesNotMatch(view.renderer.text, /^WebGPU/);
  const gpu = createHarness({ renderer: "webgpu" });
  await gpu.controller.open({ designId });
  assert.equal(gpu.controller.view().renderer.text, "WebGPU view");
  assert.equal(gpu.controller.view().renderer.countsAsWebGPU, true);
});

test("HCA-06.1 save sends commands with expected_revision and ends saved", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  await h.controller.apply({ type: "move", placementId: placements.p1, position_m: [1.5, 0, 1] });
  await h.controller.apply({ type: "hide", placementId: placements.p2, hidden: true });
  const release = h.fake.hold();
  const saving = h.controller.save();
  await flush();
  assert.equal(h.controller.view().workingStatus, "saving");
  release();
  await saving;
  const view = h.controller.view();
  assert.equal(view.workingStatus, "saved");
  assert.equal(view.revision, 4);
  const sent = h.fake.calls.filter(call => call.operation === "updatePlacement");
  assert.deepEqual(sent.map(call => call.body.expected_revision), [2, 3]);
  assert.deepEqual(sent[0].body.transform, { position_m: [1.5, 0, 1], rotation_deg_y: 90 });
  assert.equal(view.fits[placements.p1].thresholds_version, "Q03-provisional-2026-10-20");
});

test("HCA-06.4 expected-revision conflict keeps local edits; reapply then save", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  await h.controller.apply({ type: "rotate", placementId: placements.p1, rotation_deg_y: 105 });
  // USER-D (editor) saves first.
  await h.fake.forUser("USER-D").updatePlacement({
    params: { design_id: designId, branch_id: "main", placement_id: placements.p2 },
    body: { hidden: true, expected_revision: 2 }
  });
  await h.controller.save();
  let view = h.controller.view();
  assert.equal(view.workingStatus, "conflict");
  assert.equal(view.conflict.serverRevision, 3);
  assert.equal(view.conflict.serverChangedBy, "USER-D");
  assert.equal(view.pendingCount, 1);
  assert.equal(view.placements.find(item => item.placement_id === placements.p2).hidden, true, "server change is shown");
  assert.equal(h.fake.calls.filter(call => call.operation === "updatePlacement" && call.user === "USER-A").length, 1, "nothing re-sent automatically");

  await h.controller.resolveConflict("reapply");
  await h.controller.save();
  view = h.controller.view();
  assert.equal(view.workingStatus, "saved");
  assert.equal(view.revision, 4);
  const p1 = view.placements.find(item => item.placement_id === placements.p1);
  const p2 = view.placements.find(item => item.placement_id === placements.p2);
  assert.equal(p1.transform.rotation_deg_y, 105);
  assert.equal(p2.hidden, true, "the other editor's change is not overwritten");
});

test("offline and not-found open states are distinct and non-disclosing", async () => {
  const offline = createHarness();
  offline.fake.scenario.offline = true;
  await offline.controller.open({ designId });
  assert.equal(offline.controller.view().phase, Phase.OFFLINE);

  const stranger = createHarness({ user: "USER-E" });
  await stranger.controller.open({ designId });
  const view = stranger.controller.view();
  assert.equal(view.phase, Phase.NOT_FOUND);
  assert.equal(view.announcement, "Not found, or you don't have access to it.");
  assert.doesNotMatch(view.announcement, /dsg_/);
});
