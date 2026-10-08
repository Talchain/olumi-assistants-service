/**
 * ⭐ BATCH 7 (R3) — ISL's blocked 422 `IDENTITY_NOT_EVALUATED` is said as the one question that unblocks it, never
 * "the analysis failed" (R&C CLAIM #72 5860867216; AI Quality meaning spec #72 5860888736: one ask per typed reason,
 * figures in USER units, each labelled with its owner; the generic "analysis could not run" is the mutant).
 *
 * Corpus: ISL #187's own served wire (Paul `a295e4a1`, PLoT a6da42b) with its WITH_ADDEND identity, and the 422 body
 * PLoT forwards for ISL #187's critique template TODAY (no typed `identity` field — the ask is then figure-free).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  composeIdentityNotEvaluatedAsk,
  composeIdentityAskForNode,
  readIdentityAsk,
  sayFigure,
} from '../identity-not-evaluated-ask.js';
import { composeHandlerFailureBody } from '../../compose/handler-failure-responses.js';
import { HandlerInvocationFailedError } from '../../tools/handler-errors.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync(
  new URL('./fixtures/isl187-identity-not-evaluated-paul-a295e4a1.json', import.meta.url), 'utf8',
)) as Rec;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const untyped = (): Rec[] => clone(F.plot_422_untyped.critiques);
const typed = (over: Rec = {}): Rec[] => untyped().map((c) => ({ ...c, identity: { ...clone(F.typed_identity_inconsistent), ...over } }));
const FORMULA = '“Pro plan price” × “Pro paying subscribers” + “Other MRR growth”';
const NEVER = /fail|IDENTITY_NOT_EVALUATED|identity_|withheld_reason|could not run|couldn't proceed/i;

describe('precondition: the corpus is ISL #187\'s wire and the 422 PLoT forwards today', () => {
  it('MRR declares price × subscribers + other MRR growth; the critique is typed only by code + affected ids', () => {
    expect(node(F.graph, 'mrr').nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'] });
    expect(node(F.graph, 'mrr').observed_state).toMatchObject({ raw_value: 75000, unit: 'GBP MRR', source: 'brief_extraction' });
    const [c] = untyped();
    expect(c).toMatchObject({ code: 'IDENTITY_NOT_EVALUATED', affected_node_ids: ['mrr', 'pro_plan_price', 'pro_paying_subscribers', 'other_mrr_growth'] });
    expect(c!.identity).toBeUndefined();
    expect(c!.message).toContain('50,000.00');
  });
});

describe('the ask, one per typed reason (AIQ 5860888736)', () => {
  it('identity_inconsistent: both figures ISL compared, in the user\'s units, the stated one labelled with its owner', () => {
    const a = composeIdentityNotEvaluatedAsk(typed(), F.graph)!;
    expect(a.reason).toBe('identity_inconsistent');
    expect(a.assistant_text).toBe(
      `The figures don't add up: ${FORMULA} gives £50,000, but you said “MRR” is £75,000. Which is right? `
      + 'Or is there more “MRR” from somewhere that isn\'t in the model?',
    );
    expect(a.assistant_text).not.toMatch(NEVER);
  });

  it('owner label follows the ONE authority: Olumi\'s estimate / unattributed never read as "you said"', () => {
    const g = clone(F.graph);
    node(g, 'mrr').observed_state.source = 'cee_inference';
    expect(composeIdentityNotEvaluatedAsk(typed(), g)!.assistant_text).toContain('but Olumi\'s estimate of “MRR” is £75,000.');
    delete node(g, 'mrr').observed_state.source;
    expect(composeIdentityNotEvaluatedAsk(typed(), g)!.assistant_text).toContain('but the model has “MRR” at £75,000.');
  });

  it('the figures are the 422\'s own, never recomputed from the graph (graph says 49 × 1,500 + 1,000 = 74,500)', () => {
    const a = composeIdentityNotEvaluatedAsk(typed({ reconstructed: 61234, stated: 80000 }), F.graph)!;
    expect(a.assistant_text).toContain('gives £61,234, but you said “MRR” is £80,000.');
    expect(a.assistant_text).not.toContain('74,500');
  });

  it('identity_operand_missing: names the operand the model holds no level for', () => {
    const g = clone(F.graph);
    delete node(g, 'pro_paying_subscribers').observed_state;
    const a = composeIdentityNotEvaluatedAsk(typed({ withheld_reason: 'identity_operand_missing', reconstructed: undefined, stated: undefined }), g)!;
    expect(a).toMatchObject({ reason: 'identity_operand_missing', chip_label: 'Give its value' });
    expect(a.assistant_text).toBe(`To work out “MRR” as ${FORMULA}, I need “Pro paying subscribers”: what is it today?`);
  });

  it('identity_zero_level: names the zero operand and asks whether 0 is right', () => {
    const g = clone(F.graph);
    Object.assign(node(g, 'pro_plan_price').observed_state, { value: 0, raw_value: 0 });
    const a = composeIdentityNotEvaluatedAsk(typed({ withheld_reason: 'identity_zero_level' }), g)!;
    expect(a.assistant_text).toBe(`“Pro plan price” is 0 today, so “MRR” can't be worked out as ${FORMULA}. Is 0 right, or what is it?`);
  });

  it('identity_frame_missing: names the operand with no unit, and asks for it', () => {
    const g = clone(F.graph);
    delete node(g, 'pro_paying_subscribers').observed_state.unit;
    const a = composeIdentityNotEvaluatedAsk(typed({ withheld_reason: 'identity_frame_missing' }), g)!;
    expect(a.assistant_text).toBe('I can\'t put “Pro paying subscribers” on the same scale as “MRR”: what unit is it in?');
  });

  // ⛔ R3 (#72 5884883932, DL 5884896233): ISL's rule 1 frames the identity NODE as well as its operands. When every
  // operand has its unit and the TARGET has none, the ask named the operands again ("what unit is each of them in?")
  // for units the user already gave (Canvas 5884821547), and never asked about the one missing: the target's.
  it('RED — identity_frame_missing with every operand in its unit and the TARGET unitless: asks for the target only', () => {
    const g = clone(F.graph);
    delete node(g, 'mrr').observed_state;
    const a = composeIdentityNotEvaluatedAsk(typed({ withheld_reason: 'identity_frame_missing' }), g)!;
    expect(a).toMatchObject({ reason: 'identity_frame_missing', node_id: 'mrr', chip_label: 'Give its unit' });
    expect(a.assistant_text).toBe(
      `I can't work out “MRR” as ${FORMULA} without knowing what “MRR” is measured in: `
      + 'what unit is it in, and roughly what is it today or what are you aiming for?',
    );
    for (const operand of ['Pro plan price', 'Pro paying subscribers', 'Other MRR growth']) {
      expect(a.chip_message).not.toContain(operand);
    }
    expect(a.assistant_text).not.toMatch(NEVER);
  });

  it('SERVED (Canvas 5885532009, CEE 0ba55d2): the frameless target is an OUTCOME, so the ask names it and asks only for today', () => {
    const S = JSON.parse(readFileSync(
      new URL('./fixtures/served-identity-frame-missing-outcome-target-0ba55d2.json', import.meta.url), 'utf8',
    )) as Rec;
    // Precondition, read off the served graph: target frameless; both operands in their units; the goal is another node.
    expect(node(S.graph, 'pro_mrr').kind).toBe('outcome');
    expect(node(S.graph, 'pro_mrr').observed_state ?? null).toBeNull();
    expect(node(S.graph, 'pro_mrr').goal_threshold_unit ?? null).toBeNull();
    expect(node(S.graph, 'pro_price').observed_state.unit).toBe('£ per subscriber per month');
    expect(node(S.graph, 'paying_pro_subscribers').observed_state.unit).toBe('subscribers');
    const critiques = [{
      code: 'IDENTITY_NOT_EVALUATED',
      affected_node_ids: ['pro_mrr', 'pro_price', 'paying_pro_subscribers'],
      identity: { node_id: 'pro_mrr', operation: 'product', participants: ['pro_price', 'paying_pro_subscribers'], withheld_reason: 'identity_frame_missing' },
    }];
    const a = composeIdentityNotEvaluatedAsk(critiques, S.graph)!;
    // An outcome has no target of its own: "what are you aiming for?" would ask for a figure nothing can hold (AIQ 5885470243).
    expect(a.assistant_text).toBe(
      'I can\'t work out “Pro MRR” as “Pro price” × “Paying Pro subscribers” without knowing what “Pro MRR” is measured in: '
      + 'what unit is it in, and roughly what is it today?',
    );
    expect(a.chip_message).toBe('Ask me which unit “Pro MRR” is in.');
  });

  it('CONTROL: a goal whose unit is on its threshold (goal_threshold_unit) is framed, so the operand fallback stands', () => {
    const g = clone(F.graph);
    delete node(g, 'mrr').observed_state;
    node(g, 'mrr').goal_threshold_unit = '£ per month';
    const a = composeIdentityNotEvaluatedAsk(typed({ withheld_reason: 'identity_frame_missing' }), g)!;
    expect(a.assistant_text).toBe(
      'I can\'t put “Pro plan price”, “Pro paying subscribers” and “Other MRR growth” on the same scale as “MRR”: '
      + 'what unit is each of them in?',
    );
  });

  it('CONTROL: an operand with no unit is still the one named, even when the target has none too', () => {
    const g = clone(F.graph);
    delete node(g, 'mrr').observed_state;
    delete node(g, 'pro_paying_subscribers').observed_state.unit;
    const a = composeIdentityNotEvaluatedAsk(typed({ withheld_reason: 'identity_frame_missing' }), g)!;
    expect(a.assistant_text).toBe('I can\'t put “Pro paying subscribers” on the same scale as “MRR”: what unit is it in?');
  });

  it('every reason: never "failed", never a raw code', () => {
    for (const reason of ['identity_inconsistent', 'identity_operand_missing', 'identity_zero_level', 'identity_frame_missing']) {
      const g = clone(F.graph);
      delete node(g, 'pro_paying_subscribers').observed_state;
      const a = composeIdentityNotEvaluatedAsk(typed({ withheld_reason: reason }), g);
      expect(a?.assistant_text ?? '').not.toMatch(NEVER);
    }
  });
});

describe('without the typed field (the 422 PLoT forwards TODAY): the identity named, no numeric claim', () => {
  it('names the identity from the typed affected ids; not one figure read from the prose message', () => {
    const a = composeIdentityNotEvaluatedAsk(untyped(), F.graph)!;
    expect(a.reason).toBe('unstated');
    expect(a.assistant_text).toBe(
      `“MRR” is worked out as ${FORMULA}, and it could not be worked out exactly from the figures in the model, `
      + 'so Olumi held the analysis back rather than approximate it. Which of these figures needs correcting?',
    );
    expect(a.assistant_text).not.toMatch(/\d/);
  });

  it('CONTRAST: a typed reason with its figures missing falls back to the same figure-free ask', () => {
    expect(composeIdentityNotEvaluatedAsk(typed({ reconstructed: null }), F.graph)!.reason).toBe('unstated');
  });

  it('null when there is no such critique, or the graph does not hold/label the target', () => {
    expect(composeIdentityNotEvaluatedAsk(untyped().map((c) => ({ ...c, code: 'GRAPH_TOO_COMPLEX' })), F.graph)).toBeNull();
    const g = clone(F.graph);
    delete node(g, 'mrr').label;
    expect(composeIdentityNotEvaluatedAsk(untyped(), g)).toBeNull();
    expect(composeIdentityNotEvaluatedAsk(untyped(), null)).toBeNull();
  });
});

describe('sayFigure — the input class, not the served example (≥10 unit shapes)', () => {
  it.each([
    [75000, 'GBP MRR', 'MRR', '£75,000'],
    [73500.4, 'GBP MRR', 'MRR', '£73,500'],
    [49, 'GBP per month', 'Pro plan price', '£49 per month'],
    [75000, 'GBP', 'Revenue', '£75,000'],
    [75000, '£', 'Revenue', '£75,000'],
    [1200, 'USD per seat', 'Seat price', '$1,200 per seat'],
    [900, 'EUR', 'Budget', '€900'],
    [1500, 'subscribers', 'Pro paying subscribers', '1,500 subscribers'],
    [3, '% per month', 'Monthly churn', '3% per month'],
    [12.5, '', 'Score', '12.5'],
    [0.333333, 'ratio', 'Share', '0.33 ratio'],
    // AIQ 5887805333: the per-item price unit (#2291) and the slash forms read as money, never "49 GBP/subscriber/month".
    [49, 'GBP/subscriber/month', 'Pro plan price', '£49 / subscriber / month'],
    [49, '£/subscriber/month', 'Pro plan price', '£49 / subscriber / month'],
    [49, 'GBP per subscriber per month', 'Pro plan price', '£49 per subscriber per month'],
    [75000, 'GBP/month', 'MRR', '£75,000 / month'],
    [73500.4, 'GBP/month', 'MRR', '£73,500 / month'],
  ])('%s %s → %s', (v, unit, label, said) => {
    expect(sayFigure(v, unit, label)).toBe(said);
  });
});

describe('the composer says the ask for a blocked identity (RED on staging: generic "couldn\'t proceed" copy)', () => {
  const blocked = (details: Rec) => new HandlerInvocationFailedError('PLoT blocked the analysis', {
    cause_kind: 'analysis_blocked', retryable: false, details: { handler_id: 'run_analysis', ...details },
  });

  it('RED: details.identity_ask → the ask is the reply, with its chip; template names the reason', () => {
    const ask = composeIdentityNotEvaluatedAsk(typed(), F.graph)!;
    const r = composeHandlerFailureBody(blocked({ plot_primary_code: 'IDENTITY_NOT_EVALUATED', identity_ask: ask }));
    expect(r.template_id).toBe('analysis_blocked_identity_identity_inconsistent');
    expect(r.body.assistant_text).toBe(ask.assistant_text);
    expect(r.body.suggested_actions).toEqual([expect.objectContaining({ label: 'Check the figures', message: ask.chip_message })]);
  });

  it('RED: the code alone (no composable ask) still never says the generic "couldn\'t proceed" or "failed"', () => {
    const r = composeHandlerFailureBody(blocked({ plot_primary_code: 'IDENTITY_NOT_EVALUATED' }));
    expect(r.template_id).toBe('analysis_blocked_identity_not_evaluated');
    expect(r.body.assistant_text).not.toMatch(NEVER);
  });

  it('CONTRAST: a malformed ask is ignored (the reader, not a truthiness check)', () => {
    expect(readIdentityAsk({ reason: 'identity_inconsistent', assistant_text: 'x' })).toBeNull();
    const r = composeHandlerFailureBody(blocked({ plot_primary_code: 'GRAPH_TOO_COMPLEX', identity_ask: { reason: 'nope' } }));
    expect(r.template_id).toBe('analysis_blocked_graph_too_complex');
  });
});

describe('accumulation readers: ISL reasons and units are bound to the derived node', () => {
  const graph = (): Rec => ({ nodes: [
    { id: 'stock_today', kind: 'factor', label: 'Subscribers today', observed_state: { value: 0.75, raw_value: 1500, cap: 2000, unit: 'subscribers' } },
    { id: 'monthly_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, cap: 100, unit: '%' } },
    { id: 'monthly_inflow', kind: 'factor', label: 'New subscribers per month', observed_state: { value: 0.2, raw_value: 100, cap: 500, unit: 'subscribers per month' } },
    { id: 'stock_month_12', kind: 'outcome', label: 'Subscribers at month 12', scale_frame: 4000,
      nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'], horizon_months: 12, rate_scale: 0.01, stated_in_brief: false } },
    { id: 'price', kind: 'factor', label: 'Plan price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: 'GBP per subscriber per month' } },
    { id: 'mrr', kind: 'goal', label: 'MRR', goal_horizon_months: 12,
      nonlinear_identity: { operation: 'product', factor_ids: ['price', 'stock_month_12'], stated_in_brief: true } },
  ], edges: [
    ...['stock_today', 'monthly_churn', 'monthly_inflow'].map((from) => ({ from, to: 'stock_month_12' })),
    ...['price', 'stock_month_12'].map((from) => ({ from, to: 'mrr' })),
  ] });
  const critique = (withheld_reason: string): Rec[] => [{ code: 'IDENTITY_NOT_EVALUATED', identity: {
    node_id: 'stock_month_12', participants: ['monthly_inflow', 'stock_today', 'monthly_churn'], withheld_reason,
  } }];

  it('RATE: new typed reason names factor_ids[1], even when participants arrive in another order', () => {
    const ask = composeIdentityNotEvaluatedAsk(critique('identity_rate_out_of_range'), graph())!;
    expect(ask).toMatchObject({ node_id: 'stock_month_12', reason: 'identity_rate_out_of_range', chip_label: 'Give its value',
      assistant_text: '‘Monthly churn’ has to be below 100% a month for ‘Subscribers at month 12’ to be worked out: what is it today?' });
    expect(ask.chip_message).toBe(ask.assistant_text);
    expect(readIdentityAsk(ask)).toEqual(ask);
  });

  it('RATE CONTROL: a product never treats its second operand as monthly churn', () => {
    const ask = composeIdentityNotEvaluatedAsk(typed({ withheld_reason: 'identity_rate_out_of_range' }), F.graph)!;
    expect(ask).toMatchObject({ node_id: 'mrr', reason: 'unstated', chip_label: 'Check the figures' });
    expect(ask.assistant_text).not.toContain('100% a month');
  });

  it('NON-FINITE: typed reason without affected ids follows the existing figure-check path', () => {
    const ask = composeIdentityNotEvaluatedAsk(critique('identity_non_finite'), graph())!;
    expect(ask).toMatchObject({ node_id: 'stock_month_12', reason: 'unstated', chip_label: 'Check the figures' });
    expect(ask.assistant_text).toContain('Which of these figures needs correcting?');
    expect(ask.assistant_text).not.toMatch(/what unit|100% a month/);
  });

  it('NON-FINITE CONTROL: the established unstated ask has the same words', () => {
    const c = [{ code: 'IDENTITY_NOT_EVALUATED', affected_node_ids: ['stock_month_12', 'monthly_inflow', 'stock_today', 'monthly_churn'] }];
    expect(composeIdentityNotEvaluatedAsk(critique('identity_non_finite'), graph()))
      .toEqual(composeIdentityNotEvaluatedAsk(c, graph()));
  });

  it('FRAME: known part units never become a unit ask, with or without a stored derived level', () => {
    for (const stored of [false, true]) {
      const g = graph();
      if (stored) node(g, 'stock_month_12').observed_state = { value: 0.5, raw_value: 2000, cap: 4000, unit: 'subscribers' };
      const ask = composeIdentityNotEvaluatedAsk(critique('identity_frame_missing'), g)!;
      expect(ask).toMatchObject({ node_id: 'stock_month_12', reason: 'unstated', chip_label: 'Check the figures' });
      expect(ask.assistant_text).not.toMatch(/what unit|what is it today/);
    }
  });

  it('FRAME NODE-UNIT: part units held on the node never become a unit ask', () => {
    const g = graph();
    for (const id of ['stock_today', 'monthly_churn', 'monthly_inflow']) {
      const part = node(g, id);
      part.unit = part.observed_state.unit;
      delete part.observed_state.unit;
    }
    const ask = composeIdentityNotEvaluatedAsk(critique('identity_frame_missing'), g)!;
    expect(ask).toMatchObject({ node_id: 'stock_month_12', reason: 'unstated', chip_label: 'Check the figures' });
    expect(ask.assistant_text).not.toMatch(/what unit|what is it today/);
  });

  it('FRAME USER-READING: the user\'s stated part units never become a unit ask', () => {
    const g = graph();
    for (const id of ['stock_today', 'monthly_churn', 'monthly_inflow']) {
      const part = node(g, id);
      part.unit_reading = { unit: part.observed_state.unit, source: 'user_stated', source_quote: part.label };
      delete part.observed_state.unit;
    }
    const ask = composeIdentityNotEvaluatedAsk(critique('identity_frame_missing'), g)!;
    expect(ask).toMatchObject({ node_id: 'stock_month_12', reason: 'unstated', chip_label: 'Check the figures' });
    expect(ask.assistant_text).not.toMatch(/what unit|what is it today/);
  });

  it('FRAME CONTROL: only an actually missing part unit is asked', () => {
    const g = graph();
    delete node(g, 'monthly_churn').observed_state.unit;
    const ask = composeIdentityNotEvaluatedAsk(critique('identity_frame_missing'), g)!;
    expect(ask).toMatchObject({ node_id: 'stock_month_12', reason: 'identity_frame_missing' });
    expect(ask.assistant_text).toBe('I can\'t put “Monthly churn” on the same scale as “Subscribers at month 12”: what unit is it in?');
    expect(ask.chip_message).not.toMatch(/Subscribers today|New subscribers per month/);
  });

  it('FRAME READING CONTROL: an Olumi-written unit is still missing the user\'s unit', () => {
    const g = graph();
    delete node(g, 'monthly_churn').observed_state.unit;
    node(g, 'monthly_churn').unit_reading = { unit: '%', source: 'olumi_reading', source_quote: 'Churn could be a percentage' };
    const ask = composeIdentityNotEvaluatedAsk(critique('identity_frame_missing'), g)!;
    expect(ask).toMatchObject({ node_id: 'stock_month_12', reason: 'identity_frame_missing' });
    expect(ask.assistant_text).toBe('I can\'t put “Monthly churn” on the same scale as “Subscribers at month 12”: what unit is it in?');
  });

  it('ZERO: valid zero churn never invents a product-reconciliation ask', () => {
    const g = graph();
    node(g, 'monthly_churn').observed_state = { value: 0, raw_value: 0, cap: 100, unit: '%' };
    node(g, 'stock_month_12').observed_state = { value: 0.5, raw_value: 2000, cap: 4000, unit: 'subscribers' };
    expect(node(g, 'stock_month_12').nonlinear_identity.operation).toBe('accumulation');
    expect(composeIdentityAskForNode('stock_month_12', g)).toBeNull();
  });

  it('ZERO CONTROL: a stated product with a zero operand still asks about that operand', () => {
    const g = clone(F.graph);
    node(g, 'pro_paying_subscribers').observed_state = { value: 0, raw_value: 0, cap: 2000, unit: 'subscribers' };
    expect(composeIdentityAskForNode('mrr', g)).toMatchObject({ node_id: 'mrr', reason: 'identity_zero_level' });
  });
});
