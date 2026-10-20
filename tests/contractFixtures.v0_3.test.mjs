// P03 consumer contract tests over the B-RFX v0.3 DRAFT/SYNTHETIC fixtures
// (contracts/draft/v0.3). These tests read the same bytes as the HSB/OSB/WFA
// copies (see tests/contractFixtures.sync.test.mjs). Behavioural cases map a
// fixture example onto existing HCA exports only; no domain code was added.
import test from "node:test";
import assert from "node:assert/strict";
import { APPLICATIONS } from "../vendor/wisestay-web-session/web-session.mjs";
import { ComposerCanonicalIdentityBridge } from "../src/application/canonicalIdentityBridge.js";
import { ComposerEntryController } from "../src/application/composerEntryController.js";
import { createDesignIntent, createObjectIntent, describeEntryIntent } from "../src/domain/entryIntent.js";
import {
  acknowledgeSave,
  applyWorkingPlacementTransform,
  beginSave,
  initializeDesignState
} from "../src/domain/designState.js";
import {
  SceneActionStatus,
  SceneEnvironmentKind,
  SceneLimitStatus,
  SceneListOutcome,
  SceneSourceStatus,
  createSceneRow,
  createSceneSelectionState,
  selectSceneRow
} from "../src/domain/homeSceneSelectionState.js";
import { fixtureContexts } from "../src/fixtures/reviewFixtures.js";
import {
  FIXTURE_FILES,
  fixtureExample,
  loadDeltaRecords,
  loadEffectiveFixtures,
  loadSupersededFixture
} from "./helpers/contractFixtures.mjs";
import { canonicalFixture, USER_A, USER_B } from "./helpers/canonicalWebSessionFixture.mjs";

const at = label => {
  const [id, version] = label.split("@");
  return { id, version };
};

// Synthetic committed snapshot built only from fixture strings (B-RFX-01 "same reusable asset").
function snapshotFromOccurrenceFixture() {
  const example = fixtureExample("B-RFX-01", "same reusable asset, two occurrences");
  const design = at(example.design);
  const home = at(example.home);
  const object = at(example.object);
  return {
    example,
    snapshot: {
      designId: design.id,
      revision: design.version,
      home: { service: "home-service", id: home.id, version: home.version },
      placements: example.occurrences.map((placementId, index) => ({
        placementId,
        object: { service: "object-service", id: object.id, version: object.version },
        transform: { x: index, y: 0, rotationDegrees: 0 }
      }))
    }
  };
}

function readyState(snapshot) {
  return initializeDesignState({
    contextId: "ctx-draft",
    accountKey: "SYNTHETIC-A",
    intent: createDesignIntent({ designId: snapshot.designId, designRevision: snapshot.revision }),
    availability: fixtureContexts.ready,
    committedSnapshot: snapshot
  });
}

// ---------------------------------------------------------------- structural

test("draft: all 8 effective B-RFX fixtures load with matching ids and draft status", () => {
  const fixtures = loadEffectiveFixtures();
  assert.deepEqual(Object.keys(fixtures), ["B-RFX-01", "B-RFX-02", "B-RFX-03", "B-RFX-04", "B-RFX-05", "B-RFX-06", "B-RFX-07", "B-RFX-08"]);
  for (const [id, { path, body }] of Object.entries(fixtures)) {
    assert.equal(body.fixture_id, id);
    assert.ok(path.split("/").at(-1).startsWith(`${id}_`), `${path} prefix`);
    assert.equal(body.status, "PREPARED_NOT_EXECUTED_NOT_ACCEPTED", id);
    assert.equal(body.codec, null, id);
    assert.equal(body.protection_scheme, null, id);
    assert.equal(body.coordinate_convention, null, id);
    assert.deepEqual(body.physical_measurement_receipts, [], id);
    assert.ok(body.examples.length > 0, id);
    for (const example of body.examples) {
      assert.equal(typeof example.draft_expected, "string", `${id}/${example.example}`);
      assert.ok(example.draft_expected.trim().length > 0, `${id}/${example.example}`);
    }
  }
});

