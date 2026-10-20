import {
  LibraryOutcome,
  createLibraryState,
  normalizeLibraryResult,
  selectLibraryRow
} from "../domain/designLibraryState.js";

function result(accepted, reason, extra = {}) {
  return Object.freeze({ accepted, reason, ...extra });
}

export class DesignLibraryController {
  #adapter;
  #epoch = 0;
  #request = 0;
  #state = createLibraryState();

  constructor({ adapter = null } = {}) {
    this.#adapter = adapter;
  }

  get state() {
    return this.#state;
  }

  get adapterConnected() {
    return Boolean(this.#adapter && typeof this.#adapter.readLibrary === "function");
  }

  setAdapter(adapter) {
    this.#adapter = adapter ?? null;
    return this.invalidateContext("library-adapter-changed");
  }

  invalidateContext(reason = "library-context-invalidated") {
    this.#epoch += 1;
    this.#request += 1;
    this.#state = createLibraryState({ outcome: LibraryOutcome.DISCONNECTED, note: reason });
    return Object.freeze({ epoch: this.#epoch });
  }

  beginContext({ accountKey }) {
    if (typeof accountKey !== "string" || accountKey.trim() === "") {
      throw new TypeError("library accountKey must be a non-empty string");
    }
    this.#epoch += 1;
    this.#request += 1;
    const token = Object.freeze({ epoch: this.#epoch });
    // Context switches clear all private rows and prior selection immediately.
    this.#state = createLibraryState({
      outcome: LibraryOutcome.DISCONNECTED,
      accountKey,
      note: this.adapterConnected ? "library-context-ready-to-load" : "library-adapter-not-connected"
    });
    return token;
  }

  async load(token) {
    if (!token || token.epoch !== this.#epoch) {
      return result(false, "stale-library-context", { state: this.#state });
    }
    if (!this.adapterConnected) {
      this.#state = createLibraryState({
        outcome: LibraryOutcome.DISCONNECTED,
        accountKey: this.#state.accountKey,
        note: "library-adapter-not-connected"
      });
      return result(false, "library-adapter-not-connected", { state: this.#state });
    }

    const request = ++this.#request;
    const accountKey = this.#state.accountKey;
    this.#state = createLibraryState({
      outcome: LibraryOutcome.LOADING,
      accountKey,
      note: "library-request-in-flight"
    });

    let value;
    try {
      value = await this.#adapter.readLibrary({ accountKey });
    } catch (error) {
      if (token.epoch !== this.#epoch || request !== this.#request) {
        return result(false, "stale-library-request", { state: this.#state });
      }
      this.#state = createLibraryState({
        outcome: LibraryOutcome.UNAVAILABLE,
        accountKey,
        note: error?.message ?? "library-adapter-error"
      });
      return result(false, "library-unavailable", { state: this.#state });
    }

    if (token.epoch !== this.#epoch || request !== this.#request) {
      return result(false, "stale-library-request", { state: this.#state });
    }
    this.#state = normalizeLibraryResult(value, accountKey);
    return result(true, null, { state: this.#state });
  }

  select(token, rowId) {
    if (!token || token.epoch !== this.#epoch) {
      return result(false, "stale-library-context", { state: this.#state });
    }
    const selection = selectLibraryRow(this.#state, rowId);
    if (selection.accepted) this.#state = selection.state;
    return selection;
  }
}
