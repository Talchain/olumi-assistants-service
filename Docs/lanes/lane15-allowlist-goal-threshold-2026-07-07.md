# Lane CEE-W5 — referee field-allowlist tuning + conversational goal-threshold registration

Date: 2026-07-07 · Branch: `claude-lane15/allowlist-goal-threshold` · Base: `origin/staging` @ `678a236d9`
Missions: **A** — referee field-allowlist reconciliation (precondition for Paul's GM live-mode decision). **B** — goal-target dead-end join (Gate-item-8).

---

## Mission A — diagnosis

**Captured signal (live staging shadow):** 2× `v5.candidate_mutation.rejected`, kind `update_node_field`, blocker `FIELD_NOT_ALLOWED`, dispatch `edit_graph`, for *"Add a factor called Client Referral Rate with a positive link to \<outcome\>"* — an edit CEE's own `edit_graph` validation ACCEPTED and APPLIED.

**Mechanism (traced producer → referee):**

1. `handleEditGraph` canonicalises LLM paths via `normalisePath` (`src/orchestrator/tools/edit-graph.ts`): `/nodes/<id>/<field…>` puts everything after the node id into ONE field string — including **slash-keyed leaf paths** (`data/value`, `data/interventions/<fac_id>`). Scalar values are wrapped `{ [field]: value }`; whole-object updates keep their top-level key (`data`, `observed_state`, `prior`, `goal_threshold`, …). The applier (`patch-applier.ts`) `Object.assign`s **any** field except `id` (nodes) / `from`,`to` (edges); the PatchOperation Zod (`patch-validation.ts` `UpdateNodeValue`) is a permissive record.
2. The GM producer (`graph-management/adapters/edit-graph-producer.ts`) fans each top-level key of `update_node.value` verbatim into one `update_node_field` envelope (`update_edge` → `update_edge_field` analogously).
3. The R4 allowlist (`graph-management/field-safety.ts`, pre-fix) named exactly 7 node spellings — `label`, `description`, `category`, `display_value`, `observed_state.value`, `observed_state.baseline`, `observed_state.unit`. The three dotted `observed_state.*` entries are **producer-unreachable**: the edit wire canonical is `data` (see `normaliseEditOpsForPlot`: `observed_state → data` rename), and nested paths arrive **slash**-keyed, never dotted. `label` never arrives either (it maps to `rename_node`).

**Fields that tripped FIELD_NOT_ALLOWED:** deterministically, *every* field outside `{description, category, display_value}` — i.e. the entire value-edit class: `data`, `data/value`, `data/interventions/<fac_id>`, `observed_state` (whole object), `goal_threshold`/`_raw`/`_unit`/`_cap`, `prior`, `intercept`, `interventions`, `factor_type`, `encoding_map`, `is_baseline`, `uncertainty_drivers`, `goal_constraints`. For the captured add-factor flow the 2× signature matches the per-option intervention configuration ops the edit prompt teaches (`update_node` on each PRE-EXISTING option node with field `data/interventions/fac_client_referral_rate` — two options ⇒ two rejections; ops on the *new* node would instead reject `ENTITY_NOT_FOUND` at R3, which is not what telemetry showed). Scope note: the redacted §5 telemetry carries no field names, so the exact live field strings are reconstructed from the op vocabulary, not read from the event — the *mechanism* (any value-class field rejects) is proven by the RED fixture, which is the claim this lane stands on.

**Producer-mislabelling check (mission's preferred fix if applicable):** the producer does NOT mislabel. The captured ops genuinely are `update_node` operations (the edit prompt's taught pattern for option configuration and value edits — add-factor flows emit `add_node` + `add_edge` + `update_node` configuration ops, not `add_node` payload riders). The defect is allowlist-vocabulary mismatch, so the fix belongs in `field-safety.ts`.

## Mission A — reconciliation (commits `e0b1c3e7b` RED → `17f88b161` GREEN)

`field-safety.ts`:

- Allowlist evaluated on the field's **root segment** (`split(/[/.]/)`), so bare, slash-keyed, and dotted spellings resolve identically; a sanctioned root sanctions its sub-paths, subject to the pipeline-owned screen on the FULL path (`data/sensitivity_score` still rejects).
- **Node roots** = the sanctioned edit vocabulary (PatchOperation schema + applier + NodeV3 Zod surface) + the two wire-canonical spellings the pipeline produces that NodeV3 does not declare: `data`, `goal_constraints`. Full set: `label, description, category, display_value, observed_state, data, goal_threshold, goal_threshold_raw, goal_threshold_unit, goal_threshold_cap, goal_constraints, encoding_map, prior, factor_type, extractionType, uncertainty_drivers, intercept, interventions, is_baseline`.
- **Edge roots**: `strength, exists_probability, effect_direction, edge_type`.
- **Kept blocked → FIELD_NOT_ALLOWED:** node `id`/`kind` (identity class; the `kind` block is a deliberate judgement — a factor→goal re-type passes every Zod check while silently breaking structural invariants; pinned since Track 3 by `referee-core.test.ts`), edge `from`/`to`, unknown/invented fields.
- **Kept blocked → PIPELINE_OWNED_FIELD:** analysis-derived markers unchanged (substring: `sensitivity_score, elasticity, e_value, e-values, robustness, flip_threshold(s), confidence_tier, inference_warnings`) **plus** pipeline-recomputed stamps by exact root: `provenance, provenance_display, validation, defaulted, origin` (G10-adjacent; previously generic FIELD_NOT_ALLOWED, now the precise code).

**Known residual divergence (left in place, documented):** a `kind`-changing `update_node` that edit_graph applies would still be refereed `rejected`. Doctrine question for Paul: is node re-typing sanctioned vocabulary or identity? Current call: identity.

## Mission A — live-mode verdict expectation table (Paul's decision input)

Post-reconciliation, with `CEE_GRAPH_MANAGEMENT_MODE=live`, an edit_graph turn resolves by batch-governing precedence `rejected > stale > held > clarify`:

| Edit class (fresh frame, matching base hash) | Verdict | Blocker | Live-mode user outcome |
|---|---|---|---|
| Pure rename (`update_node` label only) | `would_apply` | — | **auto-applies** through the existing path (only auto-apply case) |
| Value edit on existing node (`data/value`, `data`, `observed_state`, `goal_threshold*`, `prior`, `intercept`, option `data/interventions/*`, …) | `held` | `TUNABLE_APPLY_HELD` | persist blocked; real pending confirm chip; "yes" resumes into decline-with-clarify (held-execute unwired) |
| Edge tunables (`strength`, `exists_probability`, `effect_direction`, `edge_type`) | `held` | `TUNABLE_APPLY_HELD` | same hold |
| `add_node` / `add_edge` (endpoints pre-existing) | `held` | `STRUCTURAL_APPLY_HELD` | hold |
| **Add-factor-with-link batch** (`add_edge`/updates referencing the node added in the SAME batch) | `rejected` | `ENTITY_NOT_FOUND` | **wholesale block** — the referee judges each envelope independently against the PRE-edit frame graph (intra-batch sequencing gap; edit path applies it fine). Governing verdict = rejected. |
| `remove_node` / `remove_edge` | `held` | `REMOVE_UNCONFIRMED` | hold |
| `add_option` | `held` | divergence / apply-unwired | hold |
| Identity (`id`, `kind`) / unknown fields | `rejected` | `FIELD_NOT_ALLOWED` | block (negative control, intended) |
| Pipeline-owned fields | `rejected` | `PIPELINE_OWNED_FIELD` | block (intended) |
| Stale base / non-fresh analysis | `stale` | `BASE_HASH_DIVERGED` / `ANALYSIS_NOT_FRESH` | rerun template |
| > 8 envelopes | `rejected` | `BATCH_CAP_EXCEEDED` | block |

**Honest bottom line for the live-mode decision:** this lane removes the FALSE `FIELD_NOT_ALLOWED` rejections (shadow telemetry is now trustworthy for field safety), but live mode would still (a) hold every non-rename edit behind a confirm whose "yes" cannot yet execute (held-execute is a named follow-up), and (b) wholesale-reject add-X-with-link batches via the intra-batch `ENTITY_NOT_FOUND` gap. Recommendation: keep GM in shadow until held-execute + intra-batch sequencing land; the allowlist precondition is now met.

## Mission B — goal-target dead-end (Gate-item-8), trace + join

**Trace of the live repro** (*"Set the success target to a 15% increase"* → 200, nothing lands):

- No `set_goal_target` handler exists in V5 (`tools/registry.ts` registers 7 handlers; the V4 deterministic `set-goal-target.ts` action is not on this path).
- The router tool-schema explicitly teaches `add_constraint` for goal thresholds ("quality must be at least 80%" …on a factor, outcome, **or goal**); `validation-registry.ts` accepts entity kind `'goal'` for it. The pre-route `deterministic-value-update.ts` finds no factor-label match for "success target" and falls through.
- `add_constraint` appends `{node_id: <goal>, operator: '>=', value, unit}` to `graph.goal_constraints` and commits — **the FACT channel**.
- `has_goal_target` (`build-turn-context.ts:388`) derives EXCLUSIVELY from `goal_translation.user_scale_target`, which `decision-context.ts` reads ONLY from the goal node's `goal_threshold_raw`/`goal_threshold_unit`. The UI goal chip and PLoT's explicit-threshold path read the same node fields. Nothing ever wrote them ⇒ dead-end: constraint fact present, `has_goal_target` false, chip stuck on "Set a target to see your chances".

**The join (commits `32c3a7df8` RED → `593c8f6d4` GREEN, `6a856e252` guard pin):** in `add-constraint.ts`, when the resolved target node is the **goal** and the operator is `>=`, the SAME `applyAndValidateMutation` write now also stamps the goal node: `goal_threshold_raw` (user units), `goal_threshold_unit`, `goal_threshold_cap`, `goal_threshold` (= raw/cap, model units). Single derivation from the same params; same sanctioned commit path (`mutated_graph` → `mergeMutatedGraphForPersistence` — threshold fields ride `nodes`, which that merge carries — → `commitDirectAnswer`); **no new writer**. The constraint entry still lands (both channels consistent, one derivation). Receipt (`formatGoalTargetSet`, provisional_doctrine_v0): *"Success target set: \<Goal\> at least 15%. The next analysis will score your options against this target."* — swept against `findSuccessClaimHit`/`findForbiddenPhraseHit` in the test.

- **Cap selection** (provisional_doctrine_v0, mirrors defaults-v19 draft doctrine): existing valid `goal_threshold_cap` (≥ raw) → `%` targets ≤100 normalise against 100 → else 25% headroom (`raw × 1.25`; never cap = target). Non-positive targets stamp raw/unit only (`has_goal_target` still registers).
- **No PLoT auto_goal_threshold fork:** the user threshold now travels explicitly on the goal node inside `plotPayload.graph` (run-analysis snapshot), which is precisely the UI's canonical `parameters.goal_threshold` semantics — no second derivation, no synthesis trigger.
- **Not stamped (honesty controls):** `at_most` goal constraints (ISL computes P(samples ≥ threshold); encoding a keep-below bound as a ≥-threshold would invert the claim — MINIMISATION doctrine; the constraint fact still lands, threshold untouched) and non-goal targets (byte-identical behaviour, pinned). **Ambiguous target expressions** (no resolvable number/entity) never reach the handler — the router/validator clarify path is untouched.
- **Freshness:** `goal_threshold`/`_raw`/`_cap` are analysis-affecting hash fields (`context/graph-hash.ts`), so the write correctly marks the prior analysis stale and the rerun picks the target up.
- **Doctrine question left open (flagged, not decided here):** whether an `at_least` GOAL constraint should ALSO remain in `goal_constraints` once the threshold is first-class, or collapse into the threshold alone. Kept both (consistent, single derivation) per mission instruction.

## Verification (all in fresh worktree `.worktrees/cee-lane15-allowlist-goal-threshold`, base 678a236d9, node_modules restored to tracked state first)

| Gate | Result |
|---|---|
| `pnpm typecheck:src` (tsc -p tsconfig.build.json --noEmit) | clean |
| `npx eslint` on all 5 touched files | clean (exit 0) |
| New fixtures: `edit-gm-field-allowlist.test.ts` (10), `add-constraint-goal-target-join.test.ts` (6) | green; RED variants verified passing against pristine base first (commits e0b1c3e7b, 32c3a7df8) |
| Focused suites: all `graph-management/__tests__` + `edit-graph-referee-gate` (178 tests, 11 files) | green |
| Focused suites: all add-constraint + d1-cross-handler (23 tests, 5 files) | green |
| Required-gate subset (`vitest.required.config.ts` over `orchestrator-v5/{handlers,graph-management,tools,coaching}`) | 102 files / 1877 tests green |
| `scripts/check-forbidden-boundary-patterns.sh` | at baseline (warnOnInvalid 0 / as-unknown-as 95 / science-fallback 17; new test files are out of ratchet scope by design) |
| `scripts/ci/typecheck-ratchet.sh` | within baseline (462 errors == baseline; one file newly clean) |
| Telemetry registry | no new event names (gate re-uses registered `v5.candidate_mutation.*` enum members); no `it.skip` added; no `src/schemas` or `orchestrator-v5/compose` schema surface touched (HOOK-5 untriggered — `forbidden-user-facing-phrases` is imported read-only by a test) |

Not run here: full `pnpm test:required` across the repo, integration/live suites, and a live staging replay of the two captured flows (needs a deploy; suggested smoke below).

## Follow-ups (not in this lane)

1. **Intra-batch referential sequencing** — referee add-X-with-link batches against a cumulatively-applied candidate view (or split batches), else live mode wholesale-rejects the commonest structural edit. Blocking for live-mode GO beyond renames.
2. **Held-execute wiring** — a "yes" on a held pending currently resumes into decline-with-clarify by design; live mode needs the reviewed-apply path.
3. **`kind` re-type doctrine** — decide identity vs sanctioned tunable (currently identity/blocked).
4. **Goal-constraint vs threshold doctrine** — keep both records or collapse (kept both, single derivation).
5. **Staging smoke after deploy** — replay both captured flows: expect zero `FIELD_NOT_ALLOWED` for the add-factor edit (shadow), and threshold + `has_goal_target:true` + receipt for the target-set turn.
