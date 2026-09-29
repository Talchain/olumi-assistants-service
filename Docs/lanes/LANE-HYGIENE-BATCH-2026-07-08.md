# CEE hygiene batch — 2026-07-08

**Branch:** `claude-cee/hygiene-batch` (base: `origin/staging` @ `9ca69f17e`)
**Companion (separate, Paul-gated):** `claude-cee/store-draft-graph-revoke`
(off the same base) — a DB-security REVOKE migration, NOT bundled into this
PR. See its own section at the bottom.

Five items, one commit each, RED-first where behavioural. Frozen telemetry
registry: no new event names added anywhere in this batch. Reserved staging
scenarios (`1909b083*`/`def3cb31*`/`8e0bf73d*`/`90385279*`/`104d65bd*`/
`fc14e7942`-era) untouched.

---

## Item A — `constraints_status` keep-list (STOPPED, documented — not implemented)

**Brief:** close the 1.6b UI backend-gap residual (DecisionGuideAI
`docs/lanes/lane36-seam-1-6b-enrichment-lift.md`) by adding
`constraints_status` to CEE's CEE→UI safe-transport keep-list, IF PLoT
actually produces it.

**What I verified:**
- **PLoT DOES emit `constraints_status`** on the `/v2/run` response
  (`plot-lite-service` `origin/staging` @ `3cf5433`,
  `src/routes/v2/run.ts:1475,1511,1519,1598,1691` — `'computed' |
  'unavailable' | 'error'`, honest-absence discipline per
  `docs/lanes/LANE27-constraint-results-top-level-gating-2026-07-08.md`).
  It is part of the ~40-key raw envelope CEE's `run_analysis` handler
  persists byte-for-byte (`@talchain/schemas` 0.14.0
  `AnalysisEnrichmentSchema` — the typed opt-in schema for that persisted
  envelope — includes `constraints_status` as a field).
- **BUT the vendored `@talchain/schemas` 0.14.0 canonical
  `CEE_UI_ENRICHMENT_KEEP_LIST`** (the cross-repo source of truth
  `compose.ts`'s `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` is drift-bolted
  against, `tests/contract/cee-to-ui.contract.test.ts` — an EXACT
  `toEqual` + a `toHaveLength(11)` pin) **does NOT include
  `constraints_status`.** Confirmed against `olumi-schemas` `origin/main`
  @ `5612e26` (same commit the 0.14.0 tarball was built from — no newer
  schemas version exists with this field added).

