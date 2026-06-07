# V5 schemas — CI auth & contract-enforcement readiness (CEE)

**Status:** investigated 2026-06-07, read-only. Conclusion: **the schemas CI-auth 401 is NOT a current blocker for CEE.** Schema-backed contract work can proceed.

**Scope:** This report verifies **CEE only** (`olumi-assistants-service`). DGAI, PLoT and ISL are **not** covered — see "Cross-repo" below.

**Canonical:** This is the single readiness doc for the `@talchain/schemas` package-auth / `NPM_PACKAGES_TOKEN` question. It is part of the canonical **guard + docs** PR (#243) and **supersedes the earlier docs-only readiness PR (#242)**. Keep this one filename; do not spawn competing readiness docs.

---

## 1. The 401 diagnosis — disproven for current CEE

The working hypothesis was: GitHub Actions gets a **401 on `@talchain/schemas`** (a GitHub Packages read-token gap) and that red CI class has blocked PRs.

**That 401/token issue may have been real historically, but it is not a blocker for current CEE, because `@talchain/schemas` is now vendored via a local `file:` tarball — there is no registry fetch to authenticate.** This is disproven for the **current CEE setup** — *not* retroactively for all past states, and *not* for other repos (see §7).

Evidence chain (shortest):

- `package.json` → `"@talchain/schemas": "file:./vendor/talchain-schemas-0.13.0.tgz"`. The tarball + its `.sha256` are **git-tracked** (`git ls-files vendor/`) and checked out by CI; `pnpm-lock.yaml` pins `@talchain/schemas@file:vendor/...`. It has been `file:`-vendored since first appearance (`e7869923`: 0.11 → 0.12 → 0.13). A `file:` dependency performs **no registry fetch** ⇒ a 401 is structurally impossible.
- `vendor/README.md` documents this as the deliberate strategy ("resolves identically from a normal clone, a CI checkout, and any worktree … Not yet published to a private registry"), with a "Removal criterion" to switch to a registry spec once `olumi-schemas` publishes.
- In the latest failed CI run (PR #239, run `27092439023`) **every `Install dependencies` step is green**, and the full log contains **no** `401` / `unauthorized` / `ERR_PNPM_FETCH` / `EAUTH`.
- The token secret genuinely is **absent** (`gh secret list` shows only `ASSIST_API_KEY`; every job logs `WARN … Failed to replace env in config: ${NPM_PACKAGES_TOKEN}`) — but that empty token is **harmless today** because nothing is fetched from the registry.

## 2. Current schema enforcement — green enough to proceed

On `main`, the required status checks include **`check-schemas`** and **`Lint, TypeCheck, Unit Tests`** (verified via branch-protection API; `strict=true`):

- **Schema drift** → `check-schemas` (`contract-schemas.yml`: install → `scripts/export-schemas.ts` → `git diff --exit-code contracts/`) — required on `main`, green on every staging push.
- **Schema self-validation** → `tests/contracts/schema-self-test.test.ts` runs in the **blocking** required gate (not in any `vitest.required.config.ts` exclusion).
- **Response-hash invariant** → `tests/unit/response-hash.test.ts` likewise runs in the **blocking** required gate.
- **OpenAPI** → `Validate OpenAPI Spec` required on `main`.

So the contract-guard items (blocking install / schema validation in CI; response-hash invariant testing) are **already satisfied in the required gate on `main`**.

## 3. The token is harmless today — but matters if registry consumption returns

The missing `NPM_PACKAGES_TOKEN` is currently a no-op. It becomes a **live 401** the moment `@talchain/schemas` (or any future `@talchain/*` schema package) is consumed from the **registry** instead of the vendored tarball — i.e. the `vendor/README.md` "Removal criterion" path.

### Sentinel guard — implemented in this PR (#243)

A registry-token sentinel **is implemented in this PR** (it is *not* deferred): `scripts/ci/guard-schemas-registry-token.sh`, wired as one step in `contract-schemas.yml` (the already-required `check-schemas` job), before `pnpm install`:

- **No-op while vendored:** when `@talchain/schemas` is `file:` / `link:` / `workspace:` → **PASS** (this is today's state).
- **Fails loudly only on a registry regression:** if it moves back to **registry** consumption **and** `NPM_PACKAGES_TOKEN` is missing → **FAIL** with a self-explaining `::error::`.

**This guard is a sentinel, not full coverage.** A real registry switch would fail many install steps across CI; the guard simply guarantees that the *first, clearest* signal is one loud, self-explaining failure on the required `check-schemas` gate rather than a confusing install-time 401. One loud required failure is enough signal — it is not a substitute for actually setting the token.

### Exact Paul action — only if registry consumption is later restored

Create a GitHub token with **`read:packages` only** (classic PAT `read:packages`, or fine-grained with **Packages: Read** on the `Talchain` org / `olumi-schemas` repo) and add it as secret **`NPM_PACKAGES_TOKEN`** (repo secret on `olumi-assistants-service`, or an org secret scoped to it). Do **not** paste the token value anywhere. The workflow wiring already references this secret on every install step, so no workflow change is needed when the secret is added.

## 4. Intent Capsule / coaching contracts — not token-blocked, but still gated

Intent Capsule and coaching-field pipeline contracts are **not blocked by `NPM_PACKAGES_TOKEN`** — schema-backed contracts are viable today through the vendored `@talchain/schemas` + the `check-schemas` drift gate + the `contracts/` JSON-Schema export + in-gate schema self-tests.

They remain gated, separately, by:

- **schema design** (defining the capsule / coaching field types in `olumi-schemas`);
- **contract review** (cross-boundary sign-off);
- the **re-vendor vs local-quarantine** choice (bump the vendored tarball per `vendor/README.md`, or keep types local until published);
- **implementation approval** for the consuming CEE code.

None of those gates is the package-read token.

**Re-characterized hold:** the earlier "no Intent Capsule schema work until schemas CI auth is fixed" rested on the now-disproven 401 premise. Re-read it as: *do not start schema-backed rollout until the re-vendor / local-contract workflow is exercised and reviewed* — not as a package-auth blocker. A local-quarantine precedent already exists (`src/orchestrator-v5/routing/types.ts` defines boundary types locally, "QUARANTINE: These types are local pending `@talchain/schemas` bump"), so new contract types can land with no registry/auth path.

## 5. Remaining enforcement gap (separate from the 401 issue)

The real current enforcement gap is **branch protection on `staging`**: `staging` is **not protected** at all (`gh api .../branches/staging/protection` → "Branch not protected"), so PRs merge into `staging` without any required check actually blocking — the checks report but do not gate. The day-to-day flow targets `staging`.

**Paul action (Settings → Branches, report-only here):** enable branch protection on `staging` mirroring `main`'s required checks (`Validate OpenAPI Spec`, `check-skipped-tests`, `validate-event-names`, `version-guard`, `Lint, TypeCheck, Unit Tests`, `check-schemas`) **and require PR approval before merge.** Note the inherited-red advisory jobs (see §6) are not in that required set, so enabling protection will not block on the baseline.

## 6. Inherited red CI classes — clearly NOT this issue

The persistent red on recent PRs is the documented inherited baseline, unrelated to schemas auth. In run `27092439023` the required `Lint, TypeCheck, Unit Tests` was **green**; red was only the **advisory** jobs:

- `Full Test Suite (advisory)` — `62 failed | 900 passed (1000 files)` / `269 failed | 17584 passed` tests (pre-existing baseline).
- `Integration Tests (advisory)` — service-like env failures.
- `Security Audit` — `pnpm audit --audit-level=high` (open dependabot advisories).

These are tracked separately and are **out of scope** for the schemas CI-auth question.

## 7. Cross-repo (DGAI / PLoT / ISL) — not verified here

This report covers **CEE only**. Before any cross-repo schema rollout, run a **cheap per-repo package-consumption check** on DGAI, PLoT and ISL:

1. `grep '@talchain' package.json` — is `@talchain/schemas` a `file:` vendored tarball or a registry spec (`^x.y`)?
2. If registry: `gh secret list` — does `NPM_PACKAGES_TOKEN` exist? and scan CI logs for the empty-token `WARN` or a real `401`/`ERR_PNPM_FETCH`.
3. If `file:`-vendored: confirm the tarball + `.sha256` are git-tracked (then no 401 risk, same as CEE).
4. Confirm `.npmrc` has `@talchain:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=${NPM_PACKAGES_TOKEN}` and every install step passes the secret.
5. Confirm branch protection + required PR approval on the working branch.

**Only repos consuming `@talchain/*` from the registry have a live 401 risk; vendored repos are insulated.**

## 8. Follow-ups (parked — separate from this PR)

- **Stray-file CI-hygiene:** the pre-push `state-write-invariant` check scans the filesystem and can be tripped by gitignored stray/duplicate files (e.g. `name 2.ts` shadow copies); a future CI-hygiene pass should switch it to scan `git ls-files` instead. Not a package-auth concern.
- Branch protection on `staging` (§5) and the future registry-switch token (§3) are **Paul actions**; per-repo **DGAI / PLoT / ISL** consumption checks (§7) precede any cross-repo rollout.

---

### Summary of what this change ships

| File | Change |
|------|--------|
| `scripts/ci/guard-schemas-registry-token.sh` | new sentinel (no-op while vendored) |
| `.github/workflows/contract-schemas.yml` | +1 step in the existing `check-schemas` job |
| `Docs/v5/v5-schemas-ci-auth-readiness.md` | this report |

No package / lockfile / `.npmrc` / secret / branch-protection / generated-contract changes.
