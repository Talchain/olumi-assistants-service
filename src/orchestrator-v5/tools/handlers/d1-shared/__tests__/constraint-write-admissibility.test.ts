/**
 * ⭐⭐ "APPLIED" MAY NOT BE SAID ABOUT A LIMIT THE ANALYSIS STRUCTURALLY CANNOT
 * EVALUATE — and the saying must happen at the WRITE, not two turns later.
 *
 * ── THE DEFECT, MEASURED ON STAGING ───────────────────────────────────────
 * Debug export `olumi-debug-44e349fa-20260914.json`, 14 Sep 2026. The user
 * said *"If the churn goes over 7% for more than 3 months, we will have a cash
 * flow problem."*. The product replied
 *
 *     "Added constraint: Churn must not exceed 7% for more than 3 months
 *      must be at most 7%."
 *
 * and persisted `goal_constraints[0]` bound to node `8b73e070`
 * ("Subscriber Churn Rate", `kind: risk`) — a node that records NO value on any
 * field. PLoT then logged `plot.constraint_no_observed_value` and
 * `constraint_analysis_absent` for all four options, and the truth reached the
 * user TWO TURNS LATER on the rerun.
 *
 * ── FIXTURES ARE CAPTURED, NOT AUTHORED ───────────────────────────────────
 * {@link CAPTURED_CHURN_RISK_NODE} is transcribed from that export's
 * `full_graph.factors[]` entry for `8b73e070`, field for field, nulls included.
 * {@link CAPTURED_CONSTRAINT_ROW} is its `goal_constraints.items[0]`. The
 * time-span corpus at the bottom is harvested from real labels already in this
 * repo's fixtures, not invented here (CLAUDE.md trap 22 — a corpus from the
 * author's head cannot see the class the author did not imagine).
 *
 * ── AND THE NEGATIVE CONTROL IS THE POINT OF THE EXERCISE ─────────────────
 * A fix that makes every limit read "not checkable" is worse than the defect.
 * Every predicate assertion below is paired with its opposite-direction twin
 * (CLAUDE.md trap 22b), and the handler suite asserts an admissible constraint
 * still reads exactly as it did before, byte for byte.
 *
 * Assertions bind by IDENTITY — node id, constraint id, the exact sentence —
 * never by a predicate another object could satisfy (CLAUDE.md trap 19).
 */

import { describe, expect, it } from 'vitest';

import type { GraphV3T } from '../../../../../schemas/cee-v3.js';
import type { HandlerInvocation } from '../../../registry.js';
import type { ProposalAction } from '../../../../routing/types.js';
import { createAddConstraintHandler } from '../../add-constraint.js';
import { buildD1Fixture } from './fixtures.js';
import {
  classifyConstraintWriteAdmissibility,
  findUnevaluatedDurationSpan,
} from '../constraint-write-admissibility.js';
import {
  formatConstraintDurationNotEvaluated,
  formatConstraintNotCheckable,
} from '../format-confirmation.js';

/* =========================================================================
 * CAPTURED EVIDENCE
 * ====================================================================== */

/** `full_graph.factors[]` entry for `8b73e070`, verbatim from the export. */
const CAPTURED_CHURN_RISK_NODE = {
  id: '8b73e070',
  label: 'Subscriber Churn Rate',
  type: 'risk',
  kind: 'risk',
  observed_state: null,
  category: null,
  interventions: null,
  interventionKeys: null,
  display_value: null,
  intercept: null,
  encoding_map: null,
  is_baseline: null,
  goal_threshold: null,
  goal_threshold_raw: null,
  goal_threshold_unit: null,
  goal_threshold_cap: null,
} as const;

/** `goal_constraints.items[0]`, verbatim from the export. */
const CAPTURED_CONSTRAINT_ROW = {
  constraint_id: 'gc-7afd7b6a-5283-4574-91a8-6a61ad821607',
  node_id: '8b73e070',
  operator: '<=',
  value: 7,
  unit: '%',
  label: 'Churn must not exceed 7% for more than 3 months',
  provenance: 'explicit',
} as const;

/**
 * The same node as the PERSISTED graph carries it — fields ABSENT rather than
 * null. Both shapes must classify identically; the export's nulls are a UI
 * projection artefact and a predicate that only handled one of them would be
 * right about the evidence and wrong about production.
 */
const PERSISTED_SHAPE_CHURN_RISK_NODE = {
  id: '8b73e070',
  kind: 'risk',
  label: 'Subscriber Churn Rate',
  provenance: 'ai_inferred',
} as const;

/* =========================================================================
 * THE PREDICATE
 * ====================================================================== */

