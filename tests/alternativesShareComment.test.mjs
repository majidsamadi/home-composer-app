import test from "node:test";
import assert from "node:assert/strict";
import { renderAlternatives, differenceText } from "../src/presentation/alternativesCompare.js";
import { OBJECT_SHARE_NOTE, renderShareComment } from "../src/presentation/shareComment.js";
import { SYNTHETIC } from "../src/fixtures/workspaceFixtures.js";
import { createHarness } from "./helpers/workspaceHarness.mjs";
import { accessibleName, createDocument, describedBy, findAll } from "./helpers/domStub.mjs";

const { designId, placements, objects } = SYNTHETIC;
const byName = (root, tag, name) => findAll(root, item => item.localName === tag && accessibleName(item) === name)[0];

function renderShare(view, handlers = {}) {
  const doc = createDocument();
  const container = doc.createElement("div");
  doc.body.append(container);
  const calls = [];
  renderShareComment(container, {
    doc, view,
    onShareObject: (...args) => calls.push(["object", ...args]),
    onShareDesign: (...args) => calls.push(["design", ...args]),
    onComment: (...args) => calls.push(["comment", ...args]),
    onResolve: (...args) => calls.push(["resolve", ...args]),
    ...handlers
  });
  return { container, calls };
}

test("HCA-06.2 create alternative", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  const doc = createDocument();
  const container = doc.createElement("div");
  doc.body.append(container);
  const created = [];
  renderAlternatives(container, { doc, view: h.controller.view(), onCreate: name => created.push(name), onSwitch() {}, onCompare() {}, onRestore() {} });
  byName(container, "input", "Alternative name").value = "  Sofa by window  ";
  byName(container, "button", "Create alternative from revision 2").click();
  assert.deepEqual(created, ["Sofa by window"]);

  const branch = await h.controller.createAlternative("Sofa by window");
  assert.equal(branch.base_revision, 2);
  const call = h.fake.calls.find(item => item.operation === "createAlternative");
  assert.deepEqual(call.body, { name: "Sofa by window", from_branch_id: "main", base_revision: 2 });
  assert.equal(h.controller.view().branches.length, 2);

  await h.controller.switchToBranch(branch.branch_id);
  await h.controller.apply({ type: "move", placementId: placements.p1, position_m: [0, 0, 0] });
  await h.controller.save();
  const view = h.controller.view();
  assert.equal(view.branchId, branch.branch_id);
  assert.equal(view.revision, 3);
  const main = await h.fake.api.getRevision({ params: { design_id: designId, branch_id: "main", revision: 2 } });
  assert.deepEqual(main.placements[0].transform.position_m, [1, 0, 1], "main is untouched by the alternative");

  // Viewers can't create alternatives; the reason is visible.
  const viewer = createHarness({ user: "USER-C" });
  await viewer.controller.open({ designId });
  container.replaceChildren();
  renderAlternatives(container, { doc, view: viewer.controller.view(), onCreate() {}, onSwitch() {}, onCompare() {}, onRestore() {} });
  const create = byName(container, "button", "Create alternative from revision 2");
  assert.equal(create.disabled, true);
  assert.equal(describedBy(create), "Your role (viewer) can't create alternatives.");
});

