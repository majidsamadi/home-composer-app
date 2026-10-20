// Composer service port (HCA side of plan X.4 / composer.v0.4.json, DRAFT).
// Status: component-tested (synthetic data only). No live service is connected.
//
// ComposerApi (JSDoc interface). Every method takes one call object
//   { params?: {<path params, snake_case>}, query?: {...}, body?: {...}|null, idempotencyKey?: string }
// and resolves with the route's JSON success body, or rejects with ServiceProblem.
//
// @typedef {Object} ComposerApi
// @property {(call) => Promise<object>} createDesign        C01 POST /designs
// @property {(call) => Promise<object>} listDesigns         C02 GET /designs
// @property {(call) => Promise<object>} getDesign           C03 GET /designs/{design_id}
// @property {(call) => Promise<object>} getRevision         C04 GET .../branches/{branch_id}/revisions/{revision}
// @property {(call) => Promise<object>} archiveDesign       C05
// @property {(call) => Promise<object>} addPlacement        C06
// @property {(call) => Promise<object>} updatePlacement     C07
// @property {(call) => Promise<object>} removePlacement     C08
// @property {(call) => Promise<object>} duplicatePlacement  C09
// @property {(call) => Promise<object>} createAlternative   C10
// @property {(call) => Promise<object>} compare             C11
// @property {(call) => Promise<object>} restoreRevision     C12
// @property {(call) => Promise<object>} assessFit           C13
// @property {(call) => Promise<object>} shareDesign         C14
// @property {(call) => Promise<object>} acceptShare         C15 accept
// @property {(call) => Promise<object>} declineShare        C15 decline
// @property {(call) => Promise<object>} updateShare         C16
// @property {(call) => Promise<object>} revokeShare         C17
// @property {(call) => Promise<object>} shareObject         C18
// @property {(call) => Promise<object>} getObjectShare      C19
// @property {(call) => Promise<object>} addComment          C20
// @property {(call) => Promise<object>} listComments        C21
// @property {(call) => Promise<object>} resolveComment      C22
// @property {(call) => Promise<object>} createViewSession   C23

export const COMPOSER_SERVICE = "composer";
export const COMPOSER_APP = "composer";
export const BFF_PATH_TEMPLATE = "/api/v1/web-session/{app}/api/{service}{path}";
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
export const THRESHOLDS_VERSION = "Q03-provisional-2026-10-20";

// idempotency: "required" | "none"; expectedVersion: "body" | "query" | "none" (as in the fixture).
export const COMPOSER_ROUTES = Object.freeze([
  ["C01", "createDesign", "POST", "/designs", "required", "none"],
  ["C02", "listDesigns", "GET", "/designs", "none", "none"],
  ["C03", "getDesign", "GET", "/designs/{design_id}", "none", "none"],
  ["C04", "getRevision", "GET", "/designs/{design_id}/branches/{branch_id}/revisions/{revision}", "none", "none"],
  ["C05", "archiveDesign", "POST", "/designs/{design_id}/archive", "required", "body"],
  ["C06", "addPlacement", "POST", "/designs/{design_id}/branches/{branch_id}/placements", "required", "body"],
  ["C07", "updatePlacement", "PATCH", "/designs/{design_id}/branches/{branch_id}/placements/{placement_id}", "none", "body"],
  ["C08", "removePlacement", "DELETE", "/designs/{design_id}/branches/{branch_id}/placements/{placement_id}", "none", "query"],
  ["C09", "duplicatePlacement", "POST", "/designs/{design_id}/branches/{branch_id}/placements/{placement_id}/duplicate", "required", "body"],
  ["C10", "createAlternative", "POST", "/designs/{design_id}/alternatives", "required", "none"],
  ["C11", "compare", "GET", "/designs/{design_id}/compare", "none", "none"],
  ["C12", "restoreRevision", "POST", "/designs/{design_id}/branches/{branch_id}/restore", "required", "body"],
  ["C13", "assessFit", "POST", "/designs/{design_id}/fit-assessments", "required", "none"],
  ["C14", "shareDesign", "POST", "/designs/{design_id}/shares", "required", "none"],
  ["C15", "acceptShare", "POST", "/design-shares/{share_id}/accept", "required", "none"],
  ["C15", "declineShare", "POST", "/design-shares/{share_id}/decline", "required", "none"],
  ["C16", "updateShare", "PATCH", "/designs/{design_id}/shares/{share_id}", "none", "body"],
  ["C17", "revokeShare", "DELETE", "/designs/{design_id}/shares/{share_id}", "none", "query"],
  ["C18", "shareObject", "POST", "/object-shares", "required", "none"],
  ["C19", "getObjectShare", "GET", "/object-shares/{object_share_id}", "none", "none"],
  ["C20", "addComment", "POST", "/designs/{design_id}/comments", "required", "none"],
  ["C21", "listComments", "GET", "/designs/{design_id}/comments", "none", "none"],
  ["C22", "resolveComment", "POST", "/comments/{comment_id}/resolve", "required", "body"],
  ["C23", "createViewSession", "POST", "/designs/{design_id}/view-sessions", "required", "none"]
].map(([id, operation, method, path, idempotency, expectedVersion]) =>
  Object.freeze({ id, operation, method, path, idempotency, expectedVersion })));

