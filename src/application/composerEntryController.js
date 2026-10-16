import { initializeDesignState, acknowledgeSave, rejectSave } from "../domain/designState.js";

export class ComposerEntryController {
  #epoch = 0;
  #state = null;

  get state() {
    return this.#state;
  }

  beginContext({ accountKey, intent, availability }) {
    this.#epoch += 1;
    const token = Object.freeze({ epoch: this.#epoch });
    this.#state = initializeDesignState({
      contextId: `ctx-${this.#epoch}`,
      accountKey,
      intent,
      availability,
      committedSnapshot: null
    });
    return token;
  }

  acceptCommittedSnapshot(token, committedSnapshot) {
    if (!token || token.epoch !== this.#epoch) {
      return Object.freeze({ accepted: false, reason: "stale-context", state: this.#state });
    }
    if (this.#state.availability.kind !== "ready") {
      return Object.freeze({ accepted: false, reason: "availability-blocked", state: this.#state });
    }
    if (this.#state.intent.kind !== "design") {
      return Object.freeze({ accepted: false, reason: "object-intent-has-no-design-destination", state: this.#state });
    }
    this.#state = initializeDesignState({
      contextId: this.#state.contextId,
      accountKey: this.#state.accountKey,
      intent: this.#state.intent,
      availability: this.#state.availability,
      committedSnapshot
    });
    return Object.freeze({ accepted: true, reason: null, state: this.#state });
  }

  replaceState(state) {
    this.#state = state;
    return this.#state;
  }

  saveToken(operationId) {
    return Object.freeze({ epoch: this.#epoch, operationId });
  }

  acceptSaveAcknowledgement(token, authoritativeSnapshot) {
    if (!token || token.epoch !== this.#epoch) {
      return Object.freeze({ accepted: false, reason: "stale-context", state: this.#state });
    }
    const result = acknowledgeSave(this.#state, {
      operationId: token.operationId,
      authoritativeSnapshot
    });
    if (result.accepted) this.#state = result.state;
    return result;
  }

  acceptSaveFailure(token, error) {
    if (!token || token.epoch !== this.#epoch) {
      return Object.freeze({ accepted: false, reason: "stale-context", state: this.#state });
    }
    this.#state = rejectSave(this.#state, { operationId: token.operationId, error });
    return Object.freeze({ accepted: true, reason: null, state: this.#state });
  }
}
