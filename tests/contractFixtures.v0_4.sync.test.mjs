// Sync and tamper checks for the v0.4 DRAFT/SYNTHETIC contract fixture copy (P03, S0.2).
// Component-level only: these drafts are not frozen or accepted.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_DIR,
  EXPECTED_FILE_COUNT,
  SET_DIGEST,
  loadFixture,
  verifyContractFixtures
} from "../scripts/check-contract-fixtures-v0_4.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("../scripts/check-contract-fixtures-v0_4.mjs", import.meta.url));
const SIBLINGS = [
  "three-dimension-view-arcore", "three-dimension-view", "three-dimension-view-arcore-backend",
  "three-dimension-object-backend", "three-dimension-object-app", "home-composer-backend",
  "home-composer-app", "where-can-find-this-backend", "where-can-find-this-app"
];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function tempCopy(t) {
  const root = mkdtempSync(join(tmpdir(), "v04-contracts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(repoRoot, CONTRACT_DIR), join(root, CONTRACT_DIR), { recursive: true });
  return root;
}

function run(args) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [script, ...args], { encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    return { status: error.status, stdout: String(error.stdout), stderr: String(error.stderr) };
  }
}

test("P03 v0.4 repo copy matches SHA256SUMS and the pinned set digest", () => {
  const result = verifyContractFixtures(repoRoot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.files, 17);
  assert.equal(EXPECTED_FILE_COUNT, 17);
  assert.equal(result.setDigest, SET_DIGEST);
  const out = run([]);
  assert.equal(out.status, 0);
  assert.match(out.stdout, new RegExp(`contract fixtures v0\\.4: 17 files verified, set ${SET_DIGEST.slice(0, 8)}…`));
  const facts = loadFixture(repoRoot, "assets/synthetic-unit-box.facts.json");
  const glb = readFileSync(join(repoRoot, CONTRACT_DIR, "fixtures/assets/synthetic-unit-box.glb"));
  assert.equal(facts.sha256, sha256(glb));
  assert.equal(loadFixture(repoRoot, "api/finder.v0.4.json").status, "DRAFT_SYNTHETIC_NOT_FROZEN");
});

test("P03 v0.4 changed fixture byte fails", t => {
  const root = tempCopy(t);
  appendFileSync(join(root, CONTRACT_DIR, "fixtures/api/composer.v0.4.json"), " ");
  assert.deepEqual(verifyContractFixtures(root).errors, ["checksum mismatch: fixtures/api/composer.v0.4.json"]);
  const out = run(["--root", root]);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /FAILED/);
});

test("P03 v0.4 missing file fails", t => {
  const root = tempCopy(t);
  rmSync(join(root, CONTRACT_DIR, "fixtures/ports/identity.v0.4.json"));
  assert.ok(verifyContractFixtures(root).errors.includes("missing: fixtures/ports/identity.v0.4.json"));
});

test("P03 v0.4 unlisted extra file fails", t => {
  const root = tempCopy(t);
  writeFileSync(join(root, CONTRACT_DIR, "fixtures/api/.DS_Store"), "x");
  assert.ok(verifyContractFixtures(root).errors.includes("extra file not in SHA256SUMS: fixtures/api/.DS_Store"));
});

test("P03 v0.4 coordinated SHA256SUMS rewrite still fails the set digest", t => {
  const root = tempCopy(t);
  const base = join(root, CONTRACT_DIR);
  const rel = "fixtures/common/policy-limits.v0.4.json";
  const before = sha256(readFileSync(join(base, rel)));
  appendFileSync(join(base, rel), "\n");
  const after = sha256(readFileSync(join(base, rel)));
  const sums = join(base, "SHA256SUMS");
  writeFileSync(sums, readFileSync(sums, "utf8").replace(before, after));
  const result = verifyContractFixtures(root);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^set digest /);
});

test("P03 v0.4 --compare reports copies and detects drift", t => {
  const good = tempCopy(t);
  const bad = tempCopy(t);
  appendFileSync(join(bad, CONTRACT_DIR, "fixtures/viewer/scanner-lifecycle.v0.4.json"), " ");
  const ok = run(["--compare", good]);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /, compared 1 copies/);
  const drift = run(["--compare", good, bad]);
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /checksum mismatch: fixtures\/viewer\/scanner-lifecycle\.v0\.4\.json/);
});

test("P03 v0.4 local sibling clones match when present", t => {
  const parent = dirname(repoRoot.replace(/[\\/]$/, ""));
  const siblings = SIBLINGS.map(name => join(parent, name))
    .filter(path => path.replace(/[\\/]$/, "") !== repoRoot.replace(/[\\/]$/, "") && existsSync(join(path, CONTRACT_DIR)));
  if (!siblings.length) {
    t.skip("no sibling 3D clone with contracts/draft/v0.4 next to this checkout");
    return;
  }
  const out = run(["--compare", ...siblings]);
  assert.equal(out.status, 0, out.stderr);
});
