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
- warns (non-fatal) when the local pnpm major differs from CI's pinned `9`,
  with the exact `corepack pnpm@9 install --frozen-lockfile` reproduction line;
- exports `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` so Corepack can never block setup
  on an interactive download prompt (the "make bootstrap non-interactive-safe"
  point).

This turns a mysterious false-red into a signposted version mismatch. It does
NOT change what pnpm anyone runs.

## Recommended decision (Paul to choose ONE)

**Option A — pin to pnpm 9 (lowest-risk, matches CI):**
```jsonc
// package.json
"packageManager": "pnpm@9.15.9",   // pick the exact 9.x CI resolves to
"engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0 <10" }
```
- Corepack-enabled environments auto-use 9 → dev == CI. Non-Corepack users are
  unaffected (the field is advisory unless Corepack is active).
- Update `CI_PNPM_MAJOR` in `bootstrap-worktree.sh` only if the pinned major
  changes (currently already 9).
- **Validation required before merge:** `corepack pnpm@9 install --frozen-lockfile`
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
