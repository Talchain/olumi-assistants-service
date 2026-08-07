# Lane 32 — GM intra-batch referee sequencing (ROADMAP 1.34)

Date: 2026-07-08 · Branch: `claude-lane32/gm-intrabatch-sequencing` · Base: `origin/staging` @ `20821685c`
Spec of record: `acceptance-evidence/gm-mm/02-intra-batch-entity-not-found-repro.md` (reproduced live 2026-07-07, scenario `2cd44277-3c53-4d15-8bb4-3f222eef96a1`, turn `106157e0`). THE last blocker before Paul's GM live-mode decision (lane15 follow-up 1; HANDOVER §0 NEXT-WAVE item 2).

## The defect

`refereeMutationBatch` (`src/orchestrator-v5/graph-management/referee.ts`) judged every envelope independently against the PRE-edit frame graph. Any batch that adds a node AND references it in the same batch — the commonest structural edit, "add a factor and wire it in" — had all referencing envelopes rejected `ENTITY_NOT_FOUND`, the governing verdict became `rejected` (precedence `rejected > stale > held > clarify`), and live mode would wholesale-block a batch CEE's own edit pipeline validates and applies fine (live capture: `outcome:"success", operations_count:6` alongside 5 shadow `ENTITY_NOT_FOUND` rejections; `base_hash_match:true` throughout — purely referential, not staleness).

## The fix (RED `abb742938` → GREEN `95b5e31b5`)

**Sequenced batch evaluation** — the spec's "cumulatively-applied candidate view". `refereeMutationBatch` now keeps a *working view* of the graph per batch; each envelope is judged against the view containing entities introduced by prior envelopes (`advanceBatchGraph`), mirroring the in-order apply the edit pipeline performs. The first envelope always sees the pristine frame graph, so **single-envelope batches are byte-identical to `refereeMutation`** (pinned by test).

Advance rules (TOTAL — any failure keeps the previous view, degrading to pre-fix judgment for later slots):

| Envelope outcome | Working-view effect |
|---|---|
| `rejected` / `stale` | never advances (the mutation would not land under any mode) |
| built candidate present (`rename_node`, `add_option`) | candidate adopted as the view (already a validated deep clone) |
| `add_node` / `add_edge` at `STRUCTURAL_APPLY_HELD` (passed R1–R4) | applied via the same `applyAndValidateMutation` seam the candidate builders use — new `buildAddNodeCandidate` / `buildAddEdgeCandidate` in `candidate-graph.ts`, so the view stays GraphV3-validated |
| `update_node_field` / `update_edge_field` | no entity change, no advance needed |
| `remove_node` / `remove_edge` | deliberately NOT subtracted (held-unconfirmed; later references keep the conservative pre-fix judgment) |

**What is NOT touched:** the frame (R2 keeps comparing every envelope's `base_graph_hash` against the pre-edit frame hash — anti-rederivation, `base_hash_match` semantics unchanged); the GM mode flag and every live-mode path; the gate call sites (`edit-graph-dispatch.ts:1838` verified at base — gate still runs only on `successfulAppliedMutation`); telemetry event names (frozen registry — existing `v5.candidate_mutation.*` enum members only).

### Deliberate semantic consequences (beyond the headline fix)

- A second `add_node` with the SAME intra-batch id now rejects `ENTITY_ID_COLLISION` (the sequenced view is authoritative; applying both would duplicate ids).
- Entities from a rejected envelope never materialise: an engine-claim `add_node` followed by its `add_edge` still rejects the edge `ENTITY_NOT_FOUND`.
- Order-faithful: an edge BEFORE the `add_node` that introduces its endpoint still rejects (matches pipeline apply order).
- `rename_node` of an intra-batch-added node resolves against the sequenced view (can be `would_apply`); SAFE because the defining `add_node` is always `held`/`rejected` in the same batch, so the batch can never govern `proceed` — live mode's all-would_apply auto-apply is unreachable for phantom renames. Pinned with reasoning in the test.
- An `add_node` whose payload the GraphV3 schema rejects (e.g. non-canonical id) simply does not advance the view — later references get the pre-fix `ENTITY_NOT_FOUND`, never a corrupted view (the edit pipeline validates ids upstream, so live batches carry canonical ids).

## Acceptance (per spec §"Expected shape of the fix")

| Check | Result |
|---|---|
| Live-repro 6-op batch (1 `add_node` + 5 `add_edge` referencing it) | `held STRUCTURAL_APPLY_HELD` on ALL 6, zero `ENTITY_NOT_FOUND`, `base_hash_match:true` throughout |
| Gate-level (producer→referee→governing, live-repro op shapes) | governing `held` (was `rejected`), `verdictCounts.held: 6`, `rejected: 0` |
| Negative control: genuinely absent node referenced | still `rejected ENTITY_NOT_FOUND` |
| Single-envelope batches | byte-identical to `refereeMutation` (deep-equal pins, held + rejected cases) |
| Batch totality/cap | unchanged (hostile slots classified; over-cap O(1) reject; throwing slot mid-batch does not break sequencing) |

Test file: `src/orchestrator-v5/graph-management/__tests__/referee-intra-batch-sequencing.test.ts` (13 tests; 7 RED on base at `abb742938`). The lane15 allowlist shadow-replay pin (`edit-gm-field-allowlist.test.ts`) that documented the gap as open is updated: add_edge now `held`, governing `held` — the lane15 evidence doc's verdict-table row "Add-factor-with-link batch → rejected ENTITY_NOT_FOUND" and its "honest bottom line" clause (b) are superseded by this lane (historical doc left as a record).

## Verification (fresh worktree `.worktrees/cee-lane32-gm-intrabatch`, base `20821685c`)

| Gate | Result |
|---|---|
| `pnpm typecheck:src` (tsc -p tsconfig.build.json --noEmit) | clean |
| `scripts/ci/typecheck-ratchet.sh` | within baseline (136 files / 462 errors vs baseline 137/462) |
| `npx eslint` on all 4 touched files | clean |
| GM + gate + dispatch-mode suites (13 files) | 196 tests green |
| `pnpm test:required` | see PR gates section (run in this worktree) |
| Telemetry registry | no new event names; no reserved-scenario touchpoints |

## Follow-ups (unchanged from lane15, minus item 1)

1. ~~Intra-batch referential sequencing~~ — **this lane.**
2. **Held-execute wiring** — a "yes" on a held pending still resumes into decline-with-clarify; live mode needs the reviewed-apply path. Now the sole named blocker class before the live-mode flip.
3. `kind` re-type doctrine (identity vs sanctioned tunable).
4. Staging smoke after deploy — replay the spec's recipe: expect 6× `held STRUCTURAL_APPLY_HELD`, zero `ENTITY_NOT_FOUND`, governing `held` in shadow telemetry.
