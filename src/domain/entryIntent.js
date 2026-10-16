const INTENT_KINDS = new Set(["object", "design"]);

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function suppliedText(value, label) {
  if (value === undefined) return Object.freeze({ supplied: false });
  return Object.freeze({ supplied: true, value: requiredText(value, label) });
}

function freezeIntent(intent) {
  Object.freeze(intent.reference);
  return Object.freeze(intent);
}

export function createObjectIntent({ objectId, objectRevision } = {}) {
  return freezeIntent({
    kind: "object",
    reference: {
      id: requiredText(objectId, "objectId"),
      revision: suppliedText(objectRevision, "objectRevision")
    }
  });
}

export function createDesignIntent({ designId, designRevision } = {}) {
  return freezeIntent({
    kind: "design",
    reference: {
      id: requiredText(designId, "designId"),
      revision: suppliedText(designRevision, "designRevision")
    }
  });
}

export function assertEntryIntent(intent) {
  if (!intent || !INTENT_KINDS.has(intent.kind)) {
    throw new TypeError("intent must be an object or design intent");
  }
  requiredText(intent.reference?.id, `${intent.kind} reference id`);
  if (!intent.reference?.revision || typeof intent.reference.revision.supplied !== "boolean") {
    throw new TypeError("intent revision presence must be explicit");
  }
  if (intent.reference.revision.supplied) {
    requiredText(intent.reference.revision.value, `${intent.kind} revision`);
  }
  return intent;
}

export function describeEntryIntent(intent) {
  assertEntryIntent(intent);
  const revision = intent.reference.revision.supplied
    ? intent.reference.revision.value
    : "Not supplied";
  return Object.freeze({
    kind: intent.kind,
    id: intent.reference.id,
    revision
  });
}
