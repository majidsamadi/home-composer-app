// "WiseStay sign-in" section of index.html (wave 3 plan §6.3.1).
// Disconnected mode keeps both actions visibly disabled with a linked reason. Live
// mode restores the canonical session, shows a signed-out state with "Sign in with
// WiseStay" (session.start(currentPath)) and a signed-in state with "Sign out".
// Session and CSRF errors are surfaced by code; nothing is retried silently.

export const SessionState = Object.freeze({
  DISCONNECTED: "disconnected",
  CHECKING: "checking",
  SIGNED_IN: "signed-in",
  SIGNED_OUT: "signed-out",
  ERROR: "error"
});

const SAFE_CODE = /^[a-z0-9_]{1,100}$/;

function errorCode(error) {
  return typeof error?.code === "string" && SAFE_CODE.test(error.code) ? error.code : "session_unavailable";
}

export function sessionStatusText(state, code = "") {
  switch (state) {
    case SessionState.DISCONNECTED:
      return "Not connected: Composer is not yet registered with WiseStay sign-in. The sections below stay synthetic.";
    case SessionState.CHECKING:
      return "Checking your WiseStay sign-in…";
    case SessionState.SIGNED_IN:
      return "Signed in with WiseStay.";
    case SessionState.SIGNED_OUT:
      return code
        ? `Signed out (${code}). Sign in with WiseStay to continue.`
        : "Signed out. Sign in with WiseStay to use your Composer designs.";
    default:
      return `WiseStay sign-in could not be verified (${code || "session_unavailable"}). Nothing was changed. Try again.`;
  }
}

function currentPath(location) {
  if (!location || typeof location.pathname !== "string") return "/";
  return `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
}

export function mountSessionPanel(doc, { service, location = globalThis.location } = {}) {
  const byId = id => doc.getElementById(id);
  const status = byId("session-status");
  const signIn = byId("session-sign-in");
  const signOut = byId("session-sign-out");
  const reason = byId("session-reason");
  const session = service?.mode === "live" ? service.session : null;
  let state = session ? SessionState.CHECKING : SessionState.DISCONNECTED;
  let code = "";
  let busy = false;

  function render() {
    status.textContent = sessionStatusText(state, code);
    status.dataset.state = state;
    const live = Boolean(session);
    signIn.hidden = state === SessionState.SIGNED_IN;
    signIn.disabled = !live || busy || state === SessionState.CHECKING;
    signOut.hidden = live && state !== SessionState.SIGNED_IN;
    signOut.disabled = !live || busy || state !== SessionState.SIGNED_IN;
    reason.hidden = live;
    reason.textContent = live ? "" : "Sign-in is disabled: this build is not registered with the WiseStay session service.";
  }

  function set(next, nextCode = "") {
    state = next;
    code = nextCode;
    render();
  }

  async function refresh() {
    if (!session) return state;
    set(SessionState.CHECKING);
    try {
      const receipt = await session.restore(true);
      set(receipt?.authenticated === true && session.authenticated === true ? SessionState.SIGNED_IN : SessionState.SIGNED_OUT);
    } catch (error) {
      set(SessionState.ERROR, errorCode(error));
    }
    return state;
  }

  async function startSignIn() {
    if (!session || busy) return;
    busy = true;
    render();
    try {
      await session.start(currentPath(location));
    } catch (error) {
      code = errorCode(error);
      state = SessionState.ERROR;
    } finally {
      busy = false;
      render();
    }
  }

  async function startSignOut() {
    if (!session || busy) return;
    busy = true;
    render();
    try {
      await session.logout();
      state = SessionState.SIGNED_OUT;
      code = "";
    } catch (error) {
      // The local session is already cleared by logout(); report the server outcome.
      state = SessionState.ERROR;
      code = errorCode(error);
    } finally {
      busy = false;
      render();
    }
  }

  signIn.addEventListener("click", startSignIn);
  signOut.addEventListener("click", startSignOut);
  render();
  return Object.freeze({
    get state() {
      return state;
    },
    get code() {
      return code;
    },
    refresh,
    signIn: startSignIn,
    signOut: startSignOut,
    markSignedOut(nextCode = "session_required") {
      if (!session) return;
      set(SessionState.SIGNED_OUT, SAFE_CODE.test(nextCode) ? nextCode : "session_required");
    }
  });
}
