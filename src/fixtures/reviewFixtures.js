import { createDesignIntent, createObjectIntent } from "../domain/entryIntent.js";
import { AvailabilityKind } from "../domain/designState.js";

export const designIntentD1 = createDesignIntent({ designId: "D1" });
export const objectIntentO1V1 = createObjectIntent({ objectId: "O1", objectRevision: "v1" });

export const committedD1R1 = Object.freeze({
  designId: "D1",
  revision: "r1",
  home: Object.freeze({ service: "home-service", id: "H1", version: "v1" }),
  placements: Object.freeze([
    Object.freeze({ placementId: "P1", object: Object.freeze({ service: "object-service", id: "O1", version: "v1" }), transform: Object.freeze({ x: 1, y: 1, rotationDegrees: 0 }) }),
    Object.freeze({ placementId: "P2", object: Object.freeze({ service: "object-service", id: "O1", version: "v1" }), transform: Object.freeze({ x: 2.8, y: 1.8, rotationDegrees: 90 }) })
  ])
});

export const fixtureContexts = Object.freeze({
  ready: Object.freeze({ kind: AvailabilityKind.READY }),
  wrongAccount: Object.freeze({ kind: AvailabilityKind.WRONG_ACCOUNT }),
  withdrawnHome: Object.freeze({ kind: AvailabilityKind.WITHDRAWN_HOME }),
  missingDependency: Object.freeze({ kind: AvailabilityKind.MISSING_DEPENDENCY }),
  pendingInvitation: Object.freeze({ kind: AvailabilityKind.PENDING_INVITATION })
});

export const provenance = Object.freeze({
  designIntent: "E-SYN-29: DesignID D1, revision not supplied",
  objectIntent: "E-RDY-04A: O1/v1 object-only entry reference",
  committed: "E-SYN-003 /base/design: D1/r1 -> H1/v1; P1/P2 -> O1/v1",
  wrongAccount: "E-SYN-29: synthetic OTHER context; safe DesignID intent D1; authorization false",
  pendingInvitation: "E-RDY-09A: pending invitation branch; invitation/design/revision/current authority not supplied",
  withdrawnHome: "E-RDY-04E: authored withdrawn-home branch; no current service confirmation",
  missingDependency: "WS-E-P06-DESIGN-LIBRARY-008: H1/v1 and O1/v1 retained; affected dependency not supplied"
});
