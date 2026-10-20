import {
  ArrangementStatus,
  LibraryOutcome,
  LibrarySourceStatus
} from "../domain/designLibraryState.js";

const source = (kind, service, id, version) => Object.freeze({ kind, service, id, version });
const exactDesign = (id, revision) => Object.freeze({ supplied: true, id, revision });

export const localLibraryRows = Object.freeze([
  Object.freeze({
    rowId: "LOCAL-PRIVATE-D1-R1",
    arrangementStatus: ArrangementStatus.PRIVATE,
    design: exactDesign("D1", "r1"),
    sourceStatus: LibrarySourceStatus.AVAILABLE,
    sources: Object.freeze([
      source("home", "home-service", "H1", "v1"),
      source("object", "object-service", "O1", "v1")
    ]),
    fixtureLabel: "Local synthetic fixture · not an actual user library"
  }),
  Object.freeze({
    rowId: "LOCAL-SHARED-D2-R3",
    arrangementStatus: ArrangementStatus.SHARED,
    design: exactDesign("D2", "r3"),
    sourceStatus: LibrarySourceStatus.AVAILABLE,
    sources: Object.freeze([source("home", "home-service", "H2", "v2")]),
    fixtureLabel: "Local synthetic fixture · no share grant implied"
  }),
  Object.freeze({
    rowId: "LOCAL-ARCHIVED-D3-R2",
    arrangementStatus: ArrangementStatus.ARCHIVED,
    design: exactDesign("D3", "r2"),
    sourceStatus: LibrarySourceStatus.WITHDRAWN,
    sources: Object.freeze([source("home", "home-service", "H3", "v1")]),
    fixtureLabel: "Local synthetic fixture · withdrawn source remains unavailable"
  }),
  Object.freeze({
    rowId: "LOCAL-PUBLISHED-D4-R1",
    arrangementStatus: ArrangementStatus.PUBLISHED,
    design: exactDesign("D4", "r1"),
    sourceStatus: LibrarySourceStatus.UNKNOWN,
    sources: Object.freeze([]),
    fixtureLabel: "Local synthetic fixture · publication label is not current authority"
  })
]);

const results = Object.freeze({
  ready: Object.freeze({
    outcome: LibraryOutcome.READY,
    rows: localLibraryRows,
    note: "Local synthetic library rows only"
  }),
  empty: Object.freeze({
    outcome: LibraryOutcome.EMPTY,
    rows: Object.freeze([]),
    note: "Explicit local synthetic empty outcome"
  }),
  restricted: Object.freeze({
    outcome: LibraryOutcome.RESTRICTED,
    rows: Object.freeze([]),
    note: "Restricted local fixture · reason/current authority not inferred"
  }),
  "missing-dependency": Object.freeze({
    outcome: LibraryOutcome.MISSING_DEPENDENCY,
    rows: Object.freeze([]),
    note: "Missing-dependency local fixture · no fallback source selected"
  }),
  unavailable: Object.freeze({
    outcome: LibraryOutcome.UNAVAILABLE,
    rows: Object.freeze([]),
    note: "Unavailable local fixture · not equivalent to empty"
  })
});

export function createLocalDesignLibraryAdapter(kind = "ready") {
  if (!Object.hasOwn(results, kind)) throw new TypeError(`unknown local library fixture: ${kind}`);
  return Object.freeze({
    fixture: true,
    async readLibrary() {
      return results[kind];
    }
  });
}
