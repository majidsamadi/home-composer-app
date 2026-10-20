# Home Composer — application

WebGPU-first Vue/Suha workspace for placing reusable scanned objects inside saved homes, comparing alternatives and discussing versioned designs with authorized collaborators.

**Status: requirements only. No implemented WebGPU application, fit-accuracy certification or deployed product is claimed.** This initial README establishes main; detailed requirements are delivered through a documentation branch and pull request.

- [Detailed application requirements](docs/REQUIREMENTS.md)
- [Shared platform baseline v1.0](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/PLATFORM_REQUIREMENTS.md)
- [Shared contracts](https://github.com/majidsamadi/three-dimension-view-arcore-backend/blob/6cbca1ccdf4a8e9845b74451448eb0dea4f1109d/docs/CONTRACTS.md)

- [Decisions pending](docs/DECISIONS_PENDING.md) · [B-RFX v0.3 draft fixtures](contracts/draft/v0.3/README.md)

The workspace consumes Home Scanner and Object Scanner services. It does not duplicate their source assets or infer verified physical dimensions from visual appearance alone.

## Vendor: canonical web-session client

`vendor/wisestay-web-session/` holds a byte-for-byte copy of `clients/web-session/web-session.mjs` and `web-session.d.mts`. They come from `majidsamadi/wisestay-user-management-backend@553ac3c08973114f26271d1a751437d9203b5cd4` (branch `feature/account-centre-safe-return-context`) and are pinned in `SOURCE.json`.

- Offline checks: `tests/canonicalIdentityBridge.source.test.mjs` and `tests/webSessionUpstream.test.mjs` compare the local bytes with the manifest's sha256, git blob and size.
- Upstream check: `node scripts/check-web-session-upstream.mjs` runs read-only through `gh api`. It exits 1 on a pin mismatch and 2 when `gh` is unavailable. It does not run in CI because the upstream repository is private.
- Finding (2026-10-20): the pin matches upstream at the pinned commit. Upstream `main` is behind the pin and has different bytes, and the pin is on an unmerged upstream branch. The vendored bytes are kept unchanged.
