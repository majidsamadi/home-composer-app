import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_DIR,
  SET_DIGEST,
  verifyContractFixtures
} from "../scripts/check-contract-fixtures.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = fileURLToPath(new URL("../scripts/check-contract-fixtures.mjs", import.meta.url));

function tempCopy() {
  const root = mkdtempSync(join(tmpdir(), "hca-contracts-"));
  cpSync(join(repoRoot, CONTRACT_DIR), join(root, CONTRACT_DIR), { recursive: true });
  return root;
}

test("repo copy of B-RFX v0.3 draft fixtures matches SHA256SUMS and the pinned set digest", () => {
  const result = verifyContractFixtures(repoRoot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.files, 12);
  assert.equal(result.setDigest, SET_DIGEST);
  const out = execFileSync(process.execPath, [script], { encoding: "utf8" });
  assert.match(out, /contract fixtures v0\.3: 12 files verified, set 945c37d5…/);
});

test("tampered fixture bytes in a temp copy fail the sync check", () => {
  const root = tempCopy();
  try {
    appendFileSync(join(root, CONTRACT_DIR, "fixtures/original/B-RFX-01_identity-occurrence.json"), " ");
    const result = verifyContractFixtures(root);
    assert.deepEqual(result.errors, ["checksum mismatch: fixtures/original/B-RFX-01_identity-occurrence.json"]);
    assert.throws(
      () => execFileSync(process.execPath, [script, "--compare", root], { stdio: "pipe" }),
      error => error.status === 1
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing, extra and re-hashed copies fail the sync check", () => {
  const root = tempCopy();
  const base = join(root, CONTRACT_DIR);
  try {
    rmSync(join(base, "corrections/DELTA_records_v0.3.json"));
    writeFileSync(join(base, "fixtures/original/B-RFX-09_extra.json"), "{}\n");
    let result = verifyContractFixtures(root);
    assert.ok(result.errors.includes("missing: corrections/DELTA_records_v0.3.json"));
    assert.ok(result.errors.includes("extra file not in SHA256SUMS: fixtures/original/B-RFX-09_extra.json"));
    // Editing SHA256SUMS to "bless" a changed file still fails on the pinned set digest.
    appendFileSync(join(base, "SHA256SUMS"), `${"0".repeat(64)}  fixtures/original/B-RFX-09_extra.json\n`);
    result = verifyContractFixtures(root);
    assert.ok(result.errors.some(error => error.startsWith("set digest ")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--compare against an intact copy reports the number of copies", () => {
  const root = tempCopy();
  try {
    const out = execFileSync(process.execPath, [script, "--compare", root], { encoding: "utf8" });
    assert.match(out, /12 files verified, set 945c37d5… \(compared 2 copies\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
