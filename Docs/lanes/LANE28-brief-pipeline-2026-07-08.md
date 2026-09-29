# Lane 28 — brief pipeline: persist brief_text, ContextPack brief field, flag-gated PLoT leg

**Branch:** `claude-lane28/brief-pipeline` (base: `origin/staging` @ `8a495c80f`)
**Scope owned:** the `scenarios.brief_text` commit/persistence seam, `src/orchestrator-v5/context/**` (brief field only), config flag registration, run_analysis PLoT call-shape (flag-gated), tests, this doc.
**Not touched:** prompt content (Brief I owns it), any other ContextPack field, PMS, compose keep-lists, `main`.

## Problem (dossier gap G2 + 2/3 of G12 — "the system forgets the decision")

The context-architecture dossier (Brief G, 2026-07-08) verified that the
user's decision brief reaches NO LLM after the draft turn:

1. **`scenarios.brief_text` is never populated by production flows.** The
   write path exists end-to-end (`commit.ts` `briefText` →
   `append_turn_atomic(p_brief_text)`, first-write-wins predicate) and
   draft-graph-dispatch supplies it — but that dispatch's route-v2 trigger
   (`isDraftGraphShape`) requires `graph_state == null` AND no prior committed
   turns. Turns that reach the TurnExecutor instead (continuation scenarios —
   e.g. greeting first, brief second; requests carrying `graph_state`)
   committed through sites that re-passed only `context.scenarioBriefText`,
   i.e. the ALREADY-persisted brief — a circular no-op when nothing was ever
   written. Lane-21 telemetry confirmed staging scenarios carry no persisted
   `brief_text` (decision_review skips `no_brief`).
2. **The ContextPack had no brief field** (schema + assembler, zero
   occurrences at the dossier's pinned SHA), so the routing/coaching LLM never
   saw the brief on any turn after the draft.
3. **CEE never sends the brief to PLoT** → PLoT telemetry `brief_present=false`
   → PLoT's factor-review / M2 legs (gated on `!!body.brief`) structurally dead.

## Mechanism (what changed, per seam)

### Seam 2 — ContextPack brief field (`9840e1750`, null-omission fix `e993d8748`)

- `projectBrief` (context-pack-assembler.ts): trim → bound at
  `CONTEXT_PACK_BRIEF_CHAR_CAP = 2000` (context-pack-schema.ts) → DISCLOSED
  truncation (`truncated` flag + `original_chars`), never a silent slice.
- Null / undefined / whitespace-only input → the pack carries **no `brief`
  key at all** (review fix `e993d8748`; the first cut emitted `brief: null`
  on every no-brief pack, serialising `"brief": null` into every assembled
  routing prompt — prompt noise, now pinned absent by test at both unit and
  turn-executor level).
- Strict `ContextPackBriefSchema`; `brief` optional (`.nullable()` retained
  only for tolerant validation of hand-built packs — the assembler never
  emits null).
- Turn-executor threads `context.scenarioBriefText` (already loaded once per
  turn by `buildTurnContext` via `loadGraphAndBriefText`) into the assembler;
  `buildUserMessage` serialises the field into the routing prompt
  automatically.
- **Prompt-content claim, stated precisely:** the prompt TEMPLATES (Brief I /
  PMS) are untouched — but the merged behaviour DOES change what the routing
  LLM reads: whenever a brief exists for the scenario, every assembled
  ContextPack serialises a `brief` field into the routing prompt. That is
  the feature (gap G2: the brief previously reached no LLM after the draft
  turn), not a side effect.

### Seam 1 — persist `scenarios.brief_text` (`242a57a2d`, narrowed by `9acf55671`)

- New pure helper `src/orchestrator-v5/session/derive-brief-seed.ts`.
  After the review narrowing (`9acf55671`), the seed fires ONLY when ALL of:
  - the scenario has **no committed graph yet** (`hasCommittedGraph: false`
    — the executor passes `context.persistedGraph != null`, its server-side
    scenarios read; this mirrors route-v2's actual draft scope of
    `graph_state == null` + no prior committed turns);
  - message-kind payload at **frame stage**;
  - trimmed text ≥ `DRAFT_GRAPH_MIN_BRIEF_LENGTH` (30) and matches the
    decision-brief shape regex (mirror of route-v2's
    `DRAFT_GRAPH_DECISION_BRIEF_REGEX`, cross-referenced in both
    directions);
  - the trimmed text does **not end with `?`** — a permanent
    first-write-wins field must not be claimable by any mid-conversation
    question. (The regex's `\?$` alternative is kept for route-v2
    mirror-fidelity but is deliberately overridden for seeding.)
  Conservative by design: the RPC write is first-write-wins (`WHERE
  brief_text IS NULL OR brief_text = ''`), so a wrong seed would be
  permanent — frame chatter, greetings, and questions must never become the
  brief. Values are `normaliseBriefText`-bounded (8000-char DB CHECK,
  word-boundary truncation).
- Injection at the `commitTurn` wrapper in turn-executor — the same central
  chokepoint that injects `userMessage` and `coaching_state` — so ALL 20
  commit sites seed uniformly: `briefText: meta.briefText ?? briefSeedForTurn`
  (an explicit call-site re-pass wins; seed only when
  `context.scenarioBriefText == null`).
- **Scope deviation (disclosed):** the lane plan located this seam in
  `commit.ts`; it landed at the `commitTurn` wrapper in `turn-executor.ts`
  plus the new `session/derive-brief-seed.ts` helper instead. Why:
  `commit.ts` receives `briefText` from every caller and cannot distinguish
  a seed from a re-pass without new coupling to the turn payload, stage, and
  persisted-graph state; the executor's `commitTurn` wrapper is the existing
  single chokepoint all 20 commit sites already flow through and it holds
  exactly the inputs the gate needs (payload + `context.persistedGraph`).
  The helper lives in `session/` so the session layer does not import the
  HTTP route.
- Disclosed truncation reuses the existing `V5BriefTextNormalised` telemetry
  event with the draft-dispatch site's exact shape (registry unchanged — no
  new enum member).
