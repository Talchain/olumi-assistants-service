# Receipt-honesty cluster (F8/F9/F10 + N1) + 1.46 category-enum residual

Repo: `olumi-assistants-service`. Branch: `claude-cee/receipt-honesty`, worktree
`.worktrees/receipt-honesty` off `origin/staging` tip `bb8482843710181a5b5ac17636054345eee3f324`.
Source review: `acceptance-evidence/overnight-review/00-REVIEW.md` (F8 ~line 232,
F9 ~249, F10 ~270, N1 ~310) and `ROADMAP.md` row 1.46.

## Commits (RED-first, separate)

1. `db61a1c78` — FIX 1 (F8+F9) + FIX 2 (F10) + FIX 3 (N1).
2. `cd2869b8c` — correction: the first pass of the F9 fix skipped the
   entire mutation closure on a true no-op, which broke the pre-existing
   `d1-cross-handler.test.ts` invariant (every D1 handler, even on a
   no-op, returns a `mutated_graph` whose hash is unchanged — not an
   absent graph). Corrected to gate ONLY the node
   `goal_threshold_raw/_unit/_cap` stamp, leaving the (idempotent)
   `goal_constraints` row upsert unconditional. Caught by running the full
   `pnpm run test:required` gate, not just the new/targeted tests — logged
   here per the "verify readiness" doctrine.
3. `2cca33209` — FIX 4 (ROADMAP 1.46 residual, task_97fbcb00): constrain
   `edit_graph`'s node `category` to GraphV3's enum at the tool schema.

## FIX 1 — add-constraint channel-unification doctrine (F8+F9)

**ORCHESTRATOR-DEFAULT DOCTRINE — PENDING PAUL RATIFICATION.** Applied as
the most conservative, structurally-consistent reading of the review's
disposition text; flagging explicitly rather than silently treating it as
settled:

- Unchanged-value detection for a goal-target restatement now compares
  BOTH registration channels: the `goal_constraints` row (add_constraint's
  own canonical representation) AND the goal node's own
  `goal_threshold_raw`/`_unit` fields (the draft path's ONLY registration
  channel — `cee/factor-extraction/enricher.ts` never writes a
  `goal_constraints` row by design).
- `label` is excluded from the value-sameness predicate. A label-only
  change (value/unit identical, label differs) gets a distinct
  `formatConstraintLabelUpdated` receipt — never the fresh "Updated: …"
  value-change claim, never the total-noop claim either (the label DID
  change and is persisted).
- The node `goal_threshold_raw/_unit/_cap` stamp — the exact fields
  `computeAnalysisAffectingGraphHash` reads — is skipped whenever the
  value is unchanged, so a turn whose own receipt says "nothing changed"
  cannot move the analysis-affecting hash. The `goal_constraints` row
  upsert itself still runs unconditionally (idempotent on a real no-op),
  preserving the pre-existing D1 cross-handler contract that every
  handler returns a `mutated_graph` on every outcome.

**Open doctrine question for Paul:** should a same-value restatement
reaching the handler ONLY via the draft-registration channel (no
`goal_constraints` row yet) also *backfill* a canonical row on that turn?
The current fix does not manufacture one it wasn't already asked to write
(only the existing row-upsert-if-any runs); it purely stops the false
"fresh set" claim and the node hash movement. Backfilling is a separate,
deliberate decision this lane did not make unilaterally.

## FIX 2 — F10 (`formatGoalTargetNotSavedText`)

Branches on whether the pre-turn PERSISTED graph already registers a goal
target: names the SURVIVING target ("your previous target of X is still
registered…") instead of the previous unconditional "the model still has
no target" — false whenever a withheld write leaves an earlier target
intact (the append RPC skips the graph UPDATE on a null graph).

## FIX 3 — N1 (`formatGoalTargetUnchanged`)

Carries the ">=" operator qualifier ("at least 15%") to match its
set-pair `formatGoalTargetSet`, instead of the bare value ("already 15%")
which under-specified the registered `>=` contract.

## FIX 4 — 1.46 residual (task_97fbcb00)

`edit_graph`'s v2 structured-output schema encodes the node payload as an
opaque JSON-stringified `value` field — the grammar cannot constrain a
field inside that string, so the model could synthesise
`category:"strategic"` (or any string), which GraphV3's enum rejects,
failing the WHOLE edit with `SYNTHESIZED_GRAPH_INVALID`. Two-layer fix,
mirroring `src/cee/draft/anthropic-graph-schema.ts`'s load-bearing-enum
doctrine (kind/category/edge-type stay real schema enums even where other
subtrees are stringified):

1. **Constrained-at-source**: a small `category` enum field
   (`controllable|observable|external`) is declared directly on the
   operation item in `anthropic-edit-graph-schema.ts` — grammar-enforced,
   the model cannot emit an invalid value through this channel. It wins
   over anything embedded in the stringified `value` blob
   (`resolveNodeCategoryForOp` in `edit-graph.ts`).
2. **Coerced-with-disclosure**: for the residual case where the model
   still writes an out-of-enum category INSIDE the un-grammar-checked
   `value` string, it is dropped (a factor node without `category` is
   still valid GraphV3 — the field is optional), logged at WARN
   (`edit_graph.invalid_category_coerced`) so the drop is never silent.

**Grammar compile-size budget**: static budget test
(`tests/unit/anthropic-edit-graph-schema-grammar-budget.test.ts`) updated
and green — measured 995 bytes / 4 objects / 9 enum values against a
1600/6/12 budget, comfortably inside headroom.

**KNOWN GAP — live grammar-compile probe NOT run.**
`scripts/probe-grammar-compile-edit-graph.mjs` requires `ANTHROPIC_API_KEY`
(a real `messages.create` call), which was not available in this session.
The script's own doctrine: "verify live after any schema amendment, don't
trust the byte budget alone" — this has NOT been done. **Run
`ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/probe-grammar-compile-edit-graph.mjs`
before treating FIX 4 as fully verified**, even though the static budget
and all functional tests pass.

## Gates run (this worktree, `.worktrees/receipt-honesty`)

- `pnpm typecheck:src` — clean (`typecheck-src.txt`).
- `bash scripts/check-forbidden-boundary-patterns.sh` — all 3 ratchets ==
  baseline (`forbidden-boundary-patterns-ratchet.txt`).
- Targeted vitest (13 files, 79 tests, all new + all directly-touched
  pre-existing suites) — all green (`targeted-vitest-summary.txt`).
- Full `pnpm run test:required` — 19472 passed, 0 failed, 99 skipped (run
  after the F9 regression correction, catching the cross-handler-invariant
  break the targeted-only run would have missed).
- `bash scripts/validate-prepush.sh` (the authoritative push gate, all 16
  checks) — all OK (`validate-prepush.txt`).

## Not yet done (explicit)

- Live grammar-compile probe for FIX 4 (needs `ANTHROPIC_API_KEY`).
- Push to `origin/claude-cee/receipt-honesty`, PR open, CI required-check
  green, squash-merge, `ls-remote` tip confirmation, Render deploy-verify
  (healthz == tip + env quad intact) — all pending as of this evidence
  snapshot; see the session's final report for outcome.
