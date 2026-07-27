/**
 * Compose a successful OlumiResponse for A2 turn classes.
 *
 * Per Pre-impl A and Paul's constraint 6: OlumiResponse is strictly the 6
 * schema-required fields — no `updated_session_state`, no extra keys. The
 * schema requires arrays so we emit [] for `blocks`, `suggested_actions`,
 * `insights`.
 *
 * A2 adds `composeClarifyResponse`. Its output is structurally identical to
 * `composeDirectAnswerResponse` (text-only). A2 emits no chips, no blocks —
 * widening to chips lands in E2.
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { selectRunAnalysisFact, type FreshnessDerivation } from './context/freshness.js';
import { TelemetryEvents, emit } from '../utils/telemetry.js';
import type { SuggestedAction } from './compose/types.js';
import {
  buildCoachingBlocks,
  buildEvidenceBlocks,
  buildFactorConfidenceLookup,
  buildGraphNodeLookup,
  buildGraphNodeLookupFromGraph,
  buildLensSuggestionCoachingBlock,
  buildReviewCardBlocks,
  buildStaleRerunCoachingBlock,
  type BlockBuildCtx,
  type GraphNodeLookup,
} from './compose/phase3-blocks.js';
// T1 claim safety — the SINGLE owner of "may a leading option be named" is
// `deriveConstraintVerdict`, called ONCE in the run_analysis handler and
// persisted on the fact there. This funnel READS that verdict; it does not
// re-derive (CLAUDE.md trap #12). `mayNameLeadingOptionForFact` is the one
// per-fact accessor, so the block funnel and the transport projection cannot
// read it two different ways.
import { buildFocusInspectorDirective } from './compose/ui-directive.js';
import {
  mayNameLeadingOptionForFact,
  projectAnalysisSummaryForWithheldClaim,
  projectTransportEnrichmentForWithheldClaim,
  // E2 — imported so the clone-skip is DERIVED from the projection's own frozen
  // drop-set rather than from a second hand-listed copy of it (trap #12). If
  // the projection learns to drop another blob whole, the skip follows for
  // free; a local literal here would silently keep cloning it.
  WITHHELD_DROPPED_ENRICHMENT_BLOBS,
} from './compose/withheld-claim-projection.js';
import { textAssertsLeadingOption } from './compose/leading-option-egress-guard.js';
import { collectInterventionControlledFactorIds } from './context/intervention-controlled-drivers.js';

/**
 * ROADMAP 1.132 (F1) — the SUBSTANTIVE-vs-FUNCTIONAL answer discriminator.
 *
 * Every composed OlumiResponse is one of two kinds:
 *   - `'substantive'` — a real ANSWER to the user (coach / converse / text_only
 *     model prose, OR a deterministic post-analysis explanation composed from
 *     the analysis projection: the advice gate, run-comparison, and the
 *     chip-click explain/flip answers). These get progressive disclosure — the
 *     `_answer_shape` wire sidecar (headline + <=3 bullets + detail behind
 *     disclosure), synthesised at the route egress (`synthesiseAnswerShapeFromText`)
 *     when the model did not already supply one.
 *   - `'functional'` — terse operational copy: clarify questions, add-option /
 *     edit / set-value receipts, declines / refusals, deterministic recovery /
 *     guard copy, "run analysis first" nudges, and the structured dispatch
 *     families. These stay PLAIN — reshaping a functional message would push its
 *     second sentence (often the question or call-to-action) behind disclosure.
 *
 * This is DECLARED at each compose site, not inferred: the previous scoping keyed
 * on "was the text LLM-authored" (`answerProse`), which misclassified the
 * DETERMINISTIC post-analysis advice-gate answers as functional and shipped them
 * un-shaped on the live wire (3x). There is no downstream wire field, turn_class,
 * or composer identity that separates the two kinds — `composeDirectAnswerResponse`
 * serves both, and `composeToolCallResponse` composes both a chip-click explanation
 * (substantive) and an execute receipt (functional) — so the distinction MUST be
 * stated by the author at the compose site.
 *
 * Making this a REQUIRED field is the derive-not-mirror enumerator: the compiler
 * lists every compose site (a new callsite cannot build without declaring a kind),
 * so the classification can never silently drift out of a hand-maintained list.
 * The `answer-kind-compose-classification.drift.test.ts` source-enumeration guard
 * additionally pins the SET of `'substantive'` declarations so ADDING one (which
 * also needs egress wiring) fails loud rather than shipping silently un-shaped.
 */
export type AnswerKind = 'substantive' | 'functional';

export interface ComposeInput {
  assistant_text: string;
  stage: StageType;
  /**
   * ROADMAP 1.132 (F1) — REQUIRED substantive/functional classification of the
   * answer this compose produces. See `AnswerKind`. Consumed downstream (the
   * turn-executor finalise seam / chip-click dispatch surface it, and the route
   * egress synthesises `_answer_shape` only for `'substantive'`); it does NOT
   * change the composed OlumiResponse bytes.
   */
  answerKind: AnswerKind;
  /**
   * V5 Task 2.1: optional deterministic chip set. Pre-generated by the
   * chip-generator helper with stage + handler-facts + analysis context.
   * Undefined / empty keeps the pre-Task-2.1 behaviour of emitting `[]`.
   * Every chip must already conform to the boundary `ActionSchema`.
   */
  suggested_actions?: readonly SuggestedAction[];
}

// V5 finaliser contract: no composer in this file may set `analysis_ready`.
// The response-finaliser stamps it from the dispatch path's pre-computed
// payload after composition, before egress validation. See
// src/orchestrator-v5/response-finaliser.ts and the grep gate in
// scripts/check-no-direct-analysis-ready.sh.

export function composeDirectAnswerResponse(input: ComposeInput): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: input.assistant_text,
    blocks: [],
    suggested_actions: [...(input.suggested_actions ?? [])],
    insights: [],
    stage_indicator: input.stage,
  };
}

export function composeClarifyResponse(input: ComposeInput): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: input.assistant_text,
    blocks: [],
    suggested_actions: [...(input.suggested_actions ?? [])],
    insights: [],
    stage_indicator: input.stage,
  };
}

/**
 * V5 Phase 1 — composeToolCallResponse.
 *
 * Assembles the final OlumiResponse from three deterministic inputs on an
 * execute turn (spec §4.1 step 6):
 *
 *  - orientation: pre-action text from Sonnet (context, not outcomes)
 *  - confirmation: deterministic "what happened" text rendered from the
 *                  handler outcome via the handler's registered
 *                  confirmationTemplate (brief correction 5)
 *  - coaching: null stub for Phase 1a (spec step 5 is a no-op in this brief)
 *
 * Output shape is identical to composeDirectAnswerResponse — only the
 * assistant_text composition differs. Text fragments are joined with a
 * single blank line when both orientation and confirmation are non-empty;
 * otherwise the non-empty one stands alone.
 */
