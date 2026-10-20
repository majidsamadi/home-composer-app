#!/usr/bin/env node
// Pinned-source check for the vendored canonical WebSession client.
// Reads vendor/wisestay-web-session/SOURCE.json and compares, read-only via
// `gh api`, the upstream bytes of wisestay-user-management-backend at the pinned
// commit with the local vendored bytes and the manifest hashes. It then reports,
// for information only, whether upstream `main` has the same bytes.
// Exit codes: 0 pin matches; 1 pin/local mismatch; 2 `gh` unavailable or unauthenticated.
// Not run in CI: the upstream repository is private and CI has no token.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MANIFEST_PATH = join("vendor", "wisestay-web-session", "SOURCE.json");

export const sha256Hex = bytes => createHash("sha256").update(bytes).digest("hex");

// Git blob id (sha1 over "blob <size>\0<bytes>"), comparable to producer_git_blob.
export const gitBlobSha = bytes =>
  createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex");

export function parseSourceManifest(text) {
  const manifest = JSON.parse(text);
  const producer = manifest?.producer;
  if (!producer || typeof producer.repository !== "string" || !/^[0-9a-f]{40}$/.test(producer.commit ?? "")) {
    throw new Error("SOURCE.json producer repository/commit is required");
  }
  if (!Array.isArray(manifest.vendored) || manifest.vendored.length === 0) {
    throw new Error("SOURCE.json vendored entries are required");
  }
  return Object.freeze({
    repository: producer.repository,
    commit: producer.commit,
    files: Object.freeze(manifest.vendored.map(item => {
      if (!/^[0-9a-f]{64}$/.test(item.sha256 ?? "") || !item.source_path || !item.target_path) {
        throw new Error("SOURCE.json vendored entry is incomplete");
      }
      return Object.freeze({
        sourcePath: item.source_path,
        targetPath: item.target_path,
        sha256: item.sha256,
        gitBlob: item.producer_git_blob ?? null,
        bytes: item.bytes ?? null
      });
    }))
  });
}

// Offline: compare local vendored bytes with the manifest. Returns a list of problems.
export function checkLocalAgainstManifest(repoRoot, manifest) {
  const problems = [];
  for (const file of manifest.files) {
    let bytes;
    try {
      bytes = readFileSync(join(repoRoot, file.targetPath));
    } catch {
      problems.push(`missing local ${file.targetPath}`);
      continue;
    }
    if (sha256Hex(bytes) !== file.sha256) problems.push(`local sha256 differs from manifest: ${file.targetPath}`);
    if (file.gitBlob && gitBlobSha(bytes) !== file.gitBlob) problems.push(`local git blob differs from manifest: ${file.targetPath}`);
    if (file.bytes !== null && bytes.length !== file.bytes) problems.push(`local size differs from manifest: ${file.targetPath}`);
  }
  return problems;
}

function ghContents(repository, path, ref) {
  const out = execFileSync("gh", ["api", `repos/${repository}/contents/${path}?ref=${encodeURIComponent(ref)}`, "--jq", ".content"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return Buffer.from(out.replace(/\s+/g, ""), "base64");
}

function ghAvailable() {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const manifest = parseSourceManifest(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  const local = checkLocalAgainstManifest(root, manifest);
  if (local.length) {
    for (const problem of local) console.error(problem);
    return 1;
  }
  if (!ghAvailable()) {
    console.error("gh CLI is unavailable or unauthenticated; upstream pin not checked");
    return 2;
  }
  let failed = false;
  for (const file of manifest.files) {
    let pinned;
    try {
      pinned = ghContents(manifest.repository, file.sourcePath, manifest.commit);
    } catch (error) {
      console.error(`gh api failed for ${file.sourcePath}@${manifest.commit}: ${String(error.stderr || error.message).trim()}`);
      return 2;
    }
    const pinnedSha = sha256Hex(pinned);
    const localSha = sha256Hex(readFileSync(join(root, file.targetPath)));
    if (pinnedSha !== file.sha256 || pinnedSha !== localSha) {
      console.error(`PIN MISMATCH ${file.sourcePath}: upstream@pin ${pinnedSha}, manifest ${file.sha256}, local ${localSha}`);
      failed = true;
      continue;
    }
    console.log(`pin matches ${file.sourcePath}@${manifest.commit.slice(0, 12)} sha256 ${pinnedSha.slice(0, 12)}…`);
    try {
      const mainSha = sha256Hex(ghContents(manifest.repository, file.sourcePath, "main"));
      console.log(mainSha === pinnedSha
        ? `  info: upstream main has the same bytes`
        : `  info: upstream main differs (sha256 ${mainSha.slice(0, 12)}…); pin kept`);
    } catch {
      console.log("  info: upstream main could not be read");
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
