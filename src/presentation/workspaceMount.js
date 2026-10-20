// "Workspace (synthetic review)" section of index.html. Prototype / synthetic / not connected.
// Wires FakeComposerApi + a text-only fake viewer; never a live service or fetch to an API.
import { createFakeComposerApi } from "../service/fakeComposerApi.js";
import { ObjectIdEntryController, EntryOutcome, validateObjectEntry } from "../application/objectIdEntryController.js";
import { GeometryState, WorkspaceController, placementLabel } from "../application/workspaceController.js";
import { createSyntheticAssetSource, createSyntheticViewer, SYNTHETIC, syntheticWorkspaceSeed } from "../fixtures/workspaceFixtures.js";
import { renderPlacementControls } from "./placementControls.js";
import { renderAlternatives } from "./alternativesCompare.js";
import { renderShareComment } from "./shareComment.js";
import { renderPlacementList, workingStatusText, workspaceStatus } from "./workspaceViews.js";
import { describeFit } from "./fitPresentation.js";
import { el } from "./dom.js";

export function mountSyntheticWorkspace(doc, { seed = syntheticWorkspaceSeed(), loadBytes } = {}) {
  const byId = id => doc.getElementById(id);
  const fake = createFakeComposerApi({ seed });
  const assetSource = createSyntheticAssetSource({ seed, loadBytes });
  let account = byId("workspace-account").value;
  let viewer = null;
  let controller = null;
  let entry = null;
  let topView = false;

  function build() {
    controller = new WorkspaceController({
      api: fake.forUser(account),
      assetSource,
      accountKey: account,
      createViewer: () => (viewer = createSyntheticViewer({ renderer: byId("workspace-renderer").value }))
    });
    entry = new ObjectIdEntryController({ objectReader: fake.objectReader(account), workspace: controller });
    controller.subscribe(render);
  }

  function render() {
    const view = controller.view();
    const status = workspaceStatus(view);
    byId("workspace-status").textContent = status.text;
    byId("workspace-status").dataset.kind = status.kind;
    byId("workspace-announcement").textContent = view.announcement;
    byId("workspace-renderer-label").textContent = view.renderer ? view.renderer.text : "No viewer connected.";
    byId("workspace-geometry").textContent = view.geometry.text;
    byId("workspace-viewer-text").textContent = view.viewerDescription ? `Scene description: ${view.viewerDescription}` : "";
    byId("workspace-reload-view").hidden = view.geometry.state !== GeometryState.DEVICE_LOST;
    byId("workspace-working").textContent = view.workingStatus ? `${workingStatusText(view.workingStatus)} · revision ${view.revision}${view.saveError ? ` · ${view.saveError}` : ""}` : "";
    byId("workspace-save").disabled = view.workingStatus !== "unsaved";
    byId("workspace-undo").disabled = !view.pendingCount || view.workingStatus === "saving";
    byId("workspace-reapply").hidden = view.workingStatus !== "conflict";
    byId("workspace-discard").hidden = view.workingStatus !== "conflict";
    byId("workspace-load-latest").hidden = !view.staleHead || Boolean(view.pendingCount);
    for (const button of doc.querySelectorAll("[data-camera]")) button.disabled = !view.renderer || view.renderer.renderer === "unsupported";
    byId("workspace-check").disabled = !view.designId;

    renderPlacementList(byId("workspace-placements"), {
      doc, view,
      onSelect: id => controller.select(id),
      onFocus: id => controller.focusPlacement(id)
    });
    const selected = view.placements.find(item => item.placement_id === view.selection) ?? null;
    // Keep keyboard focus on the placement surface across re-renders.
    const refocus = Boolean(doc.activeElement?.hasAttribute?.("data-placement-surface"));
    renderPlacementControls(byId("workspace-controls"), {
      doc, placement: selected, label: selected ? placementLabel(selected) : "",
      canEdit: view.canEdit && !["saving", "conflict"].includes(view.workingStatus),
      editReason: view.canEdit ? "Editing is paused while saving or until the conflict is resolved." : `Your role (${view.role}) can view but not edit placements.`,
      onCommand: command => controller.apply(command)
    });
    if (refocus) doc.querySelector("[data-placement-surface]")?.focus();
    const fitRoot = byId("workspace-fit");
    if (selected && !selected.placement_id.startsWith("local-")) {
      const fit = describeFit(view.fits[selected.placement_id]);
      fitRoot.replaceChildren(
        el(doc, "h3", { text: "Fit check" }),
        el(doc, "p", { text: fit.label }),
        el(doc, "ul", { "aria-label": "Fit reasons" }, ...fit.reasons.map(reason => el(doc, "li", { text: reason }))),
        el(doc, "p", { class: "note", text: [fit.detail, fit.openingsNote].filter(Boolean).join(" · ") }),
        el(doc, "button", { type: "button", text: "Check footprint fit", on: { click: () => controller.assessFit(selected.placement_id, { question: "footprint" }) } }),
        el(doc, "button", { type: "button", text: "Check 0.30 m clearance", on: { click: () => controller.assessFit(selected.placement_id, { question: "clearance", clearanceMarginM: 0.3 }) } })
      );
    } else {
      fitRoot.replaceChildren();
    }
    renderAlternatives(byId("workspace-alternatives"), {
      doc, view,
      onCreate: name => controller.createAlternative(name),
      onSwitch: id => controller.switchToBranch(id).then(() => controller.loadComments()),
      onCompare: (a, b) => controller.compare(a, b),
      onRestore: revision => controller.restore(revision)
    });
    renderShareComment(byId("workspace-share"), {
      doc, view,
      onShareObject: (source, grantee) => controller.shareObject(source, grantee),
      onShareDesign: (grantee, role) => controller.shareDesign(grantee, role),
      onComment: body => controller.addComment(body),
      onResolve: id => controller.resolveComment(id)
    });
  }

  function renderEntry() {
    const state = entry.state;
    const idInput = byId("object-entry-id");
    const versionInput = byId("object-entry-version");
    byId("object-entry-id-error").textContent = state.errors.objectId ?? "";
    byId("object-entry-version-error").textContent = state.errors.version ?? "";
    if (state.errors.objectId) idInput.setAttribute("aria-invalid", "true"); else idInput.removeAttribute("aria-invalid");
    if (state.errors.version) versionInput.setAttribute("aria-invalid", "true"); else versionInput.removeAttribute("aria-invalid");
    const preview = byId("object-entry-preview");
    preview.replaceChildren(el(doc, "p", { text: state.message }));
    if (state.preview && [EntryOutcome.PREVIEW, EntryOutcome.NO_PLACE_RIGHT, EntryOutcome.ADDED].includes(state.outcome)) {
      const p = state.preview;
      preview.append(el(doc, "dl", { "aria-label": "Object preview" },
        el(doc, "dt", { text: "Exact version" }), el(doc, "dd", { text: p.exactVersion }),
        el(doc, "dt", { text: "Size" }), el(doc, "dd", { text: p.dimensionsText }),
        el(doc, "dt", { text: "Evidence" }), el(doc, "dd", { text: p.evidenceText }),
        el(doc, "dt", { text: "Variants" }), el(doc, "dd", { text: p.variants.length
          ? p.variants.map(item => `${item.variantId} (${item.linkStatus}; colour ${item.colour}; package ${item.package})`).join("; ")
          : "None supplied" }),
        el(doc, "dt", { text: "Allowed use for you" }), el(doc, "dd", { text: p.allowedUse.join(", ") || "None" })
      ));
      if (state.outcome === EntryOutcome.PREVIEW) {
        const realReason = p.realSizeAvailable ? null : "Real size unavailable: no recorded size. It will be added at illustrative scale.";
        preview.append(el(doc, "button", {
          type: "button", text: p.realSizeAvailable ? "Add at real size" : "Add at illustrative scale — not real size",
          on: { click: async () => { await entry.addToWorkspace(); renderEntry(); } }
        }));
        if (realReason) preview.append(el(doc, "p", { class: "note", text: realReason }));
      }
    }
  }

  async function open(designId) {
    if (controller) await controller.navigateAway();
    build();
    await controller.open({ designId });
    await controller.loadComments();
  }

  build();
  render();

  byId("workspace-open").addEventListener("click", () => open(SYNTHETIC.designId));
  byId("workspace-open-empty").addEventListener("click", () => open(SYNTHETIC.emptyDesignId));
  byId("workspace-account").addEventListener("change", async () => {
    account = byId("workspace-account").value;
    await controller.changeAccount(account);
    build();
    render();
  });
  byId("workspace-offline").addEventListener("click", () => {
    fake.scenario.offline = !fake.scenario.offline;
    byId("workspace-offline").setAttribute("aria-pressed", String(fake.scenario.offline));
  });
  byId("workspace-concurrent").addEventListener("click", async () => {
    const view = controller.view();
    if (!view.designId) return;
    const other = fake.forUser(SYNTHETIC.users.editor);
    const design = await other.getDesign({ params: { design_id: view.designId } }).catch(() => null);
    const branch = design?.branches.find(item => item.branch_id === view.branchId);
    if (!branch) return;
    const head = await other.getRevision({ params: { design_id: view.designId, branch_id: branch.branch_id, revision: branch.head_revision } });
    const target = head.placements[0];
    if (!target) return;
    await other.updatePlacement({
      params: { design_id: view.designId, branch_id: branch.branch_id, placement_id: target.placement_id },
      body: { transform: { position_m: [target.transform.position_m[0] + 0.25, 0, target.transform.position_m[2]], rotation_deg_y: target.transform.rotation_deg_y }, expected_revision: head.revision }
    });
    byId("workspace-announcement").textContent = `${SYNTHETIC.users.editor} saved revision ${head.revision + 1} in the fake service.`;
  });
  byId("workspace-device-lost").addEventListener("click", () => viewer?.simulateDeviceLost?.());
  byId("workspace-check").addEventListener("click", () => controller.checkForUpdates());
  byId("workspace-close").addEventListener("click", () => controller.navigateAway());
  byId("workspace-reload-view").addEventListener("click", () => controller.reloadView());
  byId("workspace-save").addEventListener("click", () => controller.save());
  byId("workspace-undo").addEventListener("click", () => controller.undo());
  byId("workspace-reapply").addEventListener("click", () => controller.resolveConflict("reapply"));
  byId("workspace-discard").addEventListener("click", () => controller.resolveConflict("discard"));
  byId("workspace-load-latest").addEventListener("click", () => controller.loadLatest());
  for (const button of doc.querySelectorAll("[data-camera]")) {
    button.addEventListener("click", () => {
      const action = button.dataset.camera;
      if (action === "orbit-left") controller.orbit(-Math.PI / 12, 0);
      if (action === "orbit-right") controller.orbit(Math.PI / 12, 0);
      if (action === "zoom-in") controller.zoom(1.25);
      if (action === "zoom-out") controller.zoom(0.8);
      if (action === "focus-home") controller.focusHome();
      if (action === "top") {
        topView = !topView;
        button.setAttribute("aria-pressed", String(topView));
        controller.setTopView(topView);
      }
    });
  }
  byId("object-entry-lookup").addEventListener("click", async () => {
    const input = { objectId: byId("object-entry-id").value, version: byId("object-entry-version").value };
    const pending = entry.resolve(input);
    if (validateObjectEntry(input).ok) renderEntry();
    await pending;
    renderEntry();
  });
  return { get controller() { return controller; }, get entry() { return entry; }, fake };
}
