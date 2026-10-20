# E-P06-DESIGN-STATE-CODE-01

Bounded executable preparation for P06 E01: HCA-01.1, HCA-01.4 and HCB-01.2 source-reference meaning.

## What is implemented

- Distinct incoming Object and Design intent values with explicit revision-presence tracking.
- Immutable committed design snapshots with exact Home/Object source-version pins.
- Separate working state that cannot mutate the loaded committed snapshot or source references.
- Dirty/pending/failed state that does not present as committed until an injected authoritative acknowledgement succeeds.
- Distinct edit-disabled `wrong-account`, `withdrawn-home`, `missing-dependency` and `pending-invitation` availability inputs.
- Epoch-based rejection of stale load/save results after context/account switches.
- Source-version mismatch rejection during authoritative save acknowledgement.
- Minimal local browser entry using synthetic fixtures only; all real/domain service actions are disabled.

## Not selected or implemented

No public/persisted schema, backend route/database, identity provider, positive permission, invitation-acceptance behavior, draft-storage/discard policy, migration rule, renderer/viewer framework, physical scale/fit rule or deployment is selected by this E-P06 slice. The wave 2 workspace below consumes the delegated-provisional v0.4 draft contracts (Q01–Q16) through fakes only.

## Run

```bash
npm test
npm run example
python3 -m http.server 8080
# then open http://127.0.0.1:8080/
```

No npm install is required; tests use Node's built-in test runner.

## Wave 2 workspace (HCA-02, 03, 04, 06, 07)

Status: component-tested (synthetic data only). Fake Composer service, fake viewer, DOM stub. No live service, viewer or browser run.

- `src/service/`: `composerApi.js` (ComposerApi port, one operation per table C route, `ServiceProblem`), `composerHttpApi.js` (BFF path `/api/v1/web-session/composer/api/composer<path>` over an injected transport; the default transport is disconnected and never fetches) and `fakeComposerApi.js` (in-memory table C behaviour, Q07 role matrix, expected-revision/version conflicts, idempotency keys, HCB-04 fit rules with Q03 provisional thresholds).
- `src/viewer/viewerPort.js`: mirror of the ARC shared viewer interface `wisestay.viewer/1.0.0-draft` (X.8.1) with `assertViewerContract`. HCA never imports ARC code.
- `src/domain/workspaceState.js`: pending-command working state over the last server revision (unsaved/saving/saved/conflict, undo, conflict rebase that never overwrites the other writer).
- `src/application/`: `workspaceController.js` (design → C23 view-session → `viewer.load` → `setInstances`, camera, device loss, save, alternatives, compare, restore, share, comments) and `objectIdEntryController.js` (Object ID entry, exact-version preview, add placement).
- `src/presentation/`: placement controls (keyboard and numeric), alternatives/compare/history, share/comment, fit wording, workspace status text, and the "Workspace (synthetic review)" section of `index.html`.

Fit results use the Q03 provisional thresholds (`Q03-provisional-2026-10-20`) and are not an accuracy claim. Door swing and openings are not checked. The contract fixtures are v0.4 DRAFT / SYNTHETIC — NOT FROZEN.
