// Fit outcome wording (HCB-04 outcomes, Q03 provisional thresholds, Q06 fit wording).
// Status: component-tested (synthetic data only). Never claims accuracy.
export const FIT_LABELS = Object.freeze({
  verified_fit: "Fits (verified, provisional thresholds)",
  unverified_fit: "Not verified",
  approximate: "Approximate only",
  unknown: "Unknown — scale not supported"
});

export const FIT_REASON_TEXT = Object.freeze({
  illustrative_scale_mode: "The object is shown at illustrative scale, not real size.",
  scale_claim_unknown: "The object's or home's scale is unknown.",
  dimensions_unknown: "The object has no recorded dimensions.",
  scale_claim_approximate: "Sizes are estimated or seller-declared, so the result is approximate.",
  clearance_not_requested: "No clearance margin was requested.",
  footprint_outside_home_bounds: "The footprint extends past the home bounds.",
  margin_within_uncertainty: "Measurement uncertainty is not smaller than the margin.",
  opening_clearance_not_supported: "Door swing and openings are not checked.",
  home_source_not_found: "The home scan used by this design can't be found. It may have been withdrawn or deleted.",
  home_source_unavailable: "The home scan is temporarily unavailable, so fit can't be checked right now."
});

export const OPENINGS_NOTE = "Door swing and openings are not checked.";

export function describeFit(fit) {
  if (!fit) return Object.freeze({ outcome: null, label: "No fit check yet", reasons: Object.freeze([]), detail: "", openingsNote: OPENINGS_NOTE });
  const label = FIT_LABELS[fit.outcome] ?? FIT_LABELS.unknown;
  // The openings note is always shown once (openingsNote), so its reason code is not repeated in the list.
  const reasons = (fit.reasons ?? []).filter(code => code !== "opening_clearance_not_supported").map(code => FIT_REASON_TEXT[code] ?? code);
  const parts = [];
  if (typeof fit.combined_uncertainty_m === "number") parts.push(`combined uncertainty ${fit.combined_uncertainty_m.toFixed(3)} m`);
  if (typeof fit.margin_m === "number") parts.push(`margin ${fit.margin_m.toFixed(3)} m`);
  parts.push(`thresholds ${fit.thresholds_version}`);
  return Object.freeze({ outcome: fit.outcome, label, reasons: Object.freeze(reasons), detail: parts.join(" · "), openingsNote: OPENINGS_NOTE });
}
