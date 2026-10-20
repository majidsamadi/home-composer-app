// Share and comment UI (HCA-07.1–07.3). Status: component-tested (DOM stub).
// "Share this object" (C18) and "Share this design" (C14) are two separate actions.
import { el, uniqueId, withReason } from "./dom.js";
import { placementLabel, shortId } from "../application/workspaceController.js";

export const OBJECT_SHARE_NOTE = "Shares only the object, not your home or design";
export const ROLE_TEXT = Object.freeze({
  viewer: "Viewer — can look, can't comment or edit",
  commenter: "Commenter — can look and comment",
  editor: "Editor — can comment and edit placements"
});
export const ANCHOR_STATE_TEXT = Object.freeze({
  current: "On this placement in this revision",
  removed_in_later_revision: "Placement removed in a later revision"
});

function commentsFor(view, placementId) {
  return view.comments.filter(item => (placementId
    ? item.anchor.kind === "placement" && item.anchor.placement_id === placementId
    : item.anchor.kind === "design"));
}

export function renderShareComment(container, { doc, view, onShareObject, onShareDesign, onComment, onResolve }) {
  const root = el(doc, "div", { class: "share-comment" });
  container.replaceChildren(root);
  const selected = view.placements.find(item => item.placement_id === view.selection) ?? null;

  // Share this object.
  const objectHeading = uniqueId("share-object-heading");
  const objectNote = uniqueId("share-object-note");
  const objectGrantee = uniqueId("share-object-grantee");
  const objectInput = el(doc, "input", { id: objectGrantee, type: "text", value: "" });
  const objectButton = el(doc, "button", {
    type: "button", text: "Share this object", disabled: !selected, "aria-describedby": objectNote,
    on: { click: () => { const grantee = objectInput.value.trim(); if (selected && grantee) onShareObject(selected.object_source, grantee); } }
  });
  root.append(el(doc, "section", { class: "share-object", "aria-labelledby": objectHeading },
    el(doc, "h3", { id: objectHeading, text: "Share this object" }),
    el(doc, "p", { id: objectNote, class: "note", text: selected
      ? `${OBJECT_SHARE_NOTE}. Object: ${placementLabel(selected)}.`
      : `${OBJECT_SHARE_NOTE}. Select a placement first.` }),
    el(doc, "label", { for: objectGrantee, text: "Share object with (user ID)" }), objectInput, objectButton
  ));

  // Share this design.
  const designHeading = uniqueId("share-design-heading");
  const designGrantee = uniqueId("share-design-grantee");
  const roleId = uniqueId("share-design-role");
  const designInput = el(doc, "input", { id: designGrantee, type: "text", value: "", disabled: !view.canShareDesign });
  const roleSelect = el(doc, "select", { id: roleId, disabled: !view.canShareDesign },
    ...Object.entries(ROLE_TEXT).map(([value, text]) => el(doc, "option", { value, text })));
  const designButton = el(doc, "button", {
    type: "button", text: "Share this design", disabled: !view.canShareDesign,
    on: { click: () => { const grantee = designInput.value.trim(); if (grantee) onShareDesign(grantee, roleSelect.value); } }
  });
  const participants = el(doc, "ul", { "aria-label": "Participants" },
    el(doc, "li", { text: `You · ${view.role ?? "no role"}` }),
    ...view.participants.map(item => el(doc, "li", { text: `${item.granteeUserId} · ${item.role} · ${item.state}` })));
  root.append(el(doc, "section", { class: "share-design", "aria-labelledby": designHeading },
    el(doc, "h3", { id: designHeading, text: "Share this design" }),
    el(doc, "p", { class: "note", text: "Shares this design and its home view with the role you choose." }),
    el(doc, "label", { for: designGrantee, text: "Share design with (user ID)" }), designInput,
    el(doc, "label", { for: roleId, text: "Role" }), roleSelect,
    ...withReason(doc, designButton, view.canShareDesign ? null : `Only the design owner can share the design. Your role: ${view.role ?? "none"}.`, "share-design-reason"),
    el(doc, "h4", { text: "Participants (invited in this session)" }), participants
  ));

  // Comments anchored to the selected placement (or the design when none is selected).
  const commentHeading = uniqueId("comments-heading");
  const bodyId = uniqueId("comment-body");
  const anchorText = selected ? `placement ${placementLabel(selected)} (${shortId(selected.placement_id)})` : "the design";
  const thread = el(doc, "ul", { "aria-label": `Comments on ${anchorText}` });
  const items = commentsFor(view, selected?.placement_id ?? null);
  if (!items.length) thread.append(el(doc, "li", { text: "No comments yet." }));
  for (const item of items) {
    const canResolve = item.state === "open" && (view.role === "owner" || view.role === "editor");
    const anchorState = item.anchor.kind === "placement" ? ` · ${ANCHOR_STATE_TEXT[item.anchor_state] ?? item.anchor_state}` : "";
    thread.append(el(doc, "li", { "data-comment-id": item.comment_id },
      `${item.author_user_id} · revision ${item.revision} · ${item.state}${anchorState}: ${item.body}`,
      canResolve ? el(doc, "button", { type: "button", text: "Resolve", "aria-label": `Resolve comment by ${item.author_user_id}`, on: { click: () => onResolve(item.comment_id) } }) : null
    ));
  }
  const textarea = el(doc, "textarea", { id: bodyId, maxlength: "2000", disabled: !view.canComment });
  const add = el(doc, "button", {
    type: "button", text: `Comment on ${selected ? "this placement" : "the design"}`, disabled: !view.canComment,
    on: { click: () => { const text = textarea.value.trim(); if (text) onComment(text); } }
  });
  root.append(el(doc, "section", { class: "comments", "aria-labelledby": commentHeading },
    el(doc, "h3", { id: commentHeading, text: `Comments on ${anchorText}` }),
    thread,
    el(doc, "label", { for: bodyId, text: "Comment" }), textarea,
    ...withReason(doc, add, view.canComment ? null : `Your role (${view.role}) can't comment. Ask the owner for commenter access.`, "comment-reason")
  ));
  return root;
}
