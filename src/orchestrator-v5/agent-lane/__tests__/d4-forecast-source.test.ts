/**
 * D4 (c)(1) (post-F; DL ruling 12 Oct): the derived net rate of a goal-net carrier carries the brief's OWN forecast sentence as
 * its source: `observed_state.forecast_source = {quote, origin: 'brief'}`, a CEE-only passthrough (the `extra_share_by_date`
 * precedent), read only through the provenance authority (`forecastSourceOf`). Olumi's derived figure stays Olumi's: no
 * human source, no `baseline_evidence`, and the analysis hash does not move.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { forecastSourceOf } from '../../../cee/provenance/provenance-of.js';
import { briefForecastSentence } from '../verified-option-setting.js';
import { admitAccumulationIdentities, withAdmittedAccumulations, withForecastSources } from '../accumulation-identity.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const fx = JSON.parse(readFileSync(new URL('./fixtures/t6-d4-drafts.json', import.meta.url), 'utf8')) as { brief: string; drafts: { raw_text: string }[] };
// Design brief (diagnosis only, never proof for the original): the horizon worded so the EXISTING route holds 3 months.
const DESIGN = fx.brief.replace('next quarter', 'in 3 months').replace('by the end of that quarter', 'by the end of month 3');
const FORECAST = 'Without a change, we expect it to reach 10 weeks in 3 months.';
const NET = 'No-change cycle increase per month';
function carrierDraft(): Rec {
  const m = JSON.parse(fx.drafts[1]!.raw_text) as Rec;
  m.factors = m.factors.filter((f: Rec) => !/no-change/i.test(f.label));
  m.factors.push({ label: 'Median delivery cycle today', role: 'observable', baseline_known: true, baseline_evidence: null, baseline_value: 8, unit: 'weeks', provenance: 'explicit', plausible_max: 20 });
  m.factors.push({ label: NET, role: 'external', baseline_known: false, baseline_evidence: null, baseline_value: 2 / 3, unit: 'weeks per month', provenance: 'inferred', plausible_max: 5 });
  m.links = m.links.filter((l: Rec) => !/no-change/i.test(l.from));
  m.links.push({ from: 'Median delivery cycle today', to: 'median delivery cycle', direction: 'positive', provenance: 'inferred', effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'inferred', definitional: true, basis: null });
  m.links.push({ from: NET, to: 'median delivery cycle', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null });
  m.identities = [{ outcome: 'median delivery cycle', operation: 'accumulation', factors: ['Median delivery cycle today', NET], provenance: 'inferred', reading: 'net' }];
  return m;
}
async function registered(brief: string): Promise<Rec> {
  let graph: Rec | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = GraphV3.parse((body as Rec).graph) as Rec; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const call = (async () => ({ text: JSON.stringify(carrierDraft()) })) as unknown as CallStructuredModel;
  const r = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', brief, dispatch, call) as Rec;
  expect(r.ok).toBe(true);
  return graph!;
}
const netOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.label === NET);

describe('the derived net rate carries the brief\'s own forecast sentence, through the stored graph', () => {
  it('design brief: the carrier is admitted; the rate holds the sentence writing today + net × T (8 + 2/3 × 3 = 10 weeks)', async () => {
    const g = await registered(DESIGN);
    expect(g.nodes.some((n: Rec) => n.nonlinear_identity?.operation === 'accumulation')).toBe(true);
    expect(netOf(g).observed_state.forecast_source).toEqual({ quote: FORECAST, origin: 'brief' });
    expect(forecastSourceOf(netOf(g))).toEqual({ quote: FORECAST, origin: 'brief' });
  });
  it('it stays Olumi\'s derived figure: its own source is unchanged and no human evidence is written', async () => {
    const g = await registered(DESIGN);
    expect(netOf(g).observed_state.source).toBe('cee_inference');
    expect(JSON.stringify(netOf(g))).not.toContain('baseline_evidence');
  });
  it('display only: the analysis hash is the same with or without it', async () => {
    const g = await registered(DESIGN);
    const without = structuredClone(g);
    delete netOf(without).observed_state.forecast_source;
    expect(computeAnalysisAffectingGraphHash(g as never)).toBe(computeAnalysisAffectingGraphHash(without as never));
  });
  it('NEGATIVE: the brief as written (no horizon held, so no carrier) binds nothing', async () => {
    const g = await registered(fx.brief);
    expect(JSON.stringify(g)).not.toContain('forecast_source');
  });
});

describe('the sentence is bound by the figure\'s identity; anything else binds nothing', () => {
  const brief = 'Our current median delivery cycle is 8 weeks. Without a change, we expect it to reach 10 weeks in 3 months.';
  it('the one sentence writing 10 weeks, which follows the sentence naming the goal', () => {
    expect(briefForecastSentence('median delivery cycle', 'weeks', 10, brief)).toBe('Without a change, we expect it to reach 10 weeks in 3 months.');
  });
  it('NEGATIVE: another figure (11) is no forecast of this carrier', () => {
    expect(briefForecastSentence('median delivery cycle', 'weeks', 11, brief)).toBeUndefined();
  });
  it('NEGATIVE: two forecast sentences writing 10 weeks → ambiguous → none', () => {
    expect(briefForecastSentence('median delivery cycle', 'weeks', 10, `${brief} We expect the median delivery cycle to be 10 weeks by then.`)).toBeUndefined();
  });
  it('a past report of the same figure is no forecast, so it does not compete', () => {
    expect(briefForecastSentence('median delivery cycle', 'weeks', 10, `${brief} The median delivery cycle hit 10 weeks once before.`)).toBe(FORECAST);
  });
  it.each([
    ['a negated expectation', 'Our current median delivery cycle is 8 weeks. We do not expect it to reach 10 weeks in 3 months.'],
    ['a conditional expectation', 'Our current median delivery cycle is 8 weeks. If we hire, we expect it to reach 10 weeks in 3 months.'],
    ['an expected bound', 'Our current median delivery cycle is 8 weeks. We expect it to stay below 10 weeks in 3 months.'],
    ['a figure with no expectation word', 'Our current median delivery cycle is 8 weeks. It reaches 10 weeks in 3 months.'],
  ])('NEGATIVE: %s → none', (_, text) => {
    expect(briefForecastSentence('median delivery cycle', 'weeks', 10, text)).toBeUndefined();
  });
  it('NEGATIVE: a sentence that neither names the goal nor follows one that does → none', () => {
    expect(briefForecastSentence('median delivery cycle', 'weeks', 10, 'Hiring takes 10 weeks. Our current median delivery cycle is 8 weeks.')).toBeUndefined();
  });
  it('NEGATIVE: the figure as an aim ("we want it at 10 weeks") is no forecast', () => {
    expect(briefForecastSentence('median delivery cycle', 'weeks', 10, 'Our current median delivery cycle is 8 weeks. We want to get it to 10 weeks.')).toBeUndefined();
  });
});

describe('only a DERIVED rate is a forecast\'s conversion: a monthly change a person stated carries no forecast source', () => {
  it('a stated monthly change (the user\'s +2/3 a month) → nothing written', () => {
    const nodes: Rec[] = [
      { id: 'cycle', kind: 'goal', label: 'Median delivery cycle', goal_horizon_months: 3, goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.15, goal_threshold_unit: 'weeks',
        observed_state: { value: 0.4, baseline: 0.4, raw_value: 8, cap: 20, unit: 'weeks', source: 'brief_extraction' } },
      { id: 'today', kind: 'factor', label: 'Median delivery cycle today', observed_state: { value: 0.4, raw_value: 8, cap: 20, unit: 'weeks', source: 'brief_extraction' } },
      { id: 'drift', kind: 'factor', label: NET, observed_state: { value: 0.1333, raw_value: 2 / 3, cap: 5, unit: 'weeks per month', source: 'brief_extraction', extractionType: 'explicit' } },
    ];
    const edges = [{ from: 'today', to: 'cycle' }, { from: 'drift', to: 'cycle' }];
    const admission = admitAccumulationIdentities(nodes as never, edges, [{ outcome: 'Median delivery cycle', operation: 'accumulation',
      factors: ['Median delivery cycle today', NET], reading: 'net', provenance: 'explicit' }] as never);
    const graph = withAdmittedAccumulations(nodes as never, edges, admission);
    const out = withForecastSources(graph as never, admission, () => 'Without a change, we expect it to reach 10 weeks in 3 months.');
    expect(out).toBe(graph);
  });
});
