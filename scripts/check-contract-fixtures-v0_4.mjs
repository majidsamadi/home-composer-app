#!/usr/bin/env node
// Sync check for the v0.4 DRAFT/SYNTHETIC contract fixtures (P03, S0.2).
// Recomputes every SHA256SUMS entry, rejects missing/extra fixture files and
// pins sha256(SHA256SUMS) to SET_DIGEST so copies in other repos cannot drift
// silently. Byte-identical in ARC, HSA, OSA, HCA and WFA. Node builtins only.
// Component-level integrity check only: it does not freeze or accept the drafts.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SET_DIGEST = "96a8e8c01757e8bdbfde6a21c46faaf13a5fb180d6a3750fb2ab0988df1f7f9f";
export const CONTRACT_DIR = join("contracts", "draft", "v0.4");
export const EXPECTED_FILE_COUNT = 17;
const CHECKED_SUBDIRS = ["fixtures"];
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
  const entries = text.slice(0, -1).split("\n").map((line, index) => {
    const match = LINE.exec(line);
    if (!match) throw new Error(`SHA256SUMS line ${index + 1} is malformed`);
    if (match[2].split("/").some(part => part === ".." || part === "") || match[2].includes("\\")) {
      throw new Error(`SHA256SUMS line ${index + 1} has an unsafe path`);
    }
    return { sha256: match[1], path: match[2] };
  });
  const paths = entries.map(entry => entry.path);
  const sorted = [...paths].sort();
  if (paths.some((path, index) => path !== sorted[index]) || new Set(paths).size !== paths.length) {
    throw new Error("SHA256SUMS paths must be unique and in sorted order");
  }
  return entries;
}

// Returns { files, setDigest, errors, entries }. errors is empty when the copy is intact.
export function verifyContractFixtures(repoRoot) {
  const base = resolve(repoRoot, CONTRACT_DIR);
  const errors = [];
  let sumsBytes;
  try {
    sumsBytes = readFileSync(join(base, "SHA256SUMS"));
  } catch {
    return { files: 0, setDigest: null, errors: [`${base}: SHA256SUMS missing`], entries: [] };
  }
  const setDigest = sha256(sumsBytes);
  if (setDigest !== SET_DIGEST) errors.push(`set digest ${setDigest} != pinned ${SET_DIGEST}`);
  let entries = [];
  try {
    entries = parseSums(sumsBytes.toString("utf8"));
  } catch (error) {
    errors.push(error.message);
  }
  if (entries.length && entries.length !== EXPECTED_FILE_COUNT) {
    errors.push(`expected ${EXPECTED_FILE_COUNT} listed files, found ${entries.length}`);
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
  return { files: entries.length, setDigest, errors, entries };
}

// Verify the copy, then return the parsed JSON fixture at fixtures/<rel>.
export function loadFixture(repoRoot, rel) {
  const result = verifyContractFixtures(repoRoot);
  if (result.errors.length) throw new Error(`contract fixtures v0.4 drift: ${result.errors.join("; ")}`);
  return JSON.parse(readFileSync(join(resolve(repoRoot, CONTRACT_DIR), "fixtures", ...rel.split("/")), "utf8"));
}

function main(argv) {
  const here = resolve(fileURLToPath(new URL("..", import.meta.url)));
  let root = here;
  const rootAt = argv.indexOf("--root");
  if (rootAt >= 0) {
    if (!argv[rootAt + 1] || argv[rootAt + 1].startsWith("--")) {
      console.error("--root needs a repo root");
      return 1;
    }
    root = resolve(argv[rootAt + 1]);
  }
  const others = [];
  const compareAt = argv.indexOf("--compare");
  if (compareAt >= 0) {
    others.push(...argv.slice(compareAt + 1).filter(item => !item.startsWith("--")).map(item => resolve(item)));
    if (others.length === 0) {
      console.error("--compare needs at least one repo root");
      return 1;
    }
  }
  let failed = false;
  let own = null;
  for (const candidate of [root, ...others]) {
    try {
      statSync(candidate);
    } catch {
      console.error(`contract fixtures v0.4: FAILED: ${candidate}: not found`);
      failed = true;
      continue;
    }
    const result = verifyContractFixtures(candidate);
    if (result.errors.length) {
      failed = true;
      for (const error of result.errors) console.error(`contract fixtures v0.4: FAILED: ${candidate}: ${error}`);
      continue;
    }
    if (own === null) {
      own = result;
    } else if (JSON.stringify(result.entries) !== JSON.stringify(own.entries)) {
      failed = true;
      console.error(`contract fixtures v0.4: FAILED: copy under ${candidate} differs from ${root}`);
    }
  }
  if (failed || own === null) return 1;
  let message = `contract fixtures v0.4: ${own.files} files verified, set ${SET_DIGEST.slice(0, 8)}…`;
  if (others.length) message += `, compared ${others.length} copies`;
  console.log(message);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
