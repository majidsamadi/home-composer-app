# Home Composer — application

WebGPU-first Vue/Suha workspace for placing reusable scanned objects inside saved homes, comparing alternatives and discussing versioned designs with authorized collaborators.

**Status: requirements only. No implemented WebGPU application, fit-accuracy certification or deployed product is claimed.** This initial README establishes main; detailed requirements are delivered through a documentation branch and pull request.

- [Detailed application requirements](docs/REQUIREMENTS.md)
- [Shared platform baseline v1.0](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/PLATFORM_REQUIREMENTS.md)
- [Shared contracts](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/CONTRACTS.md)

- [Decisions pending](docs/DECISIONS_PENDING.md) · [B-RFX v0.3 draft fixtures](contracts/draft/v0.3/README.md)

The workspace consumes Home Scanner and Object Scanner services. It does not duplicate their source assets or infer verified physical dimensions from visual appearance alone.

## Vendor: canonical web-session client

`vendor/wisestay-web-session/` holds a byte-for-byte copy of `clients/web-session/web-session.mjs` and `web-session.d.mts`. They come from `majidsamadi/wisestay-user-management-backend@5b085956d3435145fe80922a53d4d304aa19f97f` (branch `feature/3d-wave3`, the IDM commit that registers the four 3D apps) and are pinned in `SOURCE.json`. The earlier pin `553ac3c` had `WebSession.isCurrent()`; this one does not, so `src/application/canonicalIdentityBridge.js` keeps the same exact-receipt check locally (`isCurrentReceipt`).

- Offline checks: `tests/canonicalIdentityBridge.source.test.mjs` and `tests/webSessionUpstream.test.mjs` compare the local bytes with the manifest's sha256, git blob and size.
- Upstream check: `node scripts/check-web-session-upstream.mjs` runs read-only through `gh api`. It exits 1 on a pin mismatch and 2 when `gh` is unavailable. It does not run in CI because the upstream repository is private.
- Finding (2026-10-20): the pin matches upstream at the pinned commit. Upstream `main` is behind the pin and has different bytes, and the pin is on an unmerged upstream branch. The vendored bytes are kept unchanged.

## Wave 3 dev hosting

Status: component-tested (synthetic data only). Dev publication pipeline configured; dev deployment pending publish.

- **Build.** `node scripts/build-site.mjs` copies `index.html`, `src/**`, `vendor/**` and the one runtime fixture (the synthetic GLB) into `dist/` and writes `dist/release.json` (`repository`, `origin`, `revision` = `GITHUB_SHA` or `local`, per-file sha256). No API URL is built in.
- **API access.** The page calls only the same-origin route `/api/v1/web-session/composer/api/composer<path>` through the canonical `WebSession` (`createWebSessionTransport` in `src/service/composerHttpApi.js`). The Account Centre BFF at `user.wizestay.com` forwards it to the Composer API with the user's central token.
- **Live or disconnected.** `src/application/liveComposition.js` selects live mode only when the vendored client registers `composer` and the page runs at `https://composer.wizestay.com`. The vendored pin registers `composer`, so live sign-in is reachable only on that origin. Anywhere else (local review, previews) the build stays disconnected: the "WiseStay sign-in" section shows both actions disabled with the reason, and the review sections stay synthetic.
- **Publication.** The `deploy` job in `.github/workflows/ci.yml` runs after the application checks on a push to `main` (or `workflow_dispatch` with `deploy: true`). It assumes only `arn:aws:iam::511831442607:role/wisestay-web-composer-publisher` with `allowed-account-ids: '511831442607'` and checks the caller before publishing. `deployment/publish.py` reads `/wisestay/dev/websites/composer/publication`, checks the distribution alias and S3 origin, verifies the build hashes, syncs assets without deleting, uploads `index.html` and `release.json` with `no-store`, invalidates `/*` and waits.
- **Smoke and receipt.** The index must load with the published hash and `release.json` must show this commit; `/api/v1/web-session/composer/readiness` must return JSON (not the page); `/assets/missing.js` must return 403 or 404. The receipt is the artifact `deployment-receipt-<sha>` (`dist/deployment-receipt.json`, 30 days).
- **Hosting.** Bucket `wisestay-web-composer-511831442607` and its distribution come from the owner-applied `wisestay-infrastructure` root `applications/three-d-dev` (Q15-R1). Rollback: revert the merge; the next publication restores the previous files (old assets are never deleted).
