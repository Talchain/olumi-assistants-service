/**
 * PERSPECTIVES — stakeholder differences from attributed claims.
 *
 * Three required cases (goal difference · belief difference · hypothetical
 * perspective) plus the AIQ rows for this lane (5909706102):
 *   · a "CFO view" the user never gave → labelled hypothetical, no quotes;
 *   · two stated views with different churn figures → both shown, with sources;
 *   · control: a view the user did state → attributed to it;
 *   · a perspective never writes to the model; Olumi never picks a winner.
 *
 * The graph fixture is parsed by the REAL `GraphV3` schema, so it is a graph
 * the product could hold, not a shape invented for the test.
 */
import { describe, expect, it } from 'vitest';
import { DisagreementPartySchema, DisagreementType } from '@talchain/schemas/boundary';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import {
  deriveStakeholderDifferences,
  toContractParts,
  type AttributedClaim,
  type StakeholderDifferences,
} from '../stakeholder-differences.js';

const BRIEF =
  'We are deciding whether to raise the Pro plan price from £49 to £59. ' +
  'Sales thinks churn will rise 2 points if we raise the price; Finance thinks churn won\'t move. ' +
  'Sales puts monthly churn at 5% today; Finance says it is 3%. ' +
  'Sales wants to maximise new signups; Finance wants to keep gross margin above 60%.';

const GRAPH: GraphV3T = GraphV3.parse({
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Grow the Pro plan business' },
    { id: 'dec_price', kind: 'decision', label: 'Pro plan price' },
    { id: 'opt_raise', kind: 'option', label: 'Raise to £59' },
    { id: 'opt_hold', kind: 'option', label: 'Hold at £49' },
    {
      id: 'fac_price',
      kind: 'factor',
      label: 'Pro plan price',
      observed_state: { value: 49, unit: 'GBP', source: 'brief_extraction' },
    },
    {
      id: 'fac_churn',
      kind: 'factor',
      label: 'Monthly churn',
      observed_state: { value: 0.04, unit: '%', source: 'cee_inference' },
    },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'fac_churn',
      strength: { mean: 0.3, std: 0.1 },
      exists_probability: 0.8,
      effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis' },
    },
    {
      from: 'fac_churn',
      to: 'goal_growth',
      strength: { mean: -0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ],
});

const SALES = { kind: 'named_stakeholder', label: 'Sales' } as const;
const FINANCE = { kind: 'named_stakeholder', label: 'Finance' } as const;

const GOAL_CLAIMS: AttributedClaim[] = [
  {
    claim_id: 'c_sales_goal',
    holder: SALES,
    subject: { kind: 'goal', id: 'goal_growth' },
    stance: { kind: 'objective', statement: 'Maximise new signups' },
    source_quote: 'Sales wants to maximise new signups',
  },
  {
    claim_id: 'c_fin_goal',
    holder: FINANCE,
    subject: { kind: 'goal', id: 'goal_growth' },
    stance: { kind: 'objective', statement: 'Keep gross margin above 60%' },
    source_quote: 'Finance wants to keep gross margin above 60%',
  },
];

const EDGE_BELIEF_CLAIMS: AttributedClaim[] = [
  {
    claim_id: 'c_sales_churn_effect',
    holder: SALES,
    subject: { kind: 'edge', from: 'fac_price', to: 'fac_churn' },
    stance: { kind: 'figure', value: 2, unit: 'percentage_points', expression_raw: 'churn will rise 2 points' },
    source_quote: 'Sales thinks churn will rise 2 points if we raise the price',
  },
  {
    claim_id: 'c_fin_churn_effect',
    holder: FINANCE,
    subject: { kind: 'edge', from: 'fac_price', to: 'fac_churn' },
    stance: { kind: 'effect', direction: 'no_effect', expression_raw: "churn won't move" },
    source_quote: "Finance thinks churn won't move",
  },
];

const FIGURE_CLAIMS: AttributedClaim[] = [
  {
    claim_id: 'c_sales_churn_level',
    holder: SALES,
    subject: { kind: 'factor', id: 'fac_churn' },
    stance: { kind: 'figure', value: 0.05, unit: '%', expression_raw: 'monthly churn at 5%' },
    source_quote: 'Sales puts monthly churn at 5% today',
  },
  {
    claim_id: 'c_fin_churn_level',
    holder: FINANCE,
    subject: { kind: 'factor', id: 'fac_churn' },
    stance: { kind: 'figure', value: 0.03, unit: '%', expression_raw: 'it is 3%' },
    source_quote: 'Finance says it is 3%',
  },
];

const HYPOTHETICAL_CFO: AttributedClaim = {
  claim_id: 'c_hypo_cfo',
  holder: { kind: 'hypothetical', label: 'CFO lens' },
  subject: { kind: 'goal', id: 'goal_growth' },
  stance: { kind: 'objective', statement: 'Protect cash runway over growth' },
  source_quote: null,
};

