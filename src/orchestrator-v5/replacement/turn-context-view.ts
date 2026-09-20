/**
 * Replacement conversation layer — the projection from the turn's ONE context
 * read to the three things this controller needs from it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MEASURED DEFECT THIS CLOSES, AND WHY IT IS NOT A MISSING FEATURE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The route wired this controller with `getAnalysis: () => null` and
 * `history: []` — two literals, at the only production construction site. The
 * consequence was not silence, which would have been survivable. It was a
 * confident false statement: `read_results` short-circuits on a null snapshot
 * and returns "NO ANALYSIS HAS BEEN RUN on this model … not withheld, simply
 * never computed. Say so plainly rather than reasoning as if figures existed."
 * — an INSTRUCTION TO ASSERT IT — on scenarios whose analysis had completed
 * minutes earlier. `run_analysis` then offered to spend real compute
 * re-running an answer the product already held, justified with "NO ANALYSIS
 * HAS EVER BEEN RUN on this model".
 *
 * The whole reason `read-tools.ts` exists — its header describes figures that
 * were "computed, transported, parsed, persisted — and then dropped one hop
 * short of the conversation" — was defeated by one literal in the wiring.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE READ, ONE AUTHORITY — WHY THIS PROJECTS AND NEVER DERIVES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything here is READ off `EnrichedTurnContext`, the estate's existing
 * per-turn context, memoised once by `createTurnClaimSafetyResolver`. This
 * module adds NO new read, NO new round trip and — critically — no second
 * opinion about what analysis exists. CLAUDE.md trap 12: a value derived twice
 * is a mirror, and a mirror drifts. The one derivation that happens here
 * (`deriveAnalysisFreshness`) is the estate's own function, called with the
 * estate's own inputs, and its single result feeds BOTH the model-facing
 * snapshot and the wire's `analysis_state` — so the sentence the user reads
 * and the envelope the UI reads cannot disagree.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ WHY THE SCENARIO CARRIER AND NOT `prior_facts` — THE TRAP THIS AVOIDS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `context.prior_facts` is a WINDOW: its facts are fetched by an `IN` over the
 * ~20 turn rows `readRecent` returned. `build-turn-context.ts` records what
 * that cost once already, in its own words: "The T1 claim-safety permission
 * was read off that array, so a `run_analysis` fact whose parent turn had aged
 * out was invisible and the 'no analysis ⇒ nothing to withhold' branch fired
 * on a scenario that DOES have a withheld analysis."
 *
 * Reading the window here would have reproduced the EXACT defect this module
 * exists to close, one cause further along: a user who analysed their model
 * and then had a long conversation would be told their analysis never
 * happened. Same false sentence, same instruction to assert it, and invisible
 * to any test whose fixture has fewer than twenty turns — which is all of
 * them.
 *
 * So the analysis is read from `scenario_analysis_fact_set`, the validated,
 * scenario-scoped carrier that `build-turn-context.ts` built for precisely
 * this class of question, and it is read THROUGH its attestation
 * (`isReconciledScenarioAnalysisFactSet`) so a hand-built context cannot
 * manufacture `status: 'complete'` and turn omitted validation into
 * permission.
 *
 * `turn-executor.ts` states the house rule for this carrier: "Complete alone
 * feeds the prompt; capped/degraded/omitted carriers fail weak." This module
 * is slightly more permissive in ONE direction and says why: `capped` is
 * accepted, because `capped` means the NEWEST facts are present and older
 * history exists behind them, and "the latest analysis" is exactly the newest
 * fact. It is never more permissive about `degraded` or an absent carrier.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ FOUR STATES, NOT TWO. THIS IS THE POINT OF THE MODULE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "No analysis" was one word covering two completely different worlds, and the
 * product asserted the wrong one:
 *
 *   1. NEVER ANALYSED    — we looked, the record is readable, there is no
 *                          successful run. "Nothing has been computed" is TRUE.
 *   2. CURRENT           — a successful run whose graph hash matches.
 *   3. STALE / UNKNOWN    — a successful run that may not describe the model on
 *                          screen. Figures still reported, currency stated.
 *   4. COULD NOT BE READ — the store threw, the carrier is degraded, or the
 *                          context read failed. We do not KNOW what exists.
 *
 * State 4 must never be reported as state 1. "Nothing has ever been computed"
 * is a positive claim about the world; a failed read supports no claim at all.
 * That distinction is carried on {@link AnalysisSnapshot.recordReadOk} and is
 * the reason this module can return a snapshot with a null `enrichment`: the
 * consumers need to tell "looked and found nothing" from "could not look".
 *
 * The vocabulary is deliberately the estate's existing one —
 * `prior_facts_read_ok` / `newest_analysis_fact_read_ok` both mean exactly
 * this — rather than a third spelling of one idea.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HISTORY IS A SUPPLEMENT, NEVER THE CARRIER OF RECORD
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `history` exists so the model can resolve "those two" and "the one you just
 * mentioned" — reference, not memory. It is a bounded, truncatable window and
 * it must stay one.
 *
 * Anything that MATTERS — a fact the user established, a limit they stated, a
 * disagreement, an open question, a change they authorised — belongs in
 * `ConversationMemory` via the `remember` tool, which is durable, survives
 * reload, and is never truncated by a window cap. If evidence lived only in
 * `history`, the twenty-first turn would silently lose the budget figure from
 * turn one, and the product would be back at the failure
 * `conversation-memory.ts` opens with. The cap below is therefore SAFE by
 * construction rather than by luck, and it must stay that way: do not move
 * anything load-bearing out of memory and into history.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { AnalysisEnrichment } from '@talchain/schemas/boundary';

import type { EnrichedTurnContext } from '../build-turn-context.js';
import { isReconciledScenarioAnalysisFactSet } from '../context/reconcile-scenario-analysis-facts.js';
import {
  deriveAnalysisFreshness,
  selectRunAnalysisFact,
  type FreshnessDerivation,
} from '../context/freshness.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { AnalysisSnapshot } from './read-tools.js';

/**
 * How many prior turns are projected into `history`.
 *
 * Bounded because every message is re-sent on every iteration of the agent
 * loop, so an unbounded history multiplies the turn's token cost by its own
 * length. Twelve turns is roughly the span over which a pronoun or a "that
 * one" still refers to something; beyond it, durable memory is the carrier
 * (see the module header). The store's own window is larger, so this cap is
 * the binding one and is stated here rather than inherited silently.
 */