export interface ComposeToolCallInput {
  readonly orientation: string;
  readonly confirmation: string;
  readonly coaching: string | null;
  readonly stage: StageType;
  /**
   * ROADMAP 1.132 (F1) — REQUIRED substantive/functional classification (see
   * `AnswerKind`). `composeToolCallResponse` serves BOTH kinds: an execute
   * receipt (add-option / set-value confirmation → `'functional'`) AND the
   * chip-click explain/flip explanation composed from the analysis projection
   * (→ `'substantive'`). The kind is stated by the author here; it does not
   * change the composed OlumiResponse bytes.
   */
  readonly answerKind: AnswerKind;
  /**
   * V5 Group 1 Task B: when the turn's handler facts include a run_analysis
   * fact, compose emits an `analysis_result` block carrying the minimal
   * result fields plus the opaque enrichment (which may carry
   * `decision_review` under enrichment when the auto-fire completed).
   * Undefined for handler turns that do not produce this fact shape.
   */
  readonly handlerFacts?: readonly HandlerFact[];
  /**
   * V5 Task 2.1: pre-generated deterministic chips. See `ComposeInput`.
   */
  readonly suggested_actions?: readonly SuggestedAction[];
  /**
   * V5 Phase 3A PR 3 — block lifecycle context. When supplied AND the
   * current turn's `handlerFacts` carries NO `run_analysis` fact, the
   * composer walks `priorFacts` for the canonical prior fact (selected
   * by the freshness derivation upstream) and emits Phase 3 blocks
   * tagged by the freshness verdict:
   *   - 'fresh' → rebuild ReviewCard / Coaching / Evidence blocks from
   *               the prior fact (graph hash matches current → safe to
   *               present as live insights).
   *   - 'stale' → emit ONLY the stale-safe rerun CoachingBlock; suppress
   *               every other Phase 3 block (graph diverged → original
   *               insights are no longer trustworthy).
   *   - 'unknown' / 'none' → suppress emission entirely.
   *
   * Required context fields:
   *   - `priorFacts`: typically `EnrichedTurnContext.prior_facts`.
   *   - `freshness`: the `FreshnessDerivation` already computed by the
   *                  dispatcher's pre-handler step.
   *   - `requestId` + `scenarioId`: telemetry-only identifiers for
   *                                 `v5.phase3.block_lifecycle`.
   *
   * Omitting `lifecycle` preserves PR #178/180 behaviour: Phase 3
   * blocks emit ONLY when the current turn's `handlerFacts` contains a
   * run_analysis fact.
   */
  readonly lifecycle?: {
    readonly priorFacts: readonly HandlerFact[];
    readonly freshness: FreshnessDerivation;
    readonly requestId: string;
    readonly scenarioId: string;
  };
  /**
   * R4 lookup fix — the persisted scenario graph for this turn
   * (`EnrichedTurnContext.persistedGraph` on the routed path,
   * `RunAnalysisScenarioSnapshot.rawPersistedGraph` on the chip-click
   * run_analysis path). Fallback source for graph-node ID→{label,kind}
   * resolution: the PLoT /v2/run envelope stored as
   * `fact.result.enrichment` carries NO top-level `graph` key, so
   * without this fallback every Phase 3 block ships `target_refs: []`
   * and the flag-gated ui_directive emitter can never resolve its
   * option target (verified live at deployed build 441dc0d). Consulted
   * ONLY when the enrichment graph yields zero lookup entries — a
   * present, non-empty enrichment graph stays authoritative. Omitting
   * it preserves the pre-fix fail-closed behaviour exactly. Never
   * re-fetched here: callers pass the graph they already hold for the
   * turn.
   */
  readonly persistedGraph?: unknown;
  /**
   * Review F1 — hash gate for the CURRENT-TURN fallback. On the routed
   * path the run_analysis handler performs its own persisted-graph read
   * at execution time, while `persistedGraph` above was loaded at turn
   * start — a concurrent writer in that window can rename/remove nodes
   * between the two reads, making the fallback resolve stale labels or
   * fail closed on in-window additions. Callers pass the canonical
   * analysis-affecting hash of `persistedGraph` that they ALREADY hold
   * (turn-executor: `currentAnalysisGraphHashForTurn`; chip-click
   * run_analysis: the fact's own `graph_hash_at_run`, equal by
   * construction because the snapshot is the exact object the handler
   * hashed). The current-turn branch consults the fallback ONLY when
   * this equals the fact's `graph_hash_at_run`; on mismatch or when
   * absent it fails closed to the pre-fix behaviour. The prior-fact
   * lifecycle branch ignores this field — its FRESH verdict is already
   * derived against the same persisted graph. No hashing happens here.
   */
  readonly persistedGraphHash?: string | null;
}

export function composeToolCallResponse(input: ComposeToolCallInput): OlumiResponse {
  const pieces: string[] = [];
  const trimmedOrientation = input.orientation.trim();
  const trimmedConfirmation = input.confirmation.trim();
  if (trimmedOrientation) pieces.push(trimmedOrientation);
  if (trimmedConfirmation) pieces.push(trimmedConfirmation);
  if (input.coaching) pieces.push(input.coaching.trim());

  const blocks = buildBlocksFromFacts(
    input.handlerFacts ?? [],
    input.lifecycle,
    input.persistedGraph,
    input.persistedGraphHash,
  );

  return {
    response_version: 2,
    assistant_text: pieces.join('\n\n'),
    blocks,
    suggested_actions: [...(input.suggested_actions ?? [])],
    insights: [],
    stage_indicator: input.stage,
  };
}

/**
 * Map recognised handler facts to OlumiResponse blocks. Emitted shapes:
 *  - run_analysis fact → `analysis_result` block + Phase 3 lifecycle blocks
 *    (fresh review_card / coaching / evidence — see lifecycle decision tree
 *    below).
 *  - set_factor_value / add_constraint / adjust_edge_strength facts →
 *    `graph_patch` block (status, operation, target_id, before, after).
 *    The boundary GraphPatchBlock operation enum mirrors these three D1
 *    fact_types one-for-one so the mapping is direct.
 *
 * Phase 3 lifecycle decision tree (PR 3 — 2026-05-17):
 *
 *   1. Current turn contains a run_analysis fact with `graph_hash_at_run`:
 *      → emit `analysis_result` (existing) AND fresh Phase 3 blocks rebuilt
 *        from the current-turn fact's `enrichment.decision_review`.
 *        Lifecycle telemetry: `emitted_fresh`, reason='current_turn_fact'.
 *
 *   2. No current-turn run_analysis fact, but lifecycle context supplied
 *      AND prior_facts contains the selected run_analysis fact at
 *      `freshness.selected_fact_index`:
 *      a. freshness.freshness === 'fresh' → rebuild Phase 3 blocks fresh
 *         from the prior fact (graph hash matches current → safe).
 *         Lifecycle: `emitted_fresh`, reason='prior_fact_fresh'.
 *      b. freshness.freshness === 'stale' → emit ONLY the stale-safe
 *         rerun CoachingBlock; suppress every other Phase 3 block.
 *         Lifecycle: `emitted_stale`, stale_coaching_emitted=true.
 *      c. freshness.freshness === 'unknown' → suppress Phase 3 entirely
 *         (per spec: 'pending' implies in-flight generation, which is
 *         not the case here).
 *         Lifecycle: `skipped_unknown`.
 *      d. freshness.freshness === 'none' → no prior fact to derive from;
 *         skip Phase 3.
 *         Lifecycle: `skipped_none`.
 *
 *   3. No current-turn run_analysis fact AND no lifecycle context →
 *      preserve PR #178/180 behaviour: no Phase 3 emission, no telemetry.
 */
/** Shared empty freshBlocks arg for the mutation / flip directive branches — the
 *  row-2 lens-survival gate only applies to run_analysis; these fact classes have
 *  no lens block to consult. */
const EMPTY_FRESH_BLOCKS: OlumiResponse['blocks'] = [];

