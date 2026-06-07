# V5 — `@talchain/schemas` CI-auth readiness (CEE)

_Canonical readiness doc for the schemas package-auth / `NPM_PACKAGES_TOKEN` question. Keep this one name; do not spawn competing readiness docs._

**Status:** readiness report — informational. No code, workflow, package, branch-protection, secret or CI-guard change.
**Date:** 2026-06-07
**Scope:** CEE (`olumi-assistants-service`) only — see the cross-repo caveat in §5.

## Summary

The GitHub Packages **401 / missing-`NPM_PACKAGES_TOKEN`** issue appears to have been a *real* blocker historically. But CEE now consumes `@talchain/schemas` via a **vendored `file:` tarball**, so no registry fetch occurs and the token is never exercised. The package-auth blocker is therefore **disproven for the current CEE setup — not retroactively disproven for all past states or for other repos.** No new guard is added; this only records the state.

---

## 1. Current schema/package enforcement status

- **Consumption:** [`package.json`](../../package.json) pins `"@talchain/schemas": "file:./vendor/talchain-schemas-0.13.0.tgz"`. It is the **only** `@talchain` dependency. `node_modules/@talchain/schemas` resolves to the `file:` install (`@talchain+schemas@file+vendor+talchain-schemas-0.13.0.tgz`).
- **Integrity gate (not auth):** [`scripts/validate-tarball-sha.sh`](../../scripts/validate-tarball-sha.sh) derives the pinned tarball from `package.json` and asserts it matches the adjacent `vendor/talchain-schemas-0.13.0.tgz.sha256`. A mismatch blocks the push (the pre-push **`tarball-sha`** check). Regenerating the tarball requires committing the new `.tgz` **and** new `.sha256` together.
- **Contract drift gate:** [`.github/workflows/contract-schemas.yml`](../../.github/workflows/contract-schemas.yml) runs `pnpm install --frozen-lockfile` → `npx tsx scripts/export-schemas.ts` → `git diff --exit-code contracts/`. It verifies committed `contracts/` match generated output. The `file:` install needs no registry token.
- **Local-quarantine precedent:** `src/orchestrator-v5/routing/types.ts` already defines boundary types locally "pending `@talchain/schemas` bump" — i.e. new contract types can land without any registry/auth path.

## 2. Why the missing `NPM_PACKAGES_TOKEN` is harmless today

- A `file:` dependency is installed from the local tarball; pnpm makes **no fetch** to `https://npm.pkg.github.com`, so the `//npm.pkg.github.com/:_authToken=${NPM_PACKAGES_TOKEN}` line in [`.npmrc`](../../.npmrc) is **never used**.
- The only observable symptom is a **cosmetic warning** — `Issue while reading ".npmrc". Failed to replace env in config: ${NPM_PACKAGES_TOKEN}` — printed when the env var is unset. pnpm proceeds normally; no auth is attempted.
- Confirmed empirically: installs, the pre-push `tarball-sha` gate, and all required pre-push checks pass with the warning present.
- CI workflows (`ci.yml`, `contract-schemas.yml`, `sdk-build.yml`, `telemetry-validation.yml`, `perf-gate.yml`, `security-scanning.yml`, `version-guard.yml`, `cee-diagnostics.yml`) set `NPM_PACKAGES_TOKEN: ${{ secrets.NPM_PACKAGES_TOKEN }}` **defensively** — a no-op for the current `file:` consumption.

## 3. What would change if `@talchain/schemas` moves back to registry consumption

If `package.json` switches from `file:./vendor/…tgz` to a registry range (e.g. `"@talchain/schemas": "^0.13.0"`):

- `pnpm install` would **fetch** the package from `npm.pkg.github.com`, which requires a valid `NPM_PACKAGES_TOKEN` (a PAT with `read:packages`, cross-org).
- Without the secret, CI installs would **401** (and local installs would fail for anyone without the env var).
- The `tarball-sha` integrity gate would no longer apply (there would be no vendored tarball to checksum); integrity would shift to the registry + lockfile.

## 4. Exact Paul action required in that future case

Provision the **`NPM_PACKAGES_TOKEN`** GitHub Actions secret (org/repo level): a PAT with `read:packages` scope that can read the cross-org `@talchain` packages. The `.npmrc` config and the `env:` wiring in every workflow already reference it, so **only the secret value needs to be added** — no workflow or `.npmrc` edits. Local developers would additionally export `NPM_PACKAGES_TOKEN` in their shell.

## 5. Cross-repo caveat (verify before any cross-repo rollout)

This report verifies **CEE only**. **DGAI, PLoT and ISL** package consumption have **not** been verified here. Before any cross-repo schema or Intent Capsule rollout, run a cheap per-repo check confirming whether each repo consumes `@talchain/schemas` via **vendored tarball, registry package, local quarantine, or another path** — the auth posture (and therefore the `NPM_PACKAGES_TOKEN` requirement) may differ per repo.

## 6. Inherited red CI classes — separate from this issue

The following advisory-suite reds are **separate CI-rehab concerns, NOT package-auth blockers** and are out of scope for this readiness item:

- **Security Audit** — `vitest < 4.1.0` advisory.
- **Full Suite / Integration** — `missing` failures (large count), absent graph-evaluator fixtures (ENOENT).
- **Stale mocks** — `loadMostRecentPendingActions` "not a function".
- **`OPENAI_API_KEY`** — env-dependent test failures.

None of these are caused by, or fixed by, the `NPM_PACKAGES_TOKEN` / schema-vendoring posture. They are tracked under the CI-rehab inventory.

## 7. Is Intent Capsule / coaching contract work blocked?

**No — not blocked by `NPM_PACKAGES_TOKEN` or the old CEE 401 diagnosis.** It remains gated by ordinary engineering steps:

- normal schema design and contract review;
- the **re-vendor vs local-quarantine** choice for new types (re-build the `@talchain/schemas` tarball + `.sha256`, **or** define types locally in the `routing/types.ts` quarantine pattern pending the next bump);
- generated `contracts/` staying clean (the `contract-schemas.yml` gate);
- implementation approval.

The earlier hold ("no Intent Capsule schema work until schemas CI auth is fixed") rested on the now-disproven 401 premise and should be **re-characterized** as:

> Do not start schema-backed rollout until the re-vendor / local contract workflow is exercised and reviewed.

## Follow-ups (parked — NOT implemented in this PR)

- **Registry-token guard / sentinel — intentionally not added here.** A tiny registry-token sentinel is parked for a future CI-hygiene pass if `@talchain/schemas` moves back to registry consumption. It is not required for the current CEE vendored `file:` setup.
- **`state-write-invariant` filesystem scan.** `state-write-invariant` currently scans the filesystem and can be tripped by gitignored duplicate files such as `name 2.ts`; a future CI-hygiene pass should consider scanning `git ls-files` instead. (Not implemented in this PR.)
