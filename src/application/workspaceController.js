// Composer workspace controller (HCA-02, HCA-04, HCA-06, HCA-07).
// Status: component-tested (fake API, fake viewer). It binds a ComposerApi, a shared
// viewer that matches viewer-interface v0.4 (X.8.1) and the pure workspace state.
import { isServiceProblem, newIdempotencyKey, problemText, ROLE_PERMISSIONS } from "../service/composerApi.js";
import { assertViewerContract, rendererStatusText } from "../viewer/viewerPort.js";
import {
  acknowledgeCommand,
  applyPlacementCommand,
  beginSaving,
  createWorkspaceState,
  finishSaving,
  rebaseAfterConflict,
  resolveConflict,
  saveFailed,
  selectPlacement,
  switchBranch,
  undoLastLocalEdit,
  withBranches,
  workingPlacements,
  workingStatus
} from "../domain/workspaceState.js";

export const Phase = Object.freeze({
  IDLE: "idle", LOADING: "loading", READY: "ready", EMPTY: "empty",
  NOT_FOUND: "not-found", OFFLINE: "offline", ERROR: "error", DISPOSED: "disposed"
});

export const GeometryState = Object.freeze({
  NONE: "none", LOADING: "loading", COMPLETE: "complete", PARTIAL: "partial",
  HOME_UNAVAILABLE: "home-unavailable", UNSUPPORTED: "unsupported", DEVICE_LOST: "device-lost", FAILED: "failed"
});

const OUTCOME_TEXT = Object.freeze({
  accessible: "shown",
  source_access_denied: "not available to you",
  withdrawn: "withdrawn by its owner",
  unavailable: "temporarily unavailable"
});

export function shortId(id) {
  return typeof id === "string" && id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : String(id);
}

export function placementLabel(placement) {
  return `Object ${shortId(placement.object_source.object_id)} v${placement.object_source.version}`;
}

export class WorkspaceController {
  constructor({ api, createViewer, assetSource, accountKey = null, idempotencyKey = newIdempotencyKey }) {
    if (!api) throw new TypeError("api is required");
    if (typeof createViewer !== "function") throw new TypeError("createViewer is required");
    this.api = api;
    this.createViewer = createViewer;
    this.assetSource = assetSource;
    this.idempotencyKey = idempotencyKey;
    this.accountKey = accountKey;
    this.epoch = 0;
    this.viewer = null;
    this.unsubscribe = [];
    this.listeners = new Set();
    this.lateResultsDropped = 0;
    this.reset(Phase.IDLE);
  }

