import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  EntryInitializationStatus,
  NOT_SUPPLIED,
  describeEntryInitialization
} from "../src/application/entryInitializationPresentation.js";
import { entryInitializationFixtures } from "../src/fixtures/entryInitializationFixtures.js";

const load = relative => readFile(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const byId = id => entryInitializationFixtures.find(item => item.id === id);
const rowValue = (description, label, section = "entry") =>
  description.rows.find(item => item.label === label && item.section === section)?.value;

for (const fixture of entryInitializationFixtures) {
  test(`entry initialization fixture ${fixture.id} (${fixture.caseIds.join(", ")}) → ${fixture.expectedStatus}`, () => {
    const description = describeEntryInitialization(fixture.input);
    assert.equal(description.status, fixture.expectedStatus);
    assert.equal(description.actionsDisabled, true);
    assert.equal(typeof description.headline, "string");
    assert.ok(description.headline.length > 0);
    assert.ok(description.textAlternative.startsWith(`${description.headline}.`));
    assert.match(description.textAlternative, /All real actions are disabled\.$/);
    for (const item of description.rows) {
      assert.ok(item.label.length > 0);
      assert.ok(description.textAlternative.includes(`${item.label}: ${item.value}`), `${item.label} in text alternative`);
      if (!item.supplied) assert.equal(item.value, "Not supplied");
    }
    assert.equal(description.source, fixture.input.source);
    assert.ok(Object.isFrozen(description) && Object.isFrozen(description.rows));
  });
}

test("the seven authored E states and the seven presentation states are all covered", () => {
  const statuses = new Set(entryInitializationFixtures.map(item => item.expectedStatus));
  for (const status of ["loading", "empty", "denied", "unsupported", "offline", "conflict", "stale"]) {
    assert.ok(statuses.has(status), status);
  }
  const authored = entryInitializationFixtures.filter(item => !item.caseIds.includes("HCA-SYNTHETIC"));
  assert.deepEqual(authored.map(item => item.id), [
    "entry-design-intent", "entry-object-intent", "wrong-account", "pending-invitation",
    "withdrawn-home", "working-initialization", "library-fixture-return"
  ]);
  const cases = new Set(authored.flatMap(item => item.caseIds));
  for (const id of ["E-SYN-29", "E-RDY-04A", "E-RDY-09A", "E-RDY-04E", "E-SYN-003", "E-RDY-07C"]) assert.ok(cases.has(id), id);
});

test("1 · Design ID D1 intent keeps revision Not supplied and is not authorized", () => {
  const d = describeEntryInitialization(byId("entry-design-intent").input);
  assert.equal(rowValue(d, "Intent kind"), "DesignID");
  assert.equal(rowValue(d, "Design ID"), "D1");
  assert.equal(rowValue(d, "Design revision"), "Not supplied");
  assert.equal(rowValue(d, "Resource authorized"), "false");
  assert.equal(rowValue(d, "Current account"), "Not supplied");
});

test("2 · Object O1/v1 stays separate from any Design ID", () => {
  const d = describeEntryInitialization(byId("entry-object-intent").input);
  assert.equal(rowValue(d, "Intent kind"), "ObjectID");
  assert.equal(rowValue(d, "Object ID"), "O1");
  assert.equal(rowValue(d, "Object revision"), "v1");
  assert.equal(rowValue(d, "Design ID"), "Not supplied");
  assert.equal(d.headline, "Keep an Object reference distinct from a Design reference");
});

test("3 · wrong account OTHER preserves D1 intent and exposes no committed design", () => {
  const d = describeEntryInitialization(byId("wrong-account").input);
  assert.equal(d.reason, "wrong-account");
  assert.equal(rowValue(d, "Design ID"), "D1");
  assert.equal(rowValue(d, "Synthetic active-account label"), "OTHER");
  assert.equal(rowValue(d, "Resource authorized"), "false");
  assert.equal(d.rows.some(item => item.section === "committed"), false);
});

test("4 · pending invitation borrows no design, actor or version", () => {
  const d = describeEntryInitialization(byId("pending-invitation").input);
  for (const label of ["Invitation ID", "Affected actor", "Affected Design ID", "Design revision", "Current action authority"]) {
    assert.equal(rowValue(d, label), "Not supplied", label);
  }
  assert.equal(d.rows.some(item => item.value === "D1"), false);
});

test("5 · withdrawn home preserves D1/H1/O1/v1 and leaves the home revision Not supplied", () => {
  const d = describeEntryInitialization(byId("withdrawn-home").input);
  assert.equal(rowValue(d, "Design ID"), "D1");
  assert.equal(rowValue(d, "Home label"), "H1");
  assert.equal(rowValue(d, "Home revision"), "Not supplied");
  assert.equal(rowValue(d, "Object reference"), "O1/v1");
});

test("6 · committed D1/r1 is separate from the UNEXECUTED unsaved example and no r2 is invented", () => {
  const d = describeEntryInitialization(byId("working-initialization").input);
  assert.equal(rowValue(d, "Committed revision", "committed"), "r1");
  assert.equal(rowValue(d, "Home reference", "committed"), "H1/v1");
  assert.equal(rowValue(d, "P1 object reference", "committed"), "O1/v1");
  assert.equal(rowValue(d, "P2 object reference", "committed"), "O1/v1");
  assert.equal(rowValue(d, "Example status", "unsaved"), "UNEXECUTED authored example");
  assert.equal(rowValue(d, "Saved revision after change", "unsaved"), "Not supplied");
  assert.equal(d.rows.some(item => item.value === "r2"), false);
  assert.match(d.textAlternative, /Committed — Committed revision: r1/);
  assert.match(d.textAlternative, /Unsaved example — New position: Not supplied/);
});

test("7 · library-fixture return shows immutable metadata only", () => {
  const d = describeEntryInitialization(byId("library-fixture-return").input);
  assert.equal(rowValue(d, "Artifact HTML SHA-256"), "604abdcff59843dde691632216fd1292f8b8ee120732efa0346c492c7ab6b9af");
  assert.equal(rowValue(d, "Current rights"), "Not supplied");
  assert.equal(rowValue(d, "Source status"), "Not supplied");
});

test("loading, stale, offline and unsupported never show earlier or partial facts", () => {
  for (const id of ["loading", "stale", "offline", "unsupported"]) {
    const d = describeEntryInitialization(byId(id).input);
    assert.deepEqual(d.rows, [], id);
    assert.match(d.textAlternative, /No facts are shown\./, id);
  }
});

test("revision conflict hides the committed snapshot", () => {
  const d = describeEntryInitialization(byId("conflict").input);
  assert.equal(d.reason, "design-revision-mismatch");
  assert.equal(rowValue(d, "Design revision"), "r2");
  assert.equal(d.rows.some(item => item.section === "committed"), false);
});

test("Not supplied is distinct from an explicitly supplied null", () => {
  const d = describeEntryInitialization({
    intent: null,
    facts: [
      { label: "Absent", value: NOT_SUPPLIED, source: "test" },
      { label: "Null", value: null, source: "test" }
    ]
  });
  assert.equal(d.status, EntryInitializationStatus.EMPTY);
  assert.deepEqual(d.rows.map(item => [item.label, item.value, item.supplied]), [
    ["Absent", "Not supplied", false],
    ["Null", "None (explicitly null)", true]
  ]);
});

test("stale is revision-based only: an equal observed context is not stale", () => {
  const input = { ...byId("stale").input, observedContextId: "ctx-2" };
  assert.equal(describeEntryInitialization(input).status, "intent-preserved");
});

test("entry-initialization review source exposes a labelled status region and disabled actions", async () => {
  const html = await load("../index.html");
  assert.match(html, /aria-labelledby="entry-init-title"/);
  assert.match(html, /id="entry-init-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="entry-init-text"/);
  assert.match(html, /id="entry-init-facts"[^>]*aria-label="Entry initialization facts"/);
  assert.match(html, /Prototype \/ synthetic \/ not connected/);
  const source = await load("../src/app.js");
  assert.match(source, /describeEntryInitialization\(/);
  assert.doesNotMatch(source, /new WebSession\s*\(/);
});
