// Local synthetic fixtures for the P06 E entry-initialization review (HCA-01.1, HCA-01.4).
// Authored states 1–7 are transcribed from WS-E-P06-ENTRY-INITIALIZATION-010 v0.1
// (WiseStay_E_P06_Entry_Initialization_Prototype_v0.1.zip, prototype.html sha256
// 08e3fe0546224da232e264cd6522c29e83fec3996b9183edc55e2710d303a389, README "Authored states",
// SOURCE_MAP.json state_bindings). The remaining states are HCA synthetic presentation
// states with no E case. Prototype / synthetic / not connected; not a public schema.
import { createDesignIntent } from "../domain/entryIntent.js";
import { NOT_SUPPLIED } from "../application/entryInitializationPresentation.js";
import { committedD1R1, designIntentD1, fixtureContexts, objectIntentO1V1 } from "./reviewFixtures.js";

export const ENTRY_INITIALIZATION_RECORD = Object.freeze({
  record_id: "WS-E-P06-ENTRY-INITIALIZATION-010",
  version: "0.1",
  prototype_sha256: "08e3fe0546224da232e264cd6522c29e83fec3996b9183edc55e2710d303a389",
  banner: "Prototype / synthetic / not connected"
});

const fact = (label, value, source) => Object.freeze({ label, value, source });
const freezeFixture = item => Object.freeze({ ...item, caseIds: Object.freeze(item.caseIds), input: Object.freeze(item.input) });