test("draft: B-RFX-03 v0.2 is the effective revision and the original is superseded", () => {
  assert.equal(FIXTURE_FILES["B-RFX-03"], "fixtures/revised/B-RFX-03_version-component.v0.2.json");
  const revised = loadEffectiveFixtures()["B-RFX-03"].body;
  const original = loadSupersededFixture("B-RFX-03");
  assert.equal(revised.fixture_revision, "0.2");
  assert.equal(revised.revises.fixture_id, "B-RFX-03");
  assert.equal(revised.revises.predecessor_sha256, "62b01afb987ae6ff2453d7ebb4c7635b84d2cf2624b988457b2d4dda3e6e7d92");
  assert.equal(revised.receipt_scope.whole_fixture_contract_acceptance, null);
  assert.equal(revised.receipt_scope.runtime_execution, false);
  assert.equal(original.fixture_revision, undefined);
  assert.ok(revised.examples.length > original.examples.length);
});

test("draft: DELTA records are proposed, not frozen, and include DELTA-17..21", () => {
  const records = loadDeltaRecords();
  assert.ok(Array.isArray(records) && records.length > 0);
  for (const record of records) assert.equal(record.status, "PROPOSED_NOT_FROZEN", record.id);
  const ids = new Set(records.map(record => record.id));
  for (const id of ["DELTA-17", "DELTA-18", "DELTA-19", "DELTA-20", "DELTA-21"]) assert.ok(ids.has(id), id);
});

// ---------------------------------------------------------------- B-RFX-01

test("draft: B-RFX-01 'same reusable asset, two occurrences' keeps occurrences independent", () => {
  // designState.applyWorkingPlacementTransform changes one placement only; the shared
  // O-A@3 reference and the other occurrence stay unchanged.
  const { example, snapshot } = snapshotFromOccurrenceFixture();
  const state = readyState(snapshot);
  const moved = applyWorkingPlacementTransform(state, "P-A", { x: 9 });
  const [pA, pB] = moved.working.placements;
  assert.equal(pA.transform.x, 9);
  assert.deepEqual(pB, state.working.placements[1]);
  assert.deepEqual(pA.object, pB.object);
  assert.equal(`${pA.object.id}@${pA.object.version}`, example.object);
  assert.deepEqual(moved.committed, state.committed);
});

test("draft: B-RFX-01 'same reusable asset, two occurrences' removal of P-A", { skip: "no HCA occurrence-removal API in this slice" }, () => {});

test("draft: B-RFX-01 'personal object without property' needs no property", () => {
  // entryIntent.createObjectIntent takes only objectId/objectRevision.
  const example = fixtureExample("B-RFX-01", "personal object without property");
  assert.equal(example.property, null);
  const ref = at(example.object);
  const described = describeEntryIntent(createObjectIntent({ objectId: ref.id, objectRevision: ref.version }));
  assert.deepEqual(described, { kind: "object", id: "O-PERSONAL", revision: "1" });
  assert.equal(Object.hasOwn(described, "property"), false);
});

test("draft: B-RFX-01 'local project name is not canonical association' stays unbound", () => {
  // homeSceneSelectionState.createSceneRow: a measured-property scene needs an exact
  // supplied property; a sandbox cannot bind one. A local label is never promoted.
  const example = fixtureExample("B-RFX-01", "local project name is not canonical association");
  assert.equal(example.canonical_property, null);
  const base = {
    rowId: "row-local",
    scene: { supplied: true, id: "SCENE-LOCAL", version: "1" },
    sourceStatus: SceneSourceStatus.AVAILABLE,
    currentActionStatus: SceneActionStatus.ALLOWED,
    coverage: { status: SceneLimitStatus.NOT_SUPPLIED },
    fixtureLabel: example.local_project_label
  };
  assert.throws(() => createSceneRow({
    ...base,
    environmentKind: SceneEnvironmentKind.MEASURED_PROPERTY,
    property: { supplied: false },
    scale: { status: SceneLimitStatus.UNKNOWN }
  }), /requires an exact supplied property reference/);
  const sandbox = createSceneRow({
    ...base,
    environmentKind: SceneEnvironmentKind.ILLUSTRATIVE_SANDBOX,
    property: null,
    scale: { status: SceneLimitStatus.ILLUSTRATIVE }
  });
  assert.equal(sandbox.property.supplied, false);
  assert.equal(sandbox.fixtureLabel, "Kitchen example");
});

// ---------------------------------------------------------------- B-RFX-02

