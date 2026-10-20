// HCA mock of the ARC shared viewer against viewer-interface.v0.4.json (plan X.8.1).
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadFixture } from "../scripts/check-contract-fixtures-v0_4.mjs";
import {
  DESCRIBE_MAX_CHARS,
  RENDERER_LABELS,
  VIEWER_EVENTS,
  VIEWER_INTERFACE_VERSION,
  VIEWER_METHODS,
  assertViewerContract,
  createUnavailableViewer
} from "../src/viewer/viewerPort.js";
import { createSyntheticAssetSource, createSyntheticViewer, syntheticWorkspaceSeed, SYNTHETIC } from "../src/fixtures/workspaceFixtures.js";
import { createFakeViewer, loadGlbBytes } from "./helpers/fakeViewer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const contract = loadFixture(ROOT, "viewer/viewer-interface.v0.4.json");
const facts = loadFixture(ROOT, "assets/synthetic-unit-box.facts.json");

function homeSource(bytes = loadGlbBytes()) {
  const source = createSyntheticAssetSource({ seed: syntheticWorkspaceSeed(), loadBytes: async () => bytes }).home({ scene_id: SYNTHETIC.sceneId, version: "1" });
  return source;
}

function checkDescribe(viewer) {
  const text = viewer.describe();
  assert.equal(typeof text, "string");
  assert.ok(text.length <= contract.describe_max_chars);
  assert.doesNotMatch(text, /<[a-z]/i, "plain text");
  assert.ok(text.includes(viewer.capability().label), "names the renderer label");
  assert.match(text, /\b\d+ nodes?\b/, "node count");
  assert.match(text, /Selected: /, "selected node");
  assert.match(text, /\b\d+ uncertainty regions?\b/, "uncertainty count");
  return text;
}

test("ARC-08 fake viewer implements viewer-interface.v0.4.json", async () => {
  assert.equal(contract.status, "DRAFT_SYNTHETIC_NOT_FROZEN");
  assert.equal(VIEWER_INTERFACE_VERSION, contract.interface_version);
  assert.deepEqual([...VIEWER_METHODS], contract.methods);
  assert.deepEqual([...VIEWER_EVENTS], contract.events);
  assert.deepEqual({ ...RENDERER_LABELS }, contract.renderer_labels);
  assert.deepEqual(Object.keys(RENDERER_LABELS).sort(), [...contract.renderer_kinds].sort());
  assert.equal(DESCRIBE_MAX_CHARS, contract.describe_max_chars);

  for (const renderer of contract.renderer_kinds) {
    for (const viewer of [createFakeViewer({ renderer }), createSyntheticViewer({ renderer })]) {
      assert.equal(viewer.interfaceVersion, contract.interface_version);
      for (const method of contract.methods) assert.equal(typeof viewer[method], "function", `${renderer} ${method}`);
      assertViewerContract(viewer);
      const capability = viewer.capability();
      assert.equal(capability.label, contract.renderer_labels[renderer]);
      assert.equal(capability.countsAsWebGPU, contract.counts_as_webgpu[renderer]);
      for (const event of contract.events) assert.equal(typeof viewer.on(event, () => {}), "function", `${event} unsubscribe`);
      checkDescribe(viewer);
    }
  }
  const unavailable = createUnavailableViewer();
  assertViewerContract(unavailable);
  assert.equal(unavailable.capability().renderer, "unsupported");
  checkDescribe(unavailable);
  await assert.rejects(unavailable.load(homeSource()), { code: "UNSUPPORTED" });
});

test("ARC-08 load verifies component sha256 before parse; dispose is idempotent", async () => {
  assert.equal(contract.load_rule, "verifies component sha256 before parse");
  const source = homeSource();
  assert.equal(source.envelope.components[0].sha256, facts.sha256);
  for (const viewer of [createFakeViewer(), createSyntheticViewer({ renderer: "webgpu" })]) {
    const errors = [];
    const disposed = [];
    viewer.on("error", payload => errors.push(payload));
    viewer.on("disposed", payload => disposed.push(payload));
    const loaded = await viewer.load(source);
    assert.equal(loaded.assetId, SYNTHETIC.sceneId);
    assert.equal(loaded.version, "1");
    assert.equal(loaded.triangles, facts.triangles);
    assert.deepEqual(loaded.nodes.map(node => node.nodeId), facts.node_names);
    const tampered = new Uint8Array(loadGlbBytes().slice(0));
    tampered[100] ^= 0xff;
    await assert.rejects(viewer.load(homeSource(tampered.buffer)), { code: "COMPONENT_DIGEST_MISMATCH" });
    assert.deepEqual(errors, [{ code: "COMPONENT_DIGEST_MISMATCH" }]);
    viewer.select("unit-box");
    viewer.showUncertainty([{ regionId: "r1", kind: "unobserved", bounds: { min: [0, 0, 0], max: [1, 1, 1] }, label: "Not observed" }]);
    assert.match(checkDescribe(viewer), /home scn_01HZYSYNTH0000000000000001 version 1.*Selected: unit-box.*1 uncertainty region/);
    await viewer.dispose();
    await viewer.dispose();
    assert.equal(disposed.length, 1, contract.dispose_rule);
  }
});

test("ARC-08 viewer contract check rejects a different major, wrong labels or a WebGPU claim", () => {
  assert.throws(() => assertViewerContract(createFakeViewer({ interfaceVersion: "wisestay.viewer/2.0.0" })), /unsupported viewer interface/);
  const relabelled = createFakeViewer({ renderer: "webgl2-compatibility" });
  relabelled.capability = () => ({ renderer: "webgl2-compatibility", label: "WebGPU view", countsAsWebGPU: false });
  assert.throws(() => assertViewerContract(relabelled), /verbatim/);
  const overclaim = createFakeViewer({ renderer: "webgl2-compatibility" });
  overclaim.capability = () => ({ renderer: "webgl2-compatibility", label: RENDERER_LABELS["webgl2-compatibility"], countsAsWebGPU: true });
  assert.throws(() => assertViewerContract(overclaim), /only webgpu/);
  const missing = createFakeViewer();
  delete missing.highlight;
  assert.throws(() => assertViewerContract(missing), /highlight is missing/);
});

test("ARC-08 zoom distance is clamped to the contract range", () => {
  const viewer = createSyntheticViewer({ renderer: "webgpu" });
  viewer.zoom(1e9);
  assert.match(viewer.describe(), new RegExp(`Camera orbit, ${contract.zoom_distance_m.min.toFixed(2)} m`));
  viewer.zoom(1e-9);
  assert.match(viewer.describe(), new RegExp(`Camera orbit, ${contract.zoom_distance_m.max.toFixed(2)} m`));
  viewer.setCameraMode("top");
  assert.match(viewer.describe(), /Camera top/);
  assert.deepEqual(contract.camera_modes, ["orbit", "top"]);
});