  reset(phase) {
    this.phase = phase;
    this.state = null;
    this.geometry = { state: GeometryState.NONE, sources: [] };
    this.problem = null;
    this.announcement = "";
    this.fits = {};
    this.comparison = null;
    this.comments = [];
    this.participants = [];
    this.objectShares = [];
    this.staleHead = null;
    this.homeEnvelope = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) listener(this.view());
  }

  announce(text) {
    this.announcement = text;
  }

  current(epoch) {
    if (epoch === this.epoch) return true;
    this.lateResultsDropped += 1;
    return false;
  }

  ensureViewer() {
    if (this.viewer) return this.viewer;
    const viewer = assertViewerContract(this.createViewer());
    this.viewer = viewer;
    this.unsubscribe = [
      viewer.on("device-lost", ({ reason }) => {
        if (this.viewer !== viewer) return;
        this.geometry = { ...this.geometry, state: GeometryState.DEVICE_LOST, reason };
        this.announce("3D view lost — Reload view. Your design and unsaved edits are kept.");
        this.notify();
      }),
      viewer.on("selection", ({ nodeId }) => {
        if (this.viewer !== viewer || !this.state) return;
        this.state = selectPlacement(this.state, nodeId);
        this.notify();
      })
    ];
    return viewer;
  }

  async disposeViewer() {
    const viewer = this.viewer;
    this.viewer = null;
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    if (viewer) await viewer.dispose();
  }

  handleProblem(error, fallbackPhase = null) {
    if (!isServiceProblem(error)) throw error;
    this.problem = error;
    this.announce(problemText(error, { role: this.state?.role }));
    if (fallbackPhase) this.phase = fallbackPhase;
    else if (error.code === "not_found" && !this.state) this.phase = Phase.NOT_FOUND;
    else if (error.code === "dependency_unavailable" || error.code === "identity_unavailable") {
      if (!this.state) this.phase = Phase.OFFLINE;
      this.offline = true;
    }
  }

  async open({ designId, branchId = "main" }) {
    const epoch = ++this.epoch;
    this.reset(Phase.LOADING);
    this.offline = false;
    this.announce("Loading design…");
    this.notify();
    try {
      const design = await this.api.getDesign({ params: { design_id: designId } });
      if (!this.current(epoch)) return;
      const branch = design.branches.find(item => item.branch_id === branchId) ?? design.branches[0];
      const revision = await this.api.getRevision({ params: { design_id: designId, branch_id: branch.branch_id, revision: branch.head_revision } });
      if (!this.current(epoch)) return;
      this.state = createWorkspaceState({ design, branch, revision });
      this.phase = revision.placements.length ? Phase.READY : Phase.EMPTY;
      this.announce(`Opened ${design.title}, revision ${revision.revision}.`);
      await this.loadView(epoch);
    } catch (error) {
      if (!this.current(epoch)) return;
      this.handleProblem(error);
    }
    if (this.current(epoch)) this.notify();
  }

  // HCA-02.1: C23 view-session for the exact revision, then viewer.load + setInstances.
  async loadView(epoch = this.epoch) {
    const state = this.state;
    if (!state) return;
    const viewer = this.ensureViewer();
    this.geometry = { state: GeometryState.LOADING, sources: [] };
    const session = await this.api.createViewSession({
      params: { design_id: state.designId },
      body: { branch_id: state.branchId, revision: state.server.revision },
      idempotencyKey: this.idempotencyKey()
    });
    if (!this.current(epoch)) return;
    const sources = [
      { kind: "home", id: state.homeSource?.scene_id ?? null, version: state.homeSource?.version ?? null, outcome: session.home.outcome },
      ...session.objects.map(item => ({ kind: "object", id: item.object_id, version: item.version, outcome: item.outcome }))
    ];
    this.objectOutcomes = new Map(session.objects.map(item => [`${item.object_id}@${item.version}`, item.outcome]));
    const capability = viewer.capability();
    if (capability.renderer === "unsupported") {
      this.geometry = { state: GeometryState.UNSUPPORTED, sources };
      return;
    }
    if (session.home.outcome !== "accessible") {
      this.geometry = { state: GeometryState.HOME_UNAVAILABLE, sources };
      return;
    }
    const homeSource = this.assetSource.home(state.homeSource);
    try {
      await viewer.load(homeSource);
    } catch (error) {
      if (!this.current(epoch)) return;
      this.geometry = { state: GeometryState.FAILED, sources, reason: error?.code ?? "LOAD_FAILED" };
      return;
    }
    if (!this.current(epoch)) return;
    this.homeEnvelope = homeSource.envelope;
    const partial = sources.some(item => item.outcome !== "accessible");
    this.geometry = { state: partial ? GeometryState.PARTIAL : GeometryState.COMPLETE, sources };
    await this.syncInstances();
  }

  async reloadView() {
    if (!this.state) return;
    const epoch = this.epoch;
    this.announce("Reloading the 3D view…");
    try {
      await this.loadView(epoch);
      if (this.current(epoch)) this.announce("3D view reloaded. Your design was kept.");
    } catch (error) {
      if (this.current(epoch)) this.handleProblem(error);
    }
    if (this.current(epoch)) this.notify();
  }

  instances() {
    if (!this.state) return [];
    return workingPlacements(this.state)
      .filter(item => !item.hidden)
      .filter(item => (this.objectOutcomes?.get(`${item.object_source.object_id}@${item.object_source.version}`) ?? "accessible") === "accessible")
      .map(item => ({
        instanceId: item.placement_id,
        source: this.assetSource.object(item.object_source),
        position_m: [...item.transform.position_m],
        rotationDegY: item.transform.rotation_deg_y,
        scaleMode: item.scale_mode,
        ...(item.scale_mode === "illustrative" ? { illustrativeScale: item.illustrative_scale } : {}),
        label: placementLabel(item)
      }))
      .filter(item => item.source);
  }

  overlays() {
    const regions = (this.homeEnvelope?.unobserved_regions ?? []).map(region => ({
      regionId: region.region_id, kind: "unobserved", bounds: region.bounds_m, label: region.label
    }));
    for (const item of this.state ? workingPlacements(this.state) : []) {
      const kind = item.scale_mode === "illustrative" || item.scale_claim === "unknown" ? "unknown-scale"
        : item.scale_claim === "estimated" || item.scale_claim === "seller-declared" ? "estimated" : null;
      if (kind) regions.push({ regionId: item.placement_id, kind, bounds: placementBounds(item), label: kind === "unknown-scale" ? "Scale not known" : "Size estimated" });
    }
    return regions;
  }

  async syncInstances() {
    if (!this.viewer || ![GeometryState.COMPLETE, GeometryState.PARTIAL].includes(this.geometry.state)) return;
    await this.viewer.setInstances(this.instances());
    this.viewer.showUncertainty(this.overlays());
    this.viewer.select(this.state?.selection ?? null);
  }

  // HCA-02.2 camera controls delegate to the viewer.
  orbit(deltaYawRad, deltaPitchRad) { this.viewer?.orbit(deltaYawRad, deltaPitchRad); this.notify(); }
  zoom(factor) { this.viewer?.zoom(factor); this.notify(); }
  setTopView(top) { this.viewer?.setCameraMode(top ? "top" : "orbit"); this.announce(top ? "Top view." : "Orbit view."); this.notify(); }
  focusPlacement(placementId) {
    const item = this.state && workingPlacements(this.state).find(entry => entry.placement_id === placementId);
    if (!item || !this.viewer) return;
    this.viewer.focus({ bounds: placementBounds(item) });
    this.state = selectPlacement(this.state, placementId);
    this.announce(`Focused ${placementLabel(item)}.`);
    this.notify();
  }
  focusHome() {
    if (!this.viewer || !this.homeEnvelope) return;
    this.viewer.focus({ bounds: this.homeEnvelope.bounds_m });
    this.notify();
  }

  select(placementId) {
    if (!this.state) return;
    this.state = selectPlacement(this.state, placementId);
    this.viewer?.select(placementId);
    this.notify();
  }

  // HCA-04: local commands, undo, save.
  async apply(command) {
    if (!this.state) return false;
    try {
      this.state = applyPlacementCommand(this.state, command);
    } catch (error) {
      this.announce(ROLE_PERMISSIONS[this.state.role]?.edit ? `Not applied: ${error.message}.` : `Your role (${this.state.role}) can't edit placements.`);
      this.notify();
      return false;
    }
    if (this.phase === Phase.EMPTY && workingPlacements(this.state).length) this.phase = Phase.READY;
    this.announce(`Unsaved change: ${command.type}.`);
    await this.syncInstances();
    this.notify();
    return true;
  }

  async undo() {
    if (!this.state) return;
    this.state = undoLastLocalEdit(this.state);
    this.announce("Last unsaved change undone.");
    await this.syncInstances();
    this.notify();
  }

  requestFor(command) {
    const state = this.state;
    const params = { design_id: state.designId, branch_id: state.branchId, placement_id: command.placementId };
    const expected_revision = state.server.revision;
    const serverItem = state.server.placements.find(item => item.placement_id === command.placementId);
    switch (command.type) {
      case "add": return ["addPlacement", {
        params: { design_id: state.designId, branch_id: state.branchId },
        body: {
          object_source: command.object_source,
          transform: { position_m: command.position_m, rotation_deg_y: command.rotation_deg_y },
          scale_mode: command.scale_mode,
          illustrative_scale: command.scale_mode === "illustrative" ? command.illustrative_scale : null,
          expected_revision
        },
        idempotencyKey: this.idempotencyKey()
      }];
      case "move": return ["updatePlacement", { params, body: { transform: { position_m: command.position_m, rotation_deg_y: serverItem.transform.rotation_deg_y }, expected_revision } }];
      case "rotate": return ["updatePlacement", { params, body: { transform: { position_m: serverItem.transform.position_m, rotation_deg_y: command.rotation_deg_y }, expected_revision } }];
      case "hide": return ["updatePlacement", { params, body: { hidden: command.hidden, expected_revision } }];
      case "setScaleMode": return ["updatePlacement", { params, body: { scale_mode: command.scale_mode, illustrative_scale: command.scale_mode === "illustrative" ? command.illustrative_scale : null, expected_revision } }];
      case "duplicate": return ["duplicatePlacement", { params, body: { expected_revision, offset_m: command.offset_m }, idempotencyKey: this.idempotencyKey() }];
      case "remove": return ["removePlacement", { params, query: { expected_revision } }];
      default: throw new TypeError(`unknown command ${command.type}`);
    }
  }

  async latestRecord() {
    const design = await this.api.getDesign({ params: { design_id: this.state.designId } });
    const branch = design.branches.find(item => item.branch_id === this.state.branchId);
    const record = await this.api.getRevision({ params: { design_id: this.state.designId, branch_id: branch.branch_id, revision: branch.head_revision } });
    return { design, record };
  }

  // HCA-06.1 / 06.4: send pending commands in order with expected_revision.
  async save() {
    if (!this.state || !this.state.pending.length || this.state.saving || this.state.conflict) return;
    const epoch = this.epoch;
    this.state = beginSaving(this.state);
    this.announce("Saving…");
    this.notify();
    try {
      while (this.state.pending.length) {
        const command = this.state.pending[0];
        const [operation, call] = this.requestFor(command);
        const response = await this.api[operation](call);
        if (!this.current(epoch)) return;
        if (response.fit && response.placement) this.fits[response.placement.placement_id] = response.fit;
        this.state = acknowledgeCommand(this.state, { seq: command.seq, revision: response.revision, placementId: response.placement_id ?? null });
      }
      const { design, record } = await this.latestRecord();
      if (!this.current(epoch)) return;
      this.state = withBranches(finishSaving(this.state, record), design.branches);
      this.announce(`Saved as revision ${record.revision}.`);
    } catch (error) {
      if (!this.current(epoch)) return;
      if (isServiceProblem(error) && error.code === "version_conflict") {
        try {
          const { design, record } = await this.latestRecord();
          if (!this.current(epoch)) return;
          this.state = withBranches(rebaseAfterConflict(this.state, record), design.branches);
          this.problem = error;
          this.announce(`Conflict: revision ${record.revision} was saved by ${record.created_by ?? "someone else"}. Your unsaved edits are kept separately.`);
        } catch (inner) {
          this.state = saveFailed(this.state, problemText(inner));
          this.handleProblem(inner);
        }
      } else if (isServiceProblem(error)) {
        this.state = saveFailed(this.state, problemText(error, { role: this.state.role }));
        this.handleProblem(error);
      } else {
        throw error;
      }
    }
    await this.syncInstances();
    this.notify();
  }

  async resolveConflict(choice) {
    if (!this.state?.conflict) return;
    this.state = resolveConflict(this.state, choice);
    const dropped = this.state.lastDropped.length;
    this.announce(choice === "discard"
      ? "Your unsaved edits were discarded. Showing the latest saved revision."
      : `Your edits are re-applied on revision ${this.state.server.revision} and still unsaved${dropped ? `; ${dropped} edit(s) no longer apply` : ""}.`);
    await this.syncInstances();
    this.notify();
  }

  // Stale: a newer head exists and there are no local edits to protect.
  async checkForUpdates() {
    if (!this.state) return;
    const epoch = this.epoch;
    try {
      const design = await this.api.getDesign({ params: { design_id: this.state.designId } });
      if (!this.current(epoch)) return;
      const head = design.branches.find(item => item.branch_id === this.state.branchId)?.head_revision;
      this.staleHead = head > this.state.server.revision ? head : null;
      this.state = withBranches(this.state, design.branches);
      if (this.staleHead) this.announce(`Revision ${head} is available. You're viewing revision ${this.state.server.revision}.`);
    } catch (error) {
      if (this.current(epoch)) this.handleProblem(error);
    }
    if (this.current(epoch)) this.notify();
  }

  async loadLatest() {
    if (!this.state || this.state.pending.length) return;
    const epoch = this.epoch;
    const { design, record } = await this.latestRecord();
    if (!this.current(epoch)) return;
    const branch = design.branches.find(item => item.branch_id === this.state.branchId);
    this.state = switchBranch(this.state, { branch, revision: record, branches: design.branches });
    this.staleHead = null;
    this.announce(`Showing revision ${record.revision}.`);
    await this.loadView(epoch);
    this.notify();
  }

  // HCA-04.4 / HCB-05.4: restore creates a new attributable revision; history is kept.
  async restore(toRevision) {
    if (!this.state || this.state.pending.length) return;
    const epoch = this.epoch;
    try {
      const response = await this.api.restoreRevision({
        params: { design_id: this.state.designId, branch_id: this.state.branchId },
        body: { to_revision: toRevision, expected_revision: this.state.server.revision },
        idempotencyKey: this.idempotencyKey()
      });
      if (!this.current(epoch)) return;
      const { design, record } = await this.latestRecord();
      if (!this.current(epoch)) return;
      this.state = withBranches(finishSaving(this.state, record, { restoredFrom: response.restored_from }), design.branches);
      this.announce(`Restored revision ${response.restored_from} as new revision ${response.revision}. Earlier revisions are kept.`);
      await this.syncInstances();
    } catch (error) {
      if (this.current(epoch)) this.handleProblem(error);
    }
    if (this.current(epoch)) this.notify();
  }

  // HCA-06.2 / 06.3 alternatives and compare.
  async createAlternative(name) {
    if (!this.state) return null;
    const epoch = this.epoch;
    try {
      const branch = await this.api.createAlternative({
        params: { design_id: this.state.designId },
        body: { name, from_branch_id: this.state.branchId, base_revision: this.state.server.revision },
        idempotencyKey: this.idempotencyKey()
      });
      if (!this.current(epoch)) return null;
      const design = await this.api.getDesign({ params: { design_id: this.state.designId } });
      if (!this.current(epoch)) return null;
      this.state = withBranches(this.state, design.branches);
      this.announce(`Created alternative "${branch.name}" from revision ${branch.base_revision}.`);
      this.notify();
      return branch;
    } catch (error) {
      if (this.current(epoch)) { this.handleProblem(error); this.notify(); }
      return null;
    }
  }

  async switchToBranch(branchId) {
    if (!this.state) return;
    const epoch = this.epoch;
    try {
      const branch = this.state.branches.find(item => item.branch_id === branchId);
      if (!branch) return;
      const record = await this.api.getRevision({ params: { design_id: this.state.designId, branch_id: branchId, revision: branch.head_revision } });
      if (!this.current(epoch)) return;
      this.state = switchBranch(this.state, { branch, revision: record });
      this.announce(`Showing "${branch.name}" at revision ${record.revision}.`);
      await this.loadView(epoch);
    } catch (error) {
      if (!this.current(epoch)) return;
      if (isServiceProblem(error)) this.handleProblem(error);
      else this.announce(error.message);
    }
    if (this.current(epoch)) this.notify();
  }

  async compare(a, b) {
    if (!this.state) return null;
    const epoch = this.epoch;
    try {
      const result = await this.api.compare({ params: { design_id: this.state.designId }, query: { a, b } });
      if (!this.current(epoch)) return null;
      this.comparison = { a, b, differences: result.differences };
      this.announce(`${result.differences.length} difference(s) between ${a} and ${b}.`);
    } catch (error) {
      if (this.current(epoch)) this.handleProblem(error);
    }
    if (this.current(epoch)) this.notify();
    return this.comparison;
  }

  async assessFit(placementId, { question = "clearance", clearanceMarginM = null } = {}) {
    if (!this.state) return null;
    const epoch = this.epoch;
    try {
      const body = { branch_id: this.state.branchId, revision: this.state.server.revision, placement_id: placementId, question };
      if (clearanceMarginM !== null) body.clearance_margin_m = clearanceMarginM;
      const fit = await this.api.assessFit({ params: { design_id: this.state.designId }, body, idempotencyKey: this.idempotencyKey() });
      if (!this.current(epoch)) return null;
      this.fits[placementId] = fit;
      this.notify();
      return fit;
    } catch (error) {
      if (this.current(epoch)) { this.handleProblem(error); this.notify(); }
      return null;
    }
  }

  // HCA-07.1 / 07.2: object share and design share are separate actions.
  async shareObject(objectSource, granteeUserId, note = null) {
    const epoch = this.epoch;
    try {
      const share = await this.api.shareObject({ body: { object_source: objectSource, grantee_user_id: granteeUserId, note }, idempotencyKey: this.idempotencyKey() });
      if (!this.current(epoch)) return null;
      this.objectShares.push(share);
      this.announce(`Shared object ${shortId(share.object_source.object_id)} v${share.object_source.version} with ${share.grantee_user_id}. Only the object was shared, not your home or design.`);
      this.notify();
      return share;
    } catch (error) {
      if (this.current(epoch)) { this.handleProblem(error); this.notify(); }
      return null;
    }
  }

  async shareDesign(granteeUserId, role) {
    if (!this.state) return null;
    const epoch = this.epoch;
    try {
      const share = await this.api.shareDesign({ params: { design_id: this.state.designId }, body: { grantee_user_id: granteeUserId, role, expires_at: null }, idempotencyKey: this.idempotencyKey() });
      if (!this.current(epoch)) return null;
      this.participants.push({ shareId: share.share_id, granteeUserId, role: share.role, state: share.state });
      this.announce(`Invited ${granteeUserId} to this design as ${share.role}. They see it after accepting.`);
      this.notify();
      return share;
    } catch (error) {
      if (this.current(epoch)) { this.handleProblem(error); this.notify(); }
      return null;
    }
  }

  // HCA-07.3: comments anchored to placements.
  async loadComments() {
    if (!this.state) return;
    const epoch = this.epoch;
    try {
      const result = await this.api.listComments({ params: { design_id: this.state.designId }, query: { branch_id: this.state.branchId, revision: this.state.server.revision } });
      if (!this.current(epoch)) return;
      this.comments = result.items;
    } catch (error) {
      if (this.current(epoch)) this.handleProblem(error);
    }
    if (this.current(epoch)) this.notify();
  }

  async addComment(body) {
    if (!this.state) return null;
    const epoch = this.epoch;
    const selection = this.state.selection;
    const anchor = selection && !selection.startsWith("local-") ? { kind: "placement", placement_id: selection } : { kind: "design" };
    try {
      const comment = await this.api.addComment({
        params: { design_id: this.state.designId },
        body: { branch_id: this.state.branchId, revision: this.state.server.revision, anchor, body, reply_to: null },
        idempotencyKey: this.idempotencyKey()
      });
      if (!this.current(epoch)) return null;
      this.announce(anchor.kind === "placement" ? `Comment added to ${shortId(anchor.placement_id)}.` : "Comment added to the design.");
      await this.loadComments();
      return comment;
    } catch (error) {
      if (this.current(epoch)) { this.handleProblem(error); this.notify(); }
      return null;
    }
  }

  async resolveComment(commentId) {
    const epoch = this.epoch;
    try {
      // C21 items carry no record_version; open comments are at version 1 (see hca-notes.md).
      await this.api.resolveComment({ params: { comment_id: commentId }, body: { expected_version: 1 }, idempotencyKey: this.idempotencyKey() });
      if (!this.current(epoch)) return;
      this.announce("Comment resolved.");
      await this.loadComments();
    } catch (error) {
      if (this.current(epoch)) { this.handleProblem(error); this.notify(); }
    }
  }

  // HCA-02.4: account change or navigation disposes the viewer; late results are dropped.
  async changeAccount(accountKey) {
    this.epoch += 1;
    this.accountKey = accountKey;
    await this.disposeViewer();
    this.reset(Phase.IDLE);
    this.announce("Account changed. The previous design was closed.");
    this.notify();
  }

  async navigateAway() {
    this.epoch += 1;
    await this.disposeViewer();
    this.reset(Phase.DISPOSED);
    this.notify();
  }

  view() {
    const state = this.state;
    const capability = this.viewer?.capability() ?? null;
    return Object.freeze({
      phase: this.phase,
      accountKey: this.accountKey,
      designId: state?.designId ?? null,
      title: state?.title ?? null,
      role: state?.role ?? null,
      canEdit: Boolean(state && ROLE_PERMISSIONS[state.role]?.edit),
      canComment: Boolean(state && ROLE_PERMISSIONS[state.role]?.comment),
      canShareDesign: Boolean(state && ROLE_PERMISSIONS[state.role]?.share_archive),
      branchId: state?.branchId ?? null,
      branches: state?.branches ?? [],
      revision: state?.server.revision ?? null,
      history: state?.history ?? [],
      workingStatus: state ? workingStatus(state) : null,
      pendingCount: state?.pending.length ?? 0,
      placements: state ? workingPlacements(state) : [],
      selection: state?.selection ?? null,
      conflict: state?.conflict ?? null,
      lastDropped: state?.lastDropped ?? [],
      saveError: state?.lastError ?? null,
      geometry: { ...this.geometry, text: geometryText(this.geometry) },
      renderer: capability ? { renderer: capability.renderer, label: capability.label, text: rendererStatusText(capability), countsAsWebGPU: capability.countsAsWebGPU } : null,
      viewerDescription: this.viewer?.describe() ?? "",
      problemCode: this.problem?.code ?? null,
      offline: Boolean(this.offline),
      staleHead: this.staleHead,
      announcement: this.announcement,
      fits: { ...this.fits },
      comparison: this.comparison,
      comments: this.comments,
      participants: [...this.participants],
      objectShares: [...this.objectShares]
    });
  }
}

