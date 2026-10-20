import {
  SceneListOutcome,
  createSceneSelectionState,
  normalizeSceneSelectionResult,
  selectSceneRow
} from "../domain/homeSceneSelectionState.js";

function result(accepted, reason, extra = {}) {
  return Object.freeze({ accepted, reason, ...extra });
}

export class HomeSceneSelectionController {
  #adapter;
  #epoch = 0;
  #request = 0;
  #state = createSceneSelectionState();

  constructor({ adapter = null } = {}) {
    this.#adapter = adapter;
  }

  get state() {
    return this.#state;
  }

  get adapterConnected() {
    return Boolean(this.#adapter && typeof this.#adapter.readScenes === "function");
  }

  setAdapter(adapter) {
    this.#adapter = adapter ?? null;
    return this.invalidateContext("scene-adapter-changed");
  }

  invalidateContext(reason = "scene-context-invalidated") {
    this.#epoch += 1;
    this.#request += 1;
    this.#state = createSceneSelectionState({ outcome: SceneListOutcome.DISCONNECTED, note: reason });
    return Object.freeze({ epoch: this.#epoch });
  }

  beginContext({ accountKey }) {
    if (typeof accountKey !== "string" || accountKey.trim() === "") {
      throw new TypeError("scene accountKey must be a non-empty string");
    }
    this.#epoch += 1;
    this.#request += 1;
    const token = Object.freeze({ epoch: this.#epoch });
    this.#state = createSceneSelectionState({
      outcome: SceneListOutcome.DISCONNECTED,
      accountKey,
      note: this.adapterConnected ? "scene-context-ready-to-load" : "scene-adapter-not-connected"
    });
    return token;
  }

  async load(token) {
    if (!token || token.epoch !== this.#epoch) return result(false, "stale-scene-context", { state: this.#state });
    if (!this.adapterConnected) {
      this.#state = createSceneSelectionState({
        outcome: SceneListOutcome.DISCONNECTED,
        accountKey: this.#state.accountKey,
        note: "scene-adapter-not-connected"
      });
      return result(false, "scene-adapter-not-connected", { state: this.#state });
    }

    const request = ++this.#request;
    const accountKey = this.#state.accountKey;
    this.#state = createSceneSelectionState({
      outcome: SceneListOutcome.LOADING,
      accountKey,
      note: "scene-request-in-flight"
    });

    let value;
    try {
      value = await this.#adapter.readScenes({ accountKey });
    } catch (error) {
      if (token.epoch !== this.#epoch || request !== this.#request) {
        return result(false, "stale-scene-request", { state: this.#state });
      }
      this.#state = createSceneSelectionState({
        outcome: SceneListOutcome.UNAVAILABLE,
        accountKey,
        note: error?.message ?? "scene-adapter-error"
      });
      return result(false, "scene-unavailable", { state: this.#state });
    }

    if (token.epoch !== this.#epoch || request !== this.#request) {
      return result(false, "stale-scene-request", { state: this.#state });
    }
    this.#state = normalizeSceneSelectionResult(value, accountKey);
    return result(true, null, { state: this.#state });
  }

  select(token, rowId) {
    if (!token || token.epoch !== this.#epoch) return result(false, "stale-scene-context", { state: this.#state });
    const selection = selectSceneRow(this.#state, rowId);
    if (selection.accepted) this.#state = selection.state;
    return selection;
  }
}
