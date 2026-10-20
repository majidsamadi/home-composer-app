import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const load = relative => readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("design-library source exposes labelled status, list and review regions", async () => {
  const html = await load("../index.html");
  assert.match(html, /aria-labelledby="library-title"/);
  assert.match(html, /id="library-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="library-list"[^>]*aria-label="Design library rows"/);
  assert.match(html, /id="library-review"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /Local synthetic design-library fixtures · not an actual user library/);
});

test("actual application composition starts with no canonical session and no library adapter", async () => {
  const source = await load("../src/app.js");
  assert.match(source, /createComposerApplication\(\)/);
  assert.doesNotMatch(source, /new WebSession\s*\(/);
  assert.match(source, /libraryController\.invalidateContext\("library-adapter-not-connected"\)/);
});