**Why this STOPS here, not "add the key":** unilaterally adding
`constraints_status` to `compose.ts`'s keep-list would immediately fail
the drift-bolt contract test (12 keys vs. the vendored package's 11,
`toEqual` mismatch) and the companion `toHaveLength(11)` pin — both exist
specifically to prevent CEE and the schemas package's keep-lists from
diverging (`compose.ts`'s own doc comment: *"Change this list ONLY in
lock-step with the schemas package"*). This is a genuine cross-repo
change (schemas package bump + re-vendor, mirroring the lane-33 workstream
that landed 0.14.0), out of scope for a single-repo CEE hygiene lane and
too large a blast radius for an "orchestrator-mergeable" batch.

**Disposition:** no code change. The DecisionGuideAI lane-36 mapper lift
stays forward-compatible-but-inert, exactly as that lane already
documented. Follow-up: a schemas-package lane to add `constraints_status`
to `CEE_UI_ENRICHMENT_KEEP_LIST`, cut a 0.15.0 (or similar), then a CEE
lane to re-vendor + add the key + update the drift-bolt's expected length.

---

## Item B — cap-doctrine unification (ROADMAP 1.18)

**Bug:** `src/cee/factor-extraction/enricher.ts`'s goal-threshold
redirection branch (`enrichGraphWithFactorsAsync`) used
`computeNormalisationCap` (unit-blind next-power-of-10 rounding) to derive
`goal_threshold_cap` for a raw target quantity. The sanctioned doctrine
(`add-constraint.ts`'s `resolveGoalThresholdCap`, used by the chat-path
`add_constraint` handler) instead does: reuse a compatible existing cap ≥
raw, else `%` targets → /100, else 25% headroom above raw. The two
diverged: the SAME raw target scored differently depending on whether it
was registered via a draft brief (enricher) or a chat message
(add_constraint) — e.g. raw=150 (no unit): old draft-path cap 1000 →
`goal_threshold` 0.15; chat-path cap 187.5 → `goal_threshold` 0.8. A ~5.3x
credibility divergence on the same stated target.

**Fix:** extracted `resolveGoalThresholdCap` into a new shared module,
`src/utils/goal-threshold-cap.ts` (single doctrine source of truth,
full doc comment explaining the '%' pre-division subtlety below).
`add-constraint.ts` now imports it (local copy deleted). `enricher.ts`'s
goal-threshold redirection branch now delegates to the SAME function for
its non-percentage cap computation.

**Deliberately NOT touched:** `computeNormalisationCap` itself stays in
`enricher.ts` for the OTHER two call sites (enhance-existing-factor,
create-new-factor) — those normalise plain FACTOR node values for display
legibility, an unrelated concern from goal-fit scoring; unifying them was
out of this item's scope and risked regressing factor-card display values
that have their own existing test coverage.

**Percentage subtlety (load-bearing, documented in the new module):**
`add-constraint.ts`'s convention stores percent targets as the RAW PERCENT
NUMBER (`5` for "5%"); `enricher.ts`'s regex extraction PRE-DIVIDES
percentages into a 0–1 fraction before this code ever sees them. Routing
the enricher's percentage branch through `resolveGoalThresholdCap` would
double-divide (0.15 → cap 100 → 0.0015, a 100x regression) — so that
branch stays a short-circuit (fraction as-is, no cap), which is already
mathematically equivalent to the doctrine's '%'→/100 step, just
pre-applied. Verified by a dedicated test.

**Tests (RED-first, `git stash` on `enricher.ts` only, confirmed a
concrete pre-fix failure — `expected 1000 to be 187.5` — then restored):**
new `tests/unit/cee.goal-threshold-cap-doctrine.test.ts` (8 tests):
`resolveGoalThresholdCap` unit cases (headroom, %, existing-cap reuse,
incompatible-unit, non-positive) + the RED fixture (identical raw target
150 → identical `goal_threshold_cap`/`goal_threshold` via both the direct
doctrine call and the draft-path enricher) + a regression pin for the
pre-existing 800-customers fixture (unaffected — 800×1.25 happens to equal
the old order-of-magnitude cap, 1000, so it was a coincidence, not a
divergence, for that specific value) + the percentage-branch
non-regression case. Existing `tests/unit/cee.factor-enricher.test.ts`
(13 tests) still green, unmodified.

---

## Item C — MM P1 set (ROADMAP 1.25)

### C1 — `commit.ts` null-vs-undefined graph gate

**Bug:** `commit.ts:~691/~702` gated the MM version hook and the
`graphPersisted` result field on `metadata.graph !== undefined`.
`CommitMetadata.graph` is typed `unknown`, and at least one caller path
(`turn-executor.ts`'s `outcome.mutatedGraph` cast,
`GraphStateIngress | null | undefined`) can supply an explicit `null`.
`null !== undefined` is `true`, so an explicit `null` graph passed the
gate as if a graph had been provided: the Lane 8 MM version hook fired
with `graph: null` (MM's `computeGraphIdentityHash` treats `null` as
identity-empty → a spurious `empty_graph` error/warn for a commit that
never intended to write a graph) AND `graphPersisted: true` was returned
on the same commit — a direct contradiction (the caller is told it's safe
to advance `stage_indicator='analyse'` on a turn that persisted no graph).

**Fix:** extracted `graphWasProvided(graph: unknown): boolean` (`graph !=
null` — excludes BOTH `null` and `undefined`) and use it at both call
sites. An explicit `null` now behaves identically to an omitted graph.

**Test (RED-first via the pure predicate — no `!==undefined` fallback
existed to compare against pre-fix, so RED = the function not existing
yet):** `tests/unit/orchestrator/commit-mm-p1.test.ts`, `graphWasProvided`
describe block (4 tests: `undefined`→false, `null`→false [the bug],
object→true, falsy-but-provided primitives `0`/`''`→true).

### C2 — guest `sign_in_required` (MV001) log-level demotion

**Bug:** `recordModelVersionForCommit`'s error/conflict branch logged
EVERY non-ok `saveVersion` result at `warn`, including `sign_in_required`
(SQLSTATE MV001) — the DESIGNED, EXPECTED outcome for every commit against
an unowned (guest) scenario (`scenarios.user_id IS NULL`, D3 Branch A,
`supabase/migrations/20260705120000_v5_model_versions.sql`). Every guest
commit logged a warning for behaviour working exactly as specified,
drowning out genuine MM faults (`store_error`, real CAS conflicts) in the
same log stream.

**Fix:** extracted `isExpectedGuestVersionRefusal(result): boolean` and
demoted that one case to `log.debug`; every other error/conflict status
stays `log.warn` (still actionable).

**NOT implemented — "skip the RPC when scenario unowned":** the brief
additionally asked to skip the `saveVersion` RPC entirely for a known-guest
scenario, avoiding the wasted round trip. Investigated: CEE currently has
NO per-turn "is this scenario a guest scenario" signal available at the
commit-seam call site. The nearest existing check
(`build-turn-context.ts`'s `preflightEnsureScenario`) reads
`scenarios.user_id` earlier in the SAME turn but discards the result after
its own cross-tenant check — it is not threaded into `CommitMetadata`, and
there is no server-side global "guest mode" flag (guest-vs-authenticated is
per-scenario, not a deployment-wide toggle). Surfacing that signal properly
would mean widening `preflightEnsureScenario`'s return type and threading a
new field through `turn-executor.ts`'s ~6 `CommitMetadata`-construction
call sites into `commit.ts` — real, valuable work, but a genuinely
different-scale change than fits an "orchestrator-mergeable hygiene batch"
(touches the most sensitive file in the turn-commit path for a latency
optimisation, not a correctness fix). Filed as a residual below; the debug
demotion above already delivers the stated primary benefit ("stops a WARN
... every guest commit").

**Test:** `commit-mm-p1.test.ts`, `isExpectedGuestVersionRefusal` describe
block (4 tests: `sign_in_required`→true; `store_error`, CAS conflict, `ok`
→false).

### C3 — two stale comments

- `src/config/index.ts` (`modelVersionsEnabled`, was ~line 840-861):
  removed the claim "the module has zero production call sites this
  slice; nothing is wired into routes or the turn-executor" — false since
  Lane 8 (2026-07-07) wired the flag-gated commit-seam MM version hook
  into `commit.ts` (the very file C1/C2 above touch). Replaced with an
  accurate pointer to that one sanctioned call site.
- `src/orchestrator-v5/model-management/types.ts` (`CAS_CONFLICT_KIND`,
  was ~line 70-79): the comment claimed the `satisfies
  GraphCasConflictCategory` constraint "makes any drift between this
  literal and the A3 closed enum a compile error" — overclaims what
  `satisfies` checks. It only guards that this ONE token
  (`'analysis_affecting_conflict'`) stays a valid member of the union; it
  does not catch new A3 category members this file should also handle,
  does not verify this is the semantically-correct category to use here,
  and creates no exhaustiveness/bidirectional check. Rewritten to state
  precisely what the guard does and does not do.

Doc-only; no tests (no behaviour change).

---

## Item D — config inverted-semantics comment (ROADMAP 1.30c)

`src/config/index.ts` (`pipelineV4Enabled`, was ~line 444-447) asserted
the OPPOSITE of the guard code: it claimed
`CEE_PIPELINE_V4_ENABLED=true` DISABLES V4 (410) and `=false` ENABLES it.
The actual guard (`src/orchestrator/route.ts:~102`,
`if (!config.features.pipelineV4Enabled) { ...; reply.code(410); }`) does
the reverse — `=false` is what returns 410 `V4_DISABLED`; `=true` is what
lets V4 execute normally. Fixed the comment to match the code (verified
against the live guard, cited above). Doc-only.

---

## Item E — `store_draft_graph` doc reconciliation (ROADMAP 1.40, docs half)

Live DB introspection (orchestrator, `pg_proc`/`proacl`, 2026-07-08, same
read-only method as the original 2026-07-04 finding) proved
`store_draft_graph`'s `authenticated` EXECUTE grant is **NOT present
live** (acl `postgres|service_role` only) — an equivalent `REVOKE` was
applied out-of-band since the 2026-07-04 finding. **The hole is CLOSED
live.** But the docs conflicted:
- `Docs/FEATURE_FLAGS.md` (already correct: "A4 closed" wording, ~line
  173) — no change needed.
- `Docs/v5/V5_CURRENT_STATE.md` (~line 27) and
  `Docs/v5/group-a-canonical-state-foundation.md` (the original §0
  finding, §7 plan, §10/§12 status lines, 2026-07-04) both stated the
  grant was still live / "queued, not applied" — stale.

**Reconciled:** `V5_CURRENT_STATE.md`'s line updated to state A4 is DONE
at the live-DB level, citing the 2026-07-08 introspection, with the repo
re-arm residual noted. `group-a-canonical-state-foundation.md` gets a new
`⚠ UPDATE (2026-07-08)` block right after the title (the current-truth
pointer) plus inline "SEE UPDATE AT TOP" annotations at every place the
original 2026-07-04 investigation asserted the hole was still open (§0,
§7, §10, §12) — the original point-in-time investigative narrative is
preserved as history (not rewritten/deleted), but no future skim can
misread it as the current state. Doc-only.

**Explicitly NOT closed by this doc reconciliation:** the repo's own
migration (`20260422120000_v5_store_draft_graph.sql`) still contains the
original `GRANT EXECUTE ... TO authenticated`, so a fresh DB build or a
prod promotion that replays migrations (rather than cloning live) would
RE-ARM the hole — repo state and live state have drifted apart. That is a
DB-security-class change, kept separately Paul-gated: see the companion
`claude-cee/store-draft-graph-revoke` branch below.

---

## Pre-existing CI reds (disclosed, not chased — per repo convention)

Not introduced by this batch; carried from `origin/staging` @ `9ca69f17e`:
- `Integration` / `Full Suite` chronic reds (repo-wide, unrelated files;
  see `lane8-gm-mm-live-integration-evidence.md` and prior lane docs for
  the standing disclosure).
- `Security Audit` — pre-existing advisory-only findings (no new
  advisories introduced by this batch's `pnpm install` — no dependency
  changes; only source + one new vendor-free util file + two new test
  files + doc edits).

## Gates run (this batch)

- `pnpm typecheck:src` (`tsc -p tsconfig.build.json --noEmit`) — clean
  after every item.
- `bash scripts/ci/typecheck-ratchet.sh` — within baseline (462 errors;
  136-137 files; drift shrank by one pre-existing file, unrelated to this
  batch — `integration-precondition-fail-chip.test.ts` — not touched
  here, left for a separate baseline-tightening pass).
- Targeted vitest on every touched/new file: `cee.goal-threshold-cap-doctrine.test.ts`
  (8), `cee.factor-enricher.test.ts` (13, pre-existing, unmodified),
  `commit-mm-p1.test.ts` (8), plus the deterministic-orchestrator suite
  touching `add-constraint.ts`'s call sites (187 tests,
  `tests/unit/orchestrator/deterministic/**`) — all green.

---

## Companion PR (separate, Paul-gated, DO NOT MERGE with this one)

**Branch:** `claude-cee/store-draft-graph-revoke` (off the same
`origin/staging` @ `9ca69f17e` base — independent of this branch, not
stacked on it).
**File:** `supabase/migrations/20260708130000_v5_revoke_store_draft_graph_authenticated.sql`
— `REVOKE EXECUTE ON FUNCTION store_draft_graph(uuid, jsonb) FROM
authenticated;` (service_role/postgres untouched).

Authored, NOT executed. Makes the repo's migration history match the
already-safe live state (Item E above) and closes the re-arm risk (a
fresh DB build from this repo would otherwise re-create the authenticated
grant). Explicitly scoped to `store_draft_graph` only — the related
legacy `append_turn_atomic` (13-arg) secondary finding is a separate,
not-yet-authored revoke (see group-a-canonical-state-foundation.md
§0/§7/§10). DB/security-class change: Paul-gated, title-prefixed
`[PAUL-GATED — DB security, do not merge]`.
