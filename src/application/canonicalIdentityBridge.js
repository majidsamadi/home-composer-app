import { CONTRACT } from "../../vendor/wisestay-web-session/web-session.mjs";
import { assertEntryIntent } from "../domain/entryIntent.js";

function result(accepted, reason, extra = {}) {
  return Object.freeze({ accepted, reason, ...extra });
}

function restoreFailureReason(error) {
  if (error && typeof error.code === "string" && error.code) return `canonical-${error.code}`;
  return "canonical-session-unavailable";
}

// Process-local receipt currentness: the exact receipt object the canonical session
// holds now, while it is authenticated. Not a resource/action grant. The canonical
// client at the wave 3 pin has no isCurrent(), so the bridge keeps the check here.
export function isCurrentReceipt(session, receipt) {
  return receipt != null && session.receipt === receipt && session.authenticated === true;
}

export class ComposerCanonicalIdentityBridge {
  #controller;
  #session;
  #generation = 0;

  constructor({ controller, session = null }) {
    if (!controller || typeof controller.beginContext !== "function" || typeof controller.invalidatePresentation !== "function") {
      throw new TypeError("controller with beginContext/invalidatePresentation is required");
    }
    this.#controller = controller;
    this.#session = session;
  }

  get sessionConnected() {
    return Boolean(this.#session?.enabled);
  }

  setSession(session) {
    this.#generation += 1;
    this.#controller.invalidatePresentation();
    this.#session = session ?? null;
    return result(true, null, { connected: this.sessionConnected });
  }

  invalidate(reason = "canonical-session-invalidated") {
    this.#generation += 1;
    this.#controller.invalidatePresentation();
    return result(false, reason);
  }

  disconnect(reason = "canonical-session-disconnected") {
    this.#session = null;
    return this.invalidate(reason);
  }

  async restoreContext({ intent, availability, force = false } = {}) {
    assertEntryIntent(intent);
    const generation = ++this.#generation;

    // Private Composer state is invalidated before any asynchronous identity refresh.
    // A late receipt can therefore never keep an earlier design visible while a new
    // canonical account is being resolved.
    this.#controller.invalidatePresentation();

    const session = this.#session;
    if (!session) return result(false, "canonical-session-missing");
    if (session.enabled !== true) return result(false, "canonical-session-disabled");
    if (!availability || typeof availability.kind !== "string") {
      return result(false, "resource-availability-required");
    }

    let receipt;
    try {
      receipt = await session.restore(force);
    } catch (error) {
      if (generation !== this.#generation) return result(false, "superseded-restore");
      this.#controller.invalidatePresentation();
      return result(false, restoreFailureReason(error));
    }

    if (generation !== this.#generation) return result(false, "superseded-restore");
    if (
      !receipt?.authenticated ||
      receipt.contract !== CONTRACT ||
      receipt.identity_contract !== "wisestay.identity.v1" ||
      session.authenticated !== true ||
      !session.userId ||
      session.userId !== receipt.user_id
    ) {
      this.#controller.invalidatePresentation();
      return result(false, "canonical-session-unavailable");
    }
    if (!isCurrentReceipt(session, receipt)) {
      this.#controller.invalidatePresentation();
      return result(false, "canonical-session-changed");
    }

    // Identity is only mapped to account context. Resource/design availability is
    // independently supplied by the owning adapter; this bridge does not promote it.
    const token = this.#controller.beginContext({
      accountKey: session.userId,
      intent,
      availability
    });
    return result(true, null, { token, accountKey: session.userId });
  }
}
