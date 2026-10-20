// Wave 3 static site build: dist/ holds the page, its modules and release.json.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite, revisionFrom, RUNTIME_FIXTURES } from "../scripts/build-site.mjs";

test("build copies the page, sources, vendor client and runtime GLB with hashes", () => {
  const out = mkdtempSync(join(tmpdir(), "hca-site-"));
  try {
    const release = buildSite({ out, env: { GITHUB_SHA: "a".repeat(40) } });
    assert.equal(release.repository, "majidsamadi/home-composer-app");
    assert.equal(release.origin, "https://composer.wizestay.com");
    assert.equal(release.revision, "a".repeat(40));
    const paths = Object.keys(release.files);
    assert.deepEqual(paths, [...paths].sort());
    for (const required of ["index.html", "src/app.js", "src/service/composerHttpApi.js",
      "vendor/wisestay-web-session/web-session.mjs", ...RUNTIME_FIXTURES]) {
      assert.ok(paths.includes(required), required);
    }
    assert.ok(!paths.includes("release.json"));
    assert.ok(paths.every(path => /^(index\.html|src\/|vendor\/|contracts\/draft\/v0\.4\/fixtures\/assets\/synthetic-unit-box\.glb$)/.test(path)), "no tests, docs or deployment files");
    for (const [path, digest] of Object.entries(release.files)) {
      assert.equal(createHash("sha256").update(readFileSync(join(out, path))).digest("hex"), digest, path);
    }
    assert.deepEqual(JSON.parse(readFileSync(join(out, "release.json"), "utf8")), release);
    // No API host is baked into the bundle; the page only uses the BFF path template.
    for (const path of paths.filter(item => /\.(m?js|html)$/.test(item))) {
      const text = readFileSync(join(out, path), "utf8");
      assert.doesNotMatch(text, /composer\.dev\.wizestay\.com|home-scanner\.dev\.wizestay\.com|object-scanner\.dev\.wizestay\.com|execute-api/, path);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("revision is the commit id in CI and 'local' otherwise", () => {
  assert.equal(revisionFrom({}), "local");
  assert.equal(revisionFrom({ GITHUB_SHA: "b".repeat(40) }), "b".repeat(40));
  assert.throws(() => revisionFrom({ GITHUB_SHA: "main" }), /40-character/);
});
