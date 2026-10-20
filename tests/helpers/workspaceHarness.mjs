// Shared setup: fake Composer service + recording fake viewer + synthetic asset source.
import { createFakeComposerApi } from "../../src/service/fakeComposerApi.js";
import { WorkspaceController } from "../../src/application/workspaceController.js";
import { createSyntheticAssetSource, syntheticWorkspaceSeed } from "../../src/fixtures/workspaceFixtures.js";
import { createFakeViewer, loadGlbBytes } from "./fakeViewer.mjs";

export function createHarness({ user = "USER-A", renderer = "webgpu", viewerOptions = {}, mutateSeed } = {}) {
  const seed = syntheticWorkspaceSeed();
  if (mutateSeed) mutateSeed(seed);
  const fake = createFakeComposerApi({ seed });
  const viewers = [];
  let keys = 0;
  const controller = new WorkspaceController({
    api: fake.forUser(user),
    assetSource: createSyntheticAssetSource({ seed, loadBytes: async () => loadGlbBytes() }),
    accountKey: user,
    idempotencyKey: () => `test-key-${String(keys += 1).padStart(4, "0")}`,
    createViewer: () => {
      const viewer = createFakeViewer({ renderer, ...viewerOptions });
      viewers.push(viewer);
      return viewer;
    }
  });
  return { seed, fake, controller, viewers, get viewer() { return viewers[viewers.length - 1]; } };
}

export const flush = () => new Promise(resolve => setImmediate(resolve));
