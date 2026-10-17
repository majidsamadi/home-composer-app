import { createComposerApplication } from "./application/applicationComposition.js";
import {
  applyWorkingPlacementTransform,
  beginSave,
  viewStatus
} from "./domain/designState.js";
import { rowSelectionReason } from "./domain/designLibraryState.js";
import { describeEntryIntent } from "./domain/entryIntent.js";
import { createLocalDesignLibraryAdapter } from "./fixtures/designLibraryFixtures.js";
import {
  committedD1R1,
  designIntentD1,
  fixtureContexts,
  objectIntentO1V1,
  provenance
} from "./fixtures/reviewFixtures.js";

// Deliberately disconnected by default: no canonical session and no library adapter.
const { controller, identityBridge, libraryController } = createComposerApplication();
const fixtureButtons = [...document.querySelectorAll("[data-fixture]")];
const libraryFixtureButtons = [...document.querySelectorAll("[data-library-fixture]")];
const realActions = [...document.querySelectorAll("[data-real-action]")];
const output = document.getElementById("state-output");
const notice = document.getElementById("notice");
const libraryStatus = document.getElementById("library-status");
const libraryList = document.getElementById("library-list");
const libraryReview = document.getElementById("library-review");
let currentToken;
let libraryToken;
let saveSequence = 0;

realActions.forEach(button => { button.disabled = true; });

function render() {
  const state = controller.state;
  if (!state) {
    output.textContent = JSON.stringify({
      canonicalIdentity: "Not connected",
      accountContext: "Not supplied",
      resourceAvailability: "Not supplied",
      committed: null,
      working: null
    }, null, 2);
    notice.textContent = "Canonical identity disconnected · no account/resource authority";
    return;
  }
  const intent = describeEntryIntent(state.intent);
  const snapshot = state.committed;
  const status = viewStatus(state);
  output.textContent = JSON.stringify({
    entryIntent: intent,
    availability: state.availability,
    status,
    committed: snapshot ? {
      designId: snapshot.designId,
      revision: snapshot.revision,
      home: snapshot.home,
      placements: snapshot.placements
    } : null,
    working: state.working,
    save: state.save
  }, null, 2);
  notice.textContent = `${state.availability.kind} · ${status.label}`;
}

function libraryOutcomeText(state) {
  const labels = {
    disconnected: "Disconnected — no library adapter/account context is active.",
    loading: "Loading the selected local synthetic library fixture.",
    ready: "Ready — rows are supplied facts only; IDs/revisions do not grant access.",
    empty: "Empty — explicitly supplied empty result.",
    restricted: "Restricted — not treated as empty and no reason is inferred.",
    "missing-dependency": "Missing dependency — no fallback source/revision is selected.",
    unavailable: "Unavailable — not treated as empty or healthy."
  };
  return labels[state.outcome] ?? state.outcome;
}

function renderLibrary() {
  const state = libraryController.state;
  libraryStatus.textContent = libraryOutcomeText(state);
  libraryList.replaceChildren();

  if (state.outcome !== "ready") {
    libraryReview.textContent = state.note || "No library row selected.";
    return;
  }

  for (const row of state.rows) {
    const item = document.createElement("li");
    item.className = "library-row";
    const title = document.createElement("h3");
    const designText = row.design.supplied
      ? `Design ${row.design.id} · revision ${row.design.revision}`
      : "Design reference not supplied";
    title.textContent = designText;

    const metadata = document.createElement("p");
    metadata.textContent = `Arrangement: ${row.arrangementStatus} · Source: ${row.sourceStatus}`;

    const sourceText = document.createElement("p");
    sourceText.className = "note";
    sourceText.textContent = row.sources.length
      ? `Pinned sources: ${row.sources.map(source => `${source.kind} ${source.id}/${source.version}`).join("; ")}`
      : "Pinned source references: Not supplied";

    const fixture = document.createElement("p");
    fixture.className = "fixture-label";
    fixture.textContent = row.fixtureLabel || "Injected read-only row";

    const select = document.createElement("button");
    select.type = "button";
    select.textContent = "Review exact design intent";
    select.dataset.libraryRow = row.rowId;
    const blocked = rowSelectionReason(row);
    select.disabled = Boolean(blocked);
    if (blocked) select.title = `Selection unavailable: ${blocked}`;
    select.addEventListener("click", () => {
      const selected = libraryController.select(libraryToken, row.rowId);
      if (!selected.accepted) {
        libraryReview.textContent = `Not selected: ${selected.reason}`;
        return;
      }
      const intent = describeEntryIntent(selected.intent);
      libraryReview.textContent = `Review-only selection: ${intent.kind} ${intent.id} / ${intent.revision}. Resource availability and edit/save authority remain independently supplied.`;
    });

    item.append(title, metadata, sourceText, fixture, select);
    libraryList.append(item);
  }

  if (!state.selection) {
    libraryReview.textContent = "No row selected. Review selection never opens, edits or saves a design.";
  }
}

