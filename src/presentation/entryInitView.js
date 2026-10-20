// Entry-initialization review section (HCA-01.1, HCA-01.4; R0 findings C-R2, C-R3).
// Read-only: renders the description and keeps Open/Edit/Save visibly disabled with
// a reason. Works against the browser document or tests/helpers/domStub.mjs.
import { describeEntryInitialization } from "../application/entryInitializationPresentation.js";
import { entryInitializationFixtures } from "../fixtures/entryInitializationFixtures.js";

export const ENTRY_INIT_ACTIONS = Object.freeze([
  Object.freeze({ action: "open", label: "Open" }),
  Object.freeze({ action: "edit", label: "Edit" }),
  Object.freeze({ action: "save", label: "Save" })
]);

export function entryInitActionsReason(description) {
  return `Open, Edit and Save are disabled: this is a read-only synthetic review with no account, design or save authority connected. Current state: ${description.headline}.`;
}

export function renderEntryInitActions(group, reasonElement, description) {
  reasonElement.textContent = entryInitActionsReason(description);
  for (const button of group.querySelectorAll("button[data-entry-init-action]")) {
    button.disabled = description.actionsDisabled === true;
    button.setAttribute("aria-describedby", reasonElement.id);
  }
}

const SECTION_PREFIX = Object.freeze({ entry: "", committed: "Committed — ", unsaved: "Unsaved example — " });

export function mountEntryInitialization(doc, fixtures = entryInitializationFixtures) {
  const controls = doc.getElementById("entry-init-controls");
  const status = doc.getElementById("entry-init-status");
  const text = doc.getElementById("entry-init-text");
  const facts = doc.getElementById("entry-init-facts");
  const actions = doc.getElementById("entry-init-actions");
  const reason = doc.getElementById("entry-init-actions-reason");

  function render(fixtureId) {
    const fixture = fixtures.find(item => item.id === fixtureId);
    const description = describeEntryInitialization(fixture ? fixture.input : { intent: null });
    status.textContent = `${fixture ? fixture.label : "No state selected"} · ${description.status} — ${description.headline}`;
    text.textContent = description.textAlternative;
    facts.replaceChildren();
    for (const item of description.rows) {
      const term = doc.createElement("dt");
      term.textContent = `${SECTION_PREFIX[item.section]}${item.label}`;
      const value = doc.createElement("dd");
      value.textContent = item.value;
      value.dataset.supplied = String(item.supplied);
      const source = doc.createElement("small");
      source.textContent = `Source: ${item.source}`;
      value.append(source);
      facts.append(term, value);
    }
    renderEntryInitActions(actions, reason, description);
    for (const button of controls.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.entryInitFixture === fixtureId));
    }
    return description;
  }

  for (const fixture of fixtures) {
    const button = doc.createElement("button");
    button.type = "button";
    button.dataset.entryInitFixture = fixture.id;
    button.textContent = fixture.label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => render(fixture.id));
    controls.append(button);
  }
  return { render };
}
