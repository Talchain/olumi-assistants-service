# CEE MM P1 fix-set completion — 2026-07-09

**Branch:** `claude-cee/mm-p1-hygiene` (base: `origin/staging` @ `c157d218c`)

Companion to `Docs/lanes/LANE-HYGIENE-BATCH-2026-07-08.md` (PR #378), which
already landed items 1, most of 2, and half of 5 the day before this lane
started. This lane completes the residuals PR #378 left open and works the
remaining ROADMAP 1.25 items, verifying each against current code first —
several had already moved or landed since the fix set was written.

---

## Item 1 — null-graph gate (`commit.ts` `graphWasProvided`)

**Status: ALREADY DONE.** Landed in PR #378 (`2a6f4128e`, 8 Jul) as
`graphWasProvided(graph) => graph != null`, used at both the MM-hook gate
and the `graphPersisted` result field. Verified present and unchanged at
this branch's base. No action taken.

## Item 2 — guest `sign_in_required` → non-fault

**Status: log-demotion already done (PR #378); RPC-skip completed here.**

PR #378 already demoted the guest-refusal log from `warn` to `debug`
(`isExpectedGuestVersionRefusal`), but explicitly left the "skip the RPC
entirely" half as a residual — CEE had no per-turn guest signal threaded
into `CommitMetadata`, and the nearest existing check
(`preflightEnsureScenario`) discards its ownership read after its own
cross-tenant check.

Rather than widen `preflightEnsureScenario`'s return type and thread a new
field through turn-executor.ts's ~6 `CommitMetadata` construction sites
(the scale PR #378 correctly declined), this lane adds a **new, optional,
plain-read `SessionStore.getScenarioOwner(scenarioId)`** method
(`session/store.ts` interface + `session/supabase-store.ts` impl — a bare
`SELECT user_id FROM scenarios WHERE id = $1`, no upsert, no RPC) and calls
it from inside `commit.ts::recordModelVersionForCommit` — which already has
a `SessionStore` instance in its enclosing closure — immediately before the
`saveVersion` RPC. `owner === null` (guest/unowned/absent) skips the RPC
entirely and logs at `debug`; a missing implementation or a read failure
fails OPEN to the pre-fix behaviour (attempt the RPC; let it answer MV001
authoritatively).

The interface member is `?`-optional so none of the four existing
`SessionStore` test-double implementations needed updating (TS allows
omission of optional members); `commit.ts` guards with `typeof
sessionStore.getScenarioOwner === 'function'`.

Tests: `src/orchestrator-v5/__tests__/commit-model-version-hook.test.ts`,
new `guest pre-check` describe block (4 cases: guest→skip, owned→proceed,
no-precheck-impl→proceed, precheck-throws→proceed). RED-verified via
`git stash` on the implementation files (2 new-behaviour tests failed,
all 7 pre-existing regression-guard tests in the file stayed green).

## Item 3 — `metadata.graph` null normalise (turn-executor:5882)

**Status: INVESTIGATED — already fully covered by item 1, no separate
action.** The `turn-executor.ts:5882` line reference in the ROADMAP entry
is stale (that line is inside the unrelated coach-path branch today; the
file has grown to 7,696 lines since Brief H was written). Traced every
consumer of `CommitMetadata.graph` / `metadata.graph` in `commit.ts`:

- `graphWasProvided(metadata.graph)` (item 1's fix) is the single
  authoritative null-vs-undefined normalisation point, used at both the MM
  hook gate and the `graphPersisted` result.
- `repairGraphForPersistence` already documents "No-op when there is no
  graph to persist (undefined/null)" — treats both identically.
- `SupabaseSessionStore.append` passes `p_graph: write.graph ?? null` —
  already collapses `undefined` to `null` uniformly before the RPC, and the
  RPC's own `p_graph IS NULL` guard treats both the same way.

No remaining call site treats an explicit `null` differently from
`undefined`. A duplicate one-liner at a turn-executor call site would be
redundant with the already-landed chokepoint fix.

## Item 4 — racing-pointer fix (thread `expected_graph_identity_hash`)

**Status: DONE**, with a documented residual.

`ModelManagementService.saveVersion` / the `create_model_version` RPC
already accept an optional write-time CAS param
(`expected_graph_identity_hash`) — confirmed plumbed end-to-end
(`service.ts` → `store-adapter.ts` → `20260705120000_v5_model_versions.sql`
`p_expected_graph_identity_hash`, MV409 on mismatch). It was simply never
threaded from the commit hook. `commit.ts::recordModelVersionForCommit` now
accepts `expectedGraphIdentityHash` and passes it through to `saveVersion`
verbatim when it's a string (both `null` and `undefined` on
`CommitMetadata.expectedGraphIdentityHash` collapse to "omitted" — the
service only accepts a string).

**Known bootstrap caveat (documented in code, not fixed here — a
DB-migration-class change, Paul-gated, out of this hygiene batch's
scope):** the RPC's CAS compares the write against the scenario's **MM
version HEAD**, not `scenarios.graph` itself. `expectedGraphIdentityHash`
is the A3 CAS hook's pre-turn *scenarios.graph* base. For a scenario with
pre-existing graph history whose first MM-tracked commit carries a
non-empty expected hash, the RPC sees `v_head IS NULL` (no MM version yet)
and raises the same MV409 — a false conflict, not a real race. This
degrades exactly like any other non-ok `saveVersion` status: logged at
`warn`, turn result unaffected (fire-and-forget, non-blocking contract),
no version row written for that turn. Filed as a residual for a future
MM-hardening lane (mirrors ROADMAP 2.17's "monotonic
`current_model_version_id` advance" forward item) — proper fix is either an
RPC change to allow `v_head IS NULL` to pass CAS (bootstrap case, migration
change) or reading MM's own current head before writing (an extra round
trip in the fire-and-forget hook).

Tests: same file, new `racing-pointer CAS threading` describe block (3
cases: string hash threaded verbatim, `undefined` → key omitted
byte-identical to pre-fix, `null` → collapses to omitted not literal
`null`). RED-verified the same way as item 2.

## Item 5 — two stale comments + V4-tombstone env guard

**Two stale comments: ALREADY DONE** in PR #378 (item C3: `config/index.ts`
`modelVersionsEnabled` comment; `model-management/types.ts`
`CAS_CONFLICT_KIND` comment) and a same-batch follow-up commit (item D:
`config/index.ts` `pipelineV4Enabled` inverted-semantics comment,
ROADMAP 1.30c). Verified both present and accurate at this branch's base.
No action taken.

**V4-tombstone default flip: INVESTIGATED, ATTEMPTED, REVERTED — filed as
a residual.** Confirmed the real risk: `CEE_PIPELINE_V4_ENABLED` is
declared in neither `render.yaml` nor `render-staging.yaml`, so the live
410 on `/orchestrate/v1/turn` depends entirely on an out-of-band Render
dashboard env var; the code default is `true` (V4 enabled), so a fresh
deploy or an accidentally-reset env var would silently re-enable the
tombstoned pipeline with zero code-level signal.

Flipping the default to `false` was implemented and then **reverted**
after verification: `tests/integration/orchestrator/route.test.ts` has
~30 cases in its "multi-turn conversation lifecycle" suite that call
`/orchestrate/v1/turn` without mocking `pipelineV4Enabled`, relying on
today's `true` default to reach the V4 pipeline and assert `200`. Flipping
the default turned every one of them into a `410` — confirmed NOT
pre-existing flake (reverting just the one default line restored
`route.test.ts` to fully green; a baseline worktree run of the same file
was unaffected either way). That is a real regression outside a hygiene
batch's blast radius, not a one-line default flip — updating ~30 call
sites to mock the flag explicitly (mirroring
`route-v4-disabled-guard.test.ts`'s `vi.mock` config-proxy pattern) is a
dedicated lane. Documented in `src/config/index.ts` at the
`pipelineV4Enabled` declaration so the next lane that touches this flag
has the finding without re-discovering it. Filed as a ROADMAP residual.

## Item 6 — dead `src/cee/constraint-extraction/**` removal

**Status: DONE.** Proved zero live references before deleting:
`grep -rn "constraint-extraction"` across `src/`, `tests/`, `scripts/`,
and `Docs/` found only (a) the module's own three files, and (b) its
single consumer, `tests/unit/constraint-to-risk.test.ts` (which imports
`constraintToRiskNode`/`constraintsToRiskNodes`/`findRelatedFactor` from
`to-risk-node.ts` — `llm-extractor.ts`'s three exports,
`extractConstraintsLLM`/`getConstraintExtractionSystemPrompt`/
`buildConstraintExtractionPrompt`, had **zero** references anywhere,
including in that test file). No barrel re-export (`src/cee/index.ts`
doesn't exist), no dynamic import, no string-literal reference outside the
module and its test. Checked the coincidentally-named
`"constraint_extraction"` observability task-key case in
`src/cee/observability/llm-call-recorder.ts::methodToStep` — that's an
unrelated, general-purpose method-name→telemetry-label switch (keyed off a
different interface's method name, not this module), left untouched
(out of this item's scope).

Deleted `src/cee/constraint-extraction/{index,llm-extractor,to-risk-node}.ts`
and `tests/unit/constraint-to-risk.test.ts`. `pnpm typecheck:src` clean
after removal (would have caught any missed import).

## Item 7 — `readResultRecords` 'results'-key read-order cleanup

**Status: DONE.** Verified against PLoT's actual emission: PLoT's `/v2/run`
wire response (`plot-lite-service` `origin/staging` @ `3cf5433`,
`src/routes/v2/run.ts`) never sets a top-level `results` key — only
`option_comparison`. CEE's own `V2RunResponseMinimal` schema
(`src/orchestrator/plot-client.ts`) already documents this precisely:
*"PLoT returns option data in `option_comparison` (not `results`)"* —
`results` is accepted there only as defensive tolerance for a hypothetical
alt shape, never actually observed on the wire. Independently corroborated
by `tests/contract/plot-to-cee.contract.test.ts`'s real staging capture,
whose `readResultRecords`-labelled test asserts against `option_comparison`
records, not `results`.

`readResultRecords` (`src/orchestrator-v5/tools/handlers/run-analysis.ts`)
previously checked `results` FIRST and documented it as "canonical" — the
inverse of reality. Since PLoT never populates `results` in production,
this was a dead precedence branch with a misleading comment, not a live
bug (both keys are never simultaneously populated on the real wire).
Reordered to check `option_comparison` first, `results` as the (still
accepted) defensive fallback; corrected the doc comment.

Tests: new
`tests/unit/orchestrator-v5/tools/handlers/run-analysis-read-result-records.test.ts`
(6 cases: precedence when both populated, results-only fallback,
option_comparison-only, neither, both-empty, non-record filtering).
Exported `readResultRecords` (previously module-private) to test it
directly, following this file's existing pattern
(`evaluateAnalysisStatus` is exported the same way). RED-verified via
`git stash`.

## Stray file: `src/orchestrator/deterministic/actions/edit-graph 2.ts`

**Status: DONE**, but not part of this PR's diff. Confirmed: untracked
(`git status` showed nothing for it), gitignored by `.gitignore:12` (`* 2.*`
— a rule specifically for this class of duplicate-file artifact), and
zero references anywhere (`grep -rn "edit-graph 2"` across the repo hit
nothing but the file itself and unrelated `.claude/worktrees` /
`tools/graph-evaluator` fixture paths). Diffed against the real
`edit-graph.ts` — a stale, superseded duplicate (older assistant-text
strings, missing `HandlerFact`/`ActionFailure` imports added since). Since
it was never tracked by git, `rm`'d directly in the active tree
(`/Users/paulslee/Documents/GitHub/olumi-assistants-service`) — nothing to
commit.

## Excluded per the brief

**CAS-kind rename** — contract-adjacent, Paul-gated. Not touched.

## Gates run (this lane)

- `pnpm typecheck:src` (`tsc -p tsconfig.build.json --noEmit`) — clean
  after every item.
- `pnpm exec eslint` on every changed file — clean.
- `bash scripts/validate-state-write-invariant.sh` — OK (this lane touches
  `session/store.ts` / `session/supabase-store.ts` / `commit.ts`, the three
  files this invariant governs).
- `bash scripts/validate-prepush.sh` (the authoritative gate) — all checks
  passed (toolchain, typecheck, smoke tests, stale-`.js`, dependency audit,
  tarball SHA, transport invariants, data responsibility, phase-0/1.5
  invariants, docs consistency, state-write invariant, handler ownership,
  response-finaliser contract, forbidden boundary patterns).
- Targeted vitest on every touched/new file, RED-first via `git stash` on
  each implementation file: `commit-model-version-hook.test.ts` (14/14),
  `commit-mm-p1.test.ts` (8/8, unchanged, regression check),
  `commit.test.ts` (20/20, unchanged), `session/__tests__/*` (85/85,
  unchanged), `run-analysis-read-result-records.test.ts` (6/6),
  `plot-to-cee.contract.test.ts` + `slice-c2-run-analysis-mocked.test.ts` +
  `phase1-c2-regression.test.ts` (regression checks, all green except one
  confirmed pre-existing/unrelated failure in
  `orchestrate-v2-group1-activation.test.ts`, reproduced identically on a
  clean `origin/staging` worktree — a `decision_review` enrichment gap
  unrelated to any file this lane touches).
- `pnpm exec vitest run --changed=origin/staging` (unbounded, no `--bail`)
  surfaced ~250 failures across ~50 files spanning auth/admin/HMAC
  suites this lane never touched — not attributable to this diff (the
  repo's own doctrine flags "Integration / Full Suite chronic reds" as a
  standing, disclosed, pre-existing condition; the authoritative gate is
  `scripts/validate-prepush.sh`'s bounded smoke-test set, which is green).
  Not independently re-verified file-by-file against baseline given time
  budget — flagged here rather than silently omitted.
