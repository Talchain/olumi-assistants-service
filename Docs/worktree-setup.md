# Working in a git worktree (humans and AI sessions)

This repo is routinely worked on via linked git worktrees (`git worktree add …`).
A fresh worktree checks out tracked sources but has **no usable toolchain**, and this
repo has two sharp edges that have repeatedly burned sessions. This page is the
canonical recipe.

## The two sharp edges

1. **node_modules is partially tracked.** ~4,300 files under `node_modules/`
   (`.pnpm/` layout, `.bin/` symlinks, pnpm metadata) were committed before the
   `.gitignore` rule existed. Consequences:
   - a fresh worktree contains a *broken, partial* node_modules until you install;
   - `pnpm install` may show tracked node_modules files as modified in `git status` —
     this is expected churn. **Never `git add` anything under `node_modules/`.**
     Stage explicit paths, never `git add -A` / `git add .`.
2. **`src/generated/openapi.d.ts` is gitignored** and imported by ~40 source files.
   Until `pnpm openapi:generate` runs, `tsc` output is a wall of TS2307 errors that
   masks any real problem.

## Setup (one command)

```bash
bash scripts/bootstrap-worktree.sh
```

This runs, idempotently: `pnpm install --frozen-lockfile` → `pnpm openapi:generate` →
`bash scripts/install-hooks.sh` → probes the toolchain **by execution** (`--version`
on tsc/eslint/vitest/openapi-typescript) plus the generated types. Execution probes
matter: because node_modules is partially tracked, a fresh worktree has a `tsc` that
exists *and runs* while eslint/vitest crash on load. The pre-push hook fails fast with
the same probes and pointer (toolchain-preflight, check 0).

Note for worktrees: git hooks live in the *shared* common dir, so installing from any
worktree covers all of them (`install-hooks.sh` resolves this via `git rev-parse
--git-path hooks`).

## Branch-cut discipline

- Cut every branch explicitly from fresh remote staging:

  ```bash
  git fetch origin && git checkout -B <branch> origin/staging
  ```

- **After a squash merge, the old feature branch is dead.** Its commits are not
  ancestors of staging, so rebasing or branching from it re-introduces already-merged
  diffs and produces phantom conflicts. Re-cut from `origin/staging` and cherry-pick
  or re-apply only what is genuinely new.
- Do not chain feature branches off other local feature branches.

## Verification discipline

- Run tests **from the worktree's own directory**. Running from the main checkout
  loads the main checkout's sources and produces misleading greens.
- Use the repo's authoritative gates (`pnpm typecheck:src`, `pnpm lint`,
  `pnpm test:required`, `bash scripts/validate-prepush.sh`), not ad-hoc `npx tsc`
  invocations that may check a different config.