function buildBlocksFromFacts(
  facts: readonly HandlerFact[],
  lifecycle?: ComposeToolCallInput['lifecycle'],
  persistedGraph?: unknown,
  persistedGraphHash?: string | null,
): OlumiResponse['blocks'] {
  const blocks: OlumiResponse['blocks'] = [];
  let currentTurnRunAnalysisHandled = false;
  let uiDirectiveEmitted = false;

  // At most ONE ui_directive per turn (N=1 latch). Owns the latch + push + set so
  // the emit protocol lives in one place (simplification F4, 2026-07-24) rather
  // than three copy-pasted blocks. `buildFocusInspectorDirective` dispatches on
  // fact.fact_type internally.
  const tryEmitUiDirective = (
    fact: HandlerFact,
    lookup: GraphNodeLookup,
    fresh: OlumiResponse['blocks'],
  ): void => {
    if (uiDirectiveEmitted) return;
    const directive = buildFocusInspectorDirective(fact, lookup, fresh);
    if (directive !== null) {
      blocks.push(directive);
      uiDirectiveEmitted = true;
    }
  };

  for (const fact of facts) {
    if (fact.fact_type === 'run_analysis') {
      currentTurnRunAnalysisHandled = true;
      blocks.push(buildAnalysisResultBlock(fact));

      // PR 3 lifecycle branch 1 — fresh blocks from current-turn fact.
      const graphHash = fact.result.graph_hash_at_run;
      if (typeof graphHash === 'string' && graphHash.length > 0) {
        // Review F1 — hash-gate the current-turn fallback: consult the
        // persisted snapshot ONLY when the caller-supplied canonical hash
        // of that snapshot equals the hash the handler computed from its
        // own execution-time read. A concurrent writer between the two
        // reads makes the hashes diverge → fail closed to the pre-fix
        // behaviour (identity over availability). Absent hash (undefined
        // or null) never equals a non-empty graphHash, so unthreaded
        // callers stay on pre-fix behaviour too.
        const fallbackForFact =
          persistedGraphHash === graphHash ? persistedGraph : undefined;
        // Review F2 — build the lookup ONCE per fact and share it between
        // the Phase 3 rebuild and the ui_directive builder.
        const lookup = buildGraphNodeLookup(fact, fallbackForFact);
        // D-U F2: reuse the SAME hash-gated raw-snapshot the lookup trusts as
        // the lever-union authority — when the snapshot hash diverges from the
        // fact's, we fail closed (undefined ⇒ empty set ⇒ no suppression),
        // mirroring the lookup's identity-over-availability stance.
        const freshBlocks = rebuildPhase3BlocksFresh(
          fact,
          graphHash,
          lookup,
          'fresh',
          fallbackForFact,
        );
        blocks.push(...freshBlocks);

        // Wave-4 δ2 (ROADMAP 1.202) — the deterministic ui_directive ladder
        // (UNCONDITIONAL — NO-DARK-LAUNCH; CEE_UI_DIRECTIVE_EMIT deleted 19 Jul).
        // CURRENT-TURN fact with a verified graph_hash_at_run ONLY. For a
        // run_analysis fact the ladder is: a SURVIVING lens block + a resolvable
        // subject → `focus` (supersedes, D-53-1); else the v1 recommended-option
        // `highlight` (regression-proof floor). `freshBlocks` is passed so the
        // row-2 σ gate reads the lens block's survival at the same chokepoint
        // wave-3 wired. The shared `lookup` carries the hash-gated persisted
        // snapshot fallback — in production the only source that resolves labels.
        // At most ONE directive per turn (`uiDirectiveEmitted` latch, N=1).
        tryEmitUiDirective(fact, lookup, freshBlocks);
        if (lifecycle !== undefined) {
          emitLifecycle(lifecycle, {
            lifecycle_state: 'emitted_fresh',
            selected_fact_index: -1,  // -1 sentinel = current-turn fact
            graph_hash_at_run: graphHash,
            current_graph_hash: graphHash,
            reason: 'current_turn_fact',
            block_count: freshBlocks.length,
            stale_coaching_emitted: false,
          });
        }
      }
    } else if (
      fact.fact_type === 'set_factor_value' ||
      fact.fact_type === 'add_constraint' ||
      fact.fact_type === 'adjust_edge_strength'
    ) {
      // V5 product-state continuity (foamy-bee tranche) — DEFERRED
      // CONTRACT GAP: the wire `graph_patch` block emits raw `before`
      // and `after` records that carry structural identifiers
      // (`constraint_id`, `node_id`, edge IDs, `provenance`,
      // `operator` characters). The Phase 0 finding called for a
      // clean human-readable display field (`display` / `summary` /
      // `applied_summary`) so the UI doesn't have to render raw
      // structural fields by default.
      //
      // The fix requires widening the boundary `GraphPatchBlockSchema`
      // (currently `.strict()` and rejecting unknown fields) — a
      // coordinated change to the vendored schemas package, out of
      // scope for this tranche. The UI handoff brief
      // [Docs/v5/foamy-bee-ui-handoff.md] documents the deferral and
      // the renderer-side workaround (use `assistant_text` as the
      // primary display source). The deferred contract is pinned as
      // `it.todo` in
      // `compose/__tests__/graph-patch-clean-payload.test.ts`; flip
      // those to real assertions when the schemas package change
      // lands.
      const { target_id, status, before, after } = fact.result;
      blocks.push({
        type: 'graph_patch',
        status,
        operation: fact.fact_type,
        target_id,
        before,
        after,
      });

      // Wave-4 δ2 (ROADMAP 1.202) row 1 — point the UI at the node the user just
      // changed: an APPLIED set_factor_value / adjust_edge_strength emits
      // `open_inspector` on the mutated node/edge. The mutation fact's `after`
      // snapshot carries no label, so resolve it from the turn-start persisted
      // graph (labels are stable across these edits). `add_constraint` is
      // EXCLUDED inside the builder (UI drops those patches — fail-open avoided).
      // N=1 latch; lookup built lazily only when no directive has fired yet.
      if (!uiDirectiveEmitted) {
        tryEmitUiDirective(fact, buildGraphNodeLookupFromGraph(persistedGraph), EMPTY_FRESH_BLOCKS);
      }
    } else if (fact.fact_type === 'what_would_flip') {
      // Wave-4 δ2 (ROADMAP 1.202) row 4 — a what_would_flip turn (precondition
      // met) points the UI at the first flip factor with `focus`. Resolved from
      // the turn-start persisted graph; fail-closed on unmet precondition / no
      // flip factor / unresolved id. N=1 latch.
      if (!uiDirectiveEmitted) {
        tryEmitUiDirective(fact, buildGraphNodeLookupFromGraph(persistedGraph), EMPTY_FRESH_BLOCKS);
      }
    }
  }

  // PR 3 lifecycle branch 2 — no current-turn run_analysis fact AND
  // lifecycle context supplied. Walk prior_facts using the freshness
  // verdict to select the canonical source fact and decide emission.
  if (!currentTurnRunAnalysisHandled && lifecycle !== undefined) {
    blocks.push(...buildLifecycleBlocksFromPrior(lifecycle, persistedGraph));
  }

  return blocks;
}

/**
 * P0-B **temporary safe-transport** enrichment keep-list for the
 * `analysis_result` block.
 *
 * THIS IS NOT THE COACHING CONTRACT. It is a regression-safe transport shape
 * scoped to P0-B: this PR changes the `analysis_result.enrichment` payload, so
 * the keep-list's only jobs are (1) don't break/degrade today's Results panel
 * and (2) stop the raw-enrichment leak. Olumi's coaching contract is
 * value-led — the science/analysis layer defines the valuable coaching
 * signals, and the frontend decides how to present them; current DGAI field
 * usage is a REGRESSION GATE here, not the source of truth.
 *
 * Why these five are safe to keep: verified against the live staging debug
 * bundle (build cef69b0). The current Results panel hydrates from
 * `results.report.option_probabilities` only (option win-probabilities); factor
 * influence/sensitivity render as `unmatched` (not yet consumed). Keeping
 * `results` + `option_comparison` preserves every currently-rendered field;
 * `factor_sensitivity` + `robustness` + `decision_review` are clean,
 * strategically-valuable science fields preserved so we transport them rather
 * than drop them.
 *
 * Dropped fields that look strategically valuable but are NOT currently
 * rendered are recorded as a POST-P0 coaching-contract workstream (see the
 * block comment below) — NOT silently deleted from the future product model.
 *
 * Exported for the contract-test drift bolt ONLY
 * (tests/contract/cee-to-ui.contract.test.ts): @talchain/schemas ≥ 0.14.0
 * publishes `CEE_UI_ENRICHMENT_KEEP_LIST` as the cross-repo source of truth
 * for this list, and the bolt asserts the two stay element-for-element
 * identical. Change this list ONLY in lock-step with the schemas package
 * (see olumi-schemas docs/enrichment-v1/ROLLOUT.md — envelope evolution
 * rules).
 */