/** Every key at every depth — for absence assertions over the whole output. */
function allKeys(o: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(o)) o.forEach((v) => allKeys(v, acc));
  else if (o !== null && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object') {
    Object.values(o).forEach((v) => deepFreeze(v));
    Object.freeze(o);
  }
  return o;
}

describe('deriveStakeholderDifferences', () => {
  it('CASE 1 — a GOAL difference: two named stakeholders want different things', () => {
    const out = deriveStakeholderDifferences(GRAPH, GOAL_CLAIMS, { source_text: BRIEF });
    expect(out.refused).toEqual([]);
    expect(out.differences).toHaveLength(1);
    const d = out.differences[0];

    expect(d.difference_kind).toBe('goal');
    expect(d.belief_shape).toBeNull();
    expect(d.contract_type).toBe('goals');
    expect(d.subject).toEqual({ kind: 'goal', id: 'goal_growth' });
    expect(d.real_holders_differ).toBe(true);
    expect(d.involves_hypothetical).toBe(false);

    // Attribution retained, by identity: each party is the holder the user named, with the user's own words.
    const byLabel = new Map(d.parties.map((p) => [p.display_label, p]));
    expect(byLabel.get('Sales')?.claim_ids).toEqual(['c_sales_goal']);
    expect(byLabel.get('Sales')?.source_quotes).toEqual(['Sales wants to maximise new signups']);
    expect(byLabel.get('Finance')?.claim_ids).toEqual(['c_fin_goal']);
    expect(byLabel.get('Finance')?.source_quotes).toEqual(['Finance wants to keep gross margin above 60%']);
    expect(byLabel.get('Finance')?.reported_by).toBe('owner');

    // A goal difference is a choice for the team, not a fact to test.
    expect(d.resolution.kind).toBe('priority_choice');
    if (d.resolution.kind !== 'priority_choice') throw new Error('unreachable');
    expect(d.resolution.expected_terminal_status).toBe('accepted_as_difference');
    expect(d.resolution.assumption).toMatchObject({ field: 'goal', label: 'Grow the Pro plan business' });
  });

  it('CASE 2 — a BELIEF difference: Sales says price moves churn 2 points, Finance says it does not move', () => {
    const out = deriveStakeholderDifferences(GRAPH, EDGE_BELIEF_CLAIMS, { source_text: BRIEF });
    expect(out.refused).toEqual([]);
    expect(out.differences).toHaveLength(1);
    const d = out.differences[0];

    expect(d.difference_kind).toBe('belief');
    expect(d.belief_shape).toBe('existence');
    expect(d.contract_type).toBe('structure');
    expect(d.real_holders_differ).toBe(true);

    // Tied to the model assumption it bears on, with what the model holds there now and whose that is.
    expect(d.resolution.kind).toBe('evidence_test');
    if (d.resolution.kind !== 'evidence_test') throw new Error('unreachable');
    expect(d.resolution.assumption).toEqual({
      subject: { kind: 'edge', from: 'fac_price', to: 'fac_churn' },
      field: 'strength.mean',
      label: 'Pro plan price → Monthly churn',
      model_value: 0.3,
      model_value_source: 'cee_hypothesis',
    });
    expect(d.resolution.question).toBe('Does "Pro plan price" move "Monthly churn", and by how much?');

    const sales = d.parties.find((p) => p.display_label === 'Sales');
    const finance = d.parties.find((p) => p.display_label === 'Finance');
    expect(sales?.positions).toEqual([EDGE_BELIEF_CLAIMS[0].stance]);
    expect(finance?.positions).toEqual([EDGE_BELIEF_CLAIMS[1].stance]);
  });

  it('AIQ row — two stated views with different churn FIGURES: both shown, each with its own source', () => {
    const out = deriveStakeholderDifferences(GRAPH, FIGURE_CLAIMS, { source_text: BRIEF });
    const d = out.differences[0];
    expect(d.difference_kind).toBe('belief');
    expect(d.belief_shape).toBe('figure');
    expect(d.contract_type).toBe('evidence');
    expect(d.units_comparable).toBe(true);
    expect(d.parties.map((p) => [p.display_label, p.positions, p.source_quotes])).toEqual([
      ['Finance', [FIGURE_CLAIMS[1].stance], ['Finance says it is 3%']],
      ['Sales', [FIGURE_CLAIMS[0].stance], ['Sales puts monthly churn at 5% today']],
    ]);
    // The model's own number is reported beside the positions with ITS provenance — neither side's.
    expect(d.resolution.assumption).toMatchObject({ model_value: 0.04, model_value_source: 'cee_inference' });
  });

  it('CASE 3 — a HYPOTHETICAL perspective is labelled as such, carries no quote, and is not a team disagreement', () => {
    const out = deriveStakeholderDifferences(GRAPH, [GOAL_CLAIMS[1], HYPOTHETICAL_CFO], { source_text: BRIEF });
    expect(out.refused).toEqual([]);
    expect(out.differences).toHaveLength(1);
    const d = out.differences[0];
    const hypo = d.parties.find((p) => p.claim_ids.includes('c_hypo_cfo'));
    const finance = d.parties.find((p) => p.claim_ids.includes('c_fin_goal'));

    expect(hypo?.is_hypothetical).toBe(true);
    expect(hypo?.display_label).toBe('Hypothetical: CFO lens');
    expect(hypo?.attribution_note).toMatch(/Olumi-generated/);
    expect(hypo?.attribution_note).toMatch(/Not a member of your team/);
    expect(hypo?.reported_by).toBe('assistant');
    expect(hypo?.source_quotes).toEqual([]);
    expect(d.headline).toContain('Hypothetical: CFO lens');

    // Control (AIQ): the view the user DID state stays attributed to its holder.
    expect(finance?.is_hypothetical).toBe(false);
    expect(finance?.display_label).toBe('Finance');
    expect(finance?.reported_by).toBe('owner');

    expect(d.involves_hypothetical).toBe(true);
    expect(d.real_holders_differ).toBe(false);
  });

  it('refuses — never relabels — a hypothetical with a quote, or a "CFO" the user never named', () => {
    const quotedHypo: AttributedClaim = { ...HYPOTHETICAL_CFO, claim_id: 'c_hypo_quoted', source_quote: 'cash is king' };
    const cfoAsNamed: AttributedClaim = {
      claim_id: 'c_cfo_named',
      holder: { kind: 'named_stakeholder', label: 'CFO' },
      subject: { kind: 'goal', id: 'goal_growth' },
      stance: { kind: 'objective', statement: 'Protect cash runway over growth' },
      // A quote that IS in the brief, so the refusal can only come from the holder check.
      source_quote: 'Finance wants to keep gross margin above 60%',
    };
    const out = deriveStakeholderDifferences(GRAPH, [...GOAL_CLAIMS, quotedHypo, cfoAsNamed], { source_text: BRIEF });
    expect(out.refused).toEqual([
      { claim_id: 'c_hypo_quoted', reason: 'hypothetical_cannot_quote' },
      { claim_id: 'c_cfo_named', reason: 'holder_not_named_in_source' },
    ]);
    // Contrast: the named holders in the same run are admitted.
    expect(out.differences[0].parties.map((p) => p.display_label)).toEqual(['Finance', 'Sales']);
  });

  it('refuses claims it cannot place or attest, each with its reason', () => {
    const bad: AttributedClaim[] = [
      { ...FIGURE_CLAIMS[0], claim_id: 'x_missing_node', subject: { kind: 'factor', id: 'fac_nope' } },
      { ...FIGURE_CLAIMS[0], claim_id: 'x_kind', subject: { kind: 'goal', id: 'fac_churn' } },
      { ...GOAL_CLAIMS[0], claim_id: 'x_fit', subject: { kind: 'factor', id: 'fac_churn' } },
      { ...FIGURE_CLAIMS[0], claim_id: 'x_noquote', source_quote: null },
      { ...FIGURE_CLAIMS[0], claim_id: 'x_invented', source_quote: 'Sales says churn is 9%' },
      { ...FIGURE_CLAIMS[0], claim_id: 'x_edge', subject: { kind: 'edge', from: 'fac_churn', to: 'fac_price' } },
    ];
    const out = deriveStakeholderDifferences(GRAPH, bad, { source_text: BRIEF });
    expect(out.refused).toEqual([
      { claim_id: 'x_missing_node', reason: 'subject_not_in_model' },
      { claim_id: 'x_kind', reason: 'subject_kind_mismatch' },
      { claim_id: 'x_fit', reason: 'stance_does_not_fit_subject' },
      { claim_id: 'x_noquote', reason: 'missing_source_quote' },
      { claim_id: 'x_invented', reason: 'quote_not_in_source' },
      { claim_id: 'x_edge', reason: 'subject_not_in_model' },
    ]);
    expect(deriveStakeholderDifferences(GRAPH, GOAL_CLAIMS).refused.map((r) => r.reason)).toEqual([
      'source_text_required',
      'source_text_required',
    ]);
  });

  it('one holder is one voice; agreeing holders are ALIGNED, not a difference; goal vs belief never cross', () => {
    const sameHolderTwice: AttributedClaim[] = [
      FIGURE_CLAIMS[0],
      { ...FIGURE_CLAIMS[1], claim_id: 'c_sales_again', holder: SALES, source_quote: 'Sales puts monthly churn at 5% today' },
    ];
    expect(deriveStakeholderDifferences(GRAPH, sameHolderTwice, { source_text: BRIEF }).differences).toEqual([]);

    const agree: AttributedClaim[] = [
      FIGURE_CLAIMS[1],
      { ...FIGURE_CLAIMS[1], claim_id: 'c_sales_agrees', holder: SALES, source_quote: 'Sales puts monthly churn at 5% today' },
    ];
    const aligned = deriveStakeholderDifferences(GRAPH, agree, { source_text: BRIEF });
    expect(aligned.differences).toEqual([]);
    expect(aligned.aligned).toEqual([
      { subject: { kind: 'factor', id: 'fac_churn' }, difference_kind: 'belief', holder_labels: ['Finance', 'Sales'] },
    ]);

    // Sales's goal claim and Finance's figure claim never pair up, even on overlapping holders.
    const mixed = deriveStakeholderDifferences(GRAPH, [GOAL_CLAIMS[0], FIGURE_CLAIMS[1]], { source_text: BRIEF });
    expect(mixed.differences).toEqual([]);
  });

  it('never writes: inputs are deep-frozen and unchanged; output is deterministic', () => {
    const graph = deepFreeze(structuredClone(GRAPH));
    const claims = deepFreeze(structuredClone([...GOAL_CLAIMS, ...EDGE_BELIEF_CLAIMS, ...FIGURE_CLAIMS, HYPOTHETICAL_CFO]));
    const before = JSON.stringify({ graph, claims });
    const a = deriveStakeholderDifferences(graph, claims, { source_text: BRIEF });
    const b = deriveStakeholderDifferences(graph, [...claims].reverse(), { source_text: BRIEF });
    expect(JSON.stringify({ graph, claims })).toBe(before);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.differences.map((d) => d.difference_id)).toEqual([
      'persp:belief:edge:fac_price->fac_churn',
      'persp:belief:factor:fac_churn',
      'persp:goal:goal:goal_growth',
    ]);
  });

  it('never picks a winner: no aggregate or verdict member at any depth, no ranking words in the copy', () => {
    const out: StakeholderDifferences = deriveStakeholderDifferences(
      GRAPH,
      [...GOAL_CLAIMS, ...EDGE_BELIEF_CLAIMS, ...FIGURE_CLAIMS, HYPOTHETICAL_CFO],
      { source_text: BRIEF },
    );
    const keys = allKeys(out);
    expect(keys.has('parties')).toBe(true); // positive control: the walk sees the output
    for (const banned of ['mean', 'median', 'average', 'midpoint', 'combined', 'consensus', 'winner', 'recommended', 'preferred', 'resolved_value', 'ops', 'patch']) {
      expect(keys.has(banned), banned).toBe(false);
    }
    const copy = out.differences.flatMap((d) => [
      d.headline,
      d.resolution.question,
      ...(d.resolution.kind === 'evidence_test' ? [d.resolution.test] : []),
    ]);
    expect(copy.length).toBeGreaterThan(0);
    for (const s of copy) {
      expect(s).not.toMatch(/\b(average|mean|median|midpoint|consensus|winner|correct|wrong|better supported|is right)\b/i);
    }
  });

  it('projects onto the PUBLISHED DisagreementSchema parts, and pins the attribution gap it exposes', () => {
    const out = deriveStakeholderDifferences(GRAPH, [...GOAL_CLAIMS, ...FIGURE_CLAIMS, HYPOTHETICAL_CFO], {
      source_text: BRIEF,
    });
    for (const d of out.differences) {
      const parts = toContractParts(d);
      expect(DisagreementType.options).toContain(parts.type);
      for (const p of parts.parties) expect(DisagreementPartySchema.safeParse(p).success).toBe(true);
    }
    const goal = toContractParts(out.differences.find((d) => d.difference_kind === 'goal')!);
    expect(goal.parties.map((p) => p.position)).toEqual([
      { kind: 'preference', statement: 'Protect cash runway over growth' },
      { kind: 'preference', statement: 'Keep gross margin above 60%' },
      { kind: 'preference', statement: 'Maximise new signups' },
    ]);
    expect(goal.parties.map((p) => p.authored_by)).toEqual(['assistant', 'owner', 'owner']);

    // ⚠ THE GAP (DESIGN.md §4): at the contract, Sales and Finance both become `authored_by: 'owner'`.
    // This assertion is a tripwire — it flips when the contract gains a holder field.
    const figure = toContractParts(out.differences.find((d) => d.belief_shape === 'figure')!);
    expect(new Set(figure.parties.map((p) => p.authored_by))).toEqual(new Set(['owner']));
    expect(Object.keys(figure.parties[0]).sort()).toEqual(['authored_by', 'position']);
  });
});
