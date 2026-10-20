// Composer HTTP client over the User Management BFF (plan X.1 / X.6).
// Status: component-tested (synthetic data only). The default composition uses the
// disconnected transport: no global fetch is ever made from this module. The live
// transport only calls an injected canonical WebSession (wave 3 plan §6.3.1).
import {
  COMPOSER_ROUTES,
  COMPOSER_SERVICE,
  ServiceProblem,
  bffPath,
  expandPath,
  newIdempotencyKey
} from "./composerApi.js";

const PROBLEM_CODE = /^[a-z0-9_]{1,100}$/;
const JSON_TYPE = /^application\/(?:problem\+)?json(?:;|$)/i;

function problemResponse(status, code) {
  return {
    status,
    headers: { "Content-Type": "application/problem+json" },
    body: { status, code, request_id: "web-session-transport" }
  };
}

// Live transport over the canonical WebSession. The browser only calls the
// same-origin BFF route /api/v1/web-session/composer/api/composer<path>; the
// session adds the CSRF and session headers and removes Authorization/Cookie.
// A 401 (from the session or the service) is reported once through onUnauthorized
// so the page can show its signed-out state. No API host is ever built here.
export function createWebSessionTransport(session, { onUnauthorized = () => {} } = {}) {
  if (!session || typeof session.fetch !== "function") throw new TypeError("a canonical WebSession is required");
  const send = session.fetch.bind(session);
  const prefix = bffPath("");
  return async function webSessionTransport(method, path, { headers = {}, body } = {}) {
    if (typeof path !== "string" || !path.startsWith(`${prefix}/`)) return problemResponse(400, "unsafe_api_path");
    let response;
    try {
      response = await send(path.slice(prefix.length), { method, headers, ...(body === undefined ? {} : { body }) }, COMPOSER_SERVICE);
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
      const code = typeof error?.code === "string" && PROBLEM_CODE.test(error.code) ? error.code : "dependency_unavailable";
      if (status === 401) onUnauthorized(code);
      return problemResponse(status, code);
    }
    const contentType = response.headers?.get?.("content-type") ?? "";
    let parsed = null;
    if (JSON_TYPE.test(contentType)) {
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
    }
    if (response.status === 401) {
      onUnauthorized(typeof parsed?.code === "string" && PROBLEM_CODE.test(parsed.code) ? parsed.code : "session_required");
    }
    // A success without JSON (for example the SPA page from a misrouted path) is not a service answer.
    if (response.status >= 200 && response.status < 300 && response.status !== 204 && parsed === null) {
      return problemResponse(502, "invalid_service_response");
    }
    if (response.status >= 400 && (parsed === null || typeof parsed !== "object")) {
      return problemResponse(response.status, "dependency_unavailable");
    }
    return { status: response.status, headers: { "Content-Type": contentType }, body: parsed };
  };
}

// transport(method, bffPath, { headers, body }) -> Promise<{ status, headers, body }>
export function createDisconnectedTransport() {
  return async function disconnectedTransport() {
    return {
      status: 503,
      headers: { "Content-Type": "application/problem+json" },
      body: {
        type: "https://wizestay.com/problems/dependency_unavailable",
        title: "Dependency unavailable",
        status: 503,
        code: "dependency_unavailable",
        request_id: "local-disconnected"
      }
    };
  };
}

function queryString(query = {}) {
  const entries = Object.entries(query).filter(([, value]) => value !== undefined && value !== null);
  if (!entries.length) return "";
  return `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}`;
}

function toProblem(response) {
  const body = response.body && typeof response.body === "object" ? response.body : {};
  return new ServiceProblem({
    status: response.status,
    code: body.code ?? "dependency_unavailable",
    title: body.title,
    reasons: body.reasons,
    current_revision: body.current_revision,
    current_version: body.current_version,
    request_id: body.request_id
  });
}

export function createComposerHttpApi({ transport = createDisconnectedTransport(), idempotencyKey = newIdempotencyKey } = {}) {
  const api = {};
  for (const route of COMPOSER_ROUTES) {
    api[route.operation] = async ({ params = {}, query = {}, body = null, idempotencyKey: key } = {}) => {
      const path = `${bffPath(expandPath(route.path, params))}${queryString(query)}`;
      // Only BFF pass-through request headers are ever set (Content-Type, Idempotency-Key).
      const headers = {};
      const hasBody = route.method === "POST" || route.method === "PATCH";
      if (hasBody) headers["Content-Type"] = "application/json";
      if (route.idempotency === "required") headers["Idempotency-Key"] = key ?? idempotencyKey();
      let response;
      try {
        response = await transport(route.method, path, { headers, body: hasBody ? JSON.stringify(body ?? {}) : undefined });
      } catch {
        throw new ServiceProblem({ status: 503, code: "dependency_unavailable" });
      }
      if (!response || response.status < 200 || response.status >= 300) throw toProblem(response ?? { status: 503 });
      return typeof response.body === "string" ? JSON.parse(response.body) : response.body;
    };
  }
  return Object.freeze(api);
}
