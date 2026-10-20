import {
  APPLICATIONS,
  CONTRACT,
  WebSession
} from "../../vendor/wisestay-web-session/web-session.mjs";

export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
const CSRF = "c".repeat(64);

const reply = value => new Response(JSON.stringify(value), {
  headers: { "Content-Type": "application/json" }
});

export function canonicalFixture({
  active = true,
  userId = USER_A,
  holdBootstrap = false,
  origin = APPLICATIONS.tenant
} = {}) {
  const calls = [];
  const navigations = [];
  const store = new Map();
  let currentActive = active;
  let currentUser = userId;
  let bootstrapRelease;
  let bootstrapStartedResolve;
  const bootstrapStarted = new Promise(resolve => { bootstrapStartedResolve = resolve; });
  let bootstrapGate = holdBootstrap ? new Promise(resolve => { bootstrapRelease = resolve; }) : null;

  const transport = async (path, init) => {
    calls.push({ path, init });
    if (path.endsWith("/readiness")) return reply({ contract: CONTRACT, ready: true });
    if (path.endsWith("/bootstrap")) {
      bootstrapStartedResolve?.();
      if (bootstrapGate) await bootstrapGate;
      return reply(currentActive ? {
        contract: CONTRACT,
        csrf: CSRF,
        authenticated: true,
        user_id: currentUser,
        identity_contract: "wisestay.identity.v1",
        expires_at: Math.floor(Date.now() / 1000) + 3600
      } : { contract: CONTRACT, csrf: CSRF, authenticated: false });
    }
    throw new Error(`unexpected canonical call: ${path}`);
  };

  const session = new WebSession({
    application: "tenant",
    origin,
    fetch: transport,
    navigate: url => navigations.push(url),
    locks: { request: async (_, work) => work() },
    storage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: key => store.delete(key)
    }
  });

  return {
    session,
    calls,
    navigations,
    bootstrapStarted,
    releaseBootstrap: () => { bootstrapGate = null; bootstrapRelease?.(); },
    setUser: value => { currentUser = value; },
    setActive: value => { currentActive = value; }
  };
}
