// P06 E entry-initialization presentation (HCA-01.1, HCA-01.4).
// Port of WS-E-P06-ENTRY-INITIALIZATION-010 v0.1 (prototype.html sha256 08e3fe05…a389)
// into a pure, read-only description. It reuses the existing entry-intent and
// availability vocabulary and never opens, edits, saves or authorizes anything.
import { assertEntryIntent, describeEntryIntent } from "../domain/entryIntent.js";
import { AvailabilityKind, committedSnapshotMismatchReason } from "../domain/designState.js";

// "Not supplied" is distinct from an explicitly supplied null.
export const NOT_SUPPLIED = Object.freeze({ supplied: false });

export const EntryInitializationStatus = Object.freeze({
  LOADING: "loading",
  STALE: "stale",
  OFFLINE: "offline",
  UNSUPPORTED: "unsupported",
  CONFLICT: "conflict",
  DENIED: "denied",
  PENDING_INVITATION: "pending-invitation",
  WITHDRAWN_HOME: "withdrawn-home",
  MISSING_DEPENDENCY: "missing-dependency",
  LIBRARY_FIXTURE_RETURN: "library-fixture-return",
  EMPTY: "empty",
  COMMITTED_REVIEW: "committed-review",
  INTENT_PRESERVED: "intent-preserved"
});

const S = EntryInitializationStatus;
const KNOWN_AVAILABILITY = new Set(Object.values(AvailabilityKind));

const HEADLINES = Object.freeze({
  [S.LOADING]: "Loading entry context — nothing is shown until supplied facts arrive",
  [S.STALE]: "Entry context changed — this description is out of date and is not reused",
  [S.OFFLINE]: "Offline — no account, design or source fact can be confirmed",
  [S.UNSUPPORTED]: "Unsupported entry context — nothing was initialized",
  [S.DENIED]: "Current authority denies this design — the intent is kept and nothing is opened",
  [S.PENDING_INVITATION]: "A pending invitation is not an accepted design",
  [S.WITHDRAWN_HOME]: "Do not initialize edits from a withdrawn-home branch",
  [S.MISSING_DEPENDENCY]: "Missing dependency — no fallback source or revision is selected",
  [S.LIBRARY_FIXTURE_RETURN]: "Show immutable metadata from the accepted library prototype",
  [S.EMPTY]: "No entry intent supplied",
  [S.COMMITTED_REVIEW]: "Keep committed revision and unsaved example visibly separate"
});

function isNotSupplied(value) {
  return value === undefined || (value !== null && typeof value === "object" && value.supplied === false);
}

function displayValue(value) {
  if (isNotSupplied(value)) return "Not supplied";
  if (value === null) return "None (explicitly null)";
  return String(value);
}

function row(section, label, value, source) {
  return Object.freeze({
    section,
    label,
    value: displayValue(value),
    supplied: !isNotSupplied(value),
    source: source ?? "Not supplied"
  });
}

function intentRows(intent) {
  const described = describeEntryIntent(intent);
  const noun = described.kind === "design" ? "Design" : "Object";
  return [
    row("entry", "Intent kind", described.kind === "design" ? "DesignID" : "ObjectID", "entryIntent.describeEntryIntent"),
    row("entry", `${noun} ID`, described.id, "entryIntent.describeEntryIntent"),
    row(
      "entry",
      `${noun} revision`,
      intent.reference.revision.supplied ? described.revision : NOT_SUPPLIED,
      "entryIntent.describeEntryIntent"
    )
  ];
}

function committedRows(snapshot) {
  const rows = [
    row("committed", "Design ID", snapshot.designId, "committed snapshot"),
    row("committed", "Committed revision", snapshot.revision, "committed snapshot"),
    row("committed", "Home reference", `${snapshot.home.id}/${snapshot.home.version}`, "committed snapshot")
  ];
  for (const item of snapshot.placements ?? []) {
    rows.push(row("committed", `${item.placementId} object reference`, `${item.object.id}/${item.object.version}`, "committed snapshot"));
  }
  return rows;
}

function factRows(section, facts) {
  return (facts ?? []).map(fact => row(section, fact.label, fact.value, fact.source));
}

function intentValid(intent) {
  try {
    assertEntryIntent(intent);
    return true;
  } catch {
    return false;
  }
}

