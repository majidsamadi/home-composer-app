// Loader for the B-RFX v0.3 DRAFT/SYNTHETIC contract fixtures (contracts/draft/v0.3).
// The revised B-RFX-03 v0.2 file is the effective revision; the original is superseded.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = new URL("../../contracts/draft/v0.3/", import.meta.url);
const readJson = relative => JSON.parse(readFileSync(fileURLToPath(new URL(relative, base)), "utf8"));

export const FIXTURE_FILES = Object.freeze({
  "B-RFX-01": "fixtures/original/B-RFX-01_identity-occurrence.json",
  "B-RFX-02": "fixtures/original/B-RFX-02_scale-frame.json",
  "B-RFX-03": "fixtures/revised/B-RFX-03_version-component.v0.2.json",
  "B-RFX-04": "fixtures/original/B-RFX-04_pending-operation-context.json",
  "B-RFX-05": "fixtures/original/B-RFX-05_observation-match.json",
  "B-RFX-06": "fixtures/original/B-RFX-06_authority-privacy-profiles.json",
  "B-RFX-07": "fixtures/original/B-RFX-07_viewer-and-second-account.json",
  "B-RFX-08": "fixtures/original/B-RFX-08_first-party-prerequisites.json"
});
export const SUPERSEDED_FILES = Object.freeze({
  "B-RFX-03": "fixtures/original/B-RFX-03_version-component.json"
});

export function loadEffectiveFixtures() {
  return Object.fromEntries(Object.entries(FIXTURE_FILES).map(([id, path]) => [id, { path, body: readJson(path) }]));
}

export function loadSupersededFixture(id) {
  return readJson(SUPERSEDED_FILES[id]);
}

export function loadDeltaRecords() {
  return readJson("corrections/DELTA_records_v0.3.json");
}

export function fixtureExample(fixtureId, exampleName) {
  const fixture = readJson(FIXTURE_FILES[fixtureId]);
  const example = fixture.examples.find(item => item.example === exampleName);
  if (!example) throw new Error(`${fixtureId} has no example "${exampleName}"`);
  return example;
}
