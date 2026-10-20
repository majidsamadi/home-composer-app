# DRAFT / SYNTHETIC — NOT FROZEN

B-RFX-01..08 v0.3 draft fixtures, Home Composer **consumer copy**. The reference copy is in `three-dimension-view-arcore-backend/contracts/draft/v0.3/`.

- Packet record: `WS-B-P03-C03-REVIEW-0.1`, from `WiseStay_Team_B_C_HANDOVER03_Reconciliation_v0.1.zip` (sha256 `b550b4f592210856b5c9df970c2c85909d6477c0070d080ed7c9ad5964258549`).
- Set digest, which is sha256 of `SHA256SUMS`: `945c37d59266ec214717eb76b92ed2170f56bf1f756936d7a393bf7554d58ba0`.
- The 12 files listed in `SHA256SUMS` are byte-for-byte packet members. Do not edit them. `.gitattributes` marks them `-text`.
- `fixtures/revised/B-RFX-03_version-component.v0.2.json` is the effective B-RFX-03. `fixtures/original/B-RFX-03_version-component.json` is kept as history and treated as superseded.
- `status: PREPARED_NOT_EXECUTED_NOT_ACCEPTED` in each fixture is authoritative. No field here is a deployed API schema. Freezing needs owner answers to Q01, Q03, Q04, Q05 and Q06 (see `docs/DECISIONS_PENDING.md`).

Sync check: `node scripts/check-contract-fixtures.mjs` (or `npm run check:contracts`). Use `--compare <repo-root> ...` to compare sibling copies. The check is unit-tested in `tests/contractFixtures.sync.test.mjs`, and the fixtures are consumed by `tests/contractFixtures.v0_3.test.mjs`.

A stray `.DS_Store` (or any other unlisted file) under a checksum-closed subtree fails the checker by design; `.gitignore` ignores `.DS_Store` so it is never committed.
