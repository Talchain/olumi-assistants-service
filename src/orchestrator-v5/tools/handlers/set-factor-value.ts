/**
 * V5 D1 — `set_factor_value` handler.
 *
 * Mutates a factor node's `observed_state.{value, raw_value}` deterministically
 * from a validated proposal. Sonnet supplies user-unit components via the
 * structured parameter shape `{ value, unit?, cap? }`; the handler
 * applies the operator and normalises model units. (`raw_value` was an
 * optional field on the structured shape pre-A3.1 but was never read by
 * the handler — removed in A3.1 Task 4. Strict Zod rejects it now.)
 *
 * Per F.6: no LLM calls inside the handler. No re-parsing of user text — the
 * proposal parameters are the source of truth (the validator already passed
 * them through the registered Zod schema).
 *
 * Returns:
 *   - `mutated_graph` — post-mutation graph (validated). Carries the
 *     full ingress top-level shape with mutated `nodes`/`edges`/
 *     `goal_constraints` stamped in (A3.1 Task 2). Replaces the
 *     ingress graph at commit time so append_turn_atomic persists
 *     the new state.
 *   - `handler_facts` — single SetFactorValueHandlerFact carrying
 *     {target_id, status, before, after}. Compose maps this to the
 *     boundary `graph_patch` block so the UI sees the change.
 *   - `assistant_text` — decision-language confirmation (no raw decimals,
 *     no spaces before %).
 */

import { z } from 'zod';

import { SetFactorValueHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { SetFactorValueHandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { HandlerFn, HandlerInvocation, HandlerOutcome } from '../registry.js';
import { HandlerInvocationFailedError, HandlerResultInvalidError } from '../handler-errors.js';
import { synthesiseDisplayValue } from '../../../cee/factor-extraction/display-value.js';
import { applyAndValidateMutation } from './d1-shared/apply-graph-mutation.js';
import { runD1Handler } from './d1-shared/error-boundary.js';
import { D1HandlerError } from './d1-shared/errors.js';
import { applyFactorValueOperator } from './d1-shared/evaluate-factor-value-proposal.js';
import { formatFactorChange } from './d1-shared/format-confirmation.js';
import { normaliseFactorValue } from './d1-shared/normalise-factor-value.js';
import { SET_FACTOR_VALUE_USER_GUIDANCE } from './d1-shared/user-guidance.js';
import { isSuccessfulRunAnalysisFact } from '../../context/freshness.js';

/**
 * P0 V5 golden-path repair (Wave 2): staleness narrative appended to a
 * successful set_factor_value receipt when a prior successful
 * run_analysis fact existed. Closes the UX loop required by the brief:
 * (1) what changed, (2) what does it affect, (3) is analysis fresh or
 * stale, (4) what should the user do next. The chip-generator's
 * stale-rerun rule emits the matching "Re-run analysis" chip when the
 * post-dispatch freshness re-derivation flips the verdict.
 *
 * British English, no internal terms (no graph hash, no fact_type, no
 * patch language). Suppressed on noop applies (raw_value unchanged) and
 * when no prior analysis existed (the model is being built; nothing to
 * stale yet).
 */
// V5 stale-aware explain recovery — the phrase "previous analysis"
// is on the brief's hard-fail list. The narrative uses "last analysis"
// (not on the forbidden list) so the deterministic narrative emits
// brief-aligned copy at source. The finaliser-level egress guard
// would otherwise rewrite this to a neutral fallback and emit a
// telemetry signal — better to use clean wording at source.
//
// "results" is used in place of any prescription-shaped noun (the
// foamy-bee UI handoff brief bans `recommended`, `winner`, `winning`
// from user-facing copy; the noun form `recommendation` is treated
// in scope by the same rule).
const STALENESS_NARRATIVE =
  ' This makes the last analysis stale. Re-run analysis to see how this affects the results.';

/**
 * Parameter Zod schema registered with the validator. Exported so the
 * validation registry can reference the same schema (single source of
 * truth — the validator and the handler check the same shape).
 *
 * Sonnet's tool schema accepts either a primitive or a structured
 * object `{ value, unit?, cap? }` for `parameters.value`; we accept
 * both here. When the value arrives as a primitive number we treat
 * it as a bare-number proposal (no unit) and the handler defers to
 * the factor's stored unit/cap; when structured, the proposal carries
 * explicit unit/cap. The structured object is `.strict()`, so unknown
 * keys (notably `raw_value`, removed in A3.1 Task 4 because it was
 * dead documentation that risked silent double-normalisation) fail
 * validation loudly.
 */
export const SetFactorValueValueSchema = z.union([
  z.number(),
  z
    .object({
      // V5 D1 golden-path closure (A3.1 Task 4): `raw_value` was
      // previously declared optional but ignored by `parseProposalValue`
      // — it never reached the handler logic. Removing it from the
      // schema closes the silent-strip footgun: a proposal carrying
      // `{ value: 5, raw_value: 0.05 }` now fails Zod validation with
      // "Unrecognized key(s)" rather than silently picking `value`.
      value: z.number(),
      unit: z.string().optional(),
      cap: z.number().optional(),
    })
    .strict(),
]);

interface ParsedValue {
  /** The numeric value the user is supplying (operator's right-hand side). */
  readonly numeric: number;
  /** Explicit unit on the proposal, if any. */
  readonly unit?: string;
  /** Explicit cap on the proposal, if any. */
  readonly cap?: number;
  /** True when the proposal supplied an explicit unit (anywhere). */
  readonly inputHasUnit: boolean;
}

function parseProposalValue(raw: unknown): ParsedValue {
  if (typeof raw === 'number') {
    return { numeric: raw, inputHasUnit: false };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { value: number; unit?: string; cap?: number };
    return {
      numeric: obj.value,
      ...(obj.unit !== undefined ? { unit: obj.unit } : {}),
      ...(obj.cap !== undefined ? { cap: obj.cap } : {}),
      inputHasUnit: typeof obj.unit === 'string' && obj.unit.length > 0,
    };
  }
  throw new D1HandlerError(
    'PARAMETER_INVALID',
    'set_factor_value: value must be a number or { value, unit?, cap? }.',
    { details: { received: raw }, userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE },
  );
}

// (Local `applyOperator` removed — single source of truth lives in
// `d1-shared/evaluate-factor-value-proposal.ts` as
// `applyFactorValueOperator`, imported above. This handler and the
// shared predicate now compute identical effectiveRaw values by
// construction, closing the review feedback NB #1.)

interface ObservedSnapshot {
  readonly value?: number;
  readonly raw_value?: number;
  readonly unit?: string;
  readonly cap?: number;
}

function snapshotObservedState(node: GraphV3T['nodes'][number]): ObservedSnapshot {
  const obs = node.observed_state;
  if (!obs) return {};
  return {
    ...(obs.value !== undefined ? { value: obs.value } : {}),
    ...(obs.raw_value !== undefined ? { raw_value: obs.raw_value } : {}),
    ...(obs.unit !== undefined ? { unit: obs.unit } : {}),
    ...(obs.cap !== undefined ? { cap: obs.cap } : {}),
  };
}

export function createSetFactorValueHandler(): HandlerFn {
  return async function setFactorValueHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    return runD1Handler('set_factor_value', async () => {
    const proposal = invocation.proposal;
    if (!proposal) {
      throw new HandlerInvocationFailedError(
        'set_factor_value invoked without a proposal',
        {
          cause_kind: 'parameter_invalid_at_execute',
          retryable: false,
          details: { handler_id: 'set_factor_value' },
        },
      );
    }

    const rawGraph = invocation.graphForTurn ?? invocation.context.persistedGraph ?? null;
    if (!rawGraph) {
      throw new D1HandlerError(
        'PRECONDITION_UNMET',
        'set_factor_value requires a graph — none was supplied for this turn.',
        {
          details: { handler_id: 'set_factor_value' },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }
    const graphParse = GraphV3.safeParse(rawGraph);
    if (!graphParse.success) {
      throw new D1HandlerError(
        'GRAPH_INVARIANT_VIOLATED',
        'set_factor_value: ingress graph failed schema validation.',
        {
          details: {
            handler_id: 'set_factor_value',
            first_issue: graphParse.error.issues[0]?.message,
          },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }
    const graph = graphParse.data;

    const targetId = proposal.entity.id;
    const targetNode = graph.nodes.find((n) => n.id === targetId);
    if (!targetNode) {
      throw new D1HandlerError(
        'ENTITY_NOT_FOUND',
        `Factor "${targetId}" was not found in the graph.`,
        {
          details: { handler_id: 'set_factor_value', target_id: targetId },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }
    if (targetNode.kind !== 'factor') {
      throw new D1HandlerError(
        'ENTITY_KIND_MISMATCH',
        `Cannot set value on a ${targetNode.kind} — set_factor_value only accepts factors.`,
        {
          details: {
            handler_id: 'set_factor_value',
            target_id: targetId,
            actual_kind: targetNode.kind,
          },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }

    const valueParam = proposal.parameters.find((p) => p.name === 'value');
    if (!valueParam) {
      throw new D1HandlerError(
        'PARAMETER_INVALID',
        'set_factor_value requires a "value" parameter.',
        {
          details: { handler_id: 'set_factor_value' },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }

    const parsed = parseProposalValue(valueParam.value);
    const operator = valueParam.operator ?? 'set';
    const before = snapshotObservedState(targetNode);

    // The "current value" against which operators apply is the user-unit
    // raw_value when present, falling back to the model-unit value. This
    // matches the user's mental model: "increase by 1000" on a £-factor
    // should increase raw_value by 1000, not value (which is a ratio).
    const currentRaw =
      before.raw_value !== undefined
        ? before.raw_value
        : before.value !== undefined
          ? before.value
          : 0;

    const newRaw = applyFactorValueOperator(currentRaw, operator, parsed.numeric);

    const normalised = normaliseFactorValue({
      rawInput: newRaw,
      ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
      ...(parsed.cap !== undefined ? { proposalCap: parsed.cap } : {}),
      ...(before.cap !== undefined ? { factorCap: before.cap } : {}),
      ...(before.unit !== undefined ? { factorUnit: before.unit } : {}),
      // The ambiguity guard only fires when the PROPOSAL itself omits the
      // unit. The factor's stored unit is irrelevant to the user's intent —
      // a bare-number proposal "200" against a cap=100 factor is ambiguous
      // regardless of whether the factor's existing observed_state.unit is
      // "%". Refuse rather than guess; the user must clarify.
      inputHasUnit: parsed.inputHasUnit,
    });

    const after: ObservedSnapshot = {
      value: normalised.value,
      raw_value: normalised.raw_value,
      ...(parsed.unit !== undefined
        ? { unit: parsed.unit }
        : before.unit !== undefined
          ? { unit: before.unit }
          : {}),
      ...(parsed.cap !== undefined
        ? { cap: parsed.cap }
        : before.cap !== undefined
          ? { cap: before.cap }
          : {}),
    };

    // Apply the mutation to a clone and Zod-parse the result.
    const result = applyAndValidateMutation(rawGraph, (clone) => {
      const node = clone.nodes.find((n) => n.id === targetId);
      if (!node) {
        // Should be impossible — we found it on `graph` and clone is a deep
        // copy. Defensive throw for completeness.
        throw new D1HandlerError('ENTITY_NOT_FOUND', `Node ${targetId} disappeared during clone.`, {
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        });
      }
      const merged = {
        ...(node.observed_state ?? {}),
        value: normalised.value,
        raw_value: normalised.raw_value,
        ...(after.unit !== undefined ? { unit: after.unit } : {}),
        ...(after.cap !== undefined ? { cap: after.cap } : {}),
      };
      node.observed_state = merged;

      // V5 D1 golden-path closure (A3.1 Task 3): recompute display_value
      // from the post-mutation observed_state via the canonical pure
      // formatter. Without this the persisted node carries a stale
      // display string ("£40,000" after we just mutated raw_value to
      // 50000). `synthesiseDisplayValue` returns undefined when input
      // is insufficient — callers who relied on absence handle that
      // path; we normalise back to undefined-meaning-cleared rather
      // than persisting the prior value.
      const recomputedDisplay = synthesiseDisplayValue({
        value: normalised.value,
        raw_value: normalised.raw_value,
        ...(after.unit !== undefined ? { unit: after.unit } : {}),
        ...(node.factor_type !== undefined ? { factor_type: node.factor_type } : {}),
        ...(after.cap !== undefined ? { cap: after.cap } : {}),
      });
      if (recomputedDisplay !== undefined) {
        node.display_value = recomputedDisplay;
      } else if (node.display_value !== undefined) {
        // Clear the stale display string when the formatter declines
        // to produce a new one.
        delete (node as { display_value?: string }).display_value;
      }

      // Stamp provenance so downstream consumers know the value was
      // user-set (NodeV3.provenance enum supports 'user_set' directly).
      node.provenance = 'user_set';

      return { before, after };
    });

    const noop =
      before.value === after.value &&
      before.raw_value === after.raw_value &&
      before.unit === after.unit &&
      before.cap === after.cap;

    const fact: SetFactorValueHandlerFact = {
      fact_type: 'set_factor_value',
      fact_version: 1,
      noop,
      result: {
        target_id: targetId,
        status: noop ? 'noop' : 'applied',
        before: before as Record<string, unknown>,
        after: after as Record<string, unknown>,
      },
    };

    const factCheck = SetFactorValueHandlerFactSchema.safeParse(fact);
    if (!factCheck.success) {
      throw new HandlerResultInvalidError(
        'SetFactorValueHandlerFact failed schema validation',
        factCheck.error,
      );
    }

    const label = targetNode.label;
    const baseText = formatFactorChange({
      label,
      before: {
        raw_value: before.raw_value ?? before.value ?? 0,
        ...(before.unit !== undefined ? { unit: before.unit } : {}),
      },
      after: {
        raw_value: after.raw_value ?? after.value ?? 0,
        ...(after.unit !== undefined ? { unit: after.unit } : {}),
      },
    });

    // P0 V5 golden-path repair (Wave 2): when a prior successful analysis
    // exists and this turn actually mutated the factor (non-noop), append
    // the staleness narrative so the assistant_text answers all four
    // user-facing questions (what changed, what it affects, is analysis
    // stale, what to do next). Suppressed on noop and pre-analysis
    // mutations.
    const hasPriorSuccessfulAnalysis = invocation.context.prior_facts.some(
      isSuccessfulRunAnalysisFact,
    );
    const assistantText =
      !noop && hasPriorSuccessfulAnalysis ? `${baseText}${STALENESS_NARRATIVE}` : baseText;

    return {
      assistant_text: assistantText,
      handler_facts: [factCheck.data],
      llm_calls_used: 0,
      mutated_graph: result.mutatedGraph,
    };
    });
  };
}
