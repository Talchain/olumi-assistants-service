# Mutation kit — 8/8 BITTEN (2026-08-14)

Worktree OUTSIDE the repo root, distinct inode from source.
ISOLATION PROVEN BY WRITING (trap 9g), not by locating: a sentinel appended to
the worktree copy left the source SHA-256 byte-identical.
Restores are HEAD-relative (`git checkout HEAD -- src/`), never index-relative (trap 9h).
Applied-check scoped to `src/`, asserting EXACTLY 1 changed file per mutant; an
unapplied mutation (occurrence count != 1) is a HARD ABORT, never a survivor
(trap 22d's false-survivor class). Collected count asserted == 20 every run; a
missing summary line is an abort, not a pass.

| # | Mutant | Verdict | Tests that RED |
|---|--------|---------|----------------|
| M1 | writer: revert the derivation | BITTEN (7) | SIGNATURE 1/2/3, % canonical divisor, canonical-inverse agreement, no-false-alarm, end-to-end guard |
| M2 | domain: admit degenerate `cap <= 1` | BITTEN (1) | degenerate-cap honest absence |
| M3 | domain: drop the negative-value guard | BITTEN (1) | negative-value honest absence |
| M4 | guard: PRESENCE-ONLY (drop inconsistency limb) | BITTEN (1) | INCONSISTENT raw_value reported |
| M5 | guard: neutered (never reports) | BITTEN (3) | alarm fires, both guard REDs |
| M6 | guard: OVER-reports every capped factor | BITTEN (4) | all three GREEN assertions + no-false-alarm |
| M7 | guard: right verdict, WRONG factor id | BITTEN (3) | alarm payload + both guard REDs |
| M8 | alarm removed | BITTEN (1) | alarm fires |

## The discriminating pair (trap 19 — bind by IDENTITY, not by a predicate)
M6 and M7 are the pair, and NEITHER alone would show binding:
- M6 (over-report) REDs the GREEN cases → the suite is sensitive to a FALSE POSITIVE,
  so its greens are not passing merely because the guard is quiet.
- M7 (same verdict, different id) REDs the RED cases → the assertions bind to
  `fac_annual_cost` BY IDENTITY (`toEqual(['fac_annual_cost'])`), not to
  "the list is non-empty", which another object could satisfy.

## Trailing pristine control
`dirty=0` · `Tests 20 passed (20)` · 0 failed — the tree was restored, and the
kit did not leave a mutation behind (trap 9h's polluted-baseline class).
