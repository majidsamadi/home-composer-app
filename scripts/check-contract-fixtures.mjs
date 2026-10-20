#!/usr/bin/env node
// Sync check for the B-RFX v0.3 DRAFT/SYNTHETIC contract fixtures (P03).
// Recomputes every SHA256SUMS entry, rejects missing/extra fixture files and
// pins sha256(SHA256SUMS) to SET_DIGEST so copies in other repos cannot drift
// silently. Node builtins only.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SET_DIGEST = "945c37d59266ec214717eb76b92ed2170f56bf1f756936d7a393bf7554d58ba0";
export const CONTRACT_DIR = join("contracts", "draft", "v0.3");
const CHECKED_SUBDIRS = ["fixtures", "corrections"];
const LINE = /^([0-9a-f]{64}) {2}([^\s].*)$/;

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function listFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

export function parseSums(text) {
  if (text.includes("\r")) throw new Error("SHA256SUMS must use LF line endings");
  if (!text.endsWith("\n") || text.endsWith("\n\n")) {
    throw new Error("SHA256SUMS must end with exactly one newline");
  }
  return text.slice(0, -1).split("\n").map((line, index) => {
    const match = LINE.exec(line);
    if (!match) throw new Error(`SHA256SUMS line ${index + 1} is malformed`);
    if (match[2].split("/").some(part => part === ".." || part === "")) {
      throw new Error(`SHA256SUMS line ${index + 1} has an unsafe path`);
    }
    return { sha256: match[1], path: match[2] };
  });
}

// Returns { files, setDigest, errors }. errors is empty when the copy is intact.
export function verifyContractFixtures(repoRoot) {
  const base = resolve(repoRoot, CONTRACT_DIR);
  const errors = [];
  let sumsBytes;
  try {
    sumsBytes = readFileSync(join(base, "SHA256SUMS"));
  } catch {
    return { files: 0, setDigest: null, errors: [`${base}: SHA256SUMS missing`] };
  }
  const setDigest = sha256(sumsBytes);
  if (setDigest !== SET_DIGEST) errors.push(`set digest ${setDigest} != pinned ${SET_DIGEST}`);
  let entries = [];
  try {
    entries = parseSums(sumsBytes.toString("utf8"));
  } catch (error) {
    errors.push(error.message);
  }
  const listed = new Set();
  for (const entry of entries) {
    listed.add(entry.path);
    let bytes;
    try {
      bytes = readFileSync(join(base, ...entry.path.split("/")));
    } catch {
      errors.push(`missing: ${entry.path}`);
      continue;
    }
    if (sha256(bytes) !== entry.sha256) errors.push(`checksum mismatch: ${entry.path}`);
  }
  for (const sub of CHECKED_SUBDIRS) {
    for (const file of listFiles(join(base, sub))) {
      const rel = relative(base, file).split(sep).join("/");
      if (!listed.has(rel)) errors.push(`extra file not in SHA256SUMS: ${rel}`);
    }
  }
  return { files: entries.length, setDigest, errors };
}

function main(argv) {
  const here = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const roots = [here];
  const compareAt = argv.indexOf("--compare");
  if (compareAt >= 0) {
    const others = argv.slice(compareAt + 1);
    if (others.length === 0) {
      console.error("--compare needs at least one repo root");
      return 1;
    }
    roots.push(...others.map(item => resolve(item)));
  }
  let failed = false;
  let files = 0;
  for (const root of roots) {
    try {
      statSync(root);
    } catch {
      console.error(`${root}: not found`);
      failed = true;
      continue;
    }
    const result = verifyContractFixtures(root);
    if (result.errors.length) {
      failed = true;
      for (const error of result.errors) console.error(`${root}: ${error}`);
    }
    files = result.files;
  }
  if (failed) return 1;
  let message = `contract fixtures v0.3: ${files} files verified, set ${SET_DIGEST.slice(0, 8)}…`;
  if (roots.length > 1) message += ` (compared ${roots.length} copies)`;
  console.log(message);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
