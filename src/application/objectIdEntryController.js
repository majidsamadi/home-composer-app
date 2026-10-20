// Object ID entry, preview and placement (HCA-03.1–03.3).
// Status: component-tested (fake object reader). The reader receives only the
// object id and version: no home, design or placement data is ever sent with it.
import { isServiceProblem } from "../service/composerApi.js";

export const OBJECT_ID_PATTERN = /^obj_[0-9A-HJKMNP-TV-Z]{26}$/;
export const VERSION_PATTERN = /^[1-9][0-9]{0,8}$/;

export const EntryOutcome = Object.freeze({
  IDLE: "idle", INVALID: "invalid", LOADING: "loading", PREVIEW: "preview",
  NOT_FOUND: "not-found", WITHDRAWN: "withdrawn", NO_PLACE_RIGHT: "no-place-right", UNAVAILABLE: "unavailable", ADDED: "added"
});

const EVIDENCE_TEXT = Object.freeze({
  unknown: "Scale unknown — no recorded size",
  estimated: "Estimated size",
  "seller-declared": "Seller-declared size (not independently checked)",
  "reference-supported": "Size supported by a reference measurement",
  "independently-verified": "Size independently verified"
});

const MESSAGES = Object.freeze({
  [EntryOutcome.NOT_FOUND]: "No object found for that ID and version, or it isn't shared with you.",
  [EntryOutcome.WITHDRAWN]: "This object has been withdrawn by its owner and can't be placed.",
  [EntryOutcome.NO_PLACE_RIGHT]: "You can view this object, but its owner hasn't allowed you to place it in a design.",
  [EntryOutcome.UNAVAILABLE]: "Object details can't be loaded right now. Nothing was added."
});

export function evidenceText(claim) {
  return EVIDENCE_TEXT[claim] ?? EVIDENCE_TEXT.unknown;
}

export function formatDimensions(dims) {
  return Array.isArray(dims) ? `${dims.map(value => value.toFixed(2)).join(" × ")} m (W × H × D)` : "Not recorded";
}

// HCA-03.1: trim and validate. Returns { ok, objectId, version, errors: {objectId?, version?} }.
export function validateObjectEntry({ objectId, version }) {
  const id = String(objectId ?? "").trim();
  const ver = String(version ?? "").trim();
  const errors = {};
  if (!id) errors.objectId = "Enter an Object ID.";
  else if (!OBJECT_ID_PATTERN.test(id)) errors.objectId = "Object IDs start with obj_ followed by 26 letters or digits.";
  if (!ver) errors.version = "Enter the exact version, for example 1.";
  else if (!VERSION_PATTERN.test(ver)) errors.version = "Versions are whole numbers, for example 1.";
  return { ok: !errors.objectId && !errors.version, objectId: id, version: ver, errors };
}

export function describePreview(facts) {
  const dims = facts.effective_dimensions_m ?? null;
  const claim = facts.effective_scale_claim ?? "unknown";
  const canPlace = (facts.caller_allowed_use ?? []).includes("place");
  const realSizeAvailable = !(claim === "unknown" && !dims);
  const evidenceClasses = [...new Set((facts.dimension_evidence ?? []).map(item => item.class).filter(Boolean))];
  return Object.freeze({
    objectSource: Object.freeze({ object_id: facts.object_id, version: facts.version }),
    exactVersion: `${facts.object_id} · version ${facts.version}`,
    dimensions: dims ? Object.freeze([...dims]) : null,
    dimensionsText: formatDimensions(dims),
    scaleClaim: claim,
    evidenceText: evidenceText(claim),
    evidenceClasses: Object.freeze(evidenceClasses),
    // O13 variants carry ids and link status only; colour and package are not supplied.
    variants: Object.freeze((facts.variants ?? []).map(item => Object.freeze({
      variantId: item.variant_id, linkStatus: item.link_status, colour: "Not supplied", package: "Not supplied"
    }))),
    allowedUse: Object.freeze([...(facts.caller_allowed_use ?? [])]),
    canPlace,
    realSizeAvailable,
    defaultScaleMode: realSizeAvailable ? "real" : "illustrative"
  });
}

export class ObjectIdEntryController {
  constructor({ objectReader, workspace }) {
    this.objectReader = objectReader;
    this.workspace = workspace;
    this.sequence = 0;
    this.state = Object.freeze({ outcome: EntryOutcome.IDLE, message: "", errors: {}, preview: null });
  }

  set(next) {
    this.state = Object.freeze({ outcome: next.outcome, message: next.message ?? "", errors: next.errors ?? {}, preview: next.preview ?? null });
    return this.state;
  }

  async resolve(input) {
    const checked = validateObjectEntry(input);
    if (!checked.ok) return this.set({ outcome: EntryOutcome.INVALID, message: "Check the highlighted fields.", errors: checked.errors });
    const sequence = ++this.sequence;
    this.set({ outcome: EntryOutcome.LOADING, message: "Looking up the object…" });
    try {
      const facts = await this.objectReader.read({ object_id: checked.objectId, version: checked.version });
      if (sequence !== this.sequence) return this.state;
      const preview = describePreview(facts);
      if (!preview.canPlace) return this.set({ outcome: EntryOutcome.NO_PLACE_RIGHT, message: MESSAGES[EntryOutcome.NO_PLACE_RIGHT], preview });
      return this.set({ outcome: EntryOutcome.PREVIEW, message: `Preview of ${preview.exactVersion}.`, preview });
    } catch (error) {
      if (sequence !== this.sequence) return this.state;
      if (!isServiceProblem(error)) throw error;
      const outcome = error.code === "not_found" ? EntryOutcome.NOT_FOUND
        : error.code === "resource_withdrawn" ? EntryOutcome.WITHDRAWN
        : error.code === "action_denied" ? EntryOutcome.NO_PLACE_RIGHT : EntryOutcome.UNAVAILABLE;
      return this.set({ outcome, message: MESSAGES[outcome] });
    }
  }

  // HCA-03.3: add a placement from the previewed exact version. Real size is the
  // default whenever recorded dimensions allow it.
  async addToWorkspace({ scaleMode, illustrativeScale = 1, position_m = [0, 0, 0], rotation_deg_y = 0 } = {}) {
    const preview = this.state.preview;
    if (this.state.outcome !== EntryOutcome.PREVIEW || !preview) return false;
    const mode = scaleMode ?? preview.defaultScaleMode;
    if (mode === "real" && !preview.realSizeAvailable) {
      this.set({ ...this.state, message: "Real size isn't available: this object has no recorded size. Choose illustrative scale." });
      return false;
    }
    const added = await this.workspace.apply({
      type: "add",
      object_source: { ...preview.objectSource },
      dimensions_m: preview.dimensions ? [...preview.dimensions] : null,
      scale_claim: preview.scaleClaim,
      scale_mode: mode,
      illustrative_scale: mode === "illustrative" ? illustrativeScale : null,
      position_m,
      rotation_deg_y
    });
    if (!added) return false;
    this.set({ outcome: EntryOutcome.ADDED, message: `Added ${preview.exactVersion} at ${mode === "real" ? "real size" : "illustrative scale"} (unsaved).`, preview });
    return true;
  }
}