describe('classifyConstraintWriteAdmissibility', () => {
  it('REFUSES the captured live defect: a risk target recording no value', () => {
    const verdict = classifyConstraintWriteAdmissibility(CAPTURED_CHURN_RISK_NODE);
    expect(verdict).toEqual({ checkable: false, reason: 'target_records_no_value' });
  });

  it('classifies the PERSISTED shape (fields absent, not null) identically', () => {
    expect(classifyConstraintWriteAdmissibility(PERSISTED_SHAPE_CHURN_RISK_NODE)).toEqual({
      checkable: false,
      reason: 'target_records_no_value',
    });
  });

  /* ── NEGATIVE CONTROLS: every one of these must stay checkable ────────── */

  it('NEGATIVE CONTROL — the SAME node with an observed value is checkable', () => {
    const verdict = classifyConstraintWriteAdmissibility({
      ...CAPTURED_CHURN_RISK_NODE,
      observed_state: { value: 0.07, raw_value: 7, unit: '%', cap: 100 },
    });
    expect(verdict).toEqual({ checkable: true, basis: 'target_records_a_value' });
  });

  it('NEGATIVE CONTROL — a GOAL target is checkable even carrying no quantity', () => {
    // PLoT skips PU injection for the goal node with reason `goal_node`
    // precisely because ISL computes that node's outcome distribution, so the
    // constraint IS evaluated against it (constraint-pu-injection.ts,
    // classifyConstraintPu). The read-time collector has no such exemption
    // because there its verdict only RELAXES a withholding; here it SPEAKS.
    expect(
      classifyConstraintWriteAdmissibility({ id: 'g1', kind: 'goal', label: 'Reach £20k MRR' }),
    ).toEqual({ checkable: true, basis: 'goal_target' });
  });

  it('NEGATIVE CONTROL — a factor whose only quantity is a `prior` is checkable', () => {
    // translator-v3.ts `buildParameterUncertaintiesV3` second pass emits a
    // uniform PU for `kind === 'factor' && prior`, so the constraint lands on
    // the `existing` branch of classifyConstraintPu.
    expect(
      classifyConstraintWriteAdmissibility({
        id: 'f1',
        kind: 'factor',
        label: 'Market appetite',
        prior: { distribution: 'uniform', range_min: 0.6, range_max: 1 },
      }),
    ).toEqual({ checkable: true, basis: 'target_records_a_value' });
  });

  it('NEGATIVE CONTROL — `data`, the V1 quantity carrier, still counts as a value', () => {
    // ⚠ THE TRAP THIS PINS: `NodeV3` is a plain `z.object` and STRIPS `data`,
    // so classifying the PARSED node would read this as carrying nothing and
    // tell the user their good limit will be ignored. The handler reads the RAW
    // node for exactly this reason; this asserts the predicate agrees.
    expect(
      classifyConstraintWriteAdmissibility({
        id: 'n1',
        kind: 'risk',
        label: 'Legacy node',
        data: { value: 3 },
      }),
    ).toEqual({ checkable: true, basis: 'target_records_a_value' });
  });

  it('NEGATIVE CONTROL — `scale_frame` alone counts as a value', () => {
    expect(
      classifyConstraintWriteAdmissibility({
        id: 'n2',
        kind: 'outcome',
        label: 'Annual Support Spend',
        scale_frame: 200000,
      }),
    ).toEqual({ checkable: true, basis: 'target_records_a_value' });
  });
});

/* =========================================================================
 * THE TIME SPAN THE ROW HAS NO FIELD FOR
 * ====================================================================== */

describe('findUnevaluatedDurationSpan', () => {
  it('finds the span the captured row silently dropped', () => {
    expect(
      findUnevaluatedDurationSpan({
        label: CAPTURED_CONSTRAINT_ROW.label,
        value: CAPTURED_CONSTRAINT_ROW.value,
        unit: CAPTURED_CONSTRAINT_ROW.unit,
      }),
    ).toBe('3 months');
  });

  /* ── OPPOSITE-DIRECTION TWINS ─────────────────────────────────────────── */

  it('TWIN — a TIME-DENOMINATED unit means the span IS the bound: silent', () => {
    expect(
      findUnevaluatedDurationSpan({
        label: 'Runway must be at least 18 months',
        value: 18,
        unit: 'months',
      }),
    ).toBeNull();
  });

  it('TWIN — a span whose number IS the threshold is the bound being rendered: silent', () => {
    expect(
      findUnevaluatedDurationSpan({ label: 'Delivery at most 12 months', value: 12 }),
    ).toBeNull();
  });

  it('TWIN — an ordinary limit with no time span at all: silent', () => {
    expect(
      findUnevaluatedDurationSpan({ label: 'Keep churn under 4%', value: 4, unit: '%' }),
    ).toBeNull();
  });

  it('speaks for a deadline clause riding on a non-temporal bound', () => {
    // Harvested label, real fixture: "Reach £20k MRR within 12 months".
    expect(
      findUnevaluatedDurationSpan({
        label: 'Reach £20k MRR within 12 months',
        value: 20000,
        unit: '£',
      }),
    ).toBe('12 months');
  });

  it('speaks for a span across years', () => {
    expect(
      findUnevaluatedDurationSpan({ label: 'Minimise TCO over 3 years', value: 2500, unit: '£' }),
    ).toBe('3 years');
  });

  it('is not left stateful between calls by its own /g regex', () => {
    const input = {
      label: CAPTURED_CONSTRAINT_ROW.label,
      value: CAPTURED_CONSTRAINT_ROW.value,
      unit: CAPTURED_CONSTRAINT_ROW.unit,
    };
    expect(findUnevaluatedDurationSpan(input)).toBe('3 months');
    expect(findUnevaluatedDurationSpan(input)).toBe('3 months');
    expect(findUnevaluatedDurationSpan(input)).toBe('3 months');
  });

  it('DISCLOSED GAP — a span with no numeral is not detected, and says nothing', () => {
    // Recorded rather than chased: the honest outcome of a miss is silence.
    expect(
      findUnevaluatedDurationSpan({
        label: 'Churn must not exceed 7% for a sustained period',
        value: 7,
        unit: '%',
      }),
    ).toBeNull();
  });
});

