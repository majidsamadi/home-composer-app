# Home Composer — application requirements

**Document:** HCA-SRS-001 · **Version:** 1.0 · **Date:** 14 October 2026  
**Repository:** majidsamadi/home-composer-app  
**Status:** requirements only; no implemented WebGPU composer, completed scanner integration or qualified fit/navigation engine.

Shared references: [platform v1.0](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/PLATFORM_REQUIREMENTS.md), [contracts](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/CONTRACTS.md), [decisions/acceptance](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/DECISIONS_AND_ACCEPTANCE.md). C = confirmed; E = engineering proposal; F/P/X = foundation/pilot/expansion.

## 1. Product definition

A Vue/Suha workspace for trying scanned products in saved homes before purchase, arranging furniture, comparing alternatives and discussing designs. Load home and object assets from their owning services; store arrangements through Composer backend. Use WebGPU as the primary browser rendering target now. Retain WebGL2 only as an explicitly identified compatibility fallback if qualified; fallback is not accepted as completion of WebGPU work.

This is an interactive assembled 3D scene, not a video, mandatory live-camera AR application or another home/object scanner. Physical AR overlays can be a future separately scoped mode. Automatic placement, room dimensions, exact collision and removing existing furniture require supporting geometry/evidence rather than a rendering-library switch.

## 2. User journeys

**HJ-01 Try a store table.** User centrally authenticates, opens their existing home, pastes/resolves the scanned Object ID, confirms the product variant/scale and places it. Save a private Design ID; no purchase or listing publication happens automatically.

**HJ-02 Ask the tenant.** Share Object ID for independent trial, or Design ID for the same arrangement. The tenant signs in, sees the allowed home/object versions, comments at the table and optionally saves an authorized alternative. Owner compares opinions and revisions; comments do not silently move objects or approve payments.

**HJ-03 Online seller ID.** Shopper copies a seller Object ID from a listing and opens it in Composer. The viewer displays permitted dimensions/variant/rights and the source's accuracy limits. The seller does not receive home geometry or access just because their object was loaded.

**HJ-04 Furnished home.** Add an item to the existing room. To replace old furniture, hide a known separable instance or use an explicit reviewed editing workflow. If the original furniture is fused into the scan, show that limitation; do not promise one-click removal or invent the hidden wall/floor.

## 3. Required screens and controls

| Screen / panel | Required behavior |
|---|---|
| Account entry | Central SSO, safe return path and account/context isolation |
| Design library | Private/shared/published status, search, recent edits, pinned-home version and unavailable references |
| New design | Select an authorized home revision or explicitly labelled sandbox; source scale/coverage preview |
| 3D workspace | WebGPU scene, orbit/zoom/top view, object list, room navigation, load/quality/rights state |
| Add object | Object ID input, optional ID/QR handoff, private/public-to-eligible-user library, variant preview and permission failures |
| Transform inspector | Numeric/keyboard move and rotate, physical size, pivot/anchor, illustrative scaling warning, reset |
| Fit and clearance | Method/support/uncertainty, dimension comparison and explicit approximate/unknown results |
| Alternatives | Fork/save, side-by-side or sequential comparison, difference summary and version selection |
| Discussion | Versioned object/scene anchors, comments, unresolved/resolved discussion and role display |
| Share and review | Object-only versus design share, intended recipients, view/comment/edit scopes and expiry |
| Source updates | Old/new asset/home version differences, broken anchors, revalidation and explicit upgrade |
| Publication/settings | Separate design publication, data privacy, local draft cleanup, accessibility and diagnostics |

Saving, sharing and publishing must have separate actions. Preview thumbnails must not disclose private designs to unauthenticated caches or notifications.

## 4. Detailed requirements

