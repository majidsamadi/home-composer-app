import test from "node:test";
import assert from "node:assert/strict";

import { HomeSceneSelectionController } from "../src/application/homeSceneSelectionController.js";
import {
  SceneActionStatus,
  SceneEnvironmentKind,
  SceneLimitStatus,
  SceneListOutcome,
  SceneSourceStatus
} from "../src/domain/homeSceneSelectionState.js";

const row = (sceneVersion = "v1", rowId = "CURRENT") => ({
  rowId,
  environmentKind: SceneEnvironmentKind.MEASURED_PROPERTY,
  property: { supplied: true, id: "H1", version: "v1" },
  scene: { supplied: true, id: "SCENE-H1", version: sceneVersion },
  sourceStatus: SceneSourceStatus.AVAILABLE,
  currentActionStatus: SceneActionStatus.ALLOWED,
  scale: { status: SceneLimitStatus.MEASURED },
  coverage: { status: SceneLimitStatus.PARTIAL }
});

function deferredAdapter() {
  const pending = [];
  return {
    pending,
    adapter: {
      readScenes(input) {
        return new Promise((resolve, reject) => pending.push({ input, resolve, reject }));
      }
    }
  };
}

test("scene context change immediately clears private rows and prior selection", async () => {
  const controller = new HomeSceneSelectionController({
    adapter: { readScenes: async () => ({ outcome: SceneListOutcome.READY, rows: [row()] }) }
  });
  const first = controller.beginContext({ accountKey: "ACCOUNT-A" });
  await controller.load(first);
  assert.equal(controller.select(first, "CURRENT").accepted, true);
  assert.equal(controller.state.rows.length, 1);
  assert.notEqual(controller.state.selection, null);

  controller.beginContext({ accountKey: "ACCOUNT-B" });
  assert.equal(controller.state.accountKey, "ACCOUNT-B");
  assert.equal(controller.state.outcome, SceneListOutcome.DISCONNECTED);
  assert.equal(controller.state.rows.length, 0);
  assert.equal(controller.state.selection, null);
});

test("delayed prior-account scene response is rejected after account change", async () => {
  const d = deferredAdapter();
  const controller = new HomeSceneSelectionController({ adapter: d.adapter });
  const first = controller.beginContext({ accountKey: "ACCOUNT-A" });
  const pending = controller.load(first);
  assert.equal(controller.state.outcome, SceneListOutcome.LOADING);

  controller.beginContext({ accountKey: "ACCOUNT-B" });
  d.pending[0].resolve({ outcome: SceneListOutcome.READY, rows: [row()] });
  const result = await pending;
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "stale-scene-request");
  assert.equal(controller.state.accountKey, "ACCOUNT-B");
  assert.equal(controller.state.rows.length, 0);
});

test("same-user newer context rejects delayed response from older context", async () => {
  const d = deferredAdapter();
  const controller = new HomeSceneSelectionController({ adapter: d.adapter });
  const first = controller.beginContext({ accountKey: "SAME-USER" });
  const firstLoad = controller.load(first);
  const second = controller.beginContext({ accountKey: "SAME-USER" });
  const secondLoad = controller.load(second);

  d.pending[0].resolve({ outcome: SceneListOutcome.READY, rows: [row("v1", "OLD")] });
  const firstResult = await firstLoad;
  assert.equal(firstResult.accepted, false);
  assert.equal(firstResult.reason, "stale-scene-request");

  d.pending[1].resolve({ outcome: SceneListOutcome.READY, rows: [row("v2", "NEW")] });
  const secondResult = await secondLoad;
  assert.equal(secondResult.accepted, true);
  assert.equal(controller.state.rows[0].scene.version, "v2");
  assert.equal(controller.state.selection, null);
});

test("refresh does not silently preserve selection onto a later scene version", async () => {
  let version = "v1";
  const controller = new HomeSceneSelectionController({
    adapter: { readScenes: async () => ({ outcome: SceneListOutcome.READY, rows: [row(version, "ROW")] }) }
  });
  const token = controller.beginContext({ accountKey: "ACCOUNT-A" });
  await controller.load(token);
  assert.equal(controller.select(token, "ROW").accepted, true);
  assert.equal(controller.state.selection.scene.version, "v1");

  version = "v2";
  await controller.load(token);
  assert.equal(controller.state.rows[0].scene.version, "v2");
  assert.equal(controller.state.selection, null);
});

test("disconnected scene adapter performs no read and creates no private rows", async () => {
  const controller = new HomeSceneSelectionController();
  const token = controller.beginContext({ accountKey: "ACCOUNT-A" });
  const result = await controller.load(token);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "scene-adapter-not-connected");
  assert.equal(controller.state.outcome, SceneListOutcome.DISCONNECTED);
  assert.equal(controller.state.rows.length, 0);
});
