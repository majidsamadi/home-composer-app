import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { workspaceStatus, WorkspaceViewKind } from "../src/presentation/workspaceViews.js";
import { mountSyntheticWorkspace } from "../src/presentation/workspaceMount.js";
import { SYNTHETIC } from "../src/fixtures/workspaceFixtures.js";
import { createHarness, flush } from "./helpers/workspaceHarness.mjs";
import { loadGlbBytes } from "./helpers/fakeViewer.mjs";
import { accessibleName, createEvent, findAll, parseHtml, tabOrder } from "./helpers/domStub.mjs";

const { designId, emptyDesignId, objects, placements } = SYNTHETIC;
const load = relative => readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

async function stateFor(kind) {
  switch (kind) {
    case "loading": {
      const h = createHarness();
      const release = h.fake.hold();
      const pending = h.controller.open({ designId });
      await flush();
      const view = h.controller.view();
      release();
      await pending;
      return view;
    }
    case "empty": { const h = createHarness(); await h.controller.open({ designId: emptyDesignId }); return h.controller.view(); }
    case "denied": { const h = createHarness({ user: "USER-E" }); await h.controller.open({ designId }); return h.controller.view(); }
    case "offline": { const h = createHarness(); h.fake.scenario.offline = true; await h.controller.open({ designId }); return h.controller.view(); }
    case "conflict": {
      const h = createHarness();
      await h.controller.open({ designId });
      await h.controller.apply({ type: "hide", placementId: placements.p1, hidden: true });
      await h.fake.forUser("USER-D").updatePlacement({ params: { design_id: designId, branch_id: "main", placement_id: placements.p2 }, body: { hidden: true, expected_revision: 2 } });
      await h.controller.save();
      return h.controller.view();
    }
    case "stale": {
      const h = createHarness();
      await h.controller.open({ designId });
      await h.fake.forUser("USER-D").updatePlacement({ params: { design_id: designId, branch_id: "main", placement_id: placements.p2 }, body: { hidden: true, expected_revision: 2 } });
      await h.controller.checkForUpdates();
      return h.controller.view();
    }
    case "withdrawn": {
      const h = createHarness();
      h.fake.scenario.objectOutcomes[`${objects.shelf}@1`] = "withdrawn";
      await h.controller.open({ designId });
      return h.controller.view();
    }
    case "unsupported": { const h = createHarness({ renderer: "unsupported" }); await h.controller.open({ designId }); return h.controller.view(); }
    default: throw new Error(kind);
  }
}

