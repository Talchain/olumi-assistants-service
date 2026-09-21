/**
 * ⭐ GO(A), THE ANSWER HALF — reading the option cost the user just gave.
 *
 * The mint half (`coaching/decide-option-cost-ask.ts` → the turn-executor's
 * `elicit_option_native_quantity` pending) asks ONE question: "what does
 * <option> cost, in <unit>?". This is its ONLY reader.
 *
 * ## Why this is not the model-unit reader one file over
 *
 * `repair-value-binding.ts` reads the answer to `elicit_option_effect`, and its
 * value grammar is MODEL-UNIT [0,1] by construction — `isModelUnitEffectValueText`,
 * whose own comment reads "it never turns bare 20 into 20%". Handing it
 * `£95,000` would either be refused or, far worse, bound as a model-unit value.
 * The two kinds name the same cell and ask opposite questions (trap 21), so
 * they get separate readers and neither may fall through to the other.
 *
 * ## Refusals — each one is a decision not to guess
 *
 * `unrelated` (leave the turn exactly as it was) when:
 *   - no live pending of this kind, or two (two live asks mean the reply is
 *     genuinely ambiguous, and the estate's ruling for that is to ask, never to
 *     pick — trap 22f);
 *   - the graph moved under the question (`preconditions.graph_hash`), so the
 *     cell the answer would land in is not the cell that was asked about;
 *   - the named option or factor no longer resolves by identity, or resolves
 *     more than once — a duplicate or foreign id is not a referent (trap 19).
 *
 * `ask` (the user is plainly answering and we cannot read it — say so rather
 * than fall silent, which is the three-way verdict R2918B established for the
 * baseline elicitation) when:
 *   - the message states no amount at all;
 *   - it states two or more amounts, so which one is the cost is a guess;
 *   - ⚠ it states an amount in a DIFFERENT currency from the one asked for.
 *     Converting is inventing a rate; recording it under the wrong unit is
 *     worse. Refusing is the only honest move, and it matches the encoder's
 *     own behaviour on a unit mismatch.
 *
 * ## What it deliberately does NOT do
 *
 * It does not write, encode, scale, or infer a cap. It returns the user's own
 * number and the unit it was asked in. Whether that number can be ENCODED onto
 * the causal model depends on the factor carrying a supported scale, which is a
 * separate question with a separate owner — and inventing that scale from the
 * cap or from the existing `0.7` is exactly the fabrication this whole path
 * exists to avoid.
 *
 * Pure: no I/O, no LLM, no telemetry, no clock (the caller supplies `nowMs`).
 */
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { filterLivePendingActions, type PendingAction } from '../session/pending-action.js';
import { sameUnit } from './native-quantity-operation.js';

export type NativeQuantityAnswer =
  | {
      readonly kind: 'bind';
      readonly pending: PendingAction;
      readonly optionId: string;
      readonly optionLabel: string;
      readonly factorId: string;
      readonly factorLabel: string;
      /** The user's own figure, in `unit`. Never converted, never scaled. */
      readonly nativeValue: number;
      readonly unit: string;
    }
  | { readonly kind: 'ask'; readonly reason: 'no_amount' | 'several_amounts' | 'unit_mismatch' }
  | { readonly kind: 'unrelated' };

interface GraphNodeLite {
  readonly id?: unknown;
  readonly kind?: unknown;
}

function nodesOf(graph: unknown): readonly GraphNodeLite[] {
  if (graph === null || typeof graph !== 'object') return [];
  const nodes = (graph as { nodes?: unknown }).nodes;
  return Array.isArray(nodes) ? (nodes as readonly GraphNodeLite[]) : [];
}

/** Exactly one node with this id AND this kind, or null. Identity, not label. */
function soleNodeOfKind(graph: unknown, id: string, kind: string): true | null {
  const hits = nodesOf(graph).filter((n) => n.id === id && n.kind === kind);
  return hits.length === 1 ? true : null;
}

export function decideNativeQuantityAnswer(params: {
  readonly message: string | null | undefined;
  readonly pendings: readonly PendingAction[] | null | undefined;
  readonly graph: unknown;
  readonly currentGraphHash: string | null | undefined;
  readonly nowMs: number;
}): NativeQuantityAnswer {
  const { pendings } = params;
  if (!Array.isArray(pendings) || pendings.length === 0) return { kind: 'unrelated' };

  const live = filterLivePendingActions(pendings, params.nowMs).filter(
    (pa) => pa.action.kind === 'elicit_option_native_quantity',
  );
  // Two live asks: the reply is genuinely ambiguous between them.
  if (live.length !== 1) return { kind: 'unrelated' };

  const pending = live[0]!;
  const asked = pending.action;
  if (asked.kind !== 'elicit_option_native_quantity') return { kind: 'unrelated' };

  // The question was asked ABOUT a graph. If that graph moved, the cell the
  // answer would land in is not the cell the user was shown.
  const pinned = pending.preconditions.graph_hash;
  if (!pinned || !params.currentGraphHash || pinned !== params.currentGraphHash) {
    return { kind: 'unrelated' };
  }

  if (soleNodeOfKind(params.graph, asked.option_id, 'option') === null) return { kind: 'unrelated' };
  if (soleNodeOfKind(params.graph, asked.factor_id, 'factor') === null) return { kind: 'unrelated' };

  const message = typeof params.message === 'string' ? params.message : '';
  const amounts = findStatedAmounts(message).filter((a) => a.kind === 'currency');
  if (amounts.length === 0) return { kind: 'ask', reason: 'no_amount' };
  if (amounts.length > 1) return { kind: 'ask', reason: 'several_amounts' };

  const amount = amounts[0]!;
  // A stated currency must MATCH. Converting invents a rate; recording under
  // the asked unit anyway would attach a number to a unit it was not given in.
  // ⚠ SYMBOL vs CODE, normalised — `findStatedAmounts` returns an ISO code
  // while a ratified constraint may carry `£`. Comparing raw would refuse the
  // user's own currency. Not a conversion: USD vs GBP still refuses.
  if (amount.currencyCode !== undefined && !sameUnit(amount.currencyCode, asked.unit)) {
    return { kind: 'ask', reason: 'unit_mismatch' };
  }
  if (!Number.isFinite(amount.magnitude)) return { kind: 'ask', reason: 'no_amount' };

  return {
    kind: 'bind',
    pending,
    optionId: asked.option_id,
    optionLabel: asked.option_label,
    factorId: asked.factor_id,
    factorLabel: asked.factor_label,
    nativeValue: amount.magnitude,
    unit: asked.unit,
  };
}
