// Offline test for scripts/check-web-session-upstream.mjs (no network, no gh).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_PATH,
  checkLocalAgainstManifest,
  gitBlobSha,
  parseSourceManifest,
  sha256Hex
} from "../scripts/check-web-session-upstream.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const manifestText = readFileSync(new URL(`../${MANIFEST_PATH}`, import.meta.url), "utf8");

test("SOURCE.json pins the upstream web-session client to an exact commit", () => {
  const manifest = parseSourceManifest(manifestText);
  assert.equal(manifest.repository, "majidsamadi/wisestay-user-management-backend");
  assert.equal(manifest.commit, "553ac3c08973114f26271d1a751437d9203b5cd4");
  assert.deepEqual(manifest.files.map(item => item.sourcePath), [
    "clients/web-session/web-session.mjs",
    "clients/web-session/web-session.d.mts"
  ]);
});

test("local vendored bytes match the manifest sha256, git blob and size", () => {
  const manifest = parseSourceManifest(manifestText);
  assert.deepEqual(checkLocalAgainstManifest(repoRoot, manifest), []);
  const mjs = readFileSync(new URL("../vendor/wisestay-web-session/web-session.mjs", import.meta.url));
  assert.equal(sha256Hex(mjs), "8c83b03365b1a3eac5259d9c32ccc52c703fe6832c3dcbbe010ec05e02ca6b91");
  assert.equal(gitBlobSha(mjs), "625a036934bc3c9b2ad788c9811e1ec8be42b76f");
});

test("a manifest hash that differs from the local bytes is reported", () => {
  const tampered = JSON.parse(manifestText);
  tampered.vendored[0].sha256 = "0".repeat(64);
  const problems = checkLocalAgainstManifest(repoRoot, parseSourceManifest(JSON.stringify(tampered)));
  assert.deepEqual(problems, ["local sha256 differs from manifest: vendor/wisestay-web-session/web-session.mjs"]);
});

test("an incomplete manifest is rejected", () => {
  assert.throws(() => parseSourceManifest(JSON.stringify({ producer: { repository: "x", commit: "main" }, vendored: [] })));
  const noHash = JSON.parse(manifestText);
  delete noHash.vendored[1].sha256;
  assert.throws(() => parseSourceManifest(JSON.stringify(noHash)), /incomplete/);
});
