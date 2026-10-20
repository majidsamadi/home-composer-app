import { HomeSceneSelectionController } from "../src/application/homeSceneSelectionController.js";
import { createLocalHomeSceneAdapter } from "../src/fixtures/homeSceneFixtures.js";

const controller = new HomeSceneSelectionController({ adapter: createLocalHomeSceneAdapter("journey") });
let token = controller.beginContext({ accountKey: "SYNTHETIC-A" });
await controller.load(token);

const current = controller.select(token, "LOCAL-MEASURED-H1-S1-V1");
console.log("current:", current.accepted, current.selection?.property.id, current.selection?.scene.id, current.selection?.scene.version);

const withdrawn = controller.select(token, "LOCAL-WITHDRAWN-H1-S1-V0");
console.log("withdrawn:", withdrawn.accepted, withdrawn.reason, controller.state.rows.find(row => row.rowId === "LOCAL-WITHDRAWN-H1-S1-V0").scene.version);

controller.setAdapter(createLocalHomeSceneAdapter("unavailable"));
token = controller.beginContext({ accountKey: "SYNTHETIC-A" });
await controller.load(token);
console.log("unavailable:", controller.state.outcome, controller.state.rows.length, controller.state.selection);

controller.setAdapter(createLocalHomeSceneAdapter("journey"));
token = controller.beginContext({ accountKey: "SYNTHETIC-A" });
await controller.load(token);
const limits = controller.select(token, "LOCAL-LIMITS-MISSING-H1-S2-V2");
console.log("limitations:", limits.accepted, limits.selection?.scale.status, limits.selection?.coverage.status);

token = controller.beginContext({ accountKey: "SYNTHETIC-B" });
console.log("account-change:", controller.state.accountKey, controller.state.outcome, controller.state.rows.length, controller.state.selection);
