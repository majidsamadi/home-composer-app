import { ComposerEntryController } from "../src/application/composerEntryController.js";
import { applyWorkingPlacementTransform, beginSave, viewStatus } from "../src/domain/designState.js";
import { committedD1R1, designIntentD1, fixtureContexts } from "../src/fixtures/reviewFixtures.js";

const controller = new ComposerEntryController();
const context = controller.beginContext({ accountKey: "SYNTHETIC-A", intent: designIntentD1, availability: fixtureContexts.ready });
controller.acceptCommittedSnapshot(context, committedD1R1);
let expected = controller.state;
controller.replaceState(context, expected, applyWorkingPlacementTransform(expected, "P1", { x: 1.25 }));
expected = controller.state;
controller.replaceState(context, expected, beginSave(expected, "example-save-1"));
const saveToken = controller.saveToken("example-save-1");

console.log("before acknowledgement:", viewStatus(controller.state).label, "committed", controller.state.committed.revision);

const ack = controller.acceptSaveAcknowledgement(saveToken, {
  ...committedD1R1,
  revision: "r2",
  placements: controller.state.working.placements.map(item => ({
    placementId: item.placementId,
    object: { ...item.object },
    transform: { ...item.transform }
  }))
});

console.log("ack accepted:", ack.accepted);
console.log("after acknowledgement:", viewStatus(controller.state).label, "committed", controller.state.committed.revision);