export const REPLACEMENT_HISTORY_TURN_CAP = 12;

export interface ReplacementTurnContextView {
  /**
   * What `read_results` and `run_analysis` are handed.
   *
   * `null` means STATE 1 — the record was read and holds no successful
   * analysis. A snapshot with `enrichment: null` and `recordReadOk: false`
   * means STATE 4 — we could not look. The two are not interchangeable and
   * the tools branch on them differently.
   */
  readonly snapshot: AnalysisSnapshot | null;
  /**
   * The wire's freshness derivation for this turn's graph, threaded into
   * `sendFinalised200` so `analysis_state.run_state` describes what actually
   * happened. THE SAME derivation that produced `snapshot.freshness` — read
   * twice from one result, never computed twice.
   */
  readonly freshness: FreshnessDerivation;
  /** Chronological (oldest first) conversation history — reference only. */
  readonly history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function optionIdsOf(graph: GraphStateIngress | null | undefined): readonly string[] | null {
  if (graph == null || !Array.isArray(graph.nodes)) return null;
  const ids = graph.nodes
    .filter((n): n is typeof n & { kind: 'option'; id: string } => {
      const rec = n as { kind?: unknown; id?: unknown };
      return rec.kind === 'option' && typeof rec.id === 'string';
    })
    .map((n) => n.id);
  return ids.length > 0 ? ids : null;
}

/**
 * The analysis facts this turn is entitled to reason from, and whether the
 * read that produced them succeeded.
 *
 * Returns `readOk: false` for every carrier we cannot stand behind — absent,
 * unattested, or `degraded` — so the caller reports ignorance rather than
 * inventing an absence.
 */
function analysisFactsFrom(context: EnrichedTurnContext): {
  readonly facts: readonly HandlerFact[];
  readonly readOk: boolean;
} {
  const set = context.scenario_analysis_fact_set;
  if (!isReconciledScenarioAnalysisFactSet(set, context.session_id)) {
    // Not attested: either omitted, or an object that did not come from the
    // authority boundary. Fail weak — we did not look through a reader we
    // trust, so we do not report on what exists.
    return { facts: [], readOk: false };
  }
  if (set.status === 'degraded') return { facts: [], readOk: false };
  // 'complete' and 'capped' both carry the NEWEST facts; `capped` additionally
  // discloses that older history exists behind them, which does not affect
  // "what is the latest analysis".
  return { facts: set.facts, readOk: true };
}

/**
 * The freshness derivation reported when nothing could be read.
 *
 * `unknown` / `derivation_failed` is the estate's existing vocabulary for
 * "freshness could not be derived", and it is NOT `none`: `none` asserts the
 * scenario has never been analysed, which is exactly the claim a failed read
 * cannot support.
 */
function unreadableFreshness(currentGraphHash: string | null): FreshnessDerivation {
  return {
    freshness: 'unknown',
    reason: 'derivation_failed',
    selected_fact_index: null,
    graph_hash_at_run: null,
    current_graph_hash: currentGraphHash,
    computed_at: null,
  };
}

/** The snapshot that says "I could not look", as distinct from "nothing is there". */
function unreadableSnapshot(): AnalysisSnapshot {
  return {
    enrichment: null,
    freshness: null,
    freshnessReason: 'derivation_failed',
    computedAt: null,
    recordReadOk: false,
  };
}

function historyFrom(context: EnrichedTurnContext): ReplacementTurnContextView['history'] {
  // `prior_turns` arrives NEWEST-FIRST from the store. Take the newest N, then
  // reverse, so the model reads the conversation forwards.
  const window = context.prior_turns.slice(0, REPLACEMENT_HISTORY_TURN_CAP);
  const messages: ReplacementTurnContextView['history'] = [];
  for (let i = window.length - 1; i >= 0; i--) {
    const turn = window[i];
    if (turn === undefined) continue;
    const user = typeof turn.user_message === 'string' ? turn.user_message.trim() : '';
    const assistant =
      typeof turn.assistant_message === 'string' ? turn.assistant_message.trim() : '';
    // A turn may carry one side, both, or neither: the content columns are
    // nullable and rows written before this controller persisted `userMessage`
    // hold a NULL user half. Project what is there and skip what is not —
    // never substitute a placeholder, which would read as something the
    // participant said.
    if (user.length > 0) messages.push({ role: 'user', content: user });
    if (assistant.length > 0) messages.push({ role: 'assistant', content: assistant });
  }
  return messages;
}

/**
 * Project the turn's context into what this controller needs.
 *
 * @param context the memoised `EnrichedTurnContext`, or `null` when the read
 *   failed or could not be attempted. `null` is STATE 4, not STATE 1.
 * @param currentGraphHash the analysis-affecting hash of the graph this turn
 *   is answering over — the same value the controller binds proposals to, so
 *   "is the analysis current?" and "is this proposal still valid?" are asked
 *   about the same object.
 * @param graph the turn's graph, read only for option identities (the
 *   freshness guard's optional third argument).
 */
export function projectTurnContext(
  context: EnrichedTurnContext | null,
  currentGraphHash: string | null,
  graph: GraphStateIngress | null | undefined,
): ReplacementTurnContextView {
  if (context === null) {
    return {
      snapshot: unreadableSnapshot(),
      freshness: unreadableFreshness(currentGraphHash),
      history: [],
    };
  }

  const { facts, readOk } = analysisFactsFrom(context);
  const freshness = deriveAnalysisFreshness(facts, currentGraphHash, optionIdsOf(graph), {
    priorFactsReadOk: readOk,
  });

  if (!readOk) {
    return { snapshot: unreadableSnapshot(), freshness, history: historyFrom(context) };
  }

  const selected = selectRunAnalysisFact(facts);
  if (selected === null) {
    // STATE 1. We looked, through a reader we trust, at the whole scenario.
    // "Nothing has been computed" is now a claim we can actually support.
    return { snapshot: null, freshness, history: historyFrom(context) };
  }

  const rawEnrichment = (selected.fact.result as { enrichment?: unknown }).enrichment;
  return {
    snapshot: {
      // Typed as the shared contract and read shape-defensively by every
      // consumer — the transport field is `z.record(z.unknown())`, so what
      // arrives is only whatever the producer sent (see `read-tools.ts`).
      enrichment:
        rawEnrichment != null && typeof rawEnrichment === 'object'
          ? (rawEnrichment as AnalysisEnrichment)
          : null,
      freshness: freshness.freshness,
      freshnessReason: freshness.reason,
      computedAt: freshness.computed_at,
      recordReadOk: true,
    },
    freshness,
    history: historyFrom(context),
  };
}