| ID | Basis / stage | Requirement | Acceptance |
|---|---|---|---|
| HCA-001 | C / F | Use Vue SPA/Suha and central first-party SSO. | No independent password flow, Ionic or React; login returns to allowed design route without credentials in URLs. |
| HCA-002 | C / P | Use WebGPU for primary rendering and report the actual renderer. | Device/adapter failure and missing features handled; screenshot/interaction evidence uses WebGPU, not an unlabelled WebGL path. |
| HCA-003 | E / F | Separate renderer, asset loader, entitlement, design state and API adapters. | Renderer replacement cannot bypass permissions or duplicate Composer/domain logic in GPU code. |
| HCA-004 | C+E / P | Load exact authorized home/object revisions through protected service contracts. | No arbitrary manifest URLs, public S3 bypass or backend-wide credentials; expired dependencies fail safely. |
| HCA-005 | E / P | Load bounded progressive representations with coherent version/integrity checks. | Missing/tampered chunks and GPU limits produce visible partial/error states; no mixed-version scene. |
| HCA-006 | C+E / P | Support orbit, zoom, top view, object focus and explicit room navigation where geometry permits. | Top view is not labelled measured floor plan; walkthrough without navigation/collision evidence is labelled limited. |
| HCA-007 | C+E / P | Resolve a copied Object ID and present version, product variant, dimensions and use rights before placement. | Wrong/private/withdrawn IDs, wrong variant and unsupported asset format are actionable states, not generic substitutes. |
| HCA-008 | C+E / P | Place objects at their recorded real size by default. | A known-size model matches the room's verified coordinate scale; missing home/object scale disables verified-fit claims. |
| HCA-009 | E / P | Provide numeric and gesture move/rotate controls with pivot/anchor disclosure. | Keyboard/text controls and touch gestures produce the same validated transforms without axis/sign errors. |
| HCA-010 | E / P | Separate free illustrative scaling from physically faithful placement. | Any size change is prominently labelled and cannot make a product-fit assessment pass as its real dimensions. |
| HCA-011 | C+E / P | Add/hide/duplicate/remove placements without changing source asset ownership or stock. | Duplicating a table creates a second placement only; removal leaves the reusable asset and source home intact. |
| HCA-012 | C+E / P | Expose embedded/separable captured furniture before replacement. | An inseparable scanned sofa remains visibly limited; hidden/inferred replacement layers retain source provenance. |
| HCA-013 | E / P | Present fit/clearance results with method, data support and uncertainty. | Bounding-box/approximate tests are not advertised as exact collision; unknown floor/door geometry returns unknown. |
| HCA-014 | E / X | Distinguish furniture footprint, moving-part clearance and delivery-path checks. | A fitting fridge footprint alone cannot certify door opening, utilities or delivery through all passages. |
| HCA-015 | C+E / P | Save private designs and alternatives as versioned backend records. | Reopening reproduces exact assets/transforms; one alternative does not overwrite another or a public listing. |
| HCA-016 | E / F | Provide bounded undo/redo and conflict-aware save. | Stale two-device edits surface conflict/diff; rollback cannot silently discard another participant's current work or revive rights. |
| HCA-017 | C+E / P | Make Object ID sharing and Design ID sharing visibly different. | Object-only share contains no home reference; design share preview shows intended recipients and permitted arrangement. |
| HCA-018 | C+E / P | Enforce viewer/commenter/editor affordances while relying on backend authorization. | Commenter cannot move furniture via UI or crafted API; accepting a design invite cannot bypass source-asset grants. |
| HCA-019 | C+E / P | Support comments attached to the correct placement and design revision. | Later movement/removal marks context outdated/orphaned rather than attaching discussion to another item. |
| HCA-020 | E / P | Compare alternatives and source updates explicitly. | New model size/coordinate revision is previewed and revalidated; previous arrangement is reproducible and not silently upgraded. |
| HCA-021 | E / F | Treat private save, proposal approval and published composition as separate states. | A positive comment/save does not publish a tour, change tenancy or order furniture. |
| HCA-022 | E / F | Preserve safe local drafts and truthful offline boundaries. | Offline edits remain local/pending; sharing/publication requires current online checks; expired lease preserves data but grants no new viewing rights. |
| HCA-023 | E / F | Handle access withdrawal/deletion/expiry and missing assets without misleading replacement. | No stale scene restored after logout or expiry; tombstones preserve design context and current rights. |
| HCA-024 | C+E / F | Keep portable export and subscription-view checks distinct from rendering. | Browser dev/debug/backup/download controls cannot expose new protected assets through legacy unrestricted exports. |
| HCA-025 | E / F | Dispose GPU resources, workers, event listeners and private scene data on context change. | Device loss, tab hiding, account switch and navigation have bounded cleanup/reopen without hidden capture or stale comments. |
| HCA-026 | E / P | Provide accessible object lists, text transforms, locations and comparison summaries. | Keyboard and screen reader complete add/place/save/share without needing precise 3D dragging. |
| HCA-027 | E / F | Measure sustained device performance and integrity, not just a static render. | Qualified scene budgets cover load time, memory, frame pacing, battery/thermal and corrupt/oversized asset rejection. |
| HCA-028 | C+E / F | Preserve Vue/Suha source boundaries and GitHub main-release discipline. | No source assets/templates/secrets in public CI; web/native releases have separate build/signing and physical evidence. |

## 5. State and integration contracts

Backend state is authoritative for Design IDs, membership, revisions, publication and dependency rights. Local state separates rendered committed revision, unsaved working changes and queued draft save; saving is not successful until the original operation is confirmed. Use the shared `Design`, `Placement`, `FitAssessment`, comment-anchor and protected-manifest profiles. Do not duplicate asset geometry in design JSON or infer a writable property profile from a cached name.

API families: design library/create/open, placements, alternatives, comments/shares, fit results, asset upgrades, view sessions and publication. Integration adapters must use released Account Centre and home/object service APIs. No renderer is permitted to resolve private raw S3 paths from user-supplied strings. A CDN delivery grant and scene decryption rights are separately bounded.

A Vue component owns user interaction and mount/unmount, not cryptographic issuance or reconstructed geometry authority. The shared visualization SDK exposes renderer capability/loss, authorized scene loading, transform events, selection and cleanup. It is reusable in ordinary approved HTML/JS hosts without requiring the purchased Suha template.

## 6. Acceptance and release

Minimum demonstration uses a real measured room and real measured object from the scanner service; owner places it, creates an alternative, shares one design with a tenant, tenant comments, owner reopens the pinned arrangement on another device. Also test object-only sharing, unsupported scale, wrong variant, revoked share, broken source revision, conflicting edits, inseparable old furniture, excessive object count and GPU device loss. No illustrative demo apartment counts as real-house qualification.

Trace HCA-001–028 to AT01–03, AT06–10, AT13, AT15–17 and AT20–22. Cross-device WebGPU evidence is separate from backend source tests and geometric fit evidence. Final scene/format/scale, rented-home audience, commercial policy, supported devices and quality thresholds require D01/D02/D07–12/D15–18. Documentation does not approve physical AR, automatic placement or purchase integrations.