test("HCA-06.3 compare differences", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  const alt = await h.controller.createAlternative("Alt");
  await h.controller.switchToBranch(alt.branch_id);
  await h.controller.apply({ type: "move", placementId: placements.p1, position_m: [0, 0, 0] });
  await h.controller.apply({ type: "rotate", placementId: placements.p1, rotation_deg_y: 0 });
  await h.controller.apply({ type: "remove", placementId: placements.p2 });
  await h.controller.save();
  const comparison = await h.controller.compare("main@2", `${alt.branch_id}@5`);
  assert.deepEqual(comparison.differences.map(item => [item.placement_id, item.change]), [
    [placements.p1, "moved"], [placements.p1, "rotated"], [placements.p2, "removed"]
  ]);
  const doc = createDocument();
  const container = doc.createElement("div");
  doc.body.append(container);
  renderAlternatives(container, { doc, view: h.controller.view(), onCreate() {}, onSwitch() {}, onCompare() {}, onRestore() {} });
  const list = container.querySelector(".compare-differences");
  assert.equal(accessibleName(list), `Differences from main@2 to ${alt.branch_id}@5`);
  assert.deepEqual(list.children.map(item => item.textContent), [
    "Placement plc_…0001: moved", "Placement plc_…0001: rotated", "Placement plc_…0002: removed"
  ]);
  assert.equal(differenceText({ placement_id: placements.p2, change: "hidden_changed" }), "Placement plc_…0002: shown/hidden changed");

  // History is kept: restoring revision 2 on the alternative creates revision 6.
  await h.controller.restore(2);
  const view = h.controller.view();
  assert.equal(view.revision, 6);
  assert.deepEqual(view.history.map(item => [item.revision, item.restoredFrom]), [[2, null], [5, null], [6, 2]]);
});

test("HCA-07.1 object vs design share distinct", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  h.controller.select(placements.p1);
  const { container, calls } = renderShare(h.controller.view());
  const objectButton = byName(container, "button", "Share this object");
  const designButton = byName(container, "button", "Share this design");
  assert.ok(objectButton && designButton && objectButton !== designButton);
  assert.match(describedBy(objectButton), new RegExp(`^${OBJECT_SHARE_NOTE}\\.`));
  assert.equal(OBJECT_SHARE_NOTE, "Shares only the object, not your home or design");
  byName(container, "input", "Share object with (user ID)").value = "USER-E";
  objectButton.click();
  assert.deepEqual(calls, [["object", { object_id: objects.box, version: "1" }, "USER-E"]]);

  const share = await h.controller.shareObject({ object_id: objects.box, version: "1" }, "USER-E");
  assert.deepEqual(Object.keys(share).sort(), ["grantee_user_id", "object_share_id", "object_source"]);
  const sent = h.fake.calls.find(item => item.operation === "shareObject");
  const serialized = JSON.stringify(sent.body);
  assert.equal(serialized.includes(designId), false);
  assert.equal(serialized.includes(SYNTHETIC.sceneId), false);
  assert.match(h.controller.view().announcement, /Only the object was shared, not your home or design/);
  const grantee = await h.fake.forUser("USER-E").getObjectShare({ params: { object_share_id: share.object_share_id } });
  assert.equal(grantee.source_outcome, "accessible");
  await assert.rejects(h.fake.forUser("USER-E").getDesign({ params: { design_id: designId } }), { status: 404 }, "object share grants no design access");

  await h.controller.shareDesign("USER-E", "commenter");
  assert.equal(h.fake.calls.filter(item => item.operation === "shareDesign").length, 1);
  assert.deepEqual(h.controller.view().participants.map(item => [item.granteeUserId, item.role, item.state]), [["USER-E", "commenter", "invited"]]);
});

test("HCA-07.2 roles", async () => {
  const roles = { "USER-A": "owner", "USER-D": "editor", "USER-B": "commenter", "USER-C": "viewer" };
  for (const [user, role] of Object.entries(roles)) {
    const h = createHarness({ user });
    await h.controller.open({ designId });
    const view = h.controller.view();
    assert.equal(view.role, role);
    assert.equal(view.canEdit, role === "owner" || role === "editor", role);
    assert.equal(view.canComment, role !== "viewer", role);
    assert.equal(view.canShareDesign, role === "owner", role);
    const { container } = renderShare(view);
    const share = byName(container, "button", "Share this design");
    assert.equal(share.disabled, role !== "owner", role);
    if (role !== "owner") assert.equal(describedBy(share), `Only the design owner can share the design. Your role: ${role}.`);
    const roleSelect = byName(container, "select", "Role");
    assert.deepEqual(roleSelect.children.map(option => option.getAttribute("value")), ["viewer", "commenter", "editor"]);
  }
  // The service enforces the same matrix (non-owner share → 403).
  const editor = createHarness({ user: "USER-D" });
  await editor.controller.open({ designId });
  await editor.controller.shareDesign("USER-E", "viewer");
  assert.equal(editor.controller.view().problemCode, "action_denied");
  assert.equal(editor.controller.view().announcement, "Your role (editor) doesn't allow this action.");
});

