import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ComposerCanonicalIdentityBridge } from "../src/application/canonicalIdentityBridge.js";
import { ComposerEntryController } from "../src/application/composerEntryController.js";
import { createDesignIntent } from "../src/domain/entryIntent.js";
import { fixtureContexts } from "../src/fixtures/reviewFixtures.js";
import { APPLICATIONS } from "../vendor/wisestay-web-session/web-session.mjs";
import { canonicalFixture } from "./helpers/canonicalWebSessionFixture.mjs";

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

test("vendored canonical WebSession bytes match the pinned producer identities", async () => {
  const mjs = fileURLToPath(new URL("../vendor/wisestay-web-session/web-session.mjs", import.meta.url));
  const dts = fileURLToPath(new URL("../vendor/wisestay-web-session/web-session.d.mts", import.meta.url));
  assert.equal(await sha256(mjs), "8c83b03365b1a3eac5259d9c32ccc52c703fe6832c3dcbbe010ec05e02ca6b91");
  assert.equal(await sha256(dts), "14a50fafea96514452d31066e6c47eecbe79cf9d9858905f87570280d6497dd9");
});

test("canonical allowlist remains unchanged and does not register Home Composer", () => {
  assert.equal(Object.hasOwn(APPLICATIONS, "home-composer"), false);
  assert.equal(Object.hasOwn(APPLICATIONS, "composer"), false);
});

test("missing or disabled canonical session creates no fake account and performs no transport", async () => {
  const controller = new ComposerEntryController();
  const intent = createDesignIntent({ designId: "D1", designRevision: "r1" });
  const missing = new ComposerCanonicalIdentityBridge({ controller });
  let result = await missing.restoreContext({ intent, availability: fixtureContexts.ready });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "canonical-session-missing");
  assert.equal(controller.state, null);

  const f = canonicalFixture({ origin: "https://not-registered-for-tenant.invalid" });
  const disabled = new ComposerCanonicalIdentityBridge({ controller, session: f.session });
  result = await disabled.restoreContext({ intent, availability: fixtureContexts.ready });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "canonical-session-disabled");
  assert.equal(f.calls.length, 0);
  assert.equal(f.navigations.length, 0);
  assert.equal(controller.state, null);
});

test("unauthenticated canonical restore remains unavailable and initializes no account", async () => {
  const f = canonicalFixture({ active: false });
  const controller = new ComposerEntryController();
  const bridge = new ComposerCanonicalIdentityBridge({ controller, session: f.session });
  const result = await bridge.restoreContext({
    intent: createDesignIntent({ designId: "D1", designRevision: "r1" }),
    availability: fixtureContexts.ready
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "canonical-session-unavailable");
  assert.equal(controller.state, null);
  assert.equal(f.navigations.length, 0);
  assert.equal(f.calls.some(call => /\/(?:start|logout)$/.test(call.path)), false);
});