export const P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP = [
  'option_comparison',
  'factor_sensitivity',
  'results',
  'robustness',
  'decision_review',
  // DGAI read-side givens with NO fallback (Codex closure review — the
  // frontend regression gate this backend repo cannot run itself). Both reach
  // enrichment via PLoT's `.passthrough()` schema + CEE's byte-for-byte store
  // (run-analysis.ts), so dropping them would regress the Results panel:
  //   - `option_comparison_status` — fixture-proven top-level (value 'computed').
  //   - `conditional_probabilities` — emitted by PLoT for constraint-bearing
  //     analyses (V5 forwards goal_constraints); read with no fallback.
  // (`conditional_winners` stays a follow-up: valuable but not currently read.)
  'option_comparison_status',
  'conditional_probabilities',
  // Top-level PLoT V2 science fields, confirmed present at this seam against a
  // real staging-captured run_analysis payload
  // (tests/fixtures/cross-service/v5-turn.run-analysis.staging.json) and
  // leak-free at the top level. Faithful pass-through ONLY: the existing
  // `undefined`-guard omits them when absent, `[]`/`null` source values are
  // preserved verbatim (no coercion, no fabricated defaults), and
  // `stripInternalKeysDeep` still removes any nested internal carrier.
  //   - `confidence_tier` — top-level scalar (e.g. 'needs_work').
  //   - `flip_thresholds` — top-level array (distinct from the per-factor
  //     `results[].factor_sensitivity[].flip_threshold`); entries may carry an
  //     honest `flip_value: null`, which is preserved as-is.
  //   - `edge_e_values` / `inference_warnings` — top-level science arrays. NOTE:
  //     in the captured payload these are EMPTY at the top level; their populated
  //     copies exist only inside stripped internal carriers (`_meta`,
  //     `downstream_calls`) and are deliberately NOT rehydrated here. Recovering
  //     the top-level keys makes transport ready; surfacing populated content is
  //     an upstream PLoT/Track-S emission follow-up, not a CEE seam change.
  'edge_e_values',
  'inference_warnings',
  'confidence_tier',
  'flip_thresholds',
  // Wave-2 ask 3 (@talchain/schemas 0.19.0, UI-verified 19 Jul): the PLoT
  // #200 leader band. The UI consumer (DGAI #291/#292) shipped
  // contract-pinned and has been dark ever since because this one key was
  // stripped. The lineage-leak reason for the original omission is already
  // handled structurally: the persisted brief's `seed` / `graph_hash` /
  // `lineage` are all in INTERNAL_ENRICHMENT_KEYS, so
  // `stripInternalKeysDeep` removes them from the kept copy at any depth
  // (pinned by the cee-to-ui contract test with the persisted staging
  // capture as its own positive control).
  'decision_brief',
] as const;

// POST-P0 COACHING-CONTRACT FOLLOW-UP (do not silently drop from the product
// model): the keep-list above is transport-only. These dropped enrichment
// fields carry potentially-valuable coaching signals the frontend does not
// render today; the value-led coaching contract should decide which to surface
// (cleaned) rather than this transport shape deciding by omission:
//   decision_quality, improvement_guidance, review_cards,
//   insights, decision_brief, conditional_winners, identifiability,
//   robustness_synthesis, m1_review, m1_coaching, factor_stability,
//   edge_sensitivity.
// Tracked as a separate coaching-contract workstream item.
// NOTE: `confidence_tier` and `flip_thresholds` were previously listed here but
// are now transported via the keep-list above — proven top-level + leak-free
// against the real captured payload. `m1_coaching` stays deferred because it
// carries the internal `isl_engine` provenance token (its cleaned form already
// ships via `decision_review`).

/**
 * VERDICT-CLASS TRANSPORT DEBT — THE REGISTERED REASONS TABLE.
 *
 * ⚠ THE DEFECT THIS EXISTS FOR. The keep-list above, and the fixed field set
 * `buildAnalysisResultBlock` destructures out of `fact.result`, have NO notion
 * of a verdict CLASS. A `*_verdict` field can be persisted server-side and
 * silently never reach the wire — and has been, twice, in two independent
 * families: `constraint_verdict` (persisted on `RunAnalysisResultSchema` since
 * @talchain/schemas 0.25.0; the adoption manifest states it "never reaches the
 * wire either way") and `goal_verdict` (ROADMAP 1.298 P0-1 — "the persisted
 * `goal_verdict` NEVER REACHES THE UI"). Neither family had to remember the
 * other; each independently forgot. That is CLAUDE.md trap 12 at the service
 * boundary: a hand-listed allowlist a human must remember to extend, whose
 * drift always reads as green.
 *
 * The UI consequence is not "a missing field": with no verdict on the wire the
 * UI re-derives from a null sentinel and cannot distinguish WITHHELD from
 * NO-ANALYSIS-EXISTS from DROPPED-BY-PIN-SKEW.
 *
 * WHAT THIS TABLE IS. Not a mirror of the verdict fields — the gate DERIVES
 * those from the persisted fact schemas at runtime
 * (`__tests__/verdict-class-transport-gate.test.ts`). This is the exemption
 * register: a derived verdict-class field must be either TRANSPORTED or carry
 * an entry HERE naming the rowed work that closes it. A third verdict family
 * added with neither REDs that gate with a paste-ready message.
 *
 * RULES THE GATE ENFORCES (so this list cannot rot the way the keep-list did):
 *   - SHRINK-ONLY in effect: an entry whose field IS transported REDs — when
 *     the wire work lands, the entry must be DELETED, not left behind.
 *   - Every entry carries a `rowed` reference (`ROADMAP <major>.<minor>`); an
 *     entry cannot be added as a bare "known issue".
 *   - Fields, unique and alphabetically sorted, for reviewable diffs.
 *
 * DO NOT use this table to make a new omission cheap. The correct close for
 * both entries below is the 0.28 contract train (ROADMAP 1.306), which carries
 * the UI-first ordering the wire change requires: the strict
 * `AnalysisResultBlockSchema` hard-fails on an unknown nested field, so
 * emitting before the UI re-vendors is an OUTAGE, not a no-op.
 */
export const UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS = [
  {
    field: 'constraint_verdict',
    rowed: 'ROADMAP 1.306',
    reason:
      'Persisted on RunAnalysisResultSchema (@talchain/schemas 0.25.0) and read ' +
      'server-side by the claim-safety derivation, but buildAnalysisResultBlock ' +
      'destructures a fixed field set that omits it, so the UI re-derives the ' +
      'withheld state from a null leading_option_id. Covers its LEGACY CARRIER ' +
      'too — the interim `enrichment.__cee_claim_safety` stamp holds the same ' +
      'two members and is likewise absent from the keep-list; exactly one of the ' +
      'two is ever present on a fact, so they are one debt, not two. Closes on ' +
      'the 0.28 train: declare it on the strict analysis_result block, re-vendor ' +
      'the UI FIRST, then project it here.',
  },
  {
    field: 'goal_verdict',
    rowed: 'ROADMAP 1.306',
    reason:
      'Family-2 goal attainment. Designed to be persisted, never projected ' +
      '(ROADMAP 1.298 P0-1). Not yet declared at this schemas pin, so the gate ' +
      'reports it PENDING rather than active — the entry is forward-declared so ' +
      'the field cannot land dark. Closes on the same 0.28 train, on the amended ' +
      'discriminated shape (measure_scope x constraint_origin x sampling_basis).',
  },
] as const;

