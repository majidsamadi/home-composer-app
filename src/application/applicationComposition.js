import { ComposerCanonicalIdentityBridge } from "./canonicalIdentityBridge.js";
import { ComposerEntryController } from "./composerEntryController.js";
import { DesignLibraryController } from "./designLibraryController.js";
import { HomeSceneSelectionController } from "./homeSceneSelectionController.js";

export function createComposerApplication({
  session = null,
  libraryAdapter = null,
  sceneAdapter = null
} = {}) {
  const controller = new ComposerEntryController();
  const identityBridge = new ComposerCanonicalIdentityBridge({ controller, session });
  const libraryController = new DesignLibraryController({ adapter: libraryAdapter });
  const sceneController = new HomeSceneSelectionController({ adapter: sceneAdapter });
  return Object.freeze({ controller, identityBridge, libraryController, sceneController });
}
