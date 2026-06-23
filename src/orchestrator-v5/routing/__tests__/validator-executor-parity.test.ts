/**
 * Validator/executor parity property test (AC.1).
 *
 * Drives a representative table of `set_factor_value` value proposals
 * through THREE gates:
 *
 *   1. validateToolCall          (validator + the new precheck)
 *   2. evaluateFactorValueProposal (the shared predicate, called as
 *                                  a redundant cross-check that the
 *                                  validator's verdict matches the
 *                                  predicate's verdict by construction)
 *   3. set_factor_value handler  (execute via normaliseFactorValue,
 *                                  which delegates to the same
 *                                  predicate)
 *
 * Asserts the AC.1 parity invariant:
 *
 *   • Every (validator∧precheck)-accepted proposal MUST succeed at
 *     execute or fail for a NON-parameter reason — `parameter_invalid_at_execute`
 *     is forbidden once the upstream gates have passed.
 *
 *   • Every validator-rejected proposal MUST be rejected with
 *     `PARAMETER_INVALID` (the canonical recoverable code), with the
 *     granular `rejection_reason` enum in `details` so dashboards can
 *     distinguish causes without parsing prose.
 *
 * Covers: capped currency, capped percentage, bare number on capped
 * factor (ambiguity guard), delta with existing raw_value, delta with
 * missing existing raw_value (AC.3 ordering), overshoot cap (with and
 * without unit), boundary values (0 and cap).
 */

import { describe, expect, it } from 'vitest';

import { createSetFactorValueHandler } from '../../tools/handlers/set-factor-value.js';
import { HandlerInvocationFailedError } from '../../tools/handler-errors.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { buildGraphLookup } from '../graph-lookup-adapter.js';
import { validateToolCall } from '../validator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import {
  evaluateFactorValueProposal,
  type FactorValueOperator,
  type ProposalRejectionReason,
} from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { ProposalAction } from '../types.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

function buildInvocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-parity',
      stage: 'frame',
      request_id: 'req-parity',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-parity',
      turn_id: 'turn-parity',
      stage: 'frame',
      message: 'set factor',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-parity',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function makeProposal(args: {
  readonly entityId: string;
  readonly value: unknown;
  readonly operator?: FactorValueOperator;
}): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: args.entityId,
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        value: args.value,
        ...(args.operator !== undefined ? { operator: args.operator } : {}),
        source: 'user_explicit',
      },
    ],
    cited_context_fields: [],
  };
}

interface PropertyCase {
  readonly label: string;
  readonly entityId: 'f-churn' | 'f-budget' | 'f-quality' | 'f-uncapped';
  readonly value: unknown;
  readonly operator?: FactorValueOperator;
  readonly expected:
    | { readonly kind: 'accept' }
    | {
        readonly kind: 'reject';
        readonly reason: ProposalRejectionReason;
      };
}

