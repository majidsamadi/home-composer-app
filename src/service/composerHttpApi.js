// Composer HTTP client over the User Management BFF (plan X.1 / X.6).
// Status: component-tested (synthetic data only). The default composition uses the
// disconnected transport: no fetch is ever made from this module.
import {
  COMPOSER_ROUTES,
  ServiceProblem,
  bffPath,
  expandPath,
  newIdempotencyKey
} from "./composerApi.js";

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
