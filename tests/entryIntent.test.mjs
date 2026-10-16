import test from "node:test";
import assert from "node:assert/strict";
import { createDesignIntent, createObjectIntent, describeEntryIntent } from "../src/domain/entryIntent.js";

test("Object ID and Design ID remain distinct with independent revision presence", () => {
  const object = createObjectIntent({ objectId: "O1", objectRevision: "v1" });
  const design = createDesignIntent({ designId: "D1" });
  assert.deepEqual(describeEntryIntent(object), { kind: "object", id: "O1", revision: "v1" });
  assert.deepEqual(describeEntryIntent(design), { kind: "design", id: "D1", revision: "Not supplied" });
  assert.equal(object.reference.id === design.reference.id, false);
});