test("draft: B-RFX-02 'unknown home, known object' keeps home scale unknown", () => {
  // createSceneRow preserves the supplied scale status; no verified-fit status exists.
  const example = fixtureExample("B-RFX-02", "unknown home, known object");
  assert.equal(example.home_scale_claim, "unknown");
  const row = createSceneRow({
    rowId: "row-unknown-scale",
    environmentKind: SceneEnvironmentKind.MEASURED_PROPERTY,
    property: { supplied: true, id: "PROPERTY-A", version: "1" },
    scene: { supplied: true, id: "H-A", version: "7" },
    sourceStatus: SceneSourceStatus.AVAILABLE,
    currentActionStatus: SceneActionStatus.ALLOWED,
    scale: { status: SceneLimitStatus.UNKNOWN },
    coverage: { status: SceneLimitStatus.NOT_SUPPLIED }
  });
  assert.equal(row.scale.status, "unknown");
  assert.equal(Object.values(SceneLimitStatus).some(value => /fit|verified/.test(value)), false);
});

// ---------------------------------------------------------------- B-RFX-03

test("draft: B-RFX-03 'foreign revision' rejects a later design revision", () => {
  // designState.committedSnapshotMismatchReason via ComposerEntryController.acceptCommittedSnapshot.
  const example = fixtureExample("B-RFX-03", "foreign revision");
  const expected = at(example.expected);
  const received = at(example.received_component_context);
  const { snapshot } = snapshotFromOccurrenceFixture();
  const controller = new ComposerEntryController();
  const token = controller.beginContext({
    accountKey: "SYNTHETIC-A",
    intent: createDesignIntent({ designId: snapshot.designId, designRevision: expected.version }),
    availability: fixtureContexts.ready
  });
  const result = controller.acceptCommittedSnapshot(token, { ...snapshot, revision: received.version });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "design-revision-mismatch");
  assert.equal(controller.state.committed, null);
});

test("draft: B-RFX-03 'foreign revision' never substitutes a newer home component on save", () => {
  // designState.acknowledgeSave + designSnapshot.samePinnedSources.
  const example = fixtureExample("B-RFX-03", "foreign revision");
  const expected = at(example.expected);
  const received = at(example.received_component_context);
  const { snapshot } = snapshotFromOccurrenceFixture();
  assert.equal(`${snapshot.home.id}@${snapshot.home.version}`, example.expected);
  const pending = beginSave(applyWorkingPlacementTransform(readyState(snapshot), "P-A", { x: 2 }), "op-draft");
  const result = acknowledgeSave(pending, {
    operationId: "op-draft",
    authoritativeSnapshot: { ...snapshot, revision: "3", home: { ...snapshot.home, id: received.id, version: received.version } }
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "source-version-mismatch");
  assert.equal(result.state.committed.home.version, expected.version);
});

test("draft: B-RFX-03 v0.2 'incomplete candidate V2' leaves accepted V1 unchanged", () => {
  // acknowledgeSave rejects a result whose pinned set differs; committed V1 is kept.
  const example = fixtureExample("B-RFX-03", "incomplete candidate V2 while accepted complete V1 remains unchanged");
  assert.deepEqual(example.candidate.received_labels, ["PART-A"]);
  const { snapshot } = snapshotFromOccurrenceFixture();
  const pending = beginSave(applyWorkingPlacementTransform(readyState(snapshot), "P-A", { x: 2 }), "op-v2");
  const incomplete = { ...snapshot, revision: "3", placements: snapshot.placements.slice(0, 1) };
  const result = acknowledgeSave(pending, { operationId: "op-v2", authoritativeSnapshot: incomplete });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "source-version-mismatch");
  assert.equal(result.state.committed.revision, snapshot.revision);
  assert.equal(result.state.committed.placements.length, 2);
});

// ---------------------------------------------------------------- B-RFX-04