export function placementBounds(item) {
  const dims = item.dimensions_m ?? [1, 1, 1];
  const scale = item.scale_mode === "illustrative" ? item.illustrative_scale ?? 1 : 1;
  const [x, y, z] = item.transform.position_m;
  const half = dims.map(value => (value * scale) / 2);
  return { min: [x - half[0], y, z - half[2]], max: [x + half[0], y + dims[1] * scale, z + half[2]] };
}

export function geometryText(geometry) {
  const missing = (geometry.sources ?? []).filter(item => item.outcome !== "accessible");
  const detail = missing.map(item => `${item.kind === "home" ? "Home" : `Object ${shortId(item.id)} v${item.version}`} ${OUTCOME_TEXT[item.outcome] ?? item.outcome}`).join("; ");
  switch (geometry.state) {
    case GeometryState.NONE: return "No design open.";
    case GeometryState.LOADING: return "Loading the 3D view…";
    case GeometryState.COMPLETE: return "All sources shown in the 3D view.";
    case GeometryState.PARTIAL: return `Partial view: ${detail}. Those placements are listed but not drawn.`;
    case GeometryState.HOME_UNAVAILABLE: return `Home not shown: ${detail || "unavailable"}. Placements are listed as text only.`;
    case GeometryState.UNSUPPORTED: return "3D view not supported on this device yet. Placements are listed as text and can still be edited.";
    case GeometryState.DEVICE_LOST: return "3D view lost — Reload view. Your design and unsaved edits are kept.";
    case GeometryState.FAILED: return `3D view could not load (${geometry.reason}). Placements are listed as text.`;
    default: return String(geometry.state);
  }
}
