# Lane: 0.16.0 re-vendor + capture both scoring probabilities (D-N, Paul-approved)

**Date:** 2026-07-11 · **Lane:** CEE lane A · **Branch:**
`claude-cee/schemas-0160-capture-probabilities` (fresh worktree off
`origin/staging` @ `f49d304e5`) · **PR:** draft, never merged by this lane
(A1 sequences merges — this vendor lane merges FIRST; the parallel CEE lane
rebases).

## Objective

1. **Re-vendor `@talchain/schemas` 0.16.0** (olumi-schemas `main` @
   `45b8bcae3f66a43c849eab16c157323092f43cee`, Paul-approved PR #8) via the
   exact #405 tarball mechanics.
2. **Capture addendum** (the previously-BLOCKED lane, now unblocked):
   `capture.ts` also captures the chosen option's
   `prediction.probability_of_goal` + `probability_of_joint_goal` from the
   analysis payload and stamps `confidence_source: 'model_derived'`.
   Absent values stay ABSENT (never 0).

## Why it was blocked, and what unblocked it

The capture-addendum lane was **correctly blocked** on 2026-07-11
(HANDOVER.md ~02:45 wave entry): *"0.15.0 DecisionRecordSchema .strict()
rejects additive JSONB at every layer → D-N both-probabilities derisk
REQUIRES 0.16.0 contract bump."* olumi-schemas PR #8 reproduced the
rejection against built dists (base 0.15.0 → `prediction: Unrecognized
key(s): 'confidence_source', 'probability_of_goal',
'probability_of_joint_goal'`) and added the fields as strictly-additive
optionals. Paul approved + merged (#8 → main `45b8bca`); this lane adopts.

D-N ruling (2026-07-11 rulings batch): **Option B ratified** — score
goal-attainment probability against whether the goal was actually hit —
with the explicit derisk that *both candidate probabilities get captured
from day one so a Neil overrule is a recompute, never lost data*.

## 1. Vendor mechanics (mirrors #405 / #373)

- `vendor/talchain-schemas-0.16.0.tgz` built from a **fresh clone at
  45b8bca** via `npm ci && npm run prepublishOnly && npm pack`
  (**761/761** package tests green at pack time).
- sha256 `65adade472d57f94e86c5f5199a1aa37b133dcbab9519e68d4a1106b206219d6`
  (+ `.sha256` manifest — verified by the pre-push
  `validate-tarball-sha.sh` gate).
- 0.15.0 tarball + manifest retired (single-current-version policy);
  `package.json` re-pinned; `pnpm-lock.yaml` delta is exactly the
  specifier/integrity swap; `vendor/README.md` rewritten.
- node_modules: **zero tracked delta staged** (install churn not
  committed).
- **Publish workflow verified** (was in_progress at dispatch): run
  29162653316 at 45b8bca — the *"Publish to GitHub Packages"* step
  **succeeded** (0.16.0 IS on GitHub Packages; tag v0.16.0 created); only
  the post-publish *"Trigger propagation"* step failed (`Parameter token or
  opts.auth is required` — same failure mode as the 0.15.0 run). Vendored
  via tarball regardless, per the #405 precedent.
- **No #405-style bolts fired**: 0.16.0 is confined to the standalone
  `DecisionRecordSchema` family (not wired into `OlumiResponseSchema`), so
  the wire-surface pin, block-type allowlist, and output-safety
  never-bolt all pass with zero edits (verified explicitly).

## 2. Capture addendum (RED-first)

- **RED** commit `3c94f2dba`: 6 behaviour specs failing pre-implementation
  + the type-only `CreateDecisionRecordWrite.prediction` surface, so specs
  compile everywhere and fail purely on behaviour. Includes:
  - goal-bearing fixture → both probabilities land verbatim from the
    CHOSEN option's `option_comparison` record;
  - absent-goal-fit fixture → honest omission (neither key exists, never
    a fabricated 0);
  - independence (one present, one absent), unusable-value omission
    (out-of-range / non-finite → omitted, never clamped), boundary 0/1
    kept;
  - `confidence_source: 'model_derived'` on every write;
  - **strict-parse proof**: vendored 0.16.0 accepts the exact prediction
    shape 0.15.0 hard-rejected, and `.strict()` stays armed on a rogue key
    (the rejection mechanism is intact — only the whitelist grew).
- **GREEN** commit `e13004cc1`: `usableUnitInterval` guard (finite number
  in [0,1] — the same rule as `confidence`), verbatim capture, no
  rescaling. 36/36 in the decision-records suites.

### Wire provenance of the two fields

Both ride the same per-option `enrichment.option_comparison[]` rows the
leader is already resolved from: PLoT emits `probability_of_goal` from
ISL's per-option results and `probability_of_joint_goal` from ISL's
`constraint_analysis.joint_probability`
(plot-lite-service `src/routes/v2/run.ts` ~1572–1592), each omitted when
absent — which is exactly why absent stays absent here.

### confidence_source design note

Stamped **unconditionally** on every write from this seam: every value the
hook can place on `prediction` is model-derived (deterministic summary,
leader `win_probability`, ISL goal probabilities), and 'user_stated' is
unreachable here (it belongs to a future elicitation lane). The explicit
stamp puts provenance on the record itself rather than leaning on the
schema's absent⇒model_derived disclosed inference (calibration honesty
§2: the two populations are never blended).

## ⚠ RESIDUAL — out-of-surface, blocking before migration execution

The merged-but-**UNEXECUTED** migration
`supabase/migrations/20260710113000_v5_decision_records.sql` still guards
`p_prediction` against the 0.15.0 key-set:

- RPC guard (~line 391): `p_prediction - 'statement' - 'confidence' <>
  '{}'::jsonb` → **22023** on any new key;
- CHECK constraint `dr_prediction_shape` (~line 206).

Once that migration executes as-is, **every capture from this seam is
22023-refused wholesale** (the hook logs + swallows → silent total capture
loss). Nothing breaks today — the RPC does not exist on staging until the
Paul-gated execution — but the migration **must be amended in place**
(its own documented pre-execution amendment flow, the PR #415→#410
precedent) to admit `confidence_source`, `probability_of_goal`,
`probability_of_joint_goal` (and, per the same 0.16.0 wave,
`decision.committed_by_user` on `p_decision`) **before execution**. The
migration is outside this lane's named surface (vendor/, package.json,
capture.ts + store adapter + tests + lane doc), so it is flagged here and
in the PR body, not touched.

## Gates

- `pnpm typecheck:src`: **CLEAN** (after vendor bump alone, after RED
  commit, and after GREEN).
- `pnpm test:required`: see PR body for the run result (0 fail required).
- node_modules: 0 tracked changes in every commit.
- Telemetry: no new events; the frozen-registry member
  `v5.decision_records.record_captured` is unchanged.
- Reserved scenarios (1909b083*, def3cb31*, 8e0bf73d*, 88396c52*): not
  touched (no live-store access in this lane at all — pure unit surface).

## Rollback

Revert the three commits (`vendor` → `RED` → `GREEN`) or the squash-merge;
the vendor commit restores the 0.15.0 tarball/pin/README in one step;
`pnpm install` repopulates node_modules.