test("draft: B-RFX-04 'old scope receipt' is not attached to the new account scope", () => {
  // ComposerEntryController epoch tokens: a token from ACCOUNT-A is stale for ACCOUNT-B.
  const example = fixtureExample("B-RFX-04", "old scope receipt");
  const [oldAccount] = example.old_scope.split("/");
  const [newAccount] = example.new_scope.split("/");
  const { snapshot } = snapshotFromOccurrenceFixture();
  const intent = createDesignIntent({ designId: snapshot.designId, designRevision: snapshot.revision });
  const controller = new ComposerEntryController();
  const oldToken = controller.beginContext({ accountKey: oldAccount, intent, availability: fixtureContexts.ready });
  controller.beginContext({ accountKey: newAccount, intent, availability: fixtureContexts.ready });
  const late = controller.acceptCommittedSnapshot(oldToken, snapshot);
  assert.equal(late.accepted, false);
  assert.equal(late.reason, "stale-context");
  assert.equal(controller.state.accountKey, "ACCOUNT-B");
  assert.equal(controller.state.committed, null);
});

// ---------------------------------------------------------------- B-RFX-05

test("draft: B-RFX-05 observation-match examples", { skip: "no HCA observation-match consumer in this slice" }, () => {});

// ---------------------------------------------------------------- B-RFX-06

test("draft: B-RFX-06 'wrong resource' is denied without leaking the requested resource", () => {
  // homeSceneSelectionState.selectSceneRow only selects a supplied row.
  const example = fixtureExample("B-RFX-06", "wrong resource");
  const granted = at(example.grant_scope.split(" ")[0]);
  const requested = at(example.requested.split(" ")[0]);
  const state = createSceneSelectionState({
    outcome: SceneListOutcome.READY,
    accountKey: "SYNTHETIC-A",
    rows: [{
      rowId: `${granted.id}@${granted.version}`,
      environmentKind: SceneEnvironmentKind.MEASURED_PROPERTY,
      property: { supplied: true, id: "PROPERTY-A", version: "1" },
      scene: { supplied: true, id: granted.id, version: granted.version },
      sourceStatus: SceneSourceStatus.AVAILABLE,
      currentActionStatus: SceneActionStatus.ALLOWED,
      scale: { status: SceneLimitStatus.NOT_SUPPLIED },
      coverage: { status: SceneLimitStatus.NOT_SUPPLIED }
    }]
  });
  const result = selectSceneRow(state, `${requested.id}@${requested.version}`);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "scene-row-not-found");
  assert.doesNotMatch(result.reason, new RegExp(requested.id));
  assert.equal(result.state.selection, null);
});

// ---------------------------------------------------------------- B-RFX-07

test("draft: B-RFX-07 second account never inherits the first account's design", async () => {
  // canonicalIdentityBridge.restoreContext. Only the two-account half of
  // 'capturing phone offline versus second viewer' maps here; no offline
  // second-viewer support is inferred.
  const example = fixtureExample("B-RFX-07", "capturing phone offline versus second viewer");
  assert.equal(example.second_viewer_network, "online");
  const { snapshot } = snapshotFromOccurrenceFixture();
  const f = canonicalFixture();
  const controller = new ComposerEntryController();
  const bridge = new ComposerCanonicalIdentityBridge({ controller, session: f.session });
  const intent = createDesignIntent({ designId: snapshot.designId, designRevision: snapshot.revision });
  const first = await bridge.restoreContext({ intent, availability: fixtureContexts.ready });
  assert.equal(controller.acceptCommittedSnapshot(first.token, snapshot).accepted, true);
  assert.equal(controller.state.accountKey, USER_A);
  f.session.clear();
  f.setUser(USER_B);
  const second = await bridge.restoreContext({ intent, availability: fixtureContexts.wrongAccount });
  assert.equal(second.accepted, true);
  assert.equal(controller.state.accountKey, USER_B);
  assert.equal(controller.state.committed, null);
  assert.equal(controller.acceptCommittedSnapshot(first.token, snapshot).reason, "stale-context");
});

test("draft: B-RFX-07 'device loss while opening exact asset'", { skip: "no HCA renderer consumer in this slice" }, () => {});

// ---------------------------------------------------------------- B-RFX-08

test("draft: B-RFX-08 'four registrations unselected' — Composer is not registered", () => {
  const example = fixtureExample("B-RFX-08", "four registrations unselected");
  const composer = example.products.find(item => item.label === "Composer");
  assert.deepEqual(composer, { label: "Composer", application_identifier: null, origin: null, callback: null, environment: null });
  assert.equal(Object.hasOwn(APPLICATIONS, "composer"), false);
  assert.equal(Object.hasOwn(APPLICATIONS, "home-composer"), false);
});
