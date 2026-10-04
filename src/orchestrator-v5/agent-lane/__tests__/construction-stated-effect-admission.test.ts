import { describe, expect, it, vi } from 'vitest';
import { admitCandidateModel, type CandidateModel, type AdmittedModel } from '../admit-model.js';
import { figureTheUserWroteFor, goalLevelTheUserWrote, holdStatedGoalAttributes, timesTheUserWrote, withdrawUnstatedBaselineStamps, writtenRangeFor } from '../stated-by-user.js';
import { briefGoalLevel } from '../unplaced-goal-level.js';
import * as statedEffect from '../../../cee/provenance/stated-effect.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { modePermitsAtLeast, resolveAnalysisAdmission } from '../../admission/analysis-admission.js';
import { placeholderGoalPaths } from '../goal-certainty.js';
import { unreadGoalProduct } from '../unread-goal-product.js';
import { withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { log } from '../../../utils/telemetry.js';

// Copied byte-identically from the sealed stated-natural-effects BRIEF; never edited there.
const BRIEF =
  "We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. " +
  "Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. " +
  "Goal: reach at least £150,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month " +
  "to monthly recurring revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each lost customer " +
  "removes £300 a month of monthly recurring revenue. The starter tier would win about 150 new subscribers, between 80 and 250. " +
  "Each starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in support. " +
  "Keeping pricing as it is adds nothing.";

const PRICE = 'existing_price_change_from_today';
const GOAL = 'monthly_recurring_revenue';
const LOSS = 'existing_customers_lost_from_price_rise';
const SWITCH = 'starter_tier_availability';
const SUBS = 'starter_subscribers';
const DETAIL = { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%' };

function candidate(): CandidateModel {
  return {
    goal: { metric: 'monthly recurring revenue', operator: '>=', value: 150000, unit: '£/month', horizon_months: 9,
      provenance: 'explicit', frame: 'level', target_stated: true, baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit' },
    constraints: [],
    factors: [
      { label: 'Existing price change from today', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', plausible_max: 100, provenance: 'explicit' },
      { label: 'Starter tier availability', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'switch', plausible_max: 1, provenance: 'inferred' },
    ],
    risks: [{ label: 'Existing customers lost from price rise', unit: 'customers', plausible_max: 500, provenance: 'explicit' }],
    outcomes: [{ label: 'Starter subscribers', unit: 'subscribers', plausible_max: 500, provenance: 'explicit' }],
    options: [
      { label: 'Raise prices by 10%', provenance: 'explicit', interventions: [{ factor_label: 'Existing price change from today', value: 10, unit: '%', provenance: 'explicit' }] },
      { label: 'Launch starter tier', provenance: 'explicit', interventions: [{ factor_label: 'Starter tier availability', value: 1, unit: 'switch', provenance: 'inferred' }] },
      { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, interventions: [] },
    ],
    links: [
      { from: 'Existing price change from today', to: 'monthly recurring revenue', direction: 'positive', provenance: 'explicit', effect_provenance: 'explicit', effect_amount: 1200, effect_per_source_change: 1 },
      { from: 'Existing price change from today', to: 'Existing customers lost from price rise', direction: 'positive', provenance: 'explicit', effect_provenance: 'explicit', effect_amount: 2, effect_per_source_change: 1 },
      { from: 'Existing customers lost from price rise', to: 'monthly recurring revenue', direction: 'negative', provenance: 'explicit', effect_provenance: 'explicit', effect_amount: -300, effect_per_source_change: 1 },
      { from: 'Starter tier availability', to: 'Starter subscribers', direction: 'positive', provenance: 'explicit', effect_provenance: 'explicit', effect_amount: 150, effect_per_source_change: 1 },
      { from: 'Starter subscribers', to: 'monthly recurring revenue', direction: 'positive', provenance: 'explicit', effect_provenance: 'explicit', effect_amount: 49, effect_per_source_change: 1 },
    ],
  };
}

function admit(c = candidate(), brief = BRIEF, served = true): AdmittedModel {
  const g = admitCandidateModel(c, {}, brief, goalLevelTheUserWrote(c, brief),
    (value, unit) => timesTheUserWrote(value, unit, brief) >= 2,
    (model) => briefGoalLevel(model, brief),
    (value, unit, scope) => served && figureTheUserWroteFor(value, unit, brief, { ...scope, strict: true }),
    (value, unit, scope) => writtenRangeFor(value, unit, brief, scope));
  // Same baseline withdrawal and target attestation used by the served build after admission.
  return { ...g, nodes: holdStatedGoalAttributes(withdrawUnstatedBaselineStamps(g.nodes, brief), c.goal, brief).nodes };
}
function edge(g: AdmittedModel, from: string, to: string) {
  const found = g.edges.filter((e) => e.from === from && e.to === to);
  expect(found).toHaveLength(1);
  return found[0]!;
}
function servedOnly(c = candidate(), brief = BRIEF) {
  const spy = vi.spyOn(statedEffect, 'admitStatedLinkEffect').mockReturnValue({ admitted: false, reason: 'no_matching_sentence' });
  try { return admit(c, brief); } finally { spy.mockRestore(); }
}

// Independent static path-product oracle: stored natural effects and raw option interventions ONLY.
function oracle(g: AdmittedModel): Record<string, number> {
  const goal = g.nodes.find((n) => n.id === GOAL)!;
  const level = goal.observed_state?.raw_value;
  expect(level).toBe(120000);
  const walk = (id: string, delta: number, seen: ReadonlySet<string>): number => {
    if (id === GOAL) return delta;
    expect(seen.has(id), `cycle at ${id}`).toBe(false);
    return g.edges.filter((e) => e.from === id && e.provenance?.natural_effect !== undefined).reduce((sum, e) => {
      const ne = e.provenance!.natural_effect!;
      return sum + walk(e.to, delta * ne.amount / ne.per_source_change, new Set([...seen, id]));
    }, 0);
  };
  return Object.fromEntries(g.nodes.filter((n) => n.kind === 'option').map((o) => [o.id,
    level! + Object.entries(o.interventions ?? {}).reduce((sum, [id, iv]) => {
      const baseline = g.nodes.find((n) => n.id === id)?.observed_state;
      const delta = (iv.raw_value ?? iv.value) - (baseline?.raw_value ?? baseline?.value ?? 0);
      return sum + walk(id, delta, new Set());
    }, 0)]));
}

describe('T1 SERVED-SHAPE admission', () => {
  it('(a) exact price → MRR identity carries the user size and quote', () => {
    const e = edge(admit(), PRICE, GOAL);
    expect(e.provenance?.source).toBe('brief_extraction');
    expect(e.provenance?.magnitude).toBe('user_stated');
    expect(e.provenance?.natural_effect).toMatchObject(DETAIL);
    expect(e.provenance?.quote).toContain('£1,200');
    expect(e.provenance!.quote!.length).toBeLessThanOrEqual(100);
    expect(BRIEF).toContain(e.provenance!.quote!);
    expect(BRIEF).toContain(e.provenance!.source_quote!);
    const persisted = GraphV3.parse(projectGraphForPersistence(admit()));
    const stored = persisted.edges.find((link) => link.from === PRICE && link.to === GOAL)!;
    expect(stored.provenance?.quote).toBe(e.provenance!.quote);
    expect(stored.provenance?.source_quote).toBe(e.provenance!.source_quote);
  });
  it('(b) all four other exact identities retain served magnitude, source and natural effect', () => {
    const g = admit(); const old = servedOnly();
    for (const [from, to] of [[PRICE, LOSS], [LOSS, GOAL], [SWITCH, SUBS], [SUBS, GOAL]]) {
      const p = edge(g, from!, to!).provenance!;
      const before = edge(old, from!, to!).provenance!;
      expect(p.magnitude).toBe(before.magnitude);
      expect(p.source).toBe(before.source);
      expect(p.natural_effect).toEqual(before.natural_effect);
      expect(before.magnitude).toBe('user_stated');
      expect(before.source).toBe('brief_extraction');
    }
  });
  it('(c) target testability is testable', () => {
    const verdict = targetTestabilityOf(admit());
    process.stdout.write(`T1 testability: ${JSON.stringify(verdict)}\n`);
    expect(verdict.kind, JSON.stringify(verdict)).toBe('testable');
  });
  it('(d) admission permits quantified provisional and has no TARGET_NOT_TESTABLE', () => {
    const a = resolveAnalysisAdmission(admit());
    const codes = a.reasons.map((r) => r.code);
    process.stdout.write(`T1 admission: ${JSON.stringify({ mode: a.permitted_analysis_mode, reason_codes: codes })}\n`);
    expect(codes).not.toContain('TARGET_NOT_TESTABLE');
    expect(modePermitsAtLeast(a.permitted_analysis_mode, 'quantified_provisional')).toBe(true);
  });
  it('(e) no goal-figure withhold fires', () => {
    const g = admit();
    const options = g.nodes.filter((n) => n.kind === 'option');
    const scoredIds = options.map((o) => o.id);
    const scored = new Map(options.map((o) => [o.id, o.interventions ?? {}]));
    const paths = placeholderGoalPaths(g, scoredIds, undefined, scored);
    const product = unreadGoalProduct(g);
    const response = { option_comparison: scoredIds.map((option_id) => ({ option_id, probability_of_goal: 0.2,
      outcome: { mean: 126000, p10: 120000, p50: 126000, p90: 130000 } })) };
    const withheld = withholdGoalFiguresForUntestableTarget(response, g);
    process.stdout.write(`T1 withholds: ${JSON.stringify({ placeholderGoalPaths: paths, unreadGoalProduct: product, target_withhold_unchanged: withheld === response })}\n`);
    expect(paths).toEqual([]);
    expect(product).toBeNull();
    expect(withheld).toBe(response);
    // Negative control proves the response carrier is read and this is not an empty-input no-op.
    expect(withholdGoalFiguresForUntestableTarget(response, servedOnly())).not.toBe(response);
  });
  it('(f) independent static arithmetic oracle is 126000 / 127350 / 120000, all below target', () => {
    const levels = oracle(admit());
    process.stdout.write(`T1 oracle: ${JSON.stringify(levels)}\n`);
    expect(levels).toEqual({ raise_prices_by_10: 126000, launch_starter_tier: 127350, keep_pricing_as_it_is: 120000 });
    expect(Object.values(levels).every((v) => v < 150000)).toBe(true);
  });
});

describe('T3 shared predicate controls', () => {
  it('preserves a decimal and the final unterminated sentence verbatim', () => {
    const brief = 'Other facts. Each 1% price rise adds £1,200.50 a month';
    expect(statedEffect.admitStatedLinkEffect(brief, { ...DETAIL, amount: 1200.5 })).toEqual({
      admitted: true, quote: 'Each 1% price rise adds £1,200.50 a month',
    });
  });
  it('never combines figures across sentences, and rejects invalid typed fields', () => {
    expect(statedEffect.admitStatedLinkEffect('Each 1% price rise. Adds £1,200 a month.', DETAIL).admitted).toBe(false);
    for (const effect of [{ ...DETAIL, amount: NaN }, { ...DETAIL, per_source_change: 0 }, { ...DETAIL, amount_unit: '' }]) {
      expect(statedEffect.admitStatedLinkEffect(BRIEF, effect)).toEqual({ admitted: false, reason: 'invalid_effect' });
    }
  });
  it('binds the target currency and period as well as the source unit', () => {
    for (const unit of ['USD/month', '£/year', '£/subscriber/month']) {
      expect(statedEffect.admitStatedLinkEffect(BRIEF, { ...DETAIL, amount_unit: unit }).admitted).toBe(false);
    }
  });
  it('two independently validating sentences refuse ambiguous_sentence', () => {
    const sentence = 'Each 1% price rise adds £1,200 a month.';
    expect(statedEffect.admitStatedLinkEffect(`${sentence} ${sentence}`, DETAIL)).toEqual({ admitted: false, reason: 'ambiguous_sentence' });
    expect(edge(admit(candidate(), `${sentence} ${sentence}`, false), PRICE, GOAL).provenance?.magnitude).not.toBe('user_stated');
  });
  it('an unwritten figure is refused by the shared predicate and admission', () => {
    expect(statedEffect.admitStatedLinkEffect(BRIEF, { ...DETAIL, amount: 1234 })).toEqual({ admitted: false, reason: 'no_matching_sentence' });
    const original = candidate();
    const c = { ...original, links: original.links.map((l, i) => i === 0 ? { ...l, effect_amount: 1234 } : l) };
    expect(edge(admit(c, BRIEF, false), PRICE, GOAL).provenance?.magnitude).not.toBe('user_stated');
  });
  it('a source unit differing from the sentence is refused', () => {
    expect(statedEffect.admitStatedLinkEffect(BRIEF, { ...DETAIL, per_source_change_unit: 'customers' })).toEqual({ admitted: false, reason: 'no_matching_sentence' });
    const original = candidate();
    const c = { ...original, factors: original.factors.map((f, i) => i === 0 ? { ...f, unit: 'customers' } : f) };
    expect(edge(admit(c, BRIEF, false), PRICE, GOAL).provenance?.magnitude).not.toBe('user_stated');
  });
  it('two resolvable links with identical typed figures tying one sentence both refuse shared admission', () => {
    const original = candidate();
    const c = { ...original,
      factors: [...original.factors, { ...original.factors[0]!, label: 'Another price factor' }],
      links: [...original.links, { ...original.links[0]!, from: 'Another price factor' }],
    };
    const g = admit(c, BRIEF, false);
    expect(edge(g, PRICE, GOAL).provenance?.magnitude).not.toBe('user_stated');
    expect(edge(g, 'another_price_factor', GOAL).provenance?.magnitude).not.toBe('user_stated');
  });
  it('served-admitted sizes remain admitted even when shared admission declines them', () => {
    const g = admit(); const old = servedOnly();
    expect(edge(old, SWITCH, SUBS).provenance?.magnitude).toBe('user_stated');
    expect(edge(g, SWITCH, SUBS).provenance).toEqual(edge(old, SWITCH, SUBS).provenance);
  });
  it('keeps the explicit-size gate and the user_specified short-circuit', () => {
    const original = candidate();
    const inferred = { ...original, links: original.links.map((l, i) => i === 0 ? { ...l, effect_provenance: 'inferred' } : l) };
    expect(edge(admit(inferred), PRICE, GOAL).provenance?.magnitude).not.toBe('user_stated');
    const edited = { ...original, links: original.links.map((l, i) => i === 0
      ? { ...l, effect_amount: 1234, effect_provenance: 'inferred', provenance_source: 'user_specified' } : l) };
    expect(edge(admit(edited), PRICE, GOAL).provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 1234 } });
  });
  it('a later duplicate cannot downgrade the user size or replace its quote', () => {
    const original = candidate();
    const c = { ...original, links: [...original.links, { ...original.links[0]!, effect_amount: 999, effect_provenance: 'inferred' }] };
    // admission keeps both drafted edges; both must carry the preserved size and matching sentence.
    const links = admit(c).edges.filter((e) => e.from === PRICE && e.to === GOAL);
    expect(links.length).toBeGreaterThan(0);
    for (const e of links) {
      expect(e.provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: DETAIL });
      expect(e.provenance?.source_quote).toContain('£1,200');
    }
  });
  it('shared admission also earns the normalising frame reach', () => {
    const original = candidate();
    const c = { ...original, goal: { ...original.goal, value: null, target_stated: false, baseline_known: false, baseline_value: null } };
    const g = admit(c, 'Each 1% price rise adds £1,200 a month.', false);
    expect(g.nodes.find((n) => n.id === GOAL)?.scale_frame).toBe(200000);
    expect(edge(g, PRICE, GOAL).provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: DETAIL });
  });
  it('logs exactly one ids-only predicate verdict per admitted size', () => {
    const spy = vi.spyOn(log, 'info');
    try {
      admit();
      const events = spy.mock.calls.map(([data]) => data as { event?: string; from?: string; to?: string; predicate?: string })
        .filter((data) => data.event === 'agent.construct.size_admitted');
      expect(events).toHaveLength(5);
      expect(events.find((e) => e.from === PRICE && e.to === GOAL)?.predicate).toBe('stated_effect');
      expect(events.find((e) => e.from === SWITCH && e.to === SUBS)?.predicate).toBe('served');
      expect(events.find((e) => e.from === PRICE && e.to === LOSS)?.predicate).toBe('both');
      for (const e of events) expect(Object.keys(e).sort()).toEqual(['event', 'from', 'predicate', 'to']);
    } finally { spy.mockRestore(); }
  });
});
