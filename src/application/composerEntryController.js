import {
  initializeDesignState,
  acknowledgeSave,
  committedSnapshotMismatchReason,
  rejectSave
} from "../domain/designState.js";


function sameRevisionPresence(a, b) {
  if (!a || !b || a.supplied !== b.supplied) return false;
  return !a.supplied || a.value === b.value;
}

function sameIntent(a, b) {
  return Boolean(a && b)
    && a.kind === b.kind
    && a.reference?.id === b.reference?.id
    && sameRevisionPresence(a.reference?.revision, b.reference?.revision);
}

function sameAvailability(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  return sameRevisionPresence(a.reason, b.reason);
}

function replacementStateMismatchReason(current, next) {
  if (!next || typeof next !== "object") return "invalid-replacement-state";
  if (next.contextId !== current.contextId) return "replacement-context-mismatch";
  if (next.accountKey !== current.accountKey) return "replacement-account-mismatch";
  if (!sameIntent(next.intent, current.intent)) return "replacement-intent-mismatch";
  if (!sameAvailability(next.availability, current.availability)) return "replacement-availability-mismatch";
  return null;
}

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
    const mismatchReason = committedSnapshotMismatchReason(this.#state.intent, committedSnapshot);
    if (mismatchReason) {
      return Object.freeze({ accepted: false, reason: mismatchReason, state: this.#state });
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

  replaceState(token, expectedState, nextState) {
    if (!token || token.epoch !== this.#epoch) {
      return Object.freeze({ accepted: false, reason: "stale-context", state: this.#state });
    }
    if (expectedState !== this.#state) {
      return Object.freeze({ accepted: false, reason: "stale-state", state: this.#state });
    }
    const mismatchReason = replacementStateMismatchReason(this.#state, nextState);
    if (mismatchReason) {
      return Object.freeze({ accepted: false, reason: mismatchReason, state: this.#state });
    }
    this.#state = nextState;
    return Object.freeze({ accepted: true, reason: null, state: this.#state });
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
