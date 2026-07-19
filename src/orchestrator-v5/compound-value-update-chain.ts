/**
 * A1 multi-edit — compound value-update chaining.
 *
 * A compound value update ("Set A to 0.6 and B to 0.8") is detected by
 * `tryCompoundValueUpdate` in the routing pre-route. The turn-executor
 * synthesises the FIRST part into the normal STEP 2-7 lifecycle (validate →
 * execute → confirm → compose → commit); this module applies the REMAINING
 * parts by looping the same `set_factor_value` handler.
 *
 * WHY A DEDICATED MODULE (not inline in turn-executor): the Gate 2 invariant
 * (`turn-executor-d1-mutation-commit-graph.test.ts`) enforces that
 * `HandlerOutcome.mutated_graph` is only PRODUCED by the three D1 mutation
 * handlers, because the STEP 7 persisted-base merge-back (V5-D1-SHAPE-01)
 * assumes every producer is a D1 ingress-echo mutation that never deletes
 * nodes. This module produces a merged `HandlerOutcome.mutated_graph` — but the
 * graph it forwards is EXACTLY the `set_factor_value` handler's own output
 * chained across parts, so the ingress-echo / never-deletes-nodes contract
 * holds by construction. Keeping the producer in this small, purpose-built file
 * lets the Gate 2 allowlist name it precisely, rather than exempting the whole
 * 9,000-line turn-executor (the repo's most regression-prone file) from the
 * guard.
 *
 * Two commit channels, both fed here:
 *   - FACTS: every applied part's `SetFactorValueHandlerFact` is appended to
 *     the commit fact set. `compose.ts` emits one `graph_patch` block per fact,
 *     so the UI sees every part; this is also what drives the committed nodes
 *     on the genuinely-empty-scenario commit path.
 *   - GRAPH: each part's `mutated_graph` becomes the next part's `graphForTurn`
 *     (graph-in → graph-out), so the FINAL `mutated_graph` carries every
 *     mutation. This threading is load-bearing on the PERSISTED-base commit
 *     path: `mergeMutatedGraphForPersistence` takes `nodes` from the emitted
 *     `mutated_graph`, so without threading the persisted graph would carry
 *     only the primary part's mutation. It also keeps each part's handler
 *     validating against the correct running graph (e.g. delta operators).
 *
 * Per-part validity: the `set_factor_value` handler runs the shared
 * `evaluateFactorValueProposal` predicate (its `preEvaluation`) and throws
 * `D1HandlerError(PARAMETER_INVALID)` on an invalid value. A thrown part is
 * refused BY NAME (see `buildCompoundReceiptText`) while the rest apply — the
 * primary part already committed a real mutation, so a later invalid part must
 * not fail the whole turn.
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { EnrichedTurnContext } from './build-turn-context.js';
import type { HandlerFn, HandlerOutcome } from './tools/registry.js';
import type { ProposalAction } from './routing/types.js';
import type { CompoundUpdatePart } from './routing/deterministic-value-update.js';
import {
  mapCqeQuantityToProposalValue,
  deriveOperator,
} from './routing/deterministic-value-update.js';
import { STALENESS_NARRATIVE } from './tools/handlers/set-factor-value.js';
import { log } from '../utils/telemetry.js';

function serialiseError(err: unknown): { name?: string; message?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

/**
 * Build the combined user-visible receipt for a compound value update from the
 * per-part handler outcomes.
 *
 * Each `set_factor_value` outcome's `assistant_text` is its own change sentence
 * ("Updated Factor A to 0.6.") optionally followed by the shared staleness
 * narrative when a prior analysis existed. Concatenating raw texts would repeat
 * that narrative once per part, so we STRIP the trailing narrative from each
 * sentence, join the change sentences, then re-append the narrative exactly
 * once when ANY part made the analysis stale. A refused part (invalid value) is
 * named plainly — the phrasing avoids the state-mutation denial forms the
 * egress guard rewrites ("no change", "nothing changed").
 */
