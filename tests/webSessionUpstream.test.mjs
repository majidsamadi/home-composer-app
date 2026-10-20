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
  assert.equal(manifest.commit, "5b085956d3435145fe80922a53d4d304aa19f97f");
  assert.deepEqual(manifest.files.map(item => item.sourcePath), [
    "clients/web-session/web-session.mjs",
    "clients/web-session/web-session.d.mts"
  ]);
});

test("local vendored bytes match the manifest sha256, git blob and size", () => {
  const manifest = parseSourceManifest(manifestText);
  assert.deepEqual(checkLocalAgainstManifest(repoRoot, manifest), []);
  const mjs = readFileSync(new URL("../vendor/wisestay-web-session/web-session.mjs", import.meta.url));
  assert.equal(sha256Hex(mjs), "153b77584d8d10606ba183c64bb780770a0e256a85a6546343f6b08a2c975bac");
  assert.equal(gitBlobSha(mjs), "dba86fcc8b447a5b7b786af8b1645d11fb7e3bb6");
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
