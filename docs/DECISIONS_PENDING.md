# Decisions pending — home-composer-app

Source: WBS §6 "Decisions to make later" (Q01–Q16). This file only records which subtasks in this repository are blocked. No answer is proposed or assumed here. Statuses come from the owner records named in the table. Anything not listed as recorded is OPEN.

| ID | WBS title | Status | Source of status | Blocked subtasks in this repo | Left null/unset in this slice |
|---|---|---|---|---|---|
| Q01 | Service and shared-component design | OPEN | WBS §6 | HCA-01.4 draft persistence/discard/drain; freezing B-RFX v0.3 contracts | E-RDY-07C "Draft persistence / discard policy" shown as Not supplied |
| Q02 | Local capture and optional cloud refinement | OPEN | WBS §6 | none in this slice | — |
| Q03 | Scale, accuracy and acceptance | OPEN | WBS §6 | fit/scale presentation; freezing B-RFX v0.3 contracts | no fit status; entry "stale" is revision-based with no time threshold |
| Q04 | Devices and interaction delivery | OPEN | WBS §6 | HCA-02 WebGPU workspace; freezing B-RFX v0.3 contracts | no renderer or device profile chosen; B-RFX-07 device-loss test skipped |
| Q05 | Asset representations and protected opening | OPEN | WBS §6 | HCA-02 WebGPU workspace asset loading; freezing B-RFX v0.3 contracts | no codec, container or protection scheme (fixtures keep `codec`/`protection_scheme` null) |
| Q06 | Product, quantity and planning semantics | OPEN — result organisation ALT1 recorded only | `WiseStay_F_Q06_Selected_Organization_v1.0` ("Separate classification, reason and processing status"); no schema, encoding, threshold, algorithm or precedence chosen | freezing B-RFX v0.3 contracts | — |
| Q07 | Audience, rented-home privacy and sharing | OPEN — first-slice content scope recorded only | `WiseStay_Human_First_Slice_Content_2026-10-14_210147.json` ("Synthetic data + permitted unoccupied references"); the action/audience matrix and consent remain OPEN | invitations (pending-invitation acceptance), sharing and roles | invitation ID/actor/version shown as Not supplied; no acceptance action |
| Q08 | Retention, deletion and evidence reuse | OPEN | WBS §6 | withdrawn-home/withdrawn-source handling beyond display | — |
| Q09 | Workload, cost and responsiveness | OPEN | WBS §6 | loading/stale timing | no timeout or refresh interval |
| Q10 | Commercial viewing and portable delivery | OPEN | WBS §6 | export/publish actions | real actions disabled |
| Q11 | External developer onboarding | OPEN | WBS §6 | none in this slice | — |
| Q12 | Notification and support ownership | OPEN | WBS §6 | invitation/comment notifications | — |
| Q13 | Virtual routes versus live indoor navigation | OPEN | WBS §6 | none in this slice | — |
| Q14 | Shop/property registration compatibility | OPEN | WBS §6 | property selection/creation | property actions disabled |
| Q15 | Deployment and resource ownership | OPEN | WBS §6 | HCA-01 Composer application registration (with IDM-01); deployment | Composer is absent from the canonical `APPLICATIONS` allowlist (B-RFX-08 `application_identifier: null`) |
| Q16 | Application embedding and predecessor coverage | OPEN | WBS §6 | embedding Composer in other applications | — |

Other open items:
- IDM-01 (Account Centre registration of Composer) is OPEN. It blocks HCA-01 sign-in/return together with Q15.
- The vendored web-session pin sits on the unmerged upstream branch `feature/account-centre-safe-return-context`, and upstream `main` differs. Whether to re-pin is OPEN; the bytes are unchanged.

Owner approval to merge `feature/3d-r0-foundation` into main: OPEN.