function deriveStatus(input) {
  if (input.loading === true) return { status: S.LOADING, reason: null };
  if (input.observedContextId !== undefined && input.observedContextId !== input.contextId) {
    // Revision/context-identity based only. No time threshold is selected (Q03/Q09).
    return { status: S.STALE, reason: "context-changed" };
  }
  if (input.connectivity === "offline") return { status: S.OFFLINE, reason: "connectivity-offline" };
  const availability = isNotSupplied(input.availability) ? null : input.availability;
  if (availability && !KNOWN_AVAILABILITY.has(availability.kind)) {
    return { status: S.UNSUPPORTED, reason: "unsupported-availability" };
  }
  if (input.intent != null && !intentValid(input.intent)) {
    return { status: S.UNSUPPORTED, reason: "unsupported-intent" };
  }
  if (availability?.kind === AvailabilityKind.WRONG_ACCOUNT) return { status: S.CONFLICT, reason: "wrong-account" };
  if (input.intent != null && input.committed) {
    const mismatch = committedSnapshotMismatchReason(input.intent, input.committed);
    if (mismatch) return { status: S.CONFLICT, reason: mismatch };
  }
  if (input.authorization === "denied") return { status: S.DENIED, reason: "authority-denied" };
  if (availability?.kind === AvailabilityKind.PENDING_INVITATION) return { status: S.PENDING_INVITATION, reason: null };
  if (availability?.kind === AvailabilityKind.WITHDRAWN_HOME) return { status: S.WITHDRAWN_HOME, reason: null };
  if (availability?.kind === AvailabilityKind.MISSING_DEPENDENCY) return { status: S.MISSING_DEPENDENCY, reason: null };
  if (input.libraryFixture === true) return { status: S.LIBRARY_FIXTURE_RETURN, reason: null };
  if (input.intent == null) return { status: S.EMPTY, reason: null };
  if (input.committed) return { status: S.COMMITTED_REVIEW, reason: null };
  return { status: S.INTENT_PRESERVED, reason: null };
}

function headlineFor(status, reason, input) {
  if (status === S.CONFLICT) {
    return reason === "wrong-account"
      ? "Preserve the intent without exposing another account’s design"
      : "Supplied entry intent conflicts with the committed snapshot — nothing was initialized";
  }
  if (status === S.INTENT_PRESERVED) {
    return input.intent.kind === "design"
      ? "Preserve a Design ID through entry"
      : "Keep an Object reference distinct from a Design reference";
  }
  return HEADLINES[status];
}

/**
 * Describe one entry-initialization snapshot for read-only review.
 *
 * input: {
 *   loading?, contextId?, observedContextId?, connectivity?: "offline",
 *   intent?: entry intent | null, availability?: { kind } | NOT_SUPPLIED,
 *   authorization?: "denied", committed?: snapshot | null, libraryFixture?: boolean,
 *   facts?: [{ label, value, source }], unsaved?: [{ label, value, source }], source?
 * }
 */
export function describeEntryInitialization(input = {}) {
  const { status, reason } = deriveStatus(input);
  const rows = [];
  // Loading/stale/offline/unsupported never show earlier or partial facts.
  const showFacts = ![S.LOADING, S.STALE, S.OFFLINE, S.UNSUPPORTED].includes(status);
  if (showFacts) {
    if (input.intent != null) rows.push(...intentRows(input.intent));
    rows.push(...factRows("entry", input.facts));
    // Committed content is only described when it does not conflict with the intent.
    if (input.committed && status !== S.CONFLICT) rows.push(...committedRows(input.committed));
    rows.push(...factRows("unsaved", input.unsaved));
  }
  const headline = headlineFor(status, reason, input);
  const sectionPrefix = { entry: "", committed: "Committed — ", unsaved: "Unsaved example — " };
  const facts = rows.map(item => `${sectionPrefix[item.section]}${item.label}: ${item.value}`);
  const textAlternative = [
    `${headline}.`,
    facts.length ? `${facts.join("; ")}.` : "No facts are shown.",
    "Prototype, synthetic, not connected. All real actions are disabled."
  ].join(" ");
  return Object.freeze({
    status,
    reason,
    headline,
    textAlternative,
    rows: Object.freeze(rows),
    actionsDisabled: true,
    source: input.source ?? null
  });
}
