#!/usr/bin/env node
// Static site build for the buildless ESM Composer app (wave 3 plan §6.3.2).
// Copies index.html, src/**, vendor/** and the one fixture the page fetches at
// runtime (the synthetic GLB) into dist/, then writes dist/release.json:
// {repository, origin, revision, files: {path: sha256}} (OTA format; release.json
// itself is not listed). No API URL is baked in: the page only calls the
// same-origin web-session BFF route.
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RUNTIME_FIXTURES = Object.freeze(["contracts/draft/v0.4/fixtures/assets/synthetic-unit-box.glb"]);
const SOURCES = Object.freeze(["index.html", "src", "vendor", ...RUNTIME_FIXTURES]);

function walk(path, out) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`refusing symlink ${relative(ROOT, path)}`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (name === ".DS_Store") continue;
      walk(join(path, name), out);
    }
  } else if (stat.isFile()) {
    out.push(path);
  }
  return out;
}

export function revisionFrom(env) {
  const value = env.GITHUB_SHA ?? "";
  if (!value) return "local";
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("GITHUB_SHA must be a 40-character commit id");
  return value;
}

export function buildSite({ root = ROOT, out = join(root, "dist"), env = process.env } = {}) {
  const site = JSON.parse(readFileSync(join(root, "deployment", "site.json"), "utf8"));
  rmSync(out, { recursive: true, force: true });
  const files = {};
  const sources = SOURCES.flatMap(item => walk(join(root, item), []));
  for (const source of sources) {
    const path = relative(root, source).split(sep).join("/");
    const target = join(out, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    files[path] = createHash("sha256").update(readFileSync(target)).digest("hex");
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
  const release = { repository: site.repository, origin: site.origin, revision: revisionFrom(env), files: sorted };
  writeFileSync(join(out, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
  return release;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const release = buildSite();
  console.log(`dist/: ${Object.keys(release.files).length} files, revision ${release.revision}`);
}