/* =========================================================================
 * THE COPY
 * ====================================================================== */

describe('the write-time copy is the run_analysis copy, not a second vocabulary', () => {
  it('states the observable, the consequence and the repair, in that order', () => {
    expect(formatConstraintNotCheckable({ targetLabel: 'Subscriber Churn Rate' })).toBe(
      'Your model records no value to test this limit: Subscriber Churn Rate has no ' +
        'number recorded against it, so it will not be part of the analysis. Tell me ' +
        'which part of your model it applies to and I will record it there; this one ' +
        'stays on the model.',
    );
  });

  it('never claims the limit was applied, enforced, or will bind', () => {
    const text = formatConstraintNotCheckable({ targetLabel: 'Subscriber Churn Rate' });
    expect(text).not.toMatch(/\bapplied\b|\benforc/i);
  });

  it('quotes the dropped span back and claims only that THIS limit ignores it', () => {
    expect(formatConstraintDurationNotEvaluated({ span: '3 months' })).toBe(
      'The “3 months” in it is recorded as wording only: the limit is stored as ' +
        'a single threshold, with no time condition attached.',
    );
  });

  /**
   * ⭐⭐ IT MUST NOT ASSERT THAT CHECKING HAPPENS — it co-emits with the
   * sentence saying it does not.
   *
   * The duration fragment is pushed by a BARE `if` in `add-constraint.ts`,
   * OUTSIDE the mintedBaseline / elicitBaseline / else chain beneath it, so it
   * ships whatever the target records. The previous wording opened "This limit
   * is checked as a single threshold" and joined, in one reply, to "...has no
   * number recorded against it, so it will not be part of the analysis."
   *
   * This binds to the CO-EMISSION, not to the sentence in isolation — the
   * defect was invisible to a test that only read one fragment.
   */
  it('⛔ does not claim the limit IS CHECKED — it co-emits with the sentence saying it is not', () => {
    const duration = formatConstraintDurationNotEvaluated({ span: '3 months' });
    const notCheckable = formatConstraintNotCheckable({ targetLabel: 'Subscriber Churn Rate' });
    const joined = `${duration} ${notCheckable}`;
    expect(duration).not.toMatch(/\bis checked\b|\bare checked\b/i);
    // The pair must not simultaneously assert checking and deny it.
    expect(joined).not.toMatch(/limit is checked/i);
    expect(notCheckable).toMatch(/not be part of the analysis|no number recorded/i);
  });
});

/* =========================================================================
 * THE HANDLER — END TO END ON THE CAPTURED SHAPE
 * ====================================================================== */

/**
 * The captured defect's graph shape: a `risk` target recording no value, with
 * an incoming edge (as `f3d2ad3a → 8b73e070` had) and an outgoing edge to the
 * goal (as `8b73e070 → b4014d90` had).
 */
function graphWithValuelessRiskTarget(): GraphV3T {
  const g = buildD1Fixture();
  g.nodes.push({
    id: 'r-churn',
    kind: 'risk',
    label: 'Subscriber Churn Rate',
  } as GraphV3T['nodes'][number]);
  g.edges.push({
    from: 'f-quality',
    to: 'r-churn',
    strength: { mean: 0.5, std: 0.12 },
    exists_probability: 0.8,
    effect_direction: 'positive',
  } as GraphV3T['edges'][number]);
  return g;
}

