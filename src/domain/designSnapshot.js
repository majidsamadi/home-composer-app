function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function sourceReference({ service, id, version }) {
  return deepFreeze({
    service: requiredText(service, "source service"),
    id: requiredText(id, "source id"),
    version: requiredText(version, "source version")
  });
}

export function placement({ placementId, object, transform }) {
  const normalized = {
    placementId: requiredText(placementId, "placementId"),
    object: sourceReference(object),
    transform: {
      x: finiteNumber(transform?.x ?? 0, "transform.x"),
      y: finiteNumber(transform?.y ?? 0, "transform.y"),
      rotationDegrees: finiteNumber(transform?.rotationDegrees ?? 0, "transform.rotationDegrees")
    }
  };
  return deepFreeze(normalized);
}

export function createCommittedSnapshot({ designId, revision, home, placements = [] }) {
  const normalizedPlacements = placements.map(placement);
  const seen = new Set();
  for (const item of normalizedPlacements) {
    if (seen.has(item.placementId)) throw new Error(`duplicate placement ${item.placementId}`);
    seen.add(item.placementId);
  }
  return deepFreeze({
    designId: requiredText(designId, "designId"),
    revision: requiredText(revision, "revision"),
    home: sourceReference(home),
    placements: normalizedPlacements
  });
}

export function cloneSnapshot(snapshot) {
  return {
    designId: snapshot.designId,
    revision: snapshot.revision,
    home: { ...snapshot.home },
    placements: snapshot.placements.map(item => ({
      placementId: item.placementId,
      object: { ...item.object },
      transform: { ...item.transform }
    }))
  };
}

export function sourceReferenceFingerprint(snapshot) {
  return JSON.stringify({
    home: snapshot.home,
    placements: snapshot.placements.map(item => ({
      placementId: item.placementId,
      object: item.object
    }))
  });
}

export function samePinnedSources(a, b) {
  return sourceReferenceFingerprint(a) === sourceReferenceFingerprint(b);
}
