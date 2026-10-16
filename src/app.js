import { ComposerCanonicalIdentityBridge } from "./application/canonicalIdentityBridge.js";
import { ComposerEntryController } from "./application/composerEntryController.js";
import {
  applyWorkingPlacementTransform,
  beginSave,
  viewStatus
} from "./domain/designState.js";
import { describeEntryIntent } from "./domain/entryIntent.js";
import {
  committedD1R1,
  designIntentD1,
  fixtureContexts,
  objectIntentO1V1,
  provenance
} from "./fixtures/reviewFixtures.js";

const controller = new ComposerEntryController();
// Deliberately disconnected: Home Composer has no approved canonical app registration/origin.
// Product composition may inject an approved canonical WebSession later without changing the bridge.
const identityBridge = new ComposerCanonicalIdentityBridge({ controller, session: null });
const fixtureButtons = [...document.querySelectorAll("[data-fixture]")];
const realActions = [...document.querySelectorAll("[data-real-action]")];
const output = document.getElementById("state-output");
const notice = document.getElementById("notice");
let currentToken;
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
render();
