// C-R3: Playwright-free accessibility check of the entry-initialization section.
// A DOM stub (tests/helpers/domStub.mjs) parses index.html and mounts the real
// presentation code; it checks roles, labels and tab order. It does not replace a
// manual screen-reader and keyboard pass, which is still outstanding (hca-notes.md).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { mountEntryInitialization } from "../src/presentation/entryInitView.js";
import { entryInitializationFixtures } from "../src/fixtures/entryInitializationFixtures.js";
import { accessibleName, createEvent, describedBy, findAll, parseHtml, tabOrder } from "./helpers/domStub.mjs";

async function mounted() {
  const html = await readFile(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
  const doc = parseHtml(html);
  const view = mountEntryInitialization(doc);
  view.render(null);
  const section = findAll(doc.body, item => item.localName === "section" && item.getAttribute("aria-labelledby") === "entry-init-title")[0];
  return { doc, view, section };
}

test("C-R3 entry-init roles: labelled region, status live region, labelled groups and facts", async () => {
  const { doc, section } = await mounted();
  assert.ok(section, "section is labelled by its heading");
  assert.equal(accessibleName(section), "Entry & design initialization review");
  const status = doc.getElementById("entry-init-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.match(status.textContent, /^No state selected · empty — No entry intent supplied$/);
  assert.equal(accessibleName(doc.getElementById("entry-init-facts")), "Entry initialization facts");
  assert.equal(accessibleName(doc.getElementById("entry-init-controls")), "Local synthetic entry-initialization states");
  const actions = doc.getElementById("entry-init-actions");
  assert.equal(actions.getAttribute("role"), "group");
  assert.equal(accessibleName(actions), "Design actions (disabled in this review)");
  // Only one live region in the section, so updates are announced once.
  assert.equal(findAll(section, item => item.hasAttribute("aria-live")).length, 1);
});

test("C-R3 entry-init labels: every button has a name; toggles expose aria-pressed; disabled actions explain why", async () => {
  const { doc, section } = await mounted();
  const buttons = findAll(section, item => item.localName === "button");
  assert.equal(buttons.length, entryInitializationFixtures.length + 3);
  for (const button of buttons) {
    assert.ok(accessibleName(button).length > 0, "button has an accessible name");
    assert.equal(button.type, "button", `${accessibleName(button)} is not a submit button`);
  }
  const fixtureButtons = buttons.filter(button => button.hasAttribute("data-entry-init-fixture"));
  assert.deepEqual(fixtureButtons.map(accessibleName), entryInitializationFixtures.map(item => item.label));
  fixtureButtons[2].click();
  assert.deepEqual(fixtureButtons.map(button => button.getAttribute("aria-pressed")), fixtureButtons.map((_, i) => String(i === 2)));
  assert.ok(doc.getElementById("entry-init-facts").children.length > 0, "facts render for the chosen state");
  for (const button of buttons.filter(item => item.hasAttribute("data-entry-init-action"))) {
    assert.equal(button.disabled, true);
    assert.match(describedBy(button), /^Open, Edit and Save are disabled: .*Current state: /);
  }
});

test("C-R3 entry-init tab order: fixture toggles in DOM order, disabled actions skipped, no positive tabindex", async () => {
  const { section } = await mounted();
  const order = tabOrder(section);
  assert.deepEqual(order.map(accessibleName), entryInitializationFixtures.map(item => item.label));
  assert.ok(findAll(section, item => Number(item.getAttribute("tabindex")) > 0).length === 0, "no positive tabindex");
  // Activating with the keyboard path (click is what Enter/Space dispatch on a button).
  order.at(-1).dispatchEvent(createEvent("click"));
  assert.equal(order.at(-1).getAttribute("aria-pressed"), "true");
});
