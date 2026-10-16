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

No public/persisted schema, backend route/database, identity provider, positive permission, invitation-acceptance behavior, draft-storage/discard policy, migration rule, renderer/viewer framework, physical scale/fit rule or deployment is selected by this code.

## Run

```bash
npm test
npm run example
python3 -m http.server 8080
# then open http://127.0.0.1:8080/
```

No npm install is required; tests use Node's built-in test runner.
