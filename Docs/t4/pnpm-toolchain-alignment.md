# pnpm toolchain alignment — analysis + recommendation for Paul

**Date:** 2026-07-03 (code-review follow-up on the T4A wave)
**Status:** RECOMMENDATION. The bootstrap version-warning in this PR is landed;
the repo-wide `packageManager` pin below is a **decision for Paul** — deliberately
not made autonomously because it changes install behaviour for every developer
and CI, and cannot be validated across pnpm 9/10/11 from here.

## The problem (confirmed)

The repo does not declare which pnpm it supports, and three versions are in play:

| Surface | pnpm | Evidence |
|---|---|---|
| CI (both workflows) | **9** | `pnpm/action-setup@v4` `version: 9` in `.github/workflows/ci.yml` + `golden-journey-replay.yml` |
| `engines.pnpm` | `>=8.0.0` | `package.json` — advisory only, npm/pnpm don't hard-enforce |
| `packageManager` | *absent* | no Corepack pin exists |
| A reviewer's machine | **11** | `pnpm install --frozen-lockfile` and the replay gate **false-reded**; the same target passed on pnpm 9 |
| This author's machine | **10.18** | installs + gate pass |

`pnpm-lock.yaml` is `lockfileVersion: '9.0'` (readable by pnpm 9/10/11), so the
lockfile format is not the blocker. The likely culprits for a newer-major
false-red are default-setting changes across majors and/or the large legacy
`pnpm.overrides` block; the `.npmrc` `${NPM_PACKAGES_TOKEN}` env-expansion only
produces a non-fatal WARN on 9/10. **Root-causing the pnpm-11 failure needs an
actual pnpm-11 run**, which is why this doc recommends rather than patches.

## Landed in this PR (safe, additive)

`scripts/bootstrap-worktree.sh`:
- runs the install as `CI=1 pnpm install --frozen-lockfile`. The real
  fresh-worktree blocker is pnpm's *"The modules directory … will be removed and
  reinstalled from scratch. Proceed?"* purge prompt, triggered by the partially
  tracked `node_modules`. It hangs even with stdin closed (reproduced on pnpm 9),
  so the install never completes and binaries stay missing — bootstrap then fails
  later at `openapi-typescript: command not found`. `CI=1` makes that step
  non-interactive. **Verified:** pnpm 9 without it hangs on the prompt; with it,
  install completes and tsc/eslint/vitest/openapi-typescript are all present.
- exports `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` (no Corepack download prompt) and
  `COREPACK_ENABLE_AUTO_PIN=0` (if `pnpm` is a Corepack shim, it must not silently
  write a `packageManager` field into `package.json` — that pin is the separate
  decision below);
- warns (non-fatal) when the local pnpm major differs from CI's pinned `9`, and
  prints a **non-mutating** reproduction line:
  `COREPACK_ENABLE_AUTO_PIN=0 CI=1 corepack pnpm@9 install --frozen-lockfile`.
  Both guards matter: bare `corepack pnpm@9 …` can auto-add a `packageManager`
  field, and without `CI=1` it hits the same purge prompt.

This turns a mysterious false-red into a signposted version mismatch. It does
NOT change what pnpm anyone runs, and does NOT mutate `package.json`.

## Recommended decision (Paul to choose ONE)

**Option A — pin to pnpm 9 (lowest-risk, matches CI):**
```jsonc
// package.json
"packageManager": "pnpm@9.15.9",   // pick the exact 9.x CI resolves to
"engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0 <10" }
```
- Corepack-enabled environments auto-use 9 → dev == CI. Non-Corepack users are
  unaffected (the field is advisory unless Corepack is active).
- Pin the EXACT version everywhere, not just the major: set `packageManager` to
  `pnpm@9.15.9` (the version Corepack currently resolves for `pnpm@9`) AND change
  the workflows' `pnpm/action-setup` from `version: 9` to `version: 9.15.9`,
  otherwise patch-level drift between dev and CI remains. Update
  `CI_PNPM_MAJOR` in `bootstrap-worktree.sh` only if the pinned major changes.
- **Validation required before merge:**
  `COREPACK_ENABLE_AUTO_PIN=0 CI=1 corepack pnpm@9.15.9 install --frozen-lockfile`
  green on a fresh worktree; CI green (it already runs 9).

**Option B — support pnpm 9–11 (more work, more resilient):**
- Reproduce the pnpm-11 failure, fix the offending config (settings/overrides),
  bump CI's `action-setup version` to a range or the newest supported, and set
  `engines.pnpm >=9`. Only worth it if the team wants version freedom.

**Recommendation:** Option A. It is the smaller, safer change and directly
removes the divergence that produced the false-red. Do it **before** promoting
the golden-journey replay workflow to a required check (a required gate that can
false-red on a contributor's pnpm major would block merges spuriously).

## Explicitly NOT changed here

`package.json` `packageManager`/`engines` and the `pnpm.overrides` block are
untouched — they are repo-policy surfaces needing your sign-off and a
cross-version validation this lane cannot perform.
