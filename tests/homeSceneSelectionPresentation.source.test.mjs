import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const load = relative => readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("home/scene source exposes labelled status, list and review regions", async () => {
  const html = await load("../index.html");
  assert.match(html, /aria-labelledby="scene-title"/);
  assert.match(html, /id="scene-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="scene-list"[^>]*aria-label="Home and scene version rows"/);
  assert.match(html, /id="scene-review"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /Illustrative non-property sandbox|Local synthetic home\/scene fixtures/);
});

test("actual application source keeps scene composition disconnected until a fixture or injected adapter is supplied", async () => {
  const source = await load("../src/app.js");
  assert.match(source, /createComposerApplication\(\)/);
  assert.match(source, /sceneController\.invalidateContext\("scene-adapter-not-connected"\)/);
  assert.doesNotMatch(source, /new WebSession\s*\(/);
});