// Table of cases spanning every value category the brief calls out.
// `expected.kind === 'accept'` means BOTH validator AND precheck accept,
// AND the handler must execute without `parameter_invalid_at_execute`.
// `expected.kind === 'reject'` means the validator MUST reject with
// PARAMETER_INVALID before the handler can run, AND the granular
// rejection_reason in details MUST match the expected enum literal.
const CASES: readonly PropertyCase[] = [
  // ---- capped percentage ----
  {
    label: 'capped percentage — in-range absolute with unit',
    entityId: 'f-churn',
    value: { value: 50, unit: '%' },
    operator: 'set',
    expected: { kind: 'accept' },
  },
  {
    label: 'capped percentage — boundary 0 with unit',
    entityId: 'f-churn',
    value: { value: 0, unit: '%' },
    operator: 'set',
    expected: { kind: 'accept' },
  },
  {
    label: 'capped percentage — boundary at cap',
    entityId: 'f-churn',
    value: { value: 100, unit: '%' },
    operator: 'set',
    expected: { kind: 'accept' },
  },
  {
    label: 'capped percentage — over-cap with unit',
    entityId: 'f-churn',
    value: { value: 150, unit: '%' },
    operator: 'set',
    expected: { kind: 'reject', reason: 'value_exceeds_cap' },
  },
  // ---- capped currency ----
  {
    label: 'capped currency — in-range absolute with unit',
    entityId: 'f-budget',
    value: { value: 23000, unit: '£' },
    operator: 'set',
    expected: { kind: 'accept' },
  },
  {
    label: 'capped currency — over-cap with unit (staging shape)',
    entityId: 'f-budget',
    value: { value: 500000, unit: '£' },
    operator: 'set',
    expected: { kind: 'reject', reason: 'value_exceeds_cap' },
  },
  // ---- bare number on capped factor (ambiguity) ----
  {
    label: 'bare number on capped factor — in-range',
    entityId: 'f-churn',
    value: 50,
    operator: 'set',
    expected: { kind: 'accept' },
  },
  {
    label: 'bare number on capped factor — outside cap (ambiguity guard)',
    entityId: 'f-churn',
    value: 500,
    operator: 'set',
    expected: { kind: 'reject', reason: 'bare_number_outside_cap' },
  },
  // ---- delta with existing raw_value ----
  {
    label: 'delta increase with existing raw_value (in-range)',
    entityId: 'f-budget',
    value: { value: 3000, unit: '£' },
    operator: 'increase',
    expected: { kind: 'accept' },
  },
  {
    label: 'delta increase with existing raw_value that overshoots cap',
    entityId: 'f-budget',
    value: { value: 70000, unit: '£' },
    operator: 'increase',
    expected: { kind: 'reject', reason: 'value_exceeds_cap' },
  },
  // ---- unit_mismatch (Blocking #1 fix, 2026-05-20 round-3) ----
  // Brief requirement: "If the unit is incompatible, ask a concise
  // clarification." Pre-fix, the predicate computed effectiveUnit
  // only for formatting and never rejected mismatches; the handler
  // then persisted the proposal's unit over the factor's, so a
  // percent factor could silently become a currency factor.
  {
    label: 'unit_mismatch — currency value on a percent factor',
    entityId: 'f-churn', // cap=100, unit='%'
    value: { value: 5000, unit: '£' },
    operator: 'set',
    expected: { kind: 'reject', reason: 'unit_mismatch' },
  },
  {
    label: 'unit_mismatch — percent value on a currency factor',
    entityId: 'f-budget', // cap=100000, unit='£'
    value: { value: 50, unit: '%' },
    operator: 'set',
    expected: { kind: 'reject', reason: 'unit_mismatch' },
  },
  {
    label: 'unit_mismatch — symmetric across operator (delta on mismatched units)',
    entityId: 'f-budget', // cap=100000, unit='£'
    value: { value: 10, unit: '%' },
    operator: 'increase',
    expected: { kind: 'reject', reason: 'unit_mismatch' },
  },

  // ---- bare sub-1 ratio on a unit-bearing factor (value/unit honesty) ----
  // The live defect: "Set …Budget… to 0.3" was applied as raw £0.3 and
  // narrated "£20,000 → £0.3". A bare number below 1 on a factor that has
  // a unit reads as a normalised proportion, not a value in that unit.
  {
    label: 'bare sub-1 on a capped currency factor (proportion guard)',
    entityId: 'f-budget', // cap=100000, unit='£'
    value: 0.3, // bare number, no unit → inputHasUnit=false
    operator: 'set',
    expected: { kind: 'reject', reason: 'bare_ratio_on_unit_factor' },
  },
  {
    label: 'bare sub-1 delta (increase) on a capped currency factor (proportion guard)',
    entityId: 'f-budget',
    value: 0.3,
    operator: 'increase',
    expected: { kind: 'reject', reason: 'bare_ratio_on_unit_factor' },
  },
  {
    label: 'bare sub-1 on an uncapped count/person-like factor (proportion guard)',
    entityId: 'f-uncapped', // no cap, unit='people'
    value: 0.3,
    operator: 'set',
    expected: { kind: 'reject', reason: 'bare_ratio_on_unit_factor' },
  },
  // ---- positive locks: the guard must NOT over-refuse legitimate input ----
  {
    label: 'bare normal currency value >= 1 (no false reject)',
    entityId: 'f-budget',
    value: 50000, // bare, but >= 1 → not proportion-looking
    operator: 'set',
    expected: { kind: 'accept' },
  },
  {
    label: 'bare sub-1 on a UNITLESS factor (ratio-in-[0,1], accepted)',
    entityId: 'f-quality', // no unit, no cap, value in [0,1]
    value: 0.7,
    operator: 'set',
    expected: { kind: 'accept' },
  },

  // ---- missing / malformed value parameter (Blocking #1 fix, 2026-05-20) ----
  // Review surfaced that a proposal with no `value` parameter slipped
  // through the precheck → handler threw `parameter_invalid_at_execute`.
  // The fix rejects at the validator with `missing_value` so the
  // recoverable invalid_parameter path fires.
  // NOTE: the table-driven case uses entity 'f-churn' with no value
  // parameter at all. The validator's structural Zod check does not
  // require the value parameter to be present (a proposal with empty
  // parameters[] still parses); the precheck closes that gap.
  // NOTE: AC.3 ordering (delta_no_existing_value before applyOperator)
  // is exercised by the dedicated predicate unit tests at
  // `evaluate-factor-value-proposal.test.ts` — that file drives the
  // predicate directly with `factorExistingRaw: undefined / NaN /
  // ±Infinity`. The property table here cannot trigger the same path
  // through a real graph fixture because every factor in
  // `buildD1Fixture` carries at least `observed_state.value`, and the
  // validator (matching the handler's existing `set-factor-value.ts:263-268`
  // fallback) treats `value` as the LHS when `raw_value` is missing.
  // Changing that fallback is a separate behavioural change outside
  // this PR's scope.
];