/**
 * Internal/debug carrier KEYS that must never ship inside a kept field, at any
 * depth (Codex review — the keep-list was a shallow top-level pick, so a leak
 * carrier nested inside a kept field would survive the copy). These are
 * clearly-internal keys (never DGAI-correlation data), so a recursive removal
 * is safe and makes the transport shape robust against nested carriers — even
 * in debug-on mode, where the response-finaliser's prose scrub is bypassed.
 * NOTE: legitimate science metadata keys like `confidence_provenance` /
 * `confidence_source` are NOT in this set — they are kept structural fields.
 * `isl_response` (raw ISL HTTP response payload) and `isl_engine` (internal
 * engine identifier) are forward-guard carrier KEYS (review follow-up): today
 * they appear only under already-denylisted carriers (`_meta.payloads`) or as a
 * value, but denylisting them makes the recovered science fields robust if a
 * future upstream shape nests either carrier directly inside a kept field.
 * (The `isl_engine` *value* form — `source_service: 'isl_engine'` — is handled
 * by deferring its only known carrier `m1_coaching`, NOT by broad value-scrub,
 * which would corrupt legit science labels.)
 */
const INTERNAL_ENRICHMENT_KEYS: ReadonlySet<string> = new Set([
  '_meta', 'meta', '_diagnostics', 'ceeTrace', 'cee_trace', 'debug',
  'payloads', 'downstream_calls', 'graph', 'graph_hash', 'graph_hash_at_run',
  'feature_flags', 'feature_flags_snapshot', 'lineage', 'seed',
  'isl_response', 'isl_engine',
]);

/**
 * Deep-clone a value while removing every {@link INTERNAL_ENRICHMENT_KEYS} key
 * at any depth, AND dropping any leaf whose string value carries the redaction
 * marker `[REDACTED]` under a non-denylisted key (Codex review #2 — the strip
 * was key-only, so a `[REDACTED]` value hiding under a harmless key would
 * survive). `[REDACTED]` is never legitimate user-facing data, so this has no
 * false positives. We deliberately do NOT value-scrub broader tokens such as
 * "engine" / "provenance": they appear in legitimate science data
 * ("Engineering Capacity", `confidence_provenance`), so a broad scrub would
 * corrupt kept fields — that residual is covered by the value-level regression
 * test instead. Cloning (not sharing the source reference) keeps the persisted
 * fact unmutated.
 */
function stripInternalKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInternalKeysDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (INTERNAL_ENRICHMENT_KEYS.has(k)) continue;
      if (typeof v === 'string' && v.includes('[REDACTED]')) continue;
      out[k] = stripInternalKeysDeep(v);
    }
    return out;
  }
  return value;
}

/**
 * Reduce a run_analysis fact's opaque enrichment to the P0-B safe-transport
 * keep-list. Applied to BOTH the current-turn run_analysis block and the
 * reused follow-up block so they emit an IDENTICAL block for a given analysis
 * (consistent DGAI content-hash dedupe + panel hydration). Rationale:
 *   - The full raw enrichment LEAKS: the prose-only `sanitiseEnrichment` never
 *     strips structural fields and is bypassed entirely when
 *     CEE_TURN_DEBUG_ENABLED is on. The live bundle carried `[REDACTED]` (in
 *     `_meta`/`meta`), `isl_engine` (in `m1_coaching`) and `seed` lineage (in
 *     `decision_brief`/`fact_objects`). The keep-list drops those carriers at
 *     the block-build site (debug-independent), and `stripInternalKeysDeep`
 *     removes any that nest inside a kept field — so `_meta`, payloads, graph,
 *     graph hashes and raw debug fields never ship.
 *   - `decision_review` is kept present-only; its nested prose is still
 *     scrubbed by the response-finaliser in normal (debug-off) mode.
 *
 * Returns `undefined` when no kept field is present so the block omits the
 * `enrichment` key (the typical chip-click, autofire-off shape).
 *
 * Exported for the CEE→UI wire-shape contract test ONLY
 * (tests/contract/cee-to-ui.contract.test.ts), so the test exercises the
 * REAL projection rather than a mirror of it.
 */