test("HCA-07.3 comment anchored to placement", async () => {
  const h = createHarness();
  await h.controller.open({ designId });
  h.controller.select(placements.p2);
  await h.controller.addComment("Too close to the door?");
  const sent = h.fake.calls.find(item => item.operation === "addComment");
  assert.deepEqual(sent.body.anchor, { kind: "placement", placement_id: placements.p2 });
  assert.equal(sent.body.revision, 2);
  let view = h.controller.view();
  assert.equal(view.comments.length, 1);
  assert.equal(view.comments[0].anchor_state, "current");

  let rendered = renderShare(view);
  assert.equal(accessibleName(rendered.container.querySelector(".comments ul")), `Comments on placement Object obj_…0002 v1 (plc_…0002)`);
  assert.match(rendered.container.querySelector(".comments ul li").textContent, /USER-A · revision 2 · open · On this placement in this revision: Too close to the door\?/);

  // The placement is removed in revision 3: the comment says so.
  await h.controller.apply({ type: "remove", placementId: placements.p2 });
  await h.controller.save();
  await h.controller.loadComments();
  view = h.controller.view();
  assert.equal(view.comments[0].anchor_state, "removed_in_later_revision");
  rendered = renderShare({ ...view, selection: placements.p2, placements: [...view.placements, { placement_id: placements.p2, object_source: { object_id: objects.shelf, version: "1" } }] });
  assert.match(rendered.container.querySelector(".comments ul li").textContent, /Placement removed in a later revision/);
  const resolve = byName(rendered.container, "button", "Resolve comment by USER-A");
  resolve.click();
  assert.deepEqual(rendered.calls.at(-1), ["resolve", view.comments[0].comment_id]);
  await h.controller.resolveComment(view.comments[0].comment_id);
  assert.equal(h.controller.view().comments[0].state, "resolved");

  // Commenting on a placement that isn't in the revision is refused by the service.
  await assert.rejects(h.fake.api.addComment({
    params: { design_id: designId },
    body: { branch_id: "main", revision: 3, anchor: { kind: "placement", placement_id: placements.p2 }, body: "x", reply_to: null },
    idempotencyKey: "idem-comment-x1"
  }), { status: 422, code: "validation_failed" });
});

test("viewer role cannot comment (403 text)", async () => {
  const h = createHarness({ user: "USER-C" });
  await h.controller.open({ designId });
  const view = h.controller.view();
  const { container } = renderShare(view);
  const add = byName(container, "button", "Comment on the design");
  assert.equal(add.disabled, true);
  assert.equal(describedBy(add), "Your role (viewer) can't comment. Ask the owner for commenter access.");
  assert.equal(byName(container, "textarea", "Comment").disabled, true);
  // Even if a request is made, the service answers 403 and the text names the role.
  await h.controller.addComment("hello");
  assert.equal(h.controller.view().problemCode, "action_denied");
  assert.equal(h.controller.view().announcement, "Your role (viewer) doesn't allow this action.");

  const commenter = createHarness({ user: "USER-B" });
  await commenter.controller.open({ designId });
  await commenter.controller.addComment("Looks good");
  assert.equal(commenter.controller.view().comments.length, 1);
  const rendered = renderShare(commenter.controller.view());
  assert.equal(findAll(rendered.container, item => accessibleName(item).startsWith("Resolve comment")).length, 0, "commenters can't resolve");
});
