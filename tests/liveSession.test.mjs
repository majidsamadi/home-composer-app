// Wave 3 live transport, composition and sign-in panel with an injected fake
// session (no network, no real WebSession origin).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { APPLICATIONS, WebSessionError } from "../vendor/wisestay-web-session/web-session.mjs";
import { LiveMode, createComposerService, selectComposerSession } from "../src/application/liveComposition.js";
import { createWebSessionTransport } from "../src/service/composerHttpApi.js";
import { mountSessionPanel, SessionState } from "../src/presentation/sessionPanel.js";
import { accessibleName, describedBy, parseHtml } from "./helpers/domStub.mjs";

const load = relative => readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const REGISTERED = Object.freeze({ composer: "https://composer.wizestay.com" });

function json(status, body, type = "application/json") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": type } });
}

class FakeSession {
  constructor({ enabled = true, responses = [], authenticated = false } = {}) {
    this.enabled = enabled;
    this.calls = [];
    this.responses = responses;
    this.authenticated = authenticated;
    this.started = [];
    this.loggedOut = 0;
    this.restoreResult = { authenticated };
  }
  async fetch(path, init, service) {
    this.calls.push({ path, init, service });
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next ?? json(200, { items: [] });
  }
  async restore() {
    if (this.restoreResult instanceof Error) throw this.restoreResult;
    return this.restoreResult;
  }
  async start(path) {
    this.started.push(path);
    if (this.startError) throw this.startError;
  }
  async logout() {
    this.loggedOut += 1;
    this.authenticated = false;
  }
}

function live(session, onUnauthorized) {
  return createComposerService({
    selection: selectComposerSession({ applications: REGISTERED, createSession: () => session }),
    onUnauthorized
  });
}

test("the vendored pin does not register composer, so the default is disconnected", () => {
  assert.equal(Object.hasOwn(APPLICATIONS, "composer"), false);
  const selection = selectComposerSession();
  assert.equal(selection.mode, LiveMode.DISCONNECTED);
  assert.equal(selection.reason, "composer-not-registered");
  assert.equal(createComposerService().mode, LiveMode.DISCONNECTED);
});

test("live mode needs the registration and an enabled session at the exact origin", () => {
  let options;
  const session = new FakeSession();
  const selection = selectComposerSession({ applications: REGISTERED, createSession: value => { options = value; return session; } });
  assert.equal(selection.mode, LiveMode.LIVE);
  assert.equal(selection.session, session);
  assert.deepEqual(options, { application: "composer" });
  const wrongOrigin = selectComposerSession({ applications: REGISTERED, createSession: () => new FakeSession({ enabled: false }) });
  assert.deepEqual([wrongOrigin.mode, wrongOrigin.reason], [LiveMode.DISCONNECTED, "origin-not-registered"]);
  const throwing = selectComposerSession({ applications: REGISTERED, createSession: () => { throw new Error("Unregistered"); } });
  assert.deepEqual([throwing.mode, throwing.reason], [LiveMode.DISCONNECTED, "canonical-session-unavailable"]);
});

test("disconnected service never reaches a session or the network", async () => {
  const original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched += 1; throw new Error("no fetch"); };
  try {
    const service = createComposerService();
    await assert.rejects(service.api.listDesigns({}), { status: 503, code: "dependency_unavailable" });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fetched, 0);
});

test("BFF paths map to backend-relative paths for the composer service only", async () => {
  const session = new FakeSession({ responses: [json(200, { items: [] }), json(201, { design_id: "dsg_1" }), json(200, { design_id: "dsg_1" })] });
  const { api } = live(session);
  await api.listDesigns({ query: { limit: 5, cursor: "c 1" } });
  await api.createDesign({ body: { title: "Synthetic" }, idempotencyKey: "hca-synthetic-0001" });
  await api.getDesign({ params: { design_id: "dsg_1" } });
  assert.deepEqual(session.calls.map(call => [call.path, call.init.method, call.service]), [
    ["/designs?limit=5&cursor=c%201", "GET", "composer"],
    ["/designs", "POST", "composer"],
    ["/designs/dsg_1", "GET", "composer"]
  ]);
  assert.equal(session.calls[0].init.body, undefined);
  assert.equal(session.calls[1].init.body, JSON.stringify({ title: "Synthetic" }));
  assert.deepEqual(session.calls[1].init.headers, { "Content-Type": "application/json", "Idempotency-Key": "hca-synthetic-0001" });
  for (const call of session.calls) {
    assert.equal(call.init.headers.Authorization, undefined);
    assert.doesNotMatch(call.path, /^https?:|dev\.wizestay\.com/);
  }
});

test("a path outside the composer BFF route is refused without a call", async () => {
  const session = new FakeSession();
  const transport = createWebSessionTransport(session);
  const response = await transport("GET", "/api/v1/web-session/composer/api/home-scanner/x");
  assert.deepEqual([response.status, response.body.code], [400, "unsafe_api_path"]);
  assert.equal(session.calls.length, 0);
});