export function buildCompoundReceiptText(
  outcomes: readonly HandlerOutcome[],
  refusedLabels: readonly string[],
): string {
  const stripStaleness = (text: string): string =>
    text.endsWith(STALENESS_NARRATIVE)
      ? text.slice(0, text.length - STALENESS_NARRATIVE.length).trimEnd()
      : text;
  const sentences = outcomes
    .map((o) => stripStaleness(o.assistant_text).trim())
    .filter((s) => s.length > 0);
  let text = sentences.join(' ');
  if (refusedLabels.length > 0) {
    const names =
      refusedLabels.length === 1
        ? refusedLabels[0]!
        : refusedLabels.length === 2
          ? `${refusedLabels[0]} and ${refusedLabels[1]}`
          : `${refusedLabels.slice(0, -1).join(', ')} and ${refusedLabels[refusedLabels.length - 1]}`;
    const factorWord = refusedLabels.length === 1 ? 'that factor' : 'those factors';
    text = `${text} I couldn't set ${names} — that value isn't valid for ${factorWord}.`.trim();
  }
  const anyStale = outcomes.some((o) => o.assistant_text.endsWith(STALENESS_NARRATIVE));
  if (anyStale) {
    text = `${text}${STALENESS_NARRATIVE}`;
  }
  return text;
}

export interface CompoundChainParams {
  /** The primary part's outcome (update[0]), already executed by the lifecycle. */
  readonly primaryOutcome: HandlerOutcome;
  /** update[1..] — the remaining parts to apply. */
  readonly remainingUpdates: readonly CompoundUpdatePart[];
  /** The resolved `set_factor_value` handler fn to invoke per part. */
  readonly handlerFn: HandlerFn;
  /** The user's raw message — used to derive each part's operator. */
  readonly message: string;
  readonly context: EnrichedTurnContext;
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly scenarioId: string;
  readonly signal: AbortSignal;
}

export interface CompoundChainResult {
  /** The primary outcome merged with the chained parts (combined receipt,
   *  appended facts, final chained `mutated_graph`). */
  readonly outcome: HandlerOutcome;
  /** True when at least one part (primary or chained) emitted a mutated graph. */
  readonly graphMutated: boolean;
}

/**
 * Apply the remaining parts of a compound value update by looping the
 * `set_factor_value` handler, threading the mutated graph part-to-part, and
 * merging the results into the primary outcome. See the module doc for the
 * contract the Gate 2 invariant relies on.
 */
export async function applyCompoundValueUpdateChain(
  params: CompoundChainParams,
): Promise<CompoundChainResult> {
  const {
    primaryOutcome,
    remainingUpdates,
    handlerFn,
    message,
    context,
    payload,
    requestId,
    scenarioId,
    signal,
  } = params;

  let chainedGraph: unknown = primaryOutcome.mutated_graph;
  let graphMutated =
    primaryOutcome.mutated_graph !== undefined && primaryOutcome.mutated_graph !== null;
  const chainedFacts: HandlerFact[] = [];
  const appliedOutcomes: HandlerOutcome[] = [];
  const refusedLabels: string[] = [];

  for (const part of remainingUpdates) {
    const { value: partValue, unit: partUnit } = mapCqeQuantityToProposalValue(part.quantity);
    const partOperator = deriveOperator(message, part.quantity);
    const partProposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: part.candidate.id,
        kind: 'node',
        label: part.candidate.label,
        resolution_status: 'resolved',
        resolution_method: 'label_match',
      },
      parameters: [
        {
          name: 'value',
          value: partUnit !== undefined ? { value: partValue, unit: partUnit } : partValue,
          operator: partOperator,
          source: 'user_explicit',
          ...(partUnit !== undefined ? { unit: partUnit } : {}),
        },
      ],
      cited_context_fields: ['graph.nodes'],
    };
    try {
      const partOutcome = await handlerFn({
        context,
        payload,
        requestId,
        signal,
        orientationText: '',
        proposal: partProposal,
        graphForTurn: chainedGraph,
      });
      chainedFacts.push(...partOutcome.handler_facts);
      appliedOutcomes.push(partOutcome);
      if (partOutcome.mutated_graph !== undefined && partOutcome.mutated_graph !== null) {
        chainedGraph = partOutcome.mutated_graph;
        graphMutated = true;
      }
    } catch (partError) {
      refusedLabels.push(part.candidate.label);
      log.warn(
        {
          event: 'v5.compound_value_update.part_refused',
          request_id: requestId,
          scenario_id: scenarioId,
          target_id: part.candidate.id,
          err: serialiseError(partError),
        },
        'V5 TurnExecutor: compound value-update part refused (value invalid); remaining parts applied',
      );
    }
  }

  const combinedReceipt = buildCompoundReceiptText(
    [primaryOutcome, ...appliedOutcomes],
    refusedLabels,
  );
  const mergedFacts: readonly HandlerFact[] = [
    ...primaryOutcome.handler_facts,
    ...chainedFacts,
  ];
  const outcome: HandlerOutcome = {
    ...primaryOutcome,
    assistant_text: combinedReceipt,
    handler_facts: mergedFacts,
    mutated_graph: chainedGraph,
  };
  return { outcome, graphMutated };
}