- draft-graph-dispatch's existing seeding is untouched; the two writers meet
  at the same first-write-wins RPC predicate.

### Seam 3 — flag-gated CEE→PLoT brief leg (`7276fe41e`)

- **New flag `CEE_SEND_BRIEF_TO_PLOT`** (`config.cee.sendBriefToPlot`,
  default **false**), registered in `src/config/index.ts` with the doctrine
  context in the comment. **Ships dark**: doctrine ask D5 (dossier §6,
  brief-to-PLoT privacy) is Paul-gated and undecided — this lane builds the
  plumbing; activation is Paul's call.
- `loadScenarioSnapshotForRunAnalysis` (build-turn-context.ts) now uses the
  new strict combined loader `loadPersistedScenarioStateStrict` →
  `store.loadGraphAndBriefText` — the brief rides the SAME round trip the
  graph already made (the store's `loadGraph` already delegated to
  `loadGraphAndBriefText` and discarded the brief; zero extra DB traffic) with
  the SAME strict error semantics (`SessionReadError` propagates →
  `scenario_read_failed`; null-graph recovery unchanged).
- run_analysis payload build: flag ON + non-whitespace persisted brief →
  top-level `brief` (trimmed), bounded at exported
  `PLOT_BRIEF_MAX_CHARS = 10000` (PLoT's run-schema `maxLength`; the DB CHECK
  caps writes at 8000, so the bound is defence-in-depth) with a DISCLOSED
  warn log if it ever fires. Flag ON + no/whitespace brief → no `brief` key
  (never an empty string; PLoT's `no_brief` skip stays honest). **Flag OFF →
  no `brief` key ever: the outbound wire is byte-identical to before this
  lane**, pinned by `run-analysis-brief-to-plot.test.ts`.
- The chip-click run_analysis path inherits the leg automatically (it injects
  the same snapshot loader into the same handler).
- PLoT acceptance verified in-repo at plot-lite-service
  `src/routes/v2/run.ts`: `brief` is in `V2_RUN_ALLOWED_KEYS` (line 930) with
  `{ type: 'string', maxLength: 10000 }` (line 968); CEE's outbound
  `validateRunPayload` (plot-client.ts) checks required fields only and does
  not reject the additive key.

## Documented, NOT flipped: `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`

The other coaching co-blocker (dossier G12 blocker (1)) is
`config.cee.runAnalysisAwaitDecisionReview`, default **false**
(`src/config/index.ts:532`). This lane does not touch it. What flipping it to
`true` would do **after** the brief pipeline lands:

- run_analysis turns (turn-executor.ts ~5145 and chip-click-dispatch.ts ~584)
  would stop short-circuiting with `v5.decision_review.skipped
  {autofire_disabled}` and instead **await**
  `enrichRunAnalysisWithDecisionReview` before returning — one additional LLM
  call of latency on every run_analysis turn (soft-fail: enrichment errors
  degrade to an absent/null `decision_review`, never a turn failure).
- Pre-Lane-28 the flip alone was pointless: the enricher's next gate is the
  brief, and with `scenarios.brief_text` never persisted it skipped with
  `no_brief` on every scenario. Post-Lane-28 seam 1, scenarios whose brief
  was seeded (frame-stage decision-shaped first message, or the
  draft-dispatch path) pass that gate, so the flip would actually populate
  `ContextPack.coaching.decision_review` — the orchestrator's currently
  permanently-empty coaching slot.
- Caveats for whoever flips it: (a) latency — the enrichment is awaited
  in-turn by design; (b) the dossier flags that
  `buildDecisionReviewUserMessage` sends `<BRIEF>` + full graph JSON + full
  raw ISL results with no display-safe projection, banding, or size caps —
  a context-hygiene review is advisable before activation; (c) the third
  co-blocker (PLoT-side factor/M2 review) additionally needs
  `CEE_SEND_BRIEF_TO_PLOT=true`, which is Paul-gated on D5. Scenarios with no
  seedable brief still legitimately skip `no_brief`.

## Review fix round (2026-07-08, commits `68fcce1b7`, `9acf55671`, `e993d8748` + this doc)

An adversarial review of the first push (`f9dda538d`) found four issues:

1. **Typecheck Drift (ratchet) CI job FAILED on the first push** — the
   lane's two new test files added +7 full-tsconfig errors over the frozen
   462 baseline (vitest-4 `vi.fn` two-generic tuple form, a
   `with { type: 'json' }` import attribute under the full tsconfig's
   module=Node16, and an undeclared `briefText` on build-turn-context's
   `RunAnalysisScenarioSnapshot`). Fixed properly in `68fcce1b7` — baseline
   file untouched; full `tsc --noEmit` back to 462 == baseline.
2. **Seed over-triggering (behavioural risk)** — any ≥30-char frame-stage
   message matching the regex, INCLUDING mid-conversation questions, could
   permanently claim `scenarios.brief_text`. Narrowed in `9acf55671` (see
   Seam 1).
3. **`"brief": null` serialised into every no-brief routing prompt** —
   omitted in `e993d8748` (see Seam 2).
4. **Claim-integrity errors in the PR body and this doc** — the "known
   pre-existing CI reds" list had been copied from plot-lite-service;
   "no prompt-content change" overstated; RED-first evidence presented as
   stronger than it is; the commit.ts→turn-executor scope deviation was
   undisclosed. All corrected in this revision.

## Verification (commands + counts, all in the lane worktree)

- **RED-first status: testimonial, not reproducible from git history.**
  Tests and implementation were bundled in the same commit per seam, so the
  history contains no checked-in RED state; the counts below are the
  implementing session's testimony. Exception (fix round): the seed
  narrowing WAS observed red-then-green — the updated suites run against
  the PRE-narrowing logic (implementation stashed; JS ignores the extra
  argument) fail exactly the new gate cases (**6 failed / 12 passed**) and
  pass **18/18** with the fix.
- Original per-seam testimony:
  - Seam 2 (`9840e1750`): 12/13 new assertions failed pre-implementation;
    e2e threading test failed with the turn-executor edit stashed.
  - Seam 3: `pnpm exec vitest run run-analysis-brief-to-plot.test.ts
    build-turn-context.test.ts` → 5 failed / 27 passed before, 32/32 after.
  - Seam 1: integration seeding case failed (`briefText` undefined — the
    circular re-pass), unit suite failed on missing module before; 13/13
    after.
- **Suites (after the fix round):** brief-pipeline suites
  (derive-brief-seed, both turn-executor brief integrations,
  context-pack-brief, run-analysis-brief-to-plot, build-turn-context) all
  green; `src/orchestrator-v5/context/__tests__` = 460 passed / 0 failed;
  full `pnpm test:required` result recorded in the PR body.
- **Gates:** `pnpm typecheck:src` clean; **full-tsconfig typecheck ratchet
  462 errors == 462 baseline** (`scripts/ci/typecheck-ratchet.sh` passes
  locally); eslint clean on changed files.
- **Wire-identity with flags off:** pinned by test (`'brief' in payload ===
  false` even when the snapshot carries a brief); the ContextPack change is
  additive (key absent when no brief exists); brief seeding writes through
  the pre-existing first-write-wins RPC parameter that every commit already
  passed (`p_brief_text: write.briefText ?? null`).
- **Known pre-existing CI reds on THIS repo** (verified red on base
  `staging` @ `8a495c80f`, unrelated to this PR): `Integration Tests
  (advisory)`, `Full Test Suite (advisory)`, and `Security Audit`. (An
  earlier revision of this doc/PR body wrongly listed plot-lite-service's
  pre-existing reds — copied in error.)
- **NOT verified here:** no live staging run; no Render telemetry pull;
  PLoT-side behaviour with `brief` present was verified by reading PLoT's
  schema/allowlist source, not by a live call. D5 activation evidence is out
  of scope by design.

## Residuals / follow-ups

- **D5 (Paul):** decide brief-to-PLoT privacy → flip `CEE_SEND_BRIEF_TO_PLOT`
  on staging and watch PLoT `brief_present` telemetry.
- **D3/G12 (Paul):** decide decision-review autofire
  (`V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`) — see the note above; consider a
  context-hygiene pass on `buildDecisionReviewUserMessage` first.
- The route-v2 draft path and the seed helper deliberately duplicate the
  decision-brief regex (session layer must not import the HTTP route);
  cross-referenced comments in both files; unify if a third consumer appears.
- `options.scenarioBrief` legacy fallback in turn-executor (~5137) is still
  marked "remove in Phase 2".