test("401 from the service or the session reports signed-out and rejects with a problem", async () => {
  const reports = [];
  const session = new FakeSession({ responses: [
    json(401, { status: 401, code: "identity_required" }, "application/problem+json"),
    new WebSessionError(401, "session_required")
  ] });
  const { api } = live(session, code => reports.push(code));
  await assert.rejects(api.listDesigns({}), { status: 401, code: "identity_required" });
  await assert.rejects(api.listDesigns({}), { status: 401, code: "session_required" });
  assert.deepEqual(reports, ["identity_required", "session_required"]);
});

test("CSRF, unsafe-path and network errors are surfaced by code, never as success", async () => {
  const reports = [];
  const session = new FakeSession({ responses: [
    json(403, { status: 403, code: "csrf_invalid" }, "application/problem+json"),
    new WebSessionError(400, "unsafe_api_path"),
    new TypeError("network"),
    new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    new Response("gateway", { status: 502, headers: { "Content-Type": "text/plain" } })
  ] });
  const { api } = live(session, code => reports.push(code));
  await assert.rejects(api.listDesigns({}), { status: 403, code: "csrf_invalid" });
  await assert.rejects(api.listDesigns({}), { status: 400, code: "unsafe_api_path" });
  await assert.rejects(api.listDesigns({}), { status: 503, code: "dependency_unavailable" });
  await assert.rejects(api.listDesigns({}), { status: 502, code: "invalid_service_response" });
  await assert.rejects(api.listDesigns({}), { status: 502, code: "dependency_unavailable" });
  assert.deepEqual(reports, []);
});

async function panelDoc() {
  return parseHtml(await load("../index.html"));
}

test("sign-in section is labelled; disconnected actions are disabled with a linked reason", async () => {
  const doc = await panelDoc();
  const panel = mountSessionPanel(doc, { service: createComposerService() });
  assert.equal(panel.state, SessionState.DISCONNECTED);
  const status = doc.getElementById("session-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.match(status.textContent, /^Not connected/);
  for (const id of ["session-sign-in", "session-sign-out"]) {
    const button = doc.getElementById(id);
    assert.equal(button.disabled, true, id);
    assert.ok(accessibleName(button), id);
    assert.match(describedBy(button), /^Sign-in is disabled/);
  }
  assert.equal(doc.getElementById("session-sign-in").textContent, "Sign in with WiseStay");
  panel.markSignedOut("session_required");
  assert.equal(panel.state, SessionState.DISCONNECTED);
});

test("live signed-out state starts sign-in at the current path; errors are shown", async () => {
  const doc = await panelDoc();
  const session = new FakeSession();
  const panel = mountSessionPanel(doc, { service: live(session), location: { pathname: "/designs/dsg_1", search: "?b=main", hash: "" } });
  assert.equal(await panel.refresh(), SessionState.SIGNED_OUT);
  const signIn = doc.getElementById("session-sign-in");
  assert.equal(signIn.disabled, false);
  assert.equal(doc.getElementById("session-sign-out").hidden, true);
  assert.match(doc.getElementById("session-status").textContent, /^Signed out\. Sign in with WiseStay/);
  await panel.signIn();
  assert.deepEqual(session.started, ["/designs/dsg_1?b=main"]);
  session.startError = new WebSessionError(403, "csrf_invalid");
  await panel.signIn();
  assert.equal(panel.state, SessionState.ERROR);
  assert.match(doc.getElementById("session-status").textContent, /\(csrf_invalid\)/);
  session.restoreResult = new WebSessionError(503, "session_unavailable");
  assert.equal(await panel.refresh(), SessionState.ERROR);
});

test("live signed-in state offers sign-out; a 401 returns the panel to signed-out", async () => {
  const doc = await panelDoc();
  const session = new FakeSession({ authenticated: true, responses: [json(401, { status: 401, code: "identity_required" }, "application/problem+json")] });
  let panel;
  const service = live(session, code => panel.markSignedOut(code));
  panel = mountSessionPanel(doc, { service, location: { pathname: "/" } });
  assert.equal(await panel.refresh(), SessionState.SIGNED_IN);
  assert.equal(doc.getElementById("session-sign-in").hidden, true);
  assert.equal(doc.getElementById("session-sign-out").disabled, false);
  await assert.rejects(service.api.listDesigns({}), { status: 401 });
  assert.equal(panel.state, SessionState.SIGNED_OUT);
  assert.match(doc.getElementById("session-status").textContent, /identity_required/);
  session.authenticated = true;
  session.restoreResult = { authenticated: true };
  await panel.refresh();
  await panel.signOut();
  assert.equal(session.loggedOut, 1);
  assert.equal(panel.state, SessionState.SIGNED_OUT);
});

test("app.js keeps the default composition and builds no WebSession itself", async () => {
  const source = await load("../src/app.js");
  assert.match(source, /createComposerApplication\(\)/);
  assert.match(source, /createComposerService\(/);
  assert.match(source, /mountSessionPanel\(document/);
  assert.doesNotMatch(source, /new WebSession\s*\(/);
  const composition = await load("../src/application/liveComposition.js");
  assert.doesNotMatch(composition, /https:\/\/[a-z-]+\.dev\.wizestay\.com/);
});