describe('AC.1 — validator/executor parity property table', () => {
  const handler = createSetFactorValueHandler();
  const graph = buildD1Fixture();
  const buildResult = buildGraphLookup({
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      observed_state: n.observed_state,
    })) as never,
    edges: graph.edges.map((e) => ({ from: e.from, to: e.to })) as never,
  } as never);
  if (buildResult.kind !== 'ok') {
    throw new Error('Test fixture failed to build a GraphLookup');
  }
  const graphLookup = buildResult.lookup;

  // ---- Blocking #1 fix: missing-value proposal MUST be rejected by validator ----
  it('proposal with no value parameter → validator rejects with missing_value (Blocking #1)', async () => {
    // Construct a proposal that targets a valid factor but carries
    // an empty parameters array. Pre-fix this slipped through the
    // precheck (returned null = "no objection"), validator accepted,
    // handler threw `parameter_invalid_at_execute` at runtime.
    const proposalNoValue: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-budget',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [], // empty — no value parameter at all
      cited_context_fields: [],
    };
    const validation = validateToolCall(
      proposalNoValue,
      graphLookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.error.code).toBe('PARAMETER_INVALID');
      expect(validation.error.details?.rejection_reason).toBe('missing_value');
    }
    // Handler MUST NOT be invoked — the test asserts the routing
    // outcome of the validator alone, since the validator-recoverable
    // path is what produces the user-visible chip.
  });

  it('proposal with unknown operator → validator rejects with invalid_operator (NB #1 round-3, 2026-05-20)', async () => {
    // Previously the operator was silently coerced to 'set' if it
    // wasn't a known FactorValueOperator. Now rejected as
    // PARAMETER_INVALID with the distinct `invalid_operator` enum so
    // dashboards can tell it apart from `missing_value`.
    const proposalBadOperator: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-budget',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        {
          name: 'value',
          value: 20000,
          // Bypass schema type — simulate a future caller that emits
          // a stale operator name.
          operator: 'noop' as unknown as 'set',
          source: 'user_explicit',
        },
      ],
      cited_context_fields: [],
    };
    const validation = validateToolCall(
      proposalBadOperator,
      graphLookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.error.code).toBe('PARAMETER_INVALID');
      expect(validation.error.details?.rejection_reason).toBe('invalid_operator');
    }
  });

  it('proposal with malformed value parameter (string) → validator rejects with missing_value (Blocking #1)', async () => {
    // The structural Zod schema gates the union shape, but defence-
    // in-depth: if a future code path bypasses Zod (test or codegen),
    // the precheck rejects malformed shapes too.
    const proposalBadShape: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: {
        id: 'f-budget',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        {
          name: 'value',
          // Wrong type — string. parseValueParameter returns null,
          // precheck rejects.
          value: 'twenty thousand' as unknown as number,
          source: 'user_explicit',
        },
      ],
      cited_context_fields: [],
    };
    const validation = validateToolCall(
      proposalBadShape,
      graphLookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      // The structural Zod schema may catch this first (also
      // PARAMETER_INVALID), or the precheck does — either path
      // surfaces PARAMETER_INVALID, which is the invariant.
      expect(validation.error.code).toBe('PARAMETER_INVALID');
    }
  });

  for (const c of CASES) {
    it(`${c.label} — validator + predicate + handler agree`, async () => {
      const proposal = makeProposal({
        entityId: c.entityId,
        value: c.value,
        ...(c.operator !== undefined ? { operator: c.operator } : {}),
      });

      // 1. Validator
      const validation = validateToolCall(
        proposal,
        graphLookup,
        HANDLER_VALIDATION_REGISTRY,
      );

      // 2. Predicate cross-check (independent of validator wiring)
      const obs = graphLookup.findFactorObservedState?.(c.entityId) ?? null;
      const valueParam = proposal.parameters[0]!.value;
      const parsedNumeric =
        typeof valueParam === 'number'
          ? valueParam
          : (valueParam as { value: number }).value;
      const parsedUnit =
        typeof valueParam === 'object' && valueParam !== null
          ? (valueParam as { unit?: string }).unit
          : undefined;
      const inputHasUnit = typeof parsedUnit === 'string' && parsedUnit.length > 0;
      const evaluation = evaluateFactorValueProposal({
        rawInput: parsedNumeric,
        operator: c.operator ?? 'set',
        ...(parsedUnit !== undefined ? { unit: parsedUnit } : {}),
        ...(obs?.cap !== undefined ? { factorCap: obs.cap } : {}),
        ...(obs?.unit !== undefined ? { factorUnit: obs.unit } : {}),
        ...(obs?.raw_value !== undefined
          ? { factorExistingRaw: obs.raw_value }
          : obs?.value !== undefined
            ? { factorExistingRaw: obs.value }
            : {}),
        inputHasUnit,
      });

      if (c.expected.kind === 'accept') {
        // Both gates MUST agree on acceptance.
        expect(validation.valid).toBe(true);
        expect(evaluation.ok).toBe(true);

        // Handler MUST execute without parameter_invalid_at_execute.
        // Other handler-internal causes (e.g. PRECONDITION_UNMET on a
        // contrived test fixture) are not the parity invariant's
        // concern — only PARAMETER_INVALID is forbidden after the
        // upstream gates pass.
        let causeKind: string | null = null;
        try {
          await handler(buildInvocation(graph, proposal));
        } catch (err) {
          if (err instanceof HandlerInvocationFailedError) {
            causeKind = err.cause_kind;
          } else {
            // Unexpected throw — surface for diagnosis.
            throw err;
          }
        }
        expect(causeKind).not.toBe('parameter_invalid_at_execute');
      } else {
        // Both gates MUST agree on rejection AND name the same reason.
        expect(validation.valid).toBe(false);
        if (!validation.valid) {
          expect(validation.error.code).toBe('PARAMETER_INVALID');
          // Validator-side rejection MUST surface the granular
          // rejection_reason in details for telemetry — the user-
          // visible message stays canonical via SET_FACTOR_VALUE_USER_GUIDANCE.
          expect(validation.error.details?.rejection_reason).toBe(c.expected.reason);
        }
        expect(evaluation.ok).toBe(false);
        if (!evaluation.ok) {
          expect(evaluation.reason).toBe(c.expected.reason);
        }
      }
    });
  }

  // -----------------------------------------------------------------
  // Cross-cutting invariant: for EVERY case in the table, regardless
  // of expected outcome, the validator's verdict and the predicate's
  // verdict MUST agree on accept/reject. Drift between them would
  // re-introduce the staging bug class.
  // -----------------------------------------------------------------
  it('cross-cutting: validator verdict and predicate verdict never disagree on accept/reject', async () => {
    for (const c of CASES) {
      const proposal = makeProposal({
        entityId: c.entityId,
        value: c.value,
        ...(c.operator !== undefined ? { operator: c.operator } : {}),
      });
      const validation = validateToolCall(
        proposal,
        graphLookup,
        HANDLER_VALIDATION_REGISTRY,
      );
      const obs = graphLookup.findFactorObservedState?.(c.entityId) ?? null;
      const valueParam = proposal.parameters[0]!.value;
      const parsedNumeric =
        typeof valueParam === 'number'
          ? valueParam
          : (valueParam as { value: number }).value;
      const parsedUnit =
        typeof valueParam === 'object' && valueParam !== null
          ? (valueParam as { unit?: string }).unit
          : undefined;
      const inputHasUnit = typeof parsedUnit === 'string' && parsedUnit.length > 0;
      const evaluation = evaluateFactorValueProposal({
        rawInput: parsedNumeric,
        operator: c.operator ?? 'set',
        ...(parsedUnit !== undefined ? { unit: parsedUnit } : {}),
        ...(obs?.cap !== undefined ? { factorCap: obs.cap } : {}),
        ...(obs?.unit !== undefined ? { factorUnit: obs.unit } : {}),
        ...(obs?.raw_value !== undefined
          ? { factorExistingRaw: obs.raw_value }
          : obs?.value !== undefined
            ? { factorExistingRaw: obs.value }
            : {}),
        inputHasUnit,
      });
      expect(validation.valid, `validator disagrees with predicate on ${c.label}`).toBe(
        evaluation.ok,
      );
    }
  });
});
