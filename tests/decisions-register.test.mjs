// Docs check for the DELEGATED-PROVISIONAL decisions register (S0.3, Q01-Q16).
// Every Qnn row must link to a heading that exists in the pinned verbatim copy
// of record WS-3D-DECISIONS-DELEGATED-2026-10-20.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const register = join(repoRoot, "docs", "DECISIONS_PENDING.md");
const RECORD_SHA256 = "5bf4fb3dc3cd787da3c262e382a09334ae0a4a5ebf05a10ab79bd9c3ccef1b2d";
const RECORD_REL = "decisions/WS-3D-DECISIONS-DELEGATED-2026-10-20.md";
const Q06_OWNER = 'Owner answer kept: ALT1 "Separate classification, reason and processing status" (Q06_RESULT_ORGANIZATION_HUMAN_20261015_073548).';
const Q07_OWNER = 'Owner answer kept: "Synthetic data + permitted unoccupied references" (Q07_FIRST_SLICE_CONTENT_HUMAN_20261014_210147).';
const QIDS = Array.from({ length: 16 }, (_, index) => `Q${String(index + 1).padStart(2, "0")}`);

// GitHub heading anchor: lowercase, drop chars outside [\w\- ], spaces -> "-".
const githubSlug = heading => heading.trim().toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-");

test("S0 decisions register: 16 DELEGATED-PROVISIONAL rows whose links resolve", () => {
  const rows = readFileSync(register, "utf8").split("\n")
    .filter(line => /^\| Q\d\d \|/.test(line))
    .map(line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()));
  assert.deepEqual(rows.map(row => row[0]), QIDS);
  const recordPath = join(dirname(register), RECORD_REL);
  assert.ok(existsSync(recordPath), recordPath);
  const raw = readFileSync(recordPath);
  assert.equal(createHash("sha256").update(raw).digest("hex"), RECORD_SHA256);
  const anchors = new Map();
  for (const match of raw.toString("utf8").matchAll(/^### (Q\d\d) ·.*$/gm)) {
    anchors.set(match[1], githubSlug(match[0].slice(4)));
  }
  assert.deepEqual([...anchors.keys()].sort(), QIDS);
  for (const [qid, , status, , record] of rows) {
    assert.ok(status.startsWith("DELEGATED-PROVISIONAL"), `${qid}: ${status}`);
    const links = [...record.matchAll(/\[§(Q\d\d)\]\(([^)#]+)#([^)]+)\)/g)];
    assert.equal(links.length, 1, `${qid}: ${record}`);
    const [, linkQ, target, anchor] = links[0];
    assert.equal(linkQ, qid);
    assert.equal(target, RECORD_REL);
    assert.ok(existsSync(join(dirname(register), target)), target);
    assert.equal(anchor, anchors.get(qid), qid);
  }
  const byId = new Map(rows.map(row => [row[0], row]));
  assert.ok(byId.get("Q06")[3].startsWith(Q06_OWNER), byId.get("Q06")[3]);
  assert.ok(byId.get("Q07")[3].startsWith(Q07_OWNER), byId.get("Q07")[3]);
  assert.equal(byId.get("Q06")[2], "DELEGATED-PROVISIONAL (extends owner answer)");
  assert.equal(byId.get("Q07")[2], "DELEGATED-PROVISIONAL (extends owner answer)");
});
