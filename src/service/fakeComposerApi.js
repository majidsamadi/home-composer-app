// In-memory fake of the Composer service (plan X.4, composer.v0.4.json, DRAFT).
// Status: component-tested (synthetic data only). It implements the table C routes,
// the Q07 role matrix, expected-revision/expected-version conflicts, idempotency
// keys and the HCB-04 fit rules with Q03 provisional thresholds. It is not HCB.
import {
  COMPOSER_ROUTES,
  IDEMPOTENCY_KEY_PATTERN,
  ROLE_PERMISSIONS,
  ServiceProblem,
  THRESHOLDS_VERSION
} from "./composerApi.js";

const VERIFIED_CLAIMS = new Set(["reference-supported", "independently-verified"]);
const APPROXIMATE_CLAIMS = new Set(["estimated", "seller-declared"]);
const CONTEXT_KINDS = new Set(["private_planning", "named_collaboration", "published_composition", "non_property_sandbox"]);
const SHARE_ROLES = new Set(["viewer", "commenter", "editor"]);
const SOURCE_OUTCOMES = new Set(["accessible", "source_access_denied", "withdrawn", "unavailable"]);

const clone = value => (value === undefined ? undefined : structuredClone(value));
const fail = (status, code, extras = {}) => { throw new ServiceProblem({ status, code, ...extras }); };
const round4 = value => Math.round(value * 10000) / 10000;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// HCB-04 fit rules (X.4, Q03 provisional). Pure; exported for tests and presentation checks.
export function computeFit({ placement, home, question = null, clearanceMarginM = null }) {
  // As HCB: footprint answers always carry opening_clearance_not_supported (door swing is not checked).
  const result = (outcome, reasons, combined = null, margin = null) => ({
    outcome, reasons: question === "footprint" ? [...reasons, "opening_clearance_not_supported"] : reasons, thresholds_version: THRESHOLDS_VERSION, combined_uncertainty_m: combined, margin_m: margin
  });
  if (placement.scale_mode === "illustrative") return result("unknown", ["illustrative_scale_mode"]);
  if (placement.scale_claim === "unknown" || home.scale_claim === "unknown") return result("unknown", ["scale_claim_unknown"]);
  if (!Array.isArray(placement.dimensions_m)) return result("unknown", ["dimensions_unknown"]);
  const uObj = Math.max(0.01, 0.03 * Math.max(...placement.dimensions_m));
  const extent = Math.max(...home.bounds_m.max.map((value, axis) => value - home.bounds_m.min[axis]));
  const uRoom = Math.max(0.05, 0.02 * extent);
  const combined = round4(Math.sqrt(uObj ** 2 + uRoom ** 2));
  let margin = null;
  if (question === "clearance") margin = clearanceMarginM;
  if (question === "footprint") margin = round4(footprintMargin(placement, home.bounds_m));
  if (APPROXIMATE_CLAIMS.has(placement.scale_claim) || APPROXIMATE_CLAIMS.has(home.scale_claim)) {
    return result("approximate", ["scale_claim_approximate"], combined, margin);
  }
  if (margin === null) return result("unverified_fit", ["clearance_not_requested"], combined, null);
  if (margin < 0) return result("unverified_fit", ["footprint_outside_home_bounds"], combined, margin);
  if (VERIFIED_CLAIMS.has(placement.scale_claim) && VERIFIED_CLAIMS.has(home.scale_claim) && combined < margin) {
    return result("verified_fit", [], combined, margin);
  }
  return result("unverified_fit", ["margin_within_uncertainty"], combined, margin);
}

// Minimum distance from the rotated footprint's bounding box to the home bounds (x/z).
function footprintMargin(placement, bounds) {
  const [w, , d] = placement.dimensions_m;
  const theta = (placement.transform.rotation_deg_y * Math.PI) / 180;
  const hx = (Math.abs(Math.cos(theta)) * w + Math.abs(Math.sin(theta)) * d) / 2;
  const hz = (Math.abs(Math.sin(theta)) * w + Math.abs(Math.cos(theta)) * d) / 2;
  const [x, , z] = placement.transform.position_m;
  return Math.min(x - hx - bounds.min[0], bounds.max[0] - (x + hx), z - hz - bounds.min[2], bounds.max[2] - (z + hz));
}

