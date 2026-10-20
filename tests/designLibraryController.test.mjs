import test from "node:test";
import assert from "node:assert/strict";

import { DesignLibraryController } from "../src/application/designLibraryController.js";
import { LibraryOutcome, LibrarySourceStatus, ArrangementStatus } from "../src/domain/designLibraryState.js";

const row = (revision = "r1", sourceStatus = LibrarySourceStatus.AVAILABLE) => ({
  rowId: `D1-${revision}`,
  arrangementStatus: ArrangementStatus.PRIVATE,
  design: { supplied: true, id: "D1", revision },
  sourceStatus,
  sources: [{ kind: "home", service: "home-service", id: "H1", version: "v1" }],
  fixtureLabel: "Local synthetic fixture"
});

function deferredAdapter() {
  const pending = [];
  return {
    pending,
    adapter: {
      readLibrary(input) {
        return new Promise((resolve, reject) => pending.push({ input, resolve, reject }));
      }
    }
  };
}

test("context switch immediately clears private rows and selection", async () => {
  const controller = new DesignLibraryController({ adapter: { readLibrary: async () => ({ outcome: LibraryOutcome.READY, rows: [row()] }) } });
  const first = controller.beginContext({ accountKey: "ACCOUNT-A" });
  await controller.load(first);
  assert.equal(controller.select(first, "D1-r1").accepted, true);
  assert.equal(controller.state.rows.length, 1);
  assert.notEqual(controller.state.selection, null);

  controller.beginContext({ accountKey: "ACCOUNT-B" });
  assert.equal(controller.state.accountKey, "ACCOUNT-B");
  assert.equal(controller.state.outcome, LibraryOutcome.DISCONNECTED);
  assert.equal(controller.state.rows.length, 0);
  assert.equal(controller.state.selection, null);
});

test("delayed old-account library response cannot attach after context switch", async () => {
  const d = deferredAdapter();
  const controller = new DesignLibraryController({ adapter: d.adapter });
  const first = controller.beginContext({ accountKey: "ACCOUNT-A" });
  const oldLoad = controller.load(first);
  assert.equal(controller.state.outcome, LibraryOutcome.LOADING);

  controller.beginContext({ accountKey: "ACCOUNT-B" });
  d.pending[0].resolve({ outcome: LibraryOutcome.READY, rows: [row()] });
  const result = await oldLoad;
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "stale-library-request");
  assert.equal(controller.state.accountKey, "ACCOUNT-B");
  assert.equal(controller.state.rows.length, 0);
});

test("same-user newer context rejects delayed response from older context", async () => {
  const d = deferredAdapter();
  const controller = new DesignLibraryController({ adapter: d.adapter });
  const first = controller.beginContext({ accountKey: "SAME-USER" });
  const firstLoad = controller.load(first);
  const second = controller.beginContext({ accountKey: "SAME-USER" });
  const secondLoad = controller.load(second);

  d.pending[0].resolve({ outcome: LibraryOutcome.READY, rows: [row("r1")] });
  const firstResult = await firstLoad;
  assert.equal(firstResult.accepted, false);
  assert.equal(firstResult.reason, "stale-library-request");

  d.pending[1].resolve({ outcome: LibraryOutcome.READY, rows: [row("r2")] });
  const secondResult = await secondLoad;
  assert.equal(secondResult.accepted, true);
  assert.equal(controller.state.rows[0].design.revision, "r2");
  assert.equal(controller.state.selection, null);
});

test("refresh never auto-restores selection onto a later unrequested revision", async () => {
  let revision = "r1";
  const controller = new DesignLibraryController({
    adapter: { readLibrary: async () => ({ outcome: LibraryOutcome.READY, rows: [row(revision)] }) }
  });
  const token = controller.beginContext({ accountKey: "ACCOUNT-A" });
  await controller.load(token);
  assert.equal(controller.select(token, "D1-r1").accepted, true);
  assert.equal(controller.state.selection.intent.reference.revision.value, "r1");

  revision = "r2";
  await controller.load(token);
  assert.equal(controller.state.rows[0].design.revision, "r2");
  assert.equal(controller.state.selection, null);
});

test("adapter failure becomes unavailable, never empty", async () => {
  const controller = new DesignLibraryController({ adapter: { readLibrary: async () => { throw new Error("offline"); } } });
  const token = controller.beginContext({ accountKey: "ACCOUNT-A" });
  const result = await controller.load(token);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "library-unavailable");
  assert.equal(controller.state.outcome, LibraryOutcome.UNAVAILABLE);
  assert.equal(controller.state.rows.length, 0);
});

test("disconnected adapter performs no read and creates no fake rows", async () => {
  const controller = new DesignLibraryController();
  const token = controller.beginContext({ accountKey: "ACCOUNT-A" });
  const result = await controller.load(token);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "library-adapter-not-connected");
  assert.equal(controller.state.outcome, LibraryOutcome.DISCONNECTED);
  assert.equal(controller.state.rows.length, 0);
});
