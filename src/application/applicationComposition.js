import { ComposerCanonicalIdentityBridge } from "./canonicalIdentityBridge.js";
import { ComposerEntryController } from "./composerEntryController.js";
import { DesignLibraryController } from "./designLibraryController.js";

export function createComposerApplication({ session = null, libraryAdapter = null } = {}) {
  const controller = new ComposerEntryController();
  const identityBridge = new ComposerCanonicalIdentityBridge({ controller, session });
  const libraryController = new DesignLibraryController({ adapter: libraryAdapter });
  return Object.freeze({ controller, identityBridge, libraryController });
}