export const ROUTE_BY_OPERATION = Object.freeze(Object.fromEntries(COMPOSER_ROUTES.map(route => [route.operation, route])));

export const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze({ read: true, comment: true, edit: true, share_archive: true }),
  editor: Object.freeze({ read: true, comment: true, edit: true, share_archive: false }),
  commenter: Object.freeze({ read: true, comment: true, edit: false, share_archive: false }),
  viewer: Object.freeze({ read: true, comment: false, edit: false, share_archive: false })
});

export const PROBLEM_TITLES = Object.freeze({
  invalid_request: "Invalid request",
  idempotency_key_required: "Idempotency key required",
  identity_required: "Sign-in required",
  action_denied: "Action denied",
  grant_expired: "Grant expired",
  grant_revoked: "Grant revoked",
  not_found: "Not found",
  version_conflict: "Version conflict",
  idempotency_key_reuse: "Idempotency key reused",
  invalid_state: "Invalid state",
  resource_withdrawn: "Resource withdrawn",
  limit_exceeded: "Limit exceeded",
  validation_failed: "Validation failed",
  unsupported_scale: "Unsupported scale",
  identity_unavailable: "Identity unavailable",
  dependency_unavailable: "Dependency unavailable"
});

export class ServiceProblem extends Error {
  constructor({ status, code, title, reasons, current_revision, current_version, request_id } = {}) {
    super(`${status} ${code}`);
    this.name = "ServiceProblem";
    this.status = Number(status);
    this.code = String(code);
    this.title = title ?? PROBLEM_TITLES[code] ?? "Problem";
    this.reasons = Array.isArray(reasons) ? [...reasons] : [];
    this.currentRevision = current_revision ?? null;
    this.currentVersion = current_version ?? null;
    this.requestId = request_id ?? null;
  }
}

export function isServiceProblem(value) {
  return value instanceof ServiceProblem;
}

// Expand a route path with the call's path params. Unknown or missing params are errors.
export function expandPath(path, params = {}) {
  return path.replace(/\{([a-z_]+)\}/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null || String(value) === "") {
      throw new TypeError(`missing path parameter ${name}`);
    }
    return encodeURIComponent(String(value));
  });
}

export function bffPath(path, { app = COMPOSER_APP, service = COMPOSER_SERVICE } = {}) {
  return BFF_PATH_TEMPLATE.replace("{app}", app).replace("{service}", service).replace("{path}", path);
}

let keySequence = 0;
export function newIdempotencyKey(prefix = "hca") {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${(keySequence += 1).toString(36)}`;
  return `${prefix}-${random}`.slice(0, 128);
}

// User-facing text for a problem. 404 never discloses whether something exists.
export function problemText(problem, { role } = {}) {
  if (!isServiceProblem(problem)) return "Something went wrong. Nothing was changed.";
  switch (problem.code) {
    case "not_found": return "Not found, or you don't have access to it.";
    case "action_denied":
      if (problem.reasons.includes("source_access_denied")) return "You can't place this object: its owner hasn't allowed placement for you.";
      return role ? `Your role (${role}) doesn't allow this action.` : "You don't have permission for this action.";
    case "version_conflict": return "Someone else changed this design. Review their changes before saving yours.";
    case "unsupported_scale": return "Real size isn't available for this object because its scale is unknown. Use illustrative scale instead.";
    case "validation_failed": return problem.reasons.length ? `Check the values: ${problem.reasons.join(", ")}.` : "Check the values and try again.";
    case "resource_withdrawn": return "This source has been withdrawn.";
    case "dependency_unavailable":
    case "identity_unavailable": return "The Composer service isn't reachable right now. Your local changes are kept.";
    case "identity_required": return "Sign in to continue.";
    default: return `${problem.title}. Nothing was changed.`;
  }
}

// Object source reader (O13-shaped read used by Object ID entry).
// Table C has no route that exposes O13 to the app; see hca-notes.md "Contract discrepancies".
// The default reader is unconnected and never calls fetch.
export function createUnconnectedObjectReader() {
  return Object.freeze({
    async read() {
      throw new ServiceProblem({ status: 503, code: "dependency_unavailable" });
    }
  });
}