export function toSafeTransportEnrichment(
  enrichment: unknown,
  /**
   * Will this block be handed to `projectTransportEnrichmentForWithheldClaim`?
   * If so, the blobs that projection drops WHOLE are never cloned (ROADMAP
   * 1.272 E2) — building a 9,581 B / 86-node subtree and discarding it one line
   * later is free work on every withheld analysis turn.
   *
   * ⚠ A BOOLEAN, NOT A KEY SET, AND THAT IS THE WHOLE SAFETY ARGUMENT. The
   * first cut of this took `droppedWholeByCaller?: readonly string[]` with a
   * docstring saying it "must only ever be passed blobs the projection drops
   * unconditionally and whole". A mutation proved that docstring was the only
   * thing enforcing it: widening the caller's array to include `robustness` — a
   * blob the projection TRANSFORMS rather than drops, so skipping it silently
   * deletes the tie facts a withheld turn is supposed to keep — passed every
   * test. A contract a caller can violate is a contract nothing enforces
   * (CLAUDE.md trap #12).
   *
   * With a boolean the set is DERIVED here from the projection's own frozen
   * constant, so the wrong-set failure mode is not expressible. If the
   * projection learns to drop another blob whole, this follows for free.
   *
   * `false` (the default) ⇒ clone everything, i.e. the pre-E2 behaviour exactly.
   */
  willProjectForWithheldClaim = false,
): Record<string, unknown> | undefined {
  if (enrichment === null || enrichment === undefined || typeof enrichment !== 'object') {
    return undefined;
  }
  const src = enrichment as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP) {
    // E2 — the drop-set is known BEFORE the clone, so the clone is free work.
    // `decision_review` measured 9,581 B / 86 nodes and is dropped whole on
    // every withheld analysis turn; it was deep-cloned first every time.
    //
    // Byte-neutral including at the empty boundary, and that is not luck worth
    // relying on silently: both this function and
    // `projectTransportEnrichmentForWithheldClaim` end with the SAME
    // "nothing survived ⇒ undefined" rule, so an enrichment whose only
    // keep-list member is a dropped blob yielded `undefined` before (build it,
    // then drop it, then collapse) and yields `undefined` now (never build it).
    if (willProjectForWithheldClaim && WITHHELD_DROPPED_ENRICHMENT_BLOBS.includes(key)) continue;
    // Shallow keep-list at the top level PLUS a deep strip of internal/debug
    // carriers inside each kept field, so the keep-list is not merely shallow.
    if (src[key] !== undefined) out[key] = stripInternalKeysDeep(src[key]);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build the `analysis_result` block from a run_analysis fact. Used by BOTH the
 * current-turn run_analysis block (branch-1) and the REUSED prior-fact FRESH
 * lifecycle branch (V5 P0-B), so both turns emit an IDENTICAL block for a given
 * analysis — keeping DGAI's content-hash dedupe and Results-panel hydration
 * consistent across the run_analysis turn and any follow-up explain /
 * what_would_flip turn.
 *
 *   - `win_probabilities` preserved VERBATIM, keyed by option id (DGAI
 *     correlates by option id).
 *   - enrichment reduced to the P0-B safe-transport keep-list (see
 *     toSafeTransportEnrichment) — transport-only, NOT the coaching contract.
 */
function buildAnalysisResultBlock(
  fact: RunAnalysisHandlerFact,
): OlumiResponse['blocks'][number] {
  const { leading_option_id, summary, win_probabilities, enrichment, graph_hash_at_run } =
    fact.result;
  // T1 CLAIM SAFETY — THE STRUCTURED HALF (ROADMAP 1.218).
  //
  // Layer 2 already drops the leader-presuming BLOCKS on a withheld turn
  // (`rebuildPhase3BlocksFresh`). This block is the other thing every withheld
  // turn ships, and the POST-#710 live walk measured it leaking on 5/5 withheld
  // bodies: `leading_option_id` verbatim, plus the leader claim inside the
  // enrichment blobs. Same verdict, same persisted stamp, same fail-closed
  // read — see compose/withheld-claim-projection.ts for what is dropped, why
  // `decision_review` goes whole while `decision_brief` does not, and why the
  // honest variant is ABSENCE rather than synthesised copy.
  const mayNameLeadingOption = mayNameLeadingOptionForFact(fact);
  // E2 (ROADMAP 1.272) — the permission is read BEFORE the clone and the
  // drop-set is a frozen module constant, so on a withheld turn the blobs that
  // `projectTransportEnrichmentForWithheldClaim` discards whole are never
  // cloned in the first place. Pure work-avoidance: the projection below still
  // runs and still owns the policy, and it would drop these keys anyway.
  const safeTransport = toSafeTransportEnrichment(enrichment, !mayNameLeadingOption);
  const transportEnrichment = mayNameLeadingOption
    ? safeTransport
    : projectTransportEnrichmentForWithheldClaim(safeTransport);
  return {
    type: 'analysis_result',
    // F1 — THE THIRD THING EVERY WITHHELD TURN SHIPS, AND THE ONE NO
    // INSTRUMENT WAS POINTED AT.
    //
    // This field used to be emitted VERBATIM on both branches. On a fact this
    // codebase writes today that is harmless — a withheld turn's summary comes
    // from the gated headline builder. The failing input is a PRE-#708 fact:
    // no `constraint_verdict`, no `__cee_claim_safety`, so the reader above
    // fails CLOSED, and the persisted summary is pre-gate copy naming the
    // leader. No migration exists, so the fail-closed default MANUFACTURED the
    // G-CEE-1 contradiction on exactly the scenarios it was protecting — and
    // `summary` was outside `BLOCK_PROSE_FIELDS` and outside `scanKey`'s key
    // vocabulary, so the residue meter reported zero hits on the class.
    //
    // Conditional, never blanket: a leader-free summary ships byte-identical on
    // a withheld turn. See `projectAnalysisSummaryForWithheldClaim`.
    summary: mayNameLeadingOption ? summary : projectAnalysisSummaryForWithheldClaim(summary),
    // `null` is the schema's own honest value here (`leading_option_id:
    // z.string().nullable()`, boundary/blocks.ts — the key is REQUIRED, so
    // `null` is the strongest available "no leader is being put forward";
    // omitting it would fail egress validation). It is also exactly what
    // ui-directive.ts's fail-closed ladder already reads as "no
    // recommendation". The FACT keeps the id — freshness, decision-record
    // capture and the Phase-3 rebuild all read it from there — so this changes
    // what the USER is told, not what CEE knows.
    //
    // LIVE HARM IT REMOVES, per the orchestrator's render probe at UI
    // `6d3f4611` / CEE `227e0aa`: this field drives the **"Leading option"
    // canvas badge**, which rendered on a withheld turn directly alongside the
    // withheld disclosure.
    //
    // ⚠ AND ONE HARM IT DOES NOT REMOVE — recorded because an earlier revision
    // of this comment claimed it and was WRONG. `V5AnalysisResultBlock.tsx`'s
    // `data-leader="true"` win-probability pill is DEAD CODE at the deployed
    // tip: its comparison is option LABEL against option ID, so it can never be
    // equal, and the probe measured ZERO fires across every run in both verdict
    // classes. Citing it here would have been the most rhetorically useful
    // sentence in the argument and the one nobody would have checked
    // (CLAUDE.md trap 14's corollary).
    leading_option_id: mayNameLeadingOption ? leading_option_id : null,
    ...(win_probabilities !== undefined ? { win_probabilities } : {}),
    ...(transportEnrichment !== undefined
      ? { enrichment: transportEnrichment as typeof enrichment }
      : {}),
    // ROADMAP 1.192 leg κ — identity handshake. Map the fact's
    // `graph_hash_at_run` (computed at run-analysis.ts:462 over the canonical
    // CANONICAL_GRAPH_HASH_KEEP_LIST, already stored on the fact) onto the
    // 0.22-shipped `computed_against_hash` wire field — the graph identity this
    // analysis result was computed against. A client compares it against the
    // turn's top-level `graph_hash` (canvas identity) to decide freshness; a
    // mismatch is a GRAPH_DIVERGED divergence, never a silent stale render.
    // Fail-closed: a legacy fact (pre-0.10.0) with no `graph_hash_at_run` OMITS
    // the field (never fabricated) — an honest "identity unknown", which the UI
    // must treat as un-verifiable, not fresh.
    ...(graph_hash_at_run !== undefined
      ? { computed_against_hash: graph_hash_at_run }
      : {}),
  };
}

/**
 * PR 3 — pure helper: rebuild the three Phase 3 builder outputs from a
 * single run_analysis fact at a known graph hash. Used by both the
 * current-turn fresh path and the prior-fact fresh path so they share
 * deterministic block construction. `lookup` is built by the caller
 * (review F2: once per fact, shared with the ui_directive builder) and
 * carries the persisted-snapshot fallback where the caller's gate allows
 * it — without that fallback every production block resolves
 * `target_refs: []` because the PLoT envelope carries no `graph` key.
 */
function rebuildPhase3BlocksFresh(
  fact: RunAnalysisHandlerFact,
  graphHash: string,
  lookup: GraphNodeLookup,
  freshness: 'fresh' | 'stale' = 'fresh',
  rawPersistedGraphForLevers?: unknown,
): OlumiResponse['blocks'] {
  const ctx: BlockBuildCtx = {
    created_at: new Date().toISOString(),
    graph_hash_at_generation: graphHash,
    freshness,
  };
  const confidenceLookup = buildFactorConfidenceLookup(fact);
  // Doctrine D-U F2: the option-set LEVER union (structural factor_ids an
  // option intervenes on) is read from the raw (un-projected) SAVED model — the
  // persisted graph the pipeline already holds, threaded by both callers as the
  // hash-gated persisted snapshot (current-turn branch) or the FRESH-verdict
  // persisted graph (prior-fact branch); the enrichment / ContextPack
  // projection strips intervention bundles, so the projected form must NOT be
  // the authority. Persisted-first per the controlled-factor-authority guard —
  // the compose.ts allowlist entry documents this provenance. Absent /
  // unthreaded graph ⇒ empty set ⇒ no suppression (byte-identical). Threaded
  // into the evidence "investigate this" surfaces AND the free-text assumption
  // "confirm this" surfaces (review-card + coaching) so a lever is never NAMED
  // as a gap to gather evidence about or an assumption to confirm.
  const interventionControlledFactorIds =
    collectInterventionControlledFactorIds(rawPersistedGraphForLevers);
  // Capability layer P0 (ROADMAP 1.183): the deterministic lens suggestion. Read
  // from the SAME fact enrichment, threaded here so BOTH the current-turn fresh
  // path and the prior-fact fresh path emit an identical block for a given
  // analysis (only ever fires on a fresh verdict — the stale branch returns
  // before reaching this helper, so a lens is never suggested off stale signals).
  // `selectLens` returns at most one, and null when nothing is justified.
  const lensSuggestion = buildLensSuggestionCoachingBlock(fact, ctx);
  const built = [
    ...buildReviewCardBlocks(fact, lookup, ctx, interventionControlledFactorIds),
    ...buildCoachingBlocks(fact, lookup, ctx, interventionControlledFactorIds),
    ...buildEvidenceBlocks(fact, lookup, confidenceLookup, ctx, interventionControlledFactorIds),
    ...(lensSuggestion !== null ? [lensSuggestion] : []),
  ];

  // T1 CLAIM SAFETY — THE SINGLE FUNNEL.
  //
  // Every Phase-3 block reaches the wire through this one function, on BOTH the
  // current-turn branch (:354) and the prior-fact lifecycle branch (:926).
  //
  // The permission is READ FROM THE FACT, never re-derived here. The verdict is
  // a FACT ABOUT THE ANALYSIS, computed exactly once — at the single
  // `deriveConstraintVerdict` call in the run_analysis handler — and stamped
  // onto the fact's enrichment there. Both branches above read the same
  // persisted bytes, so they cannot disagree.
  //
  // WHY NOT RE-DERIVE HERE (this function's previous shape, and the reason it
  // was reworked): `deriveConstraintVerdict` needs the RATIFIED constraint set,
  // and the handler and this funnel do not read it from the same place. The
  // handler reads `snapshot.goal_constraints` — the exact array it forwarded to
  // PLoT. This funnel would have to read `rawPersistedGraphForLevers`, which is
  // `undefined` whenever the current-turn branch's hash gate fails
  // (`fallbackForFact`, :341) — and an empty ratified set collapses the verdict
  // to `not_applicable`, i.e. it FAILS OPEN and silently re-permits the claim.
  // Two derivations over different inputs are how one HTTP response ends up
  // contradicting itself (CLAUDE.md trap #12).
  //
  // WHY NOT A THREADED BOOLEAN: the prior-fact branch runs no handler, so it has
  // no `HandlerOutcome` and no `__leading_option_claim_withheld` to thread — a
  // flag would have left half the paths ungated.
  //
  // FAILS CLOSED. An unstamped fact (every fact written before this change) is
  // treated as WITHHELD — see `readMayNameLeadingOptionFromResult` for why "unknown" must
  // not read as "verified".
  //
  // Live-proven harm (G-CEE-1 walk, staging 1c078f0): the confirmation said
  // "no option can be put forward yet" while `blocks[1].body` said "The MacBook
  // Pro leads by a margin of about 52 percentage points". Both on one screen.
  //
  // The narrative / robustness / scenario_context / pre_mortem / flip_threshold
  // card bodies are LLM-AUTHORED (verbatim `enrichment.decision_review`), and
  // the served prompt explicitly instructs the model to name the winner and
  // state the margin. There is no template to gate and no substitution that can
  // make that prose honest, so the block is dropped whole.
  //
  // Unknown/new block kinds are deliberately KEPT here: over-suppression would
  // silently strip useful content, and the egress guard is the layer that
  // catches an unrecognised producer LOUDLY. Layer 2 suppresses what we know is
  // unsafe; Layer 3 alarms on what we do not.
  if (mayNameLeadingOptionForFact(fact)) {
    return built;
  }
  return built.filter(
    (block) => !presumesLeadingOption(block) && !evidenceGapPresumesLeadingOption(block),
  );
}

/**
 * Does this `evidence` block's LLM-authored gap statement presuppose a leader?
 *
 * WHY `evidence` NEEDS A CONTENT TEST AT ALL. The kind list above deliberately
 * keeps every `evidence` block ("they carry no comparative claim, and dropping
 * them would cost the user real content on exactly the turn they most need
 * it"). The POST-#711/#712 live walk found that kind-level assumption is not
 * universally true — `caseINF.run`, `blocks[7].evidence_gap`:
 *
 *   "Shifts in hardware pricing and availability could alter the total cost
 *    calculation and potentially change **the leading option**."
 *
 * on an `evaluated_infeasible` (withheld) turn. A genuine presupposition that a
 * leading option exists — NOT the POST-710 §7.1 false positive, which was the
 * ordinary noun "team leads". 1 occurrence across 11 withheld bodies: a
 * low-rate producer, not a systematic one, so the block kind stays KEPT by
 * default and only an offending instance is dropped.
 *
 * WHY THE WHOLE BLOCK AND NOT JUST THE FIELD — derived from the contract, not
 * chosen. The first version of this gate dropped `evidence_gap` alone, on the
 * egress guard's "per-field, not whole-response" reasoning. That is WRONG here:
 * `@talchain/schemas` declares `evidence_gap: z.string().min(1)` on the
 * evidence block (`dist/boundary/blocks.js`) — REQUIRED, not optional. A block
 * missing it fails `OlumiResponseSchema` at egress, which would have degraded
 * the entire response on exactly the withheld turns this gate exists to
 * protect: a claim-safety fix that causes an egress failure is strictly worse
 * than the prose it suppresses.
 *
 * So the block goes whole, which is also what compose already does with the
 * leader-presuming CARDS, and for the identical stated reason: the text is
 * LLM-authored (`source_handler: 'decision_review_enricher'`, verbatim from
 * `decision_review.evidence_enhancements`) so "there is no template to gate and
 * no substitution that can make that prose honest". The block's
 * `suggested_technique` and `impact_if_gathered` are ABOUT the dropped gap
 * statement, so they do not stand meaningfully without it either.
 *
 * Scanned with the SHARED vocabulary (`textNamesLeadingOption`), so this gate
 * and the alarm that measures the residue cannot drift apart.
 */
function evidenceGapPresumesLeadingOption(block: OlumiResponse['blocks'][number]): boolean {
  const candidate = block as { type?: unknown; evidence_gap?: unknown };
  return (
    candidate.type === 'evidence' &&
    typeof candidate.evidence_gap === 'string' &&
    textAssertsLeadingOption(candidate.evidence_gap)
  );
}

/**
 * Block kinds whose prose names, ranks, or quantifies a leading option.
 *
 * Split by provenance, because the two halves are unfixable in different ways:
 *   LLM-authored (`enrichment.decision_review`) — narrative, robustness,
 *     scenario_context, pre_mortem, flip_threshold. The model is told to name
 *     the winner and give the margin, so the copy cannot be constrained here.
 *   Deterministic — the `strengthen` lens block, whose copy bank has five of
 *     eight bodies asserting a leader (lens-selector.ts BODY_BY_RATIONALE).
 *
 * Kinds deliberately ABSENT (they carry no comparative claim, and dropping them
 * would cost the user real content on exactly the turn they most need it):
 * `assumption`, `bias`, `evidence_priority`, `assumption_check`,
 * `calibration_prompt`, `orientation`, and every `evidence` block.
 */
const LEADER_PRESUMING_CARD_KINDS: ReadonlySet<string> = new Set([
  'narrative',
  'robustness',
  'scenario_context',
  'pre_mortem',
  'flip_threshold',
]);
const LEADER_PRESUMING_COACHING_KINDS: ReadonlySet<string> = new Set(['strengthen']);

function presumesLeadingOption(block: OlumiResponse['blocks'][number]): boolean {
  const b = block as { card_kind?: unknown; coaching_kind?: unknown };
  return (
    (typeof b.card_kind === 'string' && LEADER_PRESUMING_CARD_KINDS.has(b.card_kind)) ||
    (typeof b.coaching_kind === 'string' &&
      LEADER_PRESUMING_COACHING_KINDS.has(b.coaching_kind))
  );
}

/**
 * PR 3 — branch 2 of the lifecycle decision tree. Fires only when the
 * current turn produced no run_analysis fact. Uses the
 * `FreshnessDerivation` already computed upstream to choose the
 * canonical prior fact and tag the emission.
 *
 * Freshness verdict → emission:
 *   fresh   → rebuild Phase 3 blocks fresh from the prior fact.
 *   stale   → emit ONLY the stale-safe rerun CoachingBlock, suppress
 *             everything else (per spec: stale graph means cached
 *             insights are no longer trustworthy).
 *   unknown → suppress; emit `skipped_unknown` telemetry.
 *   none    → suppress; emit `skipped_none` telemetry.
 */
function buildLifecycleBlocksFromPrior(
  lifecycle: NonNullable<ComposeToolCallInput['lifecycle']>,
  persistedGraph?: unknown,
): OlumiResponse['blocks'] {
  const { freshness, priorFacts } = lifecycle;
  const verdict = freshness.freshness;

  if (verdict === 'unknown') {
    emitLifecycle(lifecycle, {
      lifecycle_state: 'skipped_unknown',
      selected_fact_index: freshness.selected_fact_index,
      graph_hash_at_run: freshness.graph_hash_at_run,
      current_graph_hash: freshness.current_graph_hash,
      reason: freshness.reason,
      block_count: 0,
      stale_coaching_emitted: false,
    });
    return [];
  }
  if (verdict === 'none') {
    emitLifecycle(lifecycle, {
      lifecycle_state: 'skipped_none',
      selected_fact_index: freshness.selected_fact_index,
      graph_hash_at_run: freshness.graph_hash_at_run,
      current_graph_hash: freshness.current_graph_hash,
      reason: freshness.reason,
      block_count: 0,
      stale_coaching_emitted: false,
    });
    return [];
  }

  const priorFact = selectPriorRunAnalysisFact(priorFacts, freshness.selected_fact_index, {
    requestId: lifecycle.requestId,
    scenarioId: lifecycle.scenarioId,
  });
  if (priorFact === null) {
    emitLifecycle(lifecycle, {
      lifecycle_state: 'rebuild_failed',
      selected_fact_index: freshness.selected_fact_index,
      graph_hash_at_run: freshness.graph_hash_at_run,
      current_graph_hash: freshness.current_graph_hash,
      reason: 'selected_fact_unavailable',
      block_count: 0,
      stale_coaching_emitted: false,
    });
    return [];
  }

  const sourceGraphHash = priorFact.result.graph_hash_at_run;
  if (typeof sourceGraphHash !== 'string' || sourceGraphHash.length === 0) {
    // Defensive: freshness derivation should have rejected this fact
    // as 'unknown' or 'none' upstream. If it slipped through, do not
    // emit blocks without a verifiable graph hash.
    emitLifecycle(lifecycle, {
      lifecycle_state: 'rebuild_failed',
      selected_fact_index: freshness.selected_fact_index,
      graph_hash_at_run: freshness.graph_hash_at_run,
      current_graph_hash: freshness.current_graph_hash,
      reason: 'source_graph_hash_missing',
      block_count: 0,
      stale_coaching_emitted: false,
    });
    return [];
  }

  if (verdict === 'stale') {
    const staleBlock = buildStaleRerunCoachingBlock({
      created_at: new Date().toISOString(),
      graph_hash_at_generation: sourceGraphHash,
    });
    const blocks: OlumiResponse['blocks'] = staleBlock ? [staleBlock] : [];
    emitLifecycle(lifecycle, {
      lifecycle_state: 'emitted_stale',
      selected_fact_index: freshness.selected_fact_index,
      graph_hash_at_run: freshness.graph_hash_at_run,
      current_graph_hash: freshness.current_graph_hash,
      reason: freshness.reason,
      block_count: blocks.length,
      stale_coaching_emitted: staleBlock !== null,
    });
    return blocks;
  }

  // verdict === 'fresh' — emit the result summary block PLUS rebuilt Phase 3
  // blocks from the prior fact.
  //
  // V5 P0-B: the `analysis_result` block (result summary / win probabilities /
  // enrichment) gives the UI a non-empty, structured answer on a
  // what_would_flip / explain chip-click even when `decision_review` is absent
  // (autofire off) and the Phase 3 cards come back empty. This is emitted on
  // the FRESH verdict ONLY — the graph hash still matches the source fact, so
  // it is safe to present as live. The 'stale' branch above returns before
  // reaching here, so a diverged graph never surfaces a result block (only the
  // stale-safe rerun coaching block). Enrichment is sanitised by the
  // response-finaliser before egress.
  const analysisResultBlock = buildAnalysisResultBlock(priorFact);
  // FRESH verdict ⇒ the freshness derivation already proved the current
  // persisted graph's canonical hash equals the source fact's
  // `graph_hash_at_run`, so the persisted graph is an identity-consistent
  // lookup fallback for the rebuilt blocks (same node ids/labels the
  // analysis ran against). No additional hash gate needed on this branch
  // (review F1 applies to the current-turn branch only, where the handler
  // performs its own execution-time read).
  const lookup = buildGraphNodeLookup(priorFact, persistedGraph);
  // D-U F2: FRESH verdict already proved the persisted graph is identity-
  // consistent with the source fact, so it is a safe lever-union authority.
  const phase3Blocks = rebuildPhase3BlocksFresh(
    priorFact,
    sourceGraphHash,
    lookup,
    'fresh',
    persistedGraph,
  );
  const freshBlocks: OlumiResponse['blocks'] = [analysisResultBlock, ...phase3Blocks];
  emitLifecycle(lifecycle, {
    lifecycle_state: 'emitted_fresh',
    selected_fact_index: freshness.selected_fact_index,
    graph_hash_at_run: freshness.graph_hash_at_run,
    current_graph_hash: freshness.current_graph_hash,
    reason: 'prior_fact_fresh',
    block_count: freshBlocks.length,
    stale_coaching_emitted: false,
  });
  return freshBlocks;
}

/**
 * Resolve the canonical prior run_analysis fact for the Phase 3 lifecycle.
 *
 * Resolution is CONTENT-based: `selectRunAnalysisFact` picks the newest
 * successful run_analysis fact in `priorFacts` — the exact selector the
 * freshness derivation used. This is deliberately NOT a blind index lookup.
 * `selectedFactIndex` is a position relative to whatever array the freshness
 * derivation ran against; a caller that derives freshness on one fact-array
 * basis (e.g. `[...handlerFacts, ...priorFacts]`) but hands the lifecycle a
 * differently-ordered array would otherwise shift the index and fail to
 * resolve the fact (`selected_fact_unavailable`). Selecting by content makes
 * the resolution robust to that array-basis drift.
 *
 * `selectedFactIndex` is retained only as a cross-check: when it disagrees
 * with the content-selected position we emit
 * `v5.phase3.lifecycle_index_mismatch` (metadata only) so the drift is
 * observable. The content-selected fact always wins — behaviour does not
 * change because the cross-check differs.
 */
function selectPriorRunAnalysisFact(
  priorFacts: readonly HandlerFact[],
  selectedFactIndex: number | null,
  telemetryContext?: { readonly requestId: string; readonly scenarioId: string },
): RunAnalysisHandlerFact | null {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return null;

  if (
    telemetryContext !== undefined &&
    selectedFactIndex !== null &&
    selectedFactIndex !== selected.index
  ) {
    emit(TelemetryEvents.V5Phase3LifecycleIndexMismatch, {
      request_id: telemetryContext.requestId,
      scenario_id: telemetryContext.scenarioId,
      passed_index: selectedFactIndex,
      content_index: selected.index,
    });
  }

  // `selectRunAnalysisFact` only ever returns a run_analysis fact; narrow
  // defensively so the return type stays honest.
  return selected.fact.fact_type === 'run_analysis' ? selected.fact : null;
}

interface LifecycleTelemetryPayload {
  readonly lifecycle_state:
    | 'emitted_fresh'
    | 'emitted_stale'
    | 'skipped_unknown'
    | 'skipped_none'
    | 'rebuild_failed';
  readonly selected_fact_index: number | null;
  readonly graph_hash_at_run: string | null;
  readonly current_graph_hash: string | null;
  readonly reason: string;
  readonly block_count: number;
  readonly stale_coaching_emitted: boolean;
}

function emitLifecycle(
  lifecycle: NonNullable<ComposeToolCallInput['lifecycle']>,
  payload: LifecycleTelemetryPayload,
): void {
  emit(TelemetryEvents.V5Phase3BlockLifecycle, {
    request_id: lifecycle.requestId,
    scenario_id: lifecycle.scenarioId,
    ...payload,
  });
}
