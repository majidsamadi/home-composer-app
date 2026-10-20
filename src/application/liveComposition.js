// Live-or-disconnected Composer service selection (wave 3 plan §6.3.1).
// Live mode needs both: the vendored canonical client registers "composer", and a
// WebSession built for it is enabled (the page runs at exactly that origin).
// Otherwise the page keeps today's disconnected transport. The wave 3 pin
// registers "composer", so live mode is reachable only at
// https://composer.wizestay.com.
import { APPLICATIONS, WebSession } from "../../vendor/wisestay-web-session/web-session.mjs";
import { COMPOSER_APP } from "../service/composerApi.js";
import {
  createComposerHttpApi,
  createDisconnectedTransport,
  createWebSessionTransport
} from "../service/composerHttpApi.js";

export const LiveMode = Object.freeze({ LIVE: "live", DISCONNECTED: "disconnected" });

function disconnected(reason) {
  return Object.freeze({ mode: LiveMode.DISCONNECTED, reason, session: null });
}

export function selectComposerSession({
  applications = APPLICATIONS,
  createSession = options => new WebSession(options)
} = {}) {
  if (!applications || !Object.hasOwn(applications, COMPOSER_APP)) return disconnected("composer-not-registered");
  let session;
  try {
    session = createSession({ application: COMPOSER_APP });
  } catch {
    return disconnected("canonical-session-unavailable");
  }
  if (session?.enabled !== true) return disconnected("origin-not-registered");
  return Object.freeze({ mode: LiveMode.LIVE, reason: null, session });
}

export function createComposerService({ selection = selectComposerSession(), onUnauthorized = () => {} } = {}) {
  const transport = selection.mode === LiveMode.LIVE
    ? createWebSessionTransport(selection.session, { onUnauthorized })
    : createDisconnectedTransport();
  return Object.freeze({
    mode: selection.mode,
    reason: selection.reason,
    session: selection.session,
    api: createComposerHttpApi({ transport })
  });
}
