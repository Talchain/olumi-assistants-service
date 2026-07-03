# Proposal size-guard fix — verification & flag-OFF proof

- Branch: `claude/v6-dual-draft-proposal-size-guards`
- Base: `origin/staging` @ `f2998df02` (#329)
- Code tip: `2960fb106` (the Codex-round-1 fix; subsequent commit is docs-only)
- Fresh worktree, full `pnpm install`, `pnpm openapi:generate`; all commands run
  from the worktree cwd. All figures below re-run at the code tip after the
  Codex-round-1 changes (size guard moved before G14; failure metadata bounded).

## Flag-OFF behavioural-identity proof (required)
The changed modules (`merge.ts` / `guards.ts` / `proposal-json-schema.ts`) are
lazy-imported only when `v6DualDraftEnabled` is ON, so flag-OFF byte-identity
holds by construction. Proven by test at both ends:

**Baseline (this worktree, before any change):**
```
✓ dispatch-flag-off.test.ts (7)   ✓ phase4-dispatch-compat.test.ts (13)
Test Files 2 passed · Tests 20 passed
```
**Re-run at code tip `2960fb106`:**
```
✓ dispatch-flag-off.test.ts (7)   ✓ phase4-dispatch-compat.test.ts (13)
Test Files 2 passed · Tests 20 passed
```
**Verdict: GREEN, identical (20/20).** The guard only ADDS rejections for
oversized input; valid-proposal merge behaviour (exercised by these suites and by
`merge.test.ts` × 33) is unchanged.

## Gates at tip
| Gate | Result |
|---|---|
| `pnpm typecheck:src` (build scope) | clean |
| Full `tsc --noEmit` (advisory drift) | **0 new errors** in changed files |
| `pnpm test:required` | **885 files / 17,975 tests passed**, 0 failed |
| eslint over changed files | clean |
| `merge.test.ts` (existing valid-proposal behaviour) | 33/33 green |
| `proposal-size-caps.test.ts` (F1 proof + ordering + bounded-metadata) | 20/20 green |
| ordering guarantee | 1,000,000-element `uncertainty_drivers` rejected per-proposal without throwing (~40ms) while a valid sibling applies |
| Full `pnpm test` advisory (creds-dependent integration + baseline reds) | failing-set identical to base — below |

## Advisory full-suite delta vs base
Base `f2998df02` failing-file set: **62 files** (captured in a fresh detached
worktree at the base SHA during the #330 verification). Tip set compared with
`comm` over sorted failing-file lists.

- New reds at tip (must be empty): **EMPTY**
- Reds gone at tip: **EMPTY**
- Failing-set **identical to base**; no test regressed on the size-guard branch.

## Change surface
Live source: `guards.ts`, `merge.ts`, `proposal-json-schema.ts` (+ 3 test files,
+ these docs). No schema (`cee-v3.ts`)/config/env/flag/migration/cross-service
change. Code-only, flag-ON-path; rollback = revert the feat/fix commits.