test("workspace states: loading, empty, denied, offline, conflict, stale, withdrawn source, unsupported renderer", async () => {
  const expected = {
    loading: [WorkspaceViewKind.LOADING, /^Loading design…$/],
    empty: [WorkspaceViewKind.EMPTY, /no placements yet/],
    denied: [WorkspaceViewKind.DENIED, /isn't available to you\. It may not exist or may not be shared with you\./],
    offline: [WorkspaceViewKind.OFFLINE, /^Offline — the Composer service can't be reached/],
    conflict: [WorkspaceViewKind.CONFLICT, /^Conflict — revision 3 was saved by USER-D\. Your unsaved edits are kept separately\.$/],
    stale: [WorkspaceViewKind.STALE, /^Out of date — revision 3 is available; you're viewing revision 2\.$/],
    withdrawn: [WorkspaceViewKind.WITHDRAWN_SOURCE, /withdrawn by its owner/],
    unsupported: [WorkspaceViewKind.UNSUPPORTED_RENDERER, /^3D view not supported on this device yet/]
  };
  const texts = new Set();
  for (const [kind, [statusKind, pattern]] of Object.entries(expected)) {
    const status = workspaceStatus(await stateFor(kind));
    assert.equal(status.kind, statusKind, kind);
    assert.match(status.text, pattern, kind);
    texts.add(status.text);
  }
  assert.equal(texts.size, Object.keys(expected).length, "each state has distinct status text");
});

test("workspace section: synthetic journey through index.html with labelled controls and live regions", async () => {
  const doc = parseHtml(await load("../index.html"));
  const section = findAll(doc.body, item => item.localName === "section" && item.getAttribute("aria-labelledby") === "workspace-title")[0];
  assert.ok(section);
  assert.equal(accessibleName(section), "Workspace (synthetic review)");
  assert.match(section.textContent, /Prototype \/ synthetic \/ not connected/);
  for (const id of ["workspace-status", "workspace-announcement", "object-entry-preview"]) {
    const region = doc.getElementById(id);
    assert.equal(region.getAttribute("role"), "status", id);
    assert.equal(region.getAttribute("aria-live"), "polite", id);
  }

  const mounted = mountSyntheticWorkspace(doc, { loadBytes: async () => loadGlbBytes() });
  assert.equal(doc.getElementById("workspace-status").textContent, "No design open.", "idle until a synthetic button is pressed");
  assert.equal(mounted.fake.calls.length, 0);

  doc.getElementById("workspace-open").click();
  for (let i = 0; i < 20 && mounted.controller.view().phase !== "ready"; i += 1) await flush();
  await flush();
  assert.equal(doc.getElementById("workspace-renderer-label").textContent, "Compatibility view (WebGL2) — not WebGPU · Synthetic review viewer: nothing is rendered");
  assert.equal(doc.getElementById("workspace-status").textContent, "All changes saved · revision 2.");
  assert.match(doc.getElementById("workspace-viewer-text").textContent, /^Scene description: Compatibility view \(WebGL2\) — not WebGPU\. home scn_/);

  // Select P1 from the text list, nudge it with the keyboard, then save.
  const select = findAll(section, item => item.localName === "button" && item.textContent.startsWith("Object obj_…0001 v1 at"))[0];
  select.click();
  await flush();
  const surface = section.querySelector("[data-placement-surface]");
  surface.focus();
  surface.dispatchEvent(createEvent("keydown", { key: "ArrowRight", shiftKey: true }));
  await flush();
  assert.equal(doc.getElementById("workspace-status").textContent, "Unsaved changes (1).");
  assert.ok(doc.activeElement.hasAttribute("data-placement-surface"), "keyboard focus stays on the placement surface");
  doc.getElementById("workspace-save").click();
  for (let i = 0; i < 20 && mounted.controller.view().workingStatus !== "saved"; i += 1) await flush();
  await flush();
  assert.equal(doc.getElementById("workspace-status").textContent, "All changes saved · revision 3.");

  // Object ID entry: invalid, then a valid seller object.
  doc.getElementById("object-entry-id").value = "nope";
  doc.getElementById("object-entry-lookup").click();
  await flush();
  assert.equal(doc.getElementById("object-entry-id").getAttribute("aria-invalid"), "true");
  assert.match(doc.getElementById("object-entry-id-error").textContent, /start with obj_/);
  doc.getElementById("object-entry-id").value = objects.lamp;
  doc.getElementById("object-entry-lookup").click();
  for (let i = 0; i < 10; i += 1) await flush();
  assert.match(doc.getElementById("object-entry-preview").textContent, /Scale unknown — no recorded size/);
  assert.ok(findAll(section, item => item.localName === "button" && item.textContent === "Add at illustrative scale — not real size").length);

  // Every interactive control in the workspace has an accessible name; no positive tabindex.
  const controls = findAll(section, item => ["button", "input", "select", "textarea"].includes(item.localName));
  assert.ok(controls.length > 40);
  for (const control of controls) assert.ok(accessibleName(control), `${control.localName}#${control.id} has a name`);
  for (const item of tabOrder(section)) assert.ok(item.tabIndex === 0, `${item.localName} tabindex`);
});

test("default composition stays disconnected; the workspace uses only the fake service", async () => {
  const source = await load("../src/app.js");
  assert.match(source, /createComposerApplication\(\)/);
  assert.match(source, /mountSyntheticWorkspace\(document\)/);
  const mount = await load("../src/presentation/workspaceMount.js");
  assert.match(mount, /createFakeComposerApi/);
  assert.doesNotMatch(mount, /createComposerHttpApi|fetch\(|new WebSession/);
  const http = await load("../src/service/composerHttpApi.js");
  assert.doesNotMatch(http, /fetch\(/, "the HTTP client only uses an injected transport");
});