export const entryInitializationFixtures = Object.freeze([
  // 1. Inbound Design ID; revision stays Not supplied.
  {
    id: "entry-design-intent",
    label: "Inbound Design ID",
    caseIds: ["E-SYN-29"],
    expectedStatus: "intent-preserved",
    input: {
      source: "E-SYN-29 · exact synthetic reference-model fixture only",
      intent: designIntentD1,
      availability: NOT_SUPPLIED,
      facts: [
        fact("Entry state", "pending_central_sign_in", "E-SYN-29 /cases/28 /steps/0 /expect/status"),
        fact("Resource authorized", "false", "E-SYN-29 /cases/28 /steps/0 /expect/resource_authorized"),
        fact("Current account", NOT_SUPPLIED, "No actual identity/account is supplied by this prototype")
      ]
    }
  },
  // 2. Object O1/v1 kept separate from any Design ID.
  {
    id: "entry-object-intent",
    label: "Inbound Object ID",
    caseIds: ["E-RDY-04A"],
    expectedStatus: "intent-preserved",
    input: {
      source: "E-RDY-04A · /cases/6 · authored case status remains proposed/not executed",
      intent: objectIntentO1V1,
      availability: NOT_SUPPLIED,
      facts: [
        fact("Exact supplied object reference", "O1/v1", "E-RDY-04A /cases/6 /setup"),
        fact("Design ID", NOT_SUPPLIED, "Object-only case supplies no design share"),
        fact("Destination home/design authority", NOT_SUPPLIED, "E-RDY-04A requires separate authority; none is supplied here")
      ]
    }
  },
  // 3. Wrong synthetic account OTHER; D1 intent preserved; resource_authorized=false.
  {
    id: "wrong-account",
    label: "Wrong account",
    caseIds: ["E-SYN-29"],
    expectedStatus: "conflict",
    input: {
      source: "E-SYN-29 · exact synthetic reference-model observation",
      intent: designIntentD1,
      availability: fixtureContexts.wrongAccount,
      facts: [
        fact("Synthetic active-account label", "OTHER", "E-SYN-29 /cases/28 /steps/1 /actor"),
        fact("Resource authorized", "false", "E-SYN-29 /cases/28 /steps/2 /expect/resource_authorized"),
        fact("Visible designs in synthetic list", "[]", "E-SYN-29 /cases/28 /steps/3 /expect/designs")
      ]
    }
  },
  // 4. Pending invitation; invitation ID/actor/design/version Not supplied.
  {
    id: "pending-invitation",
    label: "Pending invitation",
    caseIds: ["E-RDY-09A"],
    expectedStatus: "pending-invitation",
    input: {
      source: "E-RDY-09A · /cases/18 · authored case status proposed/not executed",
      intent: null,
      availability: fixtureContexts.pendingInvitation,
      facts: [
        fact("Invitation state", "pending invitation", "E-RDY-09A /cases/18 /setup"),
        fact("Invitation ID", NOT_SUPPLIED, "E-RDY-09A does not identify one"),
        fact("Affected actor", NOT_SUPPLIED, "E-RDY-09A does not identify one"),
        fact("Affected Design ID", NOT_SUPPLIED, "Do not borrow D1 from another scenario"),
        fact("Design revision", NOT_SUPPLIED, "No revision supplied for this pending-invitation branch"),
        fact("Current action authority", NOT_SUPPLIED, "No grant/acceptance is supplied by this case")
      ]
    }
  },
  // 5. Withdrawn home; D1/H1/O1/v1 preserved; home revision Not supplied.
  {
    id: "withdrawn-home",
    label: "Withdrawn home",
    caseIds: ["E-RDY-04E"],
    expectedStatus: "withdrawn-home",
    input: {
      source: "E-RDY-04E · /cases/10 · authored case status proposed/not executed",
      intent: designIntentD1,
      availability: fixtureContexts.withdrawnHome,
      facts: [
        fact("Home label", "H1", "E-RDY-04E /cases/10 /setup mentions D1/H1"),
        fact("Home revision", NOT_SUPPLIED, "Do not borrow H1/v1 from another case"),
        fact("Object reference", "O1/v1", "E-RDY-04E /cases/10 /setup"),
        fact("Branch meaning", "home withdrawn before reopening", "E-RDY-04E setup: separate variants withdraw object or home"),
        fact("Current service confirmation / action authority", NOT_SUPPLIED, "No current C/G receipt supplied by the case")
      ]
    }
  },
  // 6. Committed D1/r1 separate from the UNEXECUTED unsaved example; no r2 invented.
  {
    id: "working-initialization",
    label: "Committed vs unsaved",
    caseIds: ["E-SYN-003", "E-RDY-07C"],
    expectedStatus: "committed-review",
    input: {
      source: "E-SYN-003 /base/design + E-RDY-07C /cases/15",
      intent: designIntentD1,
      availability: fixtureContexts.ready,
      committed: committedD1R1,
      facts: [fact("Context", "private_design", "E-SYN-003 /base/design/context")],
      unsaved: [
        fact("Example status", "UNEXECUTED authored example", "E-RDY-07C behavior_execution=not_executed"),
        fact("Base design", "D1/r1", "E-RDY-07C /cases/15 /setup"),
        fact("Working change", "move P1 only in local working state", "E-RDY-07C /cases/15 /setup"),
        fact("New position", NOT_SUPPLIED, "E-RDY-07C supplies no position"),
        fact("Saved revision after change", NOT_SUPPLIED, "Do not fabricate r2"),
        fact("Draft persistence / discard policy", NOT_SUPPLIED, "E-RDY-07C unresolved_semantics; no storage/retention selection (Q01)")
      ]
    }
  },
  // 7. Local library-fixture return; immutable metadata only.
  {
    id: "library-fixture-return",
    label: "Library fixture return",
    caseIds: ["WS-E-P06-DESIGN-LIBRARY-008"],
    expectedStatus: "library-fixture-return",
    input: {
      source: "WS-E-P06-DESIGN-LIBRARY-008 v0.1 · immutable accepted artifact metadata",
      intent: null,
      libraryFixture: true,
      facts: [
        fact("Accepted artifact", "WS-E-P06-DESIGN-LIBRARY-008 v0.1", "Accepted library artifact; unchanged during retry"),
        fact("Artifact HTML SHA-256", "604abdcff59843dde691632216fd1292f8b8ee120732efa0346c492c7ab6b9af", "Existing prototype.html byte identity"),
        fact("Design ID", "D1", "Existing library fixture private card"),
        fact("Design revision", "r1", "Existing library fixture private card"),
        fact("Home reference", "H1/v1", "Existing library fixture private card"),
        fact("Object references", "O1/v1 · O1/v1", "Existing library fixture private card"),
        fact("Source status", NOT_SUPPLIED, "Existing library fixture explicitly leaves it absent"),
        fact("Current rights", NOT_SUPPLIED, "Existing library fixture explicitly leaves them absent")
      ]
    }
  },
  // HCA synthetic presentation states (no E case).
  {
    id: "loading",
    label: "Loading",
    caseIds: ["HCA-SYNTHETIC"],
    expectedStatus: "loading",
    input: { source: "HCA synthetic presentation state", loading: true, intent: designIntentD1 }
  },
  {
    id: "empty",
    label: "Empty",
    caseIds: ["HCA-SYNTHETIC"],
    expectedStatus: "empty",
    input: { source: "HCA synthetic presentation state", intent: null, availability: NOT_SUPPLIED }
  },
  {
    id: "denied",
    label: "Denied",
    caseIds: ["HCA-SYNTHETIC"],
    expectedStatus: "denied",
    input: {
      source: "HCA synthetic presentation state; denial supplied by an owning adapter, not inferred",
      intent: createDesignIntent({ designId: "D1", designRevision: "r1" }),
      availability: fixtureContexts.ready,
      authorization: "denied"
    }
  },
  {
    id: "unsupported",
    label: "Unsupported",
    caseIds: ["HCA-SYNTHETIC"],
    expectedStatus: "unsupported",
    input: {
      source: "HCA synthetic presentation state",
      intent: designIntentD1,
      availability: Object.freeze({ kind: "synthetic-unknown-availability" })
    }
  },
  {
    id: "offline",
    label: "Offline",
    caseIds: ["HCA-SYNTHETIC"],
    expectedStatus: "offline",
    input: { source: "HCA synthetic presentation state; connectivity supplied by caller", intent: designIntentD1, connectivity: "offline" }
  },
  {
    id: "conflict",
    label: "Revision conflict",
    caseIds: ["HCA-SYNTHETIC"],
    expectedStatus: "conflict",
    input: {
      source: "HCA synthetic presentation state",
      intent: createDesignIntent({ designId: "D1", designRevision: "r2" }),
      availability: fixtureContexts.ready,
      committed: committedD1R1
    }
  },
  {
    id: "stale",
    label: "Stale",
    caseIds: ["HCA-SYNTHETIC"],
    expectedStatus: "stale",
    input: {
      source: "HCA synthetic presentation state; revision-based, no time threshold",
      intent: designIntentD1,
      contextId: "ctx-2",
      observedContextId: "ctx-1"
    }
  }
].map(freezeFixture));
