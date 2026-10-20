import {
  SceneActionStatus,
  SceneEnvironmentKind,
  SceneLimitStatus,
  SceneListOutcome,
  SceneSourceStatus
} from "../domain/homeSceneSelectionState.js";

const ref = (id, version) => Object.freeze({ supplied: true, id, version });
const limit = (status, detail) => Object.freeze({ status, detail });

export const localSceneRows = Object.freeze([
  Object.freeze({
    rowId: "LOCAL-MEASURED-H1-S1-V1",
    environmentKind: SceneEnvironmentKind.MEASURED_PROPERTY,
    property: ref("H1", "v1"),
    scene: ref("SCENE-H1", "v1"),
    sourceStatus: SceneSourceStatus.AVAILABLE,
    currentActionStatus: SceneActionStatus.ALLOWED,
    scale: limit(SceneLimitStatus.MEASURED, "Local synthetic measured-reference example only"),
    coverage: limit(SceneLimitStatus.PARTIAL, "Local synthetic partial-coverage example"),
    fixtureLabel: "Local synthetic measured-property fixture · not an actual authorized property"
  }),
  Object.freeze({
    rowId: "LOCAL-WITHDRAWN-H1-S1-V0",
    environmentKind: SceneEnvironmentKind.MEASURED_PROPERTY,
    property: ref("H1", "v1"),
    scene: ref("SCENE-H1", "v0"),
    sourceStatus: SceneSourceStatus.WITHDRAWN,
    currentActionStatus: SceneActionStatus.BLOCKED,
    scale: limit(SceneLimitStatus.MEASURED, "Historical synthetic exact-version metadata"),
    coverage: limit(SceneLimitStatus.PARTIAL, "Historical synthetic exact-version metadata"),
    fixtureLabel: "Local synthetic withdrawn exact version · no fallback to v1"
  }),
  Object.freeze({
    rowId: "LOCAL-LIMITS-MISSING-H1-S2-V2",
    environmentKind: SceneEnvironmentKind.MEASURED_PROPERTY,
    property: ref("H1", "v1"),
    scene: ref("SCENE-H1-ALT", "v2"),
    sourceStatus: SceneSourceStatus.AVAILABLE,
    currentActionStatus: SceneActionStatus.ALLOWED,
    scale: limit(SceneLimitStatus.NOT_SUPPLIED, "Scale evidence not supplied"),
    coverage: limit(SceneLimitStatus.UNKNOWN, "Coverage is unresolved"),
    fixtureLabel: "Local synthetic missing scale/coverage fixture · no fit claim"
  }),
  Object.freeze({
    rowId: "LOCAL-ILLUSTRATIVE-SANDBOX-V1",
    environmentKind: SceneEnvironmentKind.ILLUSTRATIVE_SANDBOX,
    property: Object.freeze({ supplied: false }),
    scene: ref("SYN-SANDBOX-SCENE", "v1"),
    sourceStatus: SceneSourceStatus.AVAILABLE,
    currentActionStatus: SceneActionStatus.ALLOWED,
    scale: limit(SceneLimitStatus.ILLUSTRATIVE, "Illustrative only; not measured property scale"),
    coverage: limit(SceneLimitStatus.UNKNOWN, "Illustrative sandbox coverage"),
    fixtureLabel: "Illustrative non-property sandbox · never a property master or substitute measured home"
  })
]);

const results = Object.freeze({
  journey: Object.freeze({
    outcome: SceneListOutcome.READY,
    rows: localSceneRows,
    note: "Local synthetic home/scene selection journey"
  }),
  empty: Object.freeze({ outcome: SceneListOutcome.EMPTY, rows: Object.freeze([]), note: "Explicit local synthetic empty scene result" }),
  restricted: Object.freeze({ outcome: SceneListOutcome.RESTRICTED, rows: Object.freeze([]), note: "Restricted local scene fixture · no reason inferred" }),
  unavailable: Object.freeze({ outcome: SceneListOutcome.UNAVAILABLE, rows: Object.freeze([]), note: "Unavailable local scene fixture · not empty or healthy" }),
  "missing-dependency": Object.freeze({ outcome: SceneListOutcome.MISSING_DEPENDENCY, rows: Object.freeze([]), note: "Missing dependency · no fallback scene/version selected" })
});

export function createLocalHomeSceneAdapter(kind = "journey") {
  if (!Object.hasOwn(results, kind)) throw new TypeError(`unknown local scene fixture: ${kind}`);
  return Object.freeze({
    fixture: true,
    async readScenes() {
      return results[kind];
    }
  });
}