function startFixture(kind) {
  // Explicit local synthetic fixture control only; this is not canonical identity composition.
  const intent = kind === "object-intent" ? objectIntentO1V1 : designIntentD1;
  const availability = ({
    "wrong-account": fixtureContexts.wrongAccount,
    "withdrawn-home": fixtureContexts.withdrawnHome,
    "missing-dependency": fixtureContexts.missingDependency,
    "pending-invitation": fixtureContexts.pendingInvitation
  })[kind] ?? fixtureContexts.ready;
  currentToken = controller.beginContext({ accountKey: kind === "wrong-account" ? "OTHER" : "SYNTHETIC-A", intent, availability });
  if (kind === "ready-design" || kind === "working-save") controller.acceptCommittedSnapshot(currentToken, committedD1R1);
  render();
}

for (const button of fixtureButtons) {
  button.addEventListener("click", () => startFixture(button.dataset.fixture));
}

for (const button of libraryFixtureButtons) {
  button.addEventListener("click", async () => {
    const kind = button.dataset.libraryFixture;
    libraryController.setAdapter(createLocalDesignLibraryAdapter(kind));
    libraryToken = libraryController.beginContext({ accountKey: `LOCAL-FIXTURE-${kind}` });
    const pending = libraryController.load(libraryToken);
    renderLibrary();
    await pending;
    renderLibrary();
  });
}

document.getElementById("local-edit").addEventListener("click", () => {
  if (!controller.state?.committed) return;
  const expected = controller.state;
  controller.replaceState(currentToken, expected, applyWorkingPlacementTransform(expected, "P1", { x: 1.25 }));
  render();
});

document.getElementById("local-save-fail").addEventListener("click", () => {
  if (!controller.state?.dirty) return;
  const operationId = `local-save-${++saveSequence}`;
  const expected = controller.state;
  controller.replaceState(currentToken, expected, beginSave(expected, operationId));
  const token = controller.saveToken(operationId);
  controller.acceptSaveFailure(token, "synthetic-not-confirmed");
  render();
});

document.getElementById("local-save-ack").addEventListener("click", () => {
  if (!controller.state?.dirty) return;
  const operationId = `local-save-${++saveSequence}`;
  const expected = controller.state;
  controller.replaceState(currentToken, expected, beginSave(expected, operationId));
  const token = controller.saveToken(operationId);
  const authoritative = {
    ...committedD1R1,
    revision: `r${saveSequence + 1}`,
    placements: controller.state.working.placements.map(item => ({
      placementId: item.placementId,
      object: { ...item.object },
      transform: { ...item.transform }
    }))
  };
  controller.acceptSaveAcknowledgement(token, authoritative);
  render();
});

window.__WISESTAY_REVIEW_FIXTURE__ = Object.freeze({ provenance });
identityBridge.disconnect("canonical-session-not-configured");
libraryController.invalidateContext("library-adapter-not-connected");
render();
renderLibrary();