function constraintProposal(p: {
  readonly entityId: string;
  readonly entityKind: 'node' | 'goal';
  readonly constraintType: 'at_least' | 'at_most';
  readonly value: number;
  readonly unit?: string;
  readonly label?: string;
}): ProposalAction {
  const parameters: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: p.constraintType, source: 'user_explicit' },
    { name: 'value', value: p.value, source: 'user_explicit' },
  ];
  if (p.unit !== undefined) {
    parameters.push({ name: 'unit', value: p.unit, source: 'user_explicit' });
  }
  if (p.label !== undefined) {
    parameters.push({ name: 'label', value: p.label, source: 'user_explicit' });
  }
  return {
    handler_id: 'add_constraint',
    entity: {
      id: p.entityId,
      kind: p.entityKind,
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters,
    cited_context_fields: [],
  };
}

function invoke(graph: GraphV3T, proposal: ProposalAction, message: string): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-admissible',
      stage: 'frame',
      request_id: 'req-admissible',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-admissible',
      turn_id: 'turn-admissible',
      stage: 'frame',
      message,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-admissible',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

/** The user's own sentence, verbatim from the witnessed session. */
const CAPTURED_USER_MESSAGE =
  'No, I mean the updates relating to the risk of 7% churn over 3 months, ' +
  'meaning that we end up with a cash flow problem.';

describe('add_constraint: the receipt tells the truth at the write', () => {
  it('REPRODUCES AND CLOSES THE DEFECT: no bare "Added constraint" on an unevaluable limit', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        graphWithValuelessRiskTarget(),
        constraintProposal({
          entityId: 'r-churn',
          entityKind: 'node',
          constraintType: 'at_most',
          value: 7,
          unit: '%',
          label: CAPTURED_CONSTRAINT_ROW.label,
        }),
        CAPTURED_USER_MESSAGE,
      ),
    );

    // The row still commits — nothing the user stated is thrown away.
    const row = (outcome.mutated_graph as GraphV3T).goal_constraints![0]!;
    expect(row.node_id).toBe('r-churn');
    expect(row.value).toBe(7);

    // …and the receipt no longer claims it will bind.
    expect(outcome.assistant_text).toContain(
      'Your model records no value to test this limit: Subscriber Churn Rate has no ' +
        'number recorded against it, so it will not be part of the analysis.',
    );
    // ⭐ AND THE WHOLE REPLY MUST NOT CONTRADICT ITSELF. The duration fragment
    // and the not-checkable disclosure co-emit on this exact shape; the old
    // wording asserted the limit "is checked" three words before the product
    // said it would not be part of the analysis.
    expect(outcome.assistant_text).not.toMatch(/limit is checked/i);
    // The time condition is disclosed rather than silently dropped.
    expect(outcome.assistant_text).toContain(
      'The “3 months” in it is recorded as wording only: the limit is stored as '
        + 'a single threshold, with no time condition attached',
    );
  });

  it('NEGATIVE CONTROL — an ADMISSIBLE limit still reads exactly as it did', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        buildD1Fixture(),
        constraintProposal({
          entityId: 'f-churn',
          entityKind: 'node',
          constraintType: 'at_most',
          value: 5,
          unit: '%',
        }),
        'Keep churn under 5%.',
      ),
    );
    // Byte-for-byte the pre-existing receipt. Not "contains" — EQUALS, because
    // the whole risk of this change is appending noise to receipts that were
    // already true.
    expect(outcome.assistant_text).toBe('Added constraint: Customer churn must be at most 5%.');
  });

  it('NEGATIVE CONTROL — a GOAL target is never told its limit is unevaluable', async () => {
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        buildD1Fixture(),
        constraintProposal({
          entityId: 'g-revenue',
          entityKind: 'goal',
          constraintType: 'at_least',
          value: 90,
          unit: '%',
        }),
        'Revenue must be at least 90%.',
      ),
    );
    expect(outcome.assistant_text).not.toContain('Your model records no value');
  });

  it('does not stack TWO repair asks: the baseline elicitation still owns its cell', async () => {
    // `mintEligible` fires here (level-framed, risk kind, % unit, 1 < 7 ≤ 100,
    // incoming edge, no baseline), so the 2.918 elicitation asks the one
    // question and this disclosure stays silent. Two asks in one receipt invite
    // the user to answer neither.
    const handler = createAddConstraintHandler();
    const outcome = await handler(
      invoke(
        graphWithValuelessRiskTarget(),
        constraintProposal({
          entityId: 'r-churn',
          entityKind: 'node',
          constraintType: 'at_most',
          value: 7,
          unit: '%',
        }),
        'Keep Subscriber Churn Rate under 7%.',
      ),
    );
    expect(outcome.assistant_text).toContain('at right now?');
    expect(outcome.assistant_text).not.toContain('Your model records no value');
  });
});
