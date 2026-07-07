# Lane 20 — goal-target receipt honesty (URGENT hotfix)

Date: 2026-07-07 · Branch: `claude-lane20/goal-receipt-honesty` · Base: `origin/staging` @ `7ae388b53` (includes lane 15 / PR #364)
Trigger: live false mutation claim on staging build `7ae388b` — "Success target … set … Rerun the simulation…" with zero threshold fields persisted. Structural-honesty P0.

---

## 1. Root-cause verdict

**None of the three briefed suspects.** The evidence (Render logs 13:48–13:51Z + staging Supabase, scenario `55df6984-7e5e-4207-a1d9-9ba14e6e7d2a`) pins a different mechanism:

1. **Wrong dispatch path (reachability).** The turn *"Set a success target of a 15% cost reduction on the goal Reduce Operating Costs"* (turn `fac8dc19…`, request `313e7b61`, committed 13:50:29.730Z) never reached `add_constraint`. Route-v2's edit-verb intercept dispatched it to the **V4 edit_graph pipeline**: the value-update gate's clause A requires a literal ` to ` (`set X to Y`), and the live phrasing uses **"of"**. Lane 15's goal-threshold join in `add-constraint.ts` is correct but was **unreachable for the live phrasing** — its green tests drove the handler directly (unit altitude), which is exactly how they missed this.
2. **Wrong fields written.** The edit LLM emitted ONE `update_node` op stamping `{value: 0.15, type: 'percentage_reduction', description: '15% reduction in operating costs'}` onto the goal node — none of which is the goal-threshold contract. The producer fanned the 3 keys into 3 referee envelopes: **2 rejected (`value`, `type` — not sanctioned roots) + 1 held (`description`)**, mode `shadow` = observe-only, never blocks. The permissive patch-applier `Object.assign`ed all three.
3. **Unguarded receipt.** The LLM-authored ack "Success target of 15% cost reduction set on the Reduce Operating Costs goal. Rerun the simulation to evaluate which options meet this threshold." shipped with no gate tying "success target set" claims to the registered contract. `formatGoalTargetSet` (suspect 3's named emitter) never ran — but the executor path had the same missing gate class.

**Correction to the briefed timing evidence:** the turn **did** commit a graph write. `scenarios.updated_at = 2026-07-07T13:50:29.730Z` **equals** turn `fac8dc19…`'s `created_at` exactly (same milliseconds); `v5.edit_graph.persist_merge_back (base=persisted)`, `v5.graph_cas.evaluated`, and `v5.model_versions.version_created` all fired on request `313e7b61`. The "updated_at predates the turn (~13:56Z)" reading was a wall-clock mis-estimate — the turn ran at 13:50, not 13:56 (build `7ae388b` deployed live 13:47:16Z, so the repro WAS on the new build). The substantive claim **stands and is worse than "nothing persisted"**: the write happened and *carried the wrong fields*, so the model silently accreted junk (`value: 0.15` on the goal node) under a false receipt.

## 2. Persisted-graph proof (staging Supabase, read 2026-07-07 ~14:00Z)

- Goal node `goal_cost_reduction` full key set after the turn: `{id, kind, type, label, value, provenance, description}` — `value: 0.15`, `type: "percentage_reduction"`, `description: "15% reduction in operating costs"` (the edit's non-contract stamp), **no** `goal_threshold_raw` / `_unit` / `_cap` / `goal_threshold` on ANY of the 13 nodes.
- `graph->goal_constraints` = `null` (edit_graph never writes it; `mergeAppliedGraphForPersistence` deliberately doesn't carry it — #265).
- Edit fact (`v5_handler_facts`, 13:50:29.730Z): `edit_kind: parameter_update`, `operations_count: 1`, `safe_summary: "Reduce Operating Costs: set to 0.15"`, `status: applied`, `graph_hash_before: 994d891ca39efecb → graph_hash_after: 171f984a4e29a80a`.
- Consequence: `has_goal_target` (derives EXCLUSIVELY from `goal_threshold_raw`/`_unit`) stayed false; the UI goal chip and PLoT's explicit-threshold path see nothing. The receipt's "rerun … evaluate which options meet this threshold" was unconditionally false.

## 3. The fix (both halves + chokepoint symmetry)

### Half A — reachability (`src/orchestrator/routing/value-update-gate.ts`, clause C)
`<verb> … success target` phrasings (verbs: set/update/increase/decrease/reduce/raise/lower/change/adjust/make; ≤4 tokens between verb and noun; preposition deliberately unconstrained — the of/to/at variance is what clause A missed) now suppress edit_graph and fall through to the TurnExecutor tool-use path, where the router tool-schema already teaches `add_constraint` for goal thresholds. `add_constraint` (lane 15) stamps the full contract quad + the `goal_constraints` entry in one validated write; STEP 7 persists it via `mergeMutatedGraphForPersistence → commitDirectAnswer`. **Pinned end-to-end at integration altitude** (real handler, real merge/commit seam, store fake capturing the persisted graph): the committed graph carries `goal_threshold_raw: 15`, `goal_threshold_unit: '%'`, `goal_threshold_cap: 100`, `goal_threshold: 0.15`, the `>=` constraint entry, with `goal_node_id`/`options[]` intact.

### Half B — receipt honesty guard (`src/orchestrator-v5/compose/goal-target-receipt-guard.ts`, wired at both commit chokepoints)
Invariant: **a success-target registration claim ships only when backed by a graph that registers the target** (goal-kind node with finite `goal_threshold_raw` — the exact `has_goal_target` marker). Backing authority: the graph committed THIS turn when one is written (stale persisted state cannot lend honesty to a failed write); the persisted graph only for non-mutating turns describing existing state.

- `edit-graph-dispatch.ts` (pre-`commitDirectAnswer`): kills the live leak class. Log event `v5.edit_graph.goal_target_receipt_swapped`.
- `turn-executor.ts` STEP 7 (post-merge `graphForCommit`, pre-`commitTurn`): closes the merge-stripped / handler-regressed class for `formatGoalTargetSet`. Log event `v5.turn_executor.goal_target_receipt_swapped`. Commit failure already withholds the receipt (STEP 7 catch → `STATE_COMMIT_FAILED`), so together: **the receipt ships only on a durable commit whose graph carries the threshold** — the briefed swap-gate requirement.
- Both swaps run BEFORE commit, so the stored `assistant_message` equals the honest wire copy.
- Claim detector is conservative (noun phrase "success target" + registration verb AFTER it in the same sentence; questions screened): offers/suggestions ("you could set a success target…") and honest state descriptions backed by the persisted graph are never swapped. Documented residual: verb-first perfective claims ("I've set a success target") belong to the generic `SUCCESS_CLAIM_PATTERNS` class, not this guard.

**Honest-fallback wording (provisional_doctrine_v0, swept vs forbidden-phrase + success-claim guards):**
> I couldn't register that success target, so the model still has no target for the analysis to score against. Tell me it again in one message, including the value and the goal it applies to — for example: "set a success target of 15%".

The embedded example phrasing intentionally matches clause C, so the retry routes to the sanctioned writer.

## 4. CLARIFY-RESUME residual — verified, and which fix was chosen

Verified live (same scenario): turn `94aba675` *"Set a success target of a 15% cost reduction"* → deterministic clarify *"Which one should I update: Reduce Operating Costs or Recurring Operating Cost Reduction?"* (edit-pipeline target resolution, `edit-graph.ts` `buildClarificationQuestion`); **`pending_actions = []` on every turn row** — no pending-clarify context exists for this flow, and the clarify chips (`Update <label>.`) drop the 15%. The resume *"The goal node: Reduce Operating Costs"* (turn `cbad5f48`) re-entered edit_graph fresh → honest no-op ("I couldn't see a concrete change…").

**Chosen fix: the "clarify asks the user to restate value+target in one message" option** (the brief's option 2), realised two ways, both landed in this lane:
1. Clause C now routes the ambiguous-goal phrasing itself away from the edit-pipeline clarify entirely — the Sonnet tool-use path resolves the (single) goal node or clarifies through the executor's pending-carrying machinery.
2. The honest fallback explicitly instructs a self-contained one-message restatement whose example phrasing round-trips through clause C.

NOT built (bigger seam, follow-up): pendings for the V4 edit-pipeline target-resolution clarify. That clarify still drops values for **non-goal-target** value edits that reach it.

## 5. Verification (fresh worktree `.worktrees/cee-lane20-goal-receipt-honesty`, base 7ae388b53; node_modules restored to tracked state before push)

| Gate | Result |
|---|---|
| RED first (commit `Lane 20 (RED)`) | gate 4×RED (incl. live verbatim phrasing) · dispatch live-replay swap RED · executor STEP 7 swap RED · real-handler persistence pin GREEN (proving the sanctioned path works when reached) |
| GREEN (commit `Lane 20 (GREEN)`) | all lane-20 suites 68/68 |
| Lane-15 suites (add-constraint join + graph-management + referee gate, 11 files) | 174/174 green |
| All `orchestrator-v5/handlers/__tests__` (27 files) | 301 green |
| All `orchestrator-v5/__tests__` (70 files) | 758 green |
| Required-gate subset (`vitest.required.config.ts` over handlers/compose/routing/executor/tools/graph-management) | 176 files / 2960 tests green |
| `tests/integration/orchestrator/route-v2-edit-graph.test.ts` | 58/58 green |
| `pnpm typecheck:src` (tsc -p tsconfig.build.json) | clean |
| eslint on all 8 touched files | clean (exit 0) |
| `scripts/check-forbidden-boundary-patterns.sh` | at baseline (0 / 95 / 17) |
| `scripts/ci/typecheck-ratchet.sh` | within baseline (one file newly clean) |
| Telemetry registry | no new `emit()` event names (guards use `log.warn` with structured `event:` payload keys, per the `persist_merge_back` precedent); no `it.skip` added |
| Stale `.js` shadow check | none |

Not run here: full `pnpm test:required` repo-wide (CI gate), live staging replay (needs deploy — suggested smoke below).

## 6. Residuals / follow-ups

1. **Staging smoke after deploy:** replay the live turn verbatim on a fresh scenario — expect route away from edit_graph, `add_constraint` receipt "Success target set: …", persisted `goal_threshold_raw/_unit/_cap/goal_threshold` + constraint entry, `has_goal_target: true`; then replay a "target"-without-"success" phrasing to size residual 2.
2. **Clause C requires the word "success".** "Set a target of 20%" (and the UI chip copy "Set a target to see your chances", if sent verbatim) does not match clause C; the "to"-form matches clause A, the "of"-form still reaches edit_graph — where the Half-B guard now prevents the false receipt (honest fallback teaches the clause-C phrasing). Widening to bare "target" risks sweeping factor-target phrasings; deliberate narrowness.
3. **Sonnet routing is probabilistic:** clause C guarantees the message reaches the tool-use path, not that add_constraint is proposed. Worst case is an honest clarify — never a false receipt (Half B holds at both chokepoints).
4. **Edit-pipeline target-resolution clarify still drops values** for non-goal-target edits (no pending context). Separate seam.
5. **Junk fields from the live turn remain on the staging goal node** (`value: 0.15`, `type`, `description` on `goal_cost_reduction`, scenario `55df6984…`) — harmless to readiness but orchestrator may want a data cleanup.
6. **Verb-first perfective goal-target claims** ("I've set a success target of 15%") are outside the narrow detector — generic `SUCCESS_CLAIM_PATTERNS` class.