function validTransform(transform) {
  if (!transform || !Array.isArray(transform.position_m) || transform.position_m.length !== 3) return false;
  if (!transform.position_m.every(value => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 500)) return false;
  return typeof transform.rotation_deg_y === "number" && Number.isFinite(transform.rotation_deg_y);
}

function validIllustrativeScale(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.1 && value <= 10;
}

export function createFakeComposerApi({ seed, actor = "USER-A" } = {}) {
  if (!seed) throw new TypeError("seed is required (see src/fixtures/workspaceFixtures.js)");
  const world = clone(seed);
  let counter = 1000;
  let tick = 0;
  const nextId = prefix => `${prefix}_01HZYSYNTH${String(counter += 1).padStart(16, "0")}`;
  const now = () => new Date(Date.parse(world.clockStart ?? "2026-10-20T00:00:00Z") + (tick += 1) * 1000).toISOString().replace(".000Z", "Z");
  const designs = new Map();
  for (const design of world.designs) {
    designs.set(design.design_id, {
      ...design,
      status: "active",
      record_version: 1,
      shares: new Map(design.shares.map(share => [share.share_id, { record_version: 1, expires_at: null, ...share }])),
      branches: new Map(design.branches.map(branch => [branch.branch_id, {
        branch_id: branch.branch_id,
        name: branch.name,
        base_revision: branch.base_revision,
        revisions: new Map(branch.revisions.map(record => [record.revision, record])),
        head_revision: Math.max(...branch.revisions.map(record => record.revision))
      }]))
    });
  }
  const comments = new Map();
  const objectShares = new Map();
  const idempotency = new Map();
  const scenario = {
    offline: false,
    homeOutcome: null,
    objectOutcomes: {},
    failNext: null
  };
  const calls = [];
  const objectReads = [];
  let held = null;

  function objectFor(user, source) {
    const facts = world.objects[`${source.object_id}@${source.version}`];
    if (!facts) return { outcome: "not_found", facts: null };
    const uses = facts.caller_allowed_use_by_user?.[user] ?? facts.caller_allowed_use_by_user?.default ?? facts.allowed_use;
    if (!uses.includes("view")) return { outcome: "not_found", facts: null };
    if (facts.state === "withdrawn") return { outcome: "withdrawn", facts, uses };
    return { outcome: "accessible", facts, uses };
  }

  function homeOf(design) {
    return world.homes[`${design.home_source.scene_id}@${design.home_source.version}`];
  }

  function roleOf(design, user) {
    if (design.owner === user) return "owner";
    for (const share of design.shares.values()) {
      if (share.grantee_user_id === user && share.state === "accepted") return share.role;
    }
    return null;
  }

  function visibleDesign(user, designId) {
    const design = designs.get(designId);
    const role = design ? roleOf(design, user) : null;
    if (!design || !role) fail(404, "not_found");
    return { design, role };
  }

  function requirePermission(role, permission) {
    if (!ROLE_PERMISSIONS[role]?.[permission]) fail(403, "action_denied");
  }

  function branchOf(design, branchId) {
    const branch = design.branches.get(branchId);
    if (!branch) fail(404, "not_found");
    return branch;
  }

  function checkRevision(branch, expected) {
    if (Number(expected) !== branch.head_revision) fail(409, "version_conflict", { current_revision: branch.head_revision });
  }

  function checkVersion(record, expected) {
    if (Number(expected) !== record.record_version) fail(409, "version_conflict", { current_version: record.record_version });
  }

  function commit(branch, user, placements) {
    const revision = branch.head_revision + 1;
    branch.revisions.set(revision, { revision, placements, created_by: user, created_at: now(), parent_revision: branch.head_revision });
    branch.head_revision = revision;
    return revision;
  }

  function headPlacements(branch) {
    return clone(branch.revisions.get(branch.head_revision).placements);
  }

  function findPlacement(placements, placementId) {
    const index = placements.findIndex(item => item.placement_id === placementId);
    if (index < 0) fail(404, "not_found");
    return index;
  }

  function editable(user, params, expectedRevision) {
    const { design, role } = visibleDesign(user, params.design_id);
    requirePermission(role, "edit");
    const branch = branchOf(design, params.branch_id);
    checkRevision(branch, expectedRevision);
    return { design, branch };
  }

  function scaleFields(target, body, facts) {
    if (body.scale_mode !== undefined) {
      if (!["real", "illustrative"].includes(body.scale_mode)) fail(422, "validation_failed", { reasons: ["scale_mode_invalid"] });
      target.scale_mode = body.scale_mode;
    }
    if (target.scale_mode === "illustrative") {
      const scale = body.illustrative_scale ?? target.illustrative_scale ?? 1;
      if (!validIllustrativeScale(scale)) fail(422, "validation_failed", { reasons: ["illustrative_scale_out_of_range"] });
      target.illustrative_scale = scale;
    } else {
      target.illustrative_scale = null;
      if (facts && facts.effective_scale_claim === "unknown" && !facts.effective_dimensions_m) fail(422, "unsupported_scale");
      if (!facts && target.scale_claim === "unknown" && !target.dimensions_m) fail(422, "unsupported_scale");
    }
  }

  const handlers = {
    createDesign(user, { body }) {
      if (!CONTEXT_KINDS.has(body?.context_kind) || typeof body?.title !== "string" || !body.title.trim()) {
        fail(422, "validation_failed", { reasons: ["context_kind_or_title_invalid"] });
      }
      const sandbox = body.context_kind === "non_property_sandbox";
      if (!sandbox && (!body.home_source || !body.property_id)) fail(422, "validation_failed", { reasons: ["home_source_required"] });
      if (sandbox && body.property_id) fail(422, "validation_failed", { reasons: ["sandbox_has_no_property"] });
      if (body.home_source && !world.homes[`${body.home_source.scene_id}@${body.home_source.version}`]) fail(404, "not_found");
      const designId = nextId("dsg");
      designs.set(designId, {
        design_id: designId, title: body.title, context_kind: body.context_kind, home_source: clone(body.home_source),
        property_id: body.property_id ?? null, owner: user, status: "active", record_version: 1, shares: new Map(),
        branches: new Map([["main", { branch_id: "main", name: "Main", base_revision: 1, head_revision: 1,
          revisions: new Map([[1, { revision: 1, placements: [], created_by: user, created_at: now(), parent_revision: null }]]) }]])
      });
      return { design_id: designId, branch_id: "main", revision: 1, context_kind: body.context_kind, home_source: clone(body.home_source), role: "owner" };
    },
    listDesigns(user, { query }) {
      const status = query?.status ?? "active";
      const limit = Math.min(50, Math.max(1, Number(query?.limit ?? 20)));
      const items = [...designs.values()]
        .map(design => ({ design, role: roleOf(design, user) }))
        .filter(item => item.role && item.design.status === status)
        .slice(0, limit)
        .map(({ design, role }) => ({ design_id: design.design_id, role, status: design.status, title: design.title }));
      return { items, next_cursor: null };
    },
    getDesign(user, { params }) {
      const { design, role } = visibleDesign(user, params.design_id);
      return {
        design_id: design.design_id, title: design.title, context_kind: design.context_kind, home_source: clone(design.home_source),
        role, status: design.status, record_version: design.record_version,
        branches: [...design.branches.values()].map(branch => ({ branch_id: branch.branch_id, name: branch.name, base_revision: branch.base_revision, head_revision: branch.head_revision }))
      };
    },
    getRevision(user, { params }) {
      const { design } = visibleDesign(user, params.design_id);
      const record = branchOf(design, params.branch_id).revisions.get(Number(params.revision));
      if (!record) fail(404, "not_found");
      return clone(record);
    },
    archiveDesign(user, { params, body }) {
      const { design, role } = visibleDesign(user, params.design_id);
      requirePermission(role, "share_archive");
      checkVersion(design, body?.expected_version);
      design.status = "archived";
      design.record_version += 1;
      return { status: "archived" };
    },
    addPlacement(user, { params, body }) {
      const { design, role } = visibleDesign(user, params.design_id);
      requirePermission(role, "edit");
      if (!validTransform(body?.transform)) fail(422, "validation_failed", { reasons: ["transform_invalid"] });
      const branch = branchOf(design, params.branch_id);
      checkRevision(branch, body.expected_revision);
      const source = objectFor(user, body.object_source ?? {});
      if (source.outcome !== "accessible" || !source.uses.includes("place")) fail(403, "action_denied", { reasons: ["source_access_denied"] });
      const placement = {
        placement_id: nextId("plc"),
        object_source: { object_id: body.object_source.object_id, version: body.object_source.version },
        transform: clone(body.transform),
        scale_mode: "real",
        illustrative_scale: null,
        dimensions_m: clone(source.facts.effective_dimensions_m ?? null),
        scale_claim: source.facts.effective_scale_claim,
        hidden: false
      };
      scaleFields(placement, { scale_mode: body.scale_mode ?? "real", illustrative_scale: body.illustrative_scale ?? undefined }, source.facts);
      const placements = headPlacements(branch);
      placements.push(placement);
      const revision = commit(branch, user, placements);
      return { placement_id: placement.placement_id, revision, placement: clone(placement), fit: computeFit({ placement, home: homeOf(design) }) };
    },
    updatePlacement(user, { params, body }) {
      const { design, branch } = editable(user, params, body?.expected_revision);
      const placements = headPlacements(branch);
      const placement = placements[findPlacement(placements, params.placement_id)];
      if (body.transform !== undefined) {
        if (!validTransform(body.transform)) fail(422, "validation_failed", { reasons: ["transform_invalid"] });
        placement.transform = clone(body.transform);
      }
      if (body.hidden !== undefined) placement.hidden = Boolean(body.hidden);
      if (body.scale_mode !== undefined || body.illustrative_scale !== undefined) scaleFields(placement, body, null);
      const revision = commit(branch, user, placements);
      return { revision, placement: clone(placement), fit: computeFit({ placement, home: homeOf(design) }) };
    },
    removePlacement(user, { params, query }) {
      const { branch } = editable(user, params, query?.expected_revision);
      const placements = headPlacements(branch);
      placements.splice(findPlacement(placements, params.placement_id), 1);
      return { revision: commit(branch, user, placements) };
    },
    duplicatePlacement(user, { params, body }) {
      const { branch } = editable(user, params, body?.expected_revision);
      const placements = headPlacements(branch);
      const original = placements[findPlacement(placements, params.placement_id)];
      const offset = body.offset_m ?? [0.5, 0, 0];
      const copy = clone(original);
      copy.placement_id = nextId("plc");
      copy.transform.position_m = copy.transform.position_m.map((value, axis) => value + (offset[axis] ?? 0));
      if (!validTransform(copy.transform)) fail(422, "validation_failed", { reasons: ["transform_invalid"] });
      placements.push(copy);
      return { placement_id: copy.placement_id, revision: commit(branch, user, placements) };
    },
    createAlternative(user, { params, body }) {
      const { design, role } = visibleDesign(user, params.design_id);
      requirePermission(role, "edit");
      const from = branchOf(design, body?.from_branch_id);
      const base = from.revisions.get(Number(body.base_revision));
      if (!base) fail(404, "not_found");
      if (typeof body.name !== "string" || !body.name.trim()) fail(422, "validation_failed", { reasons: ["name_required"] });
      const branchId = nextId("brn");
      design.branches.set(branchId, {
        branch_id: branchId, name: body.name.trim(), base_revision: base.revision, head_revision: base.revision,
        revisions: new Map([[base.revision, clone(base)]])
      });
      return { branch_id: branchId, name: body.name.trim(), base_revision: base.revision, head_revision: base.revision };
    },
    compare(user, { params, query }) {
      const { design } = visibleDesign(user, params.design_id);
      const side = ref => {
        const [branchId, revision] = String(ref ?? "").split("@");
        const record = design.branches.get(branchId)?.revisions.get(Number(revision));
        if (!record) fail(404, "not_found");
        return clone(record.placements);
      };
      const a = side(query?.a);
      const b = side(query?.b);
      const differences = [];
      const byId = new Map(a.map(item => [item.placement_id, item]));
      for (const item of b) {
        const before = byId.get(item.placement_id);
        if (!before) { differences.push({ placement_id: item.placement_id, change: "added" }); continue; }
        if (stableStringify(before.transform.position_m) !== stableStringify(item.transform.position_m)) differences.push({ placement_id: item.placement_id, change: "moved" });
        if (before.transform.rotation_deg_y !== item.transform.rotation_deg_y) differences.push({ placement_id: item.placement_id, change: "rotated" });
        if (before.scale_mode !== item.scale_mode || before.illustrative_scale !== item.illustrative_scale) differences.push({ placement_id: item.placement_id, change: "scale_changed" });
        if (before.hidden !== item.hidden) differences.push({ placement_id: item.placement_id, change: "hidden_changed" });
      }
      const inB = new Set(b.map(item => item.placement_id));
      for (const item of a) if (!inB.has(item.placement_id)) differences.push({ placement_id: item.placement_id, change: "removed" });
      return { a: { placements: a }, b: { placements: b }, differences };
    },
    restoreRevision(user, { params, body }) {
      const { branch } = editable(user, params, body?.expected_revision);
      const target = branch.revisions.get(Number(body.to_revision));
      if (!target) fail(404, "not_found");
      return { revision: commit(branch, user, clone(target.placements)), restored_from: target.revision };
    },
    assessFit(user, { params, body }) {
      const { design } = visibleDesign(user, params.design_id);
      const record = design.branches.get(body?.branch_id)?.revisions.get(Number(body.revision));
      if (!record) fail(404, "not_found");
      const placement = record.placements.find(item => item.placement_id === body.placement_id);
      if (!placement) fail(404, "not_found");
      if (!["footprint", "clearance"].includes(body.question)) fail(422, "validation_failed", { reasons: ["question_invalid"] });
      const margin = body.clearance_margin_m;
      if (body.question === "clearance" && !(typeof margin === "number" && Number.isFinite(margin) && margin > 0)) {
        fail(422, "validation_failed", { reasons: ["clearance_margin_invalid"] });
      }
      return computeFit({ placement, home: homeOf(design), question: body.question, clearanceMarginM: margin ?? null });
    },
    shareDesign(user, { params, body }) {
      const { design, role } = visibleDesign(user, params.design_id);
      requirePermission(role, "share_archive");
      if (!SHARE_ROLES.has(body?.role) || typeof body.grantee_user_id !== "string" || !body.grantee_user_id || body.grantee_user_id === design.owner) {
        fail(422, "validation_failed", { reasons: ["share_invalid"] });
      }
      const share = { share_id: nextId("shr"), grantee_user_id: body.grantee_user_id, role: body.role, state: "invited", record_version: 1, expires_at: body.expires_at ?? null };
      design.shares.set(share.share_id, share);
      return { share_id: share.share_id, role: share.role, state: share.state };
    },
    acceptShare(user, { params }) { return answerShare(user, params, "accepted"); },
    declineShare(user, { params }) { return answerShare(user, params, "declined"); },
    updateShare(user, { params, body }) {
      const { design, role } = visibleDesign(user, params.design_id);
      requirePermission(role, "share_archive");
      const share = design.shares.get(params.share_id);
      if (!share || share.state === "revoked") fail(404, "not_found");
      checkVersion(share, body?.expected_version);
      if (!SHARE_ROLES.has(body.role)) fail(422, "validation_failed", { reasons: ["role_invalid"] });
      share.role = body.role;
      share.record_version += 1;
      return { share_id: share.share_id, role: share.role, state: share.state, record_version: share.record_version };
    },
    revokeShare(user, { params, query }) {
      const { design, role } = visibleDesign(user, params.design_id);
      requirePermission(role, "share_archive");
      const share = design.shares.get(params.share_id);
      if (!share || share.state === "revoked") fail(404, "not_found");
      checkVersion(share, query?.expected_version);
      share.state = "revoked";
      share.record_version += 1;
      return { state: "revoked" };
    },
    shareObject(user, { body }) {
      const source = objectFor(user, body?.object_source ?? {});
      if (source.outcome !== "accessible") fail(404, "not_found");
      if (typeof body.grantee_user_id !== "string" || !body.grantee_user_id) fail(422, "validation_failed", { reasons: ["grantee_required"] });
      const record = {
        object_share_id: nextId("shr"),
        object_source: { object_id: body.object_source.object_id, version: body.object_source.version },
        grantee_user_id: body.grantee_user_id,
        sharer: user,
        note: body.note ?? null
      };
      objectShares.set(record.object_share_id, record);
      // Carries no design or home reference (C18).
      return { object_share_id: record.object_share_id, object_source: clone(record.object_source), grantee_user_id: record.grantee_user_id };
    },
    getObjectShare(user, { params }) {
      const record = objectShares.get(params.object_share_id);
      if (!record || (record.grantee_user_id !== user && record.sharer !== user)) fail(404, "not_found");
      const check = objectFor(record.grantee_user_id, record.object_source);
      const sourceOutcome = check.outcome === "accessible" ? "accessible" : check.outcome === "withdrawn" ? "withdrawn" : "source_access_denied";
      return { object_source: clone(record.object_source), source_outcome: sourceOutcome };
    },
    addComment(user, { params, body }) {
      const { design, role } = visibleDesign(user, params.design_id);
      requirePermission(role, "comment");
      const record = design.branches.get(body?.branch_id)?.revisions.get(Number(body.revision));
      if (!record) fail(404, "not_found");
      if (typeof body.body !== "string" || body.body.trim().length < 1 || body.body.length > 2000) fail(422, "validation_failed", { reasons: ["comment_body_length"] });
      const anchor = body.anchor ?? {};
      if (anchor.kind === "placement") {
        if (!record.placements.some(item => item.placement_id === anchor.placement_id)) fail(422, "validation_failed", { reasons: ["anchor_placement_not_in_revision"] });
      } else if (anchor.kind !== "design") fail(422, "validation_failed", { reasons: ["anchor_invalid"] });
      const comment = {
        comment_id: nextId("cmt"), design_id: design.design_id, branch_id: body.branch_id,
        anchor: anchor.kind === "placement" ? { kind: "placement", placement_id: anchor.placement_id } : { kind: "design" },
        revision: record.revision, author_user_id: user, body: body.body, state: "open", record_version: 1, reply_to: body.reply_to ?? null
      };
      comments.set(comment.comment_id, comment);
      return { comment_id: comment.comment_id, anchor: clone(comment.anchor), revision: comment.revision, author_user_id: user, state: "open" };
    },
    listComments(user, { params, query }) {
      const { design } = visibleDesign(user, params.design_id);
      const branch = branchOf(design, query?.branch_id);
      const atRevision = query?.revision !== undefined && query.revision !== null ? Number(query.revision) : branch.head_revision;
      const record = branch.revisions.get(atRevision);
      if (!record) fail(404, "not_found");
      const present = new Set(record.placements.map(item => item.placement_id));
      const items = [...comments.values()]
        .filter(item => item.design_id === design.design_id && item.branch_id === branch.branch_id)
        .map(item => ({
          comment_id: item.comment_id, anchor: clone(item.anchor), revision: item.revision, author_user_id: item.author_user_id,
          body: item.body, state: item.state,
          anchor_state: item.anchor.kind === "placement" && !present.has(item.anchor.placement_id) ? "removed_in_later_revision" : "current"
        }));
      return { items, next_cursor: null };
    },
    resolveComment(user, { params, body }) {
      const comment = comments.get(params.comment_id);
      if (!comment) fail(404, "not_found");
      const { role } = visibleDesign(user, comment.design_id);
      if (!["owner", "editor"].includes(role)) fail(403, "action_denied");
      checkVersion(comment, body?.expected_version);
      comment.state = "resolved";
      comment.record_version += 1;
      return { state: "resolved" };
    },
    createViewSession(user, { params, body }) {
      const { design } = visibleDesign(user, params.design_id);
      const record = design.branches.get(body?.branch_id)?.revisions.get(Number(body.revision));
      if (!record) fail(404, "not_found");
      const grant = prefix => ({ [`${prefix === "vgr" ? "view" : "use"}_grant_id`]: nextId(prefix), expires_at: now() });
      const homeOutcome = scenario.homeOutcome ?? (homeOf(design) ? "accessible" : "unavailable");
      const home = homeOutcome === "accessible" ? { outcome: homeOutcome, view_grant: grant("vgr") } : { outcome: homeOutcome };
      const seen = new Set();
      const objects = [];
      for (const item of record.placements) {
        const key = `${item.object_source.object_id}@${item.object_source.version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const override = scenario.objectOutcomes[key];
        const check = objectFor(user, item.object_source);
        const outcome = override ?? (check.outcome === "not_found" ? "source_access_denied" : check.outcome);
        if (!SOURCE_OUTCOMES.has(outcome)) throw new TypeError(`unknown source outcome ${outcome}`);
        const entry = { object_id: item.object_source.object_id, version: item.object_source.version, outcome };
        if (outcome === "accessible") entry.use_grant = grant("ugr");
        objects.push(entry);
      }
      return { home, objects };
    }
  };

  function answerShare(user, params, state) {
    for (const design of designs.values()) {
      const share = design.shares.get(params.share_id);
      if (share && share.grantee_user_id === user && share.state === "invited") {
        share.state = state;
        share.record_version += 1;
        return { state };
      }
    }
    fail(404, "not_found");
  }

  function forUser(user) {
    const api = {};
    for (const route of COMPOSER_ROUTES) {
      api[route.operation] = async (call = {}) => {
        const request = { params: call.params ?? {}, query: call.query ?? {}, body: call.body ?? null };
        calls.push({ user, operation: route.operation, routeId: route.id, ...clone(request), idempotencyKey: call.idempotencyKey ?? null });
        if (held) await held.promise;
        if (scenario.offline) fail(503, "dependency_unavailable");
        if (scenario.failNext && scenario.failNext.operation === route.operation) {
          const problem = scenario.failNext.problem;
          scenario.failNext = null;
          throw new ServiceProblem(problem);
        }
        let replayKey = null;
        if (route.idempotency === "required") {
          if (typeof call.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(call.idempotencyKey)) fail(400, "idempotency_key_required");
          replayKey = `${user}|${route.operation}|${call.idempotencyKey}`;
          const digest = stableStringify(request);
          const stored = idempotency.get(replayKey);
          if (stored) {
            if (stored.digest !== digest) fail(409, "idempotency_key_reuse");
            return clone(stored.response);
          }
          const response = handlers[route.operation](user, clone(request));
          idempotency.set(replayKey, { digest, response: clone(response) });
          return clone(response);
        }
        return clone(handlers[route.operation](user, clone(request)));
      };
    }
    return Object.freeze(api);
  }

  // O13-shaped object read (fake only). Logs exactly what was sent so tests can
  // assert that no home or design data leaves the workspace.
  function objectReader(user) {
    return Object.freeze({
      async read(request) {
        objectReads.push({ user, request: clone(request) });
        if (held) await held.promise;
        if (scenario.offline) fail(503, "dependency_unavailable");
        const source = objectFor(user, request ?? {});
        if (source.outcome === "not_found") fail(404, "not_found");
        if (source.outcome === "withdrawn") fail(410, "resource_withdrawn");
        const { caller_allowed_use_by_user: _omit, ...facts } = clone(source.facts);
        return { ...facts, caller_allowed_use: [...source.uses] };
      }
    });
  }

  return {
    api: forUser(actor),
    forUser,
    objectReader,
    scenario,
    calls,
    objectReads,
    // Hold every subsequent call until release() — used to observe "saving" and stale results.
    hold() {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      held = { promise };
      return () => { held = null; release(); };
    }
  };
}
