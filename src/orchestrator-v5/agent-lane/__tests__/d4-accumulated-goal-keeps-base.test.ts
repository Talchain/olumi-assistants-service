/**
 * D4 (b) (post-F; DL route (i′), 12 Oct): a goal worked out by the accumulation carrier keeps TODAY'S level when its target
 * is a change from today ("15% below today's 8"), because ISL reads a change target's base only from the goal node. It was
 * stripped, so `targetTestabilityOf` failed P1 `missing_goal_baseline` and the 6.8 target could never be tested. A LEVEL
 * target needs no base: its strip is unchanged, byte for byte. CEE half only; it ships with ISL's (i′) change origin (an
 * accumulation-dependent target's change is read from its stated level today), never before.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { admitAccumulationIdentities, withAdmittedAccumulations } from '../accumulation-identity.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const TODAY = { value: 0.4, baseline: 0.4, raw_value: 8, cap: 20, unit: 'weeks', source: 'brief_extraction' };
function admitted(frame: string | undefined): Rec[] {
  const nodes: Rec[] = [
    { id: 'cycle', kind: 'goal', label: 'Median delivery cycle', observed_state: { ...TODAY }, goal_horizon_months: 3,
      ...(frame === undefined ? {} : { goal_threshold_frame: frame, goal_threshold_raw: frame === 'level' ? 6.8 : -0.15 }) },
    { id: 'today', kind: 'factor', label: 'Median delivery cycle today', observed_state: { value: 0.4, raw_value: 8, cap: 20, unit: 'weeks', source: 'brief_extraction' } },
    { id: 'drift', kind: 'factor', label: 'No-change cycle increase per month', observed_state: { value: 0.1333, raw_value: 2 / 3, cap: 5, unit: 'weeks per month', source: 'cee_inference' } },
  ];
  const edges = [{ from: 'today', to: 'cycle' }, { from: 'drift', to: 'cycle' }];
  const admission = admitAccumulationIdentities(nodes as never, edges, [{ outcome: 'Median delivery cycle', operation: 'accumulation',
    factors: ['Median delivery cycle today', 'No-change cycle increase per month'], reading: 'net', provenance: 'inferred' }] as never);
  expect(admission.loss).toEqual([]);
  return withAdmittedAccumulations(nodes as never, edges, admission).nodes as Rec[];
}
const goal = (nodes: Rec[]): Rec => nodes.find((n) => n.kind === 'goal')!;

describe('the accumulated goal keeps today\'s base exactly where its target is a change from today', () => {
  it.each(['change_rel', 'change_abs'])('%s: today\'s level is kept, exactly as stated, beside the derived sum', (frame) => {
    const g = goal(admitted(frame));
    expect(g.observed_state).toEqual(TODAY);
    expect(g.nonlinear_identity).toEqual({ operation: 'sum', factor_ids: ['cycle_at_month_3'], stated_in_brief: false });
  });
  it.each([['level'], [undefined]])('CONTROL (%s): a level target (or none) keeps today\'s strip, byte for byte', (frame) => {
    const g = goal(admitted(frame));
    expect(g).not.toHaveProperty('observed_state');
    expect(g.nonlinear_identity).toEqual({ operation: 'sum', factor_ids: ['cycle_at_month_3'], stated_in_brief: false });
  });
});

describe('through the real construction: the 6.8 target is testable against today\'s 8 (design brief, diagnosis only)', () => {
  // T6's r2 D4 draft, edited to declare the net carrier; the brief's horizon worded "in 3 months" so the EXISTING route holds
  // it. Never proof for the original brief (DL: its horizon is the end of the next calendar quarter).
  const fx = JSON.parse(readFileSync(new URL('./fixtures/t6-d4-drafts.json', import.meta.url), 'utf8')) as { brief: string; drafts: { raw_text: string }[] };
  const brief = fx.brief.replace('next quarter', 'in 3 months').replace('by the end of that quarter', 'by the end of month 3');
  const draft = (): Rec => {
    const m = JSON.parse(fx.drafts[1]!.raw_text) as Rec;
    m.factors = m.factors.filter((f: Rec) => !/no-change/i.test(f.label));
    m.factors.push({ label: 'Median delivery cycle today', role: 'observable', baseline_known: true, baseline_evidence: null, baseline_value: 8, unit: 'weeks', provenance: 'explicit', plausible_max: 20 });
    m.factors.push({ label: 'No-change cycle increase per month', role: 'external', baseline_known: false, baseline_evidence: null, baseline_value: 2 / 3, unit: 'weeks per month', provenance: 'inferred', plausible_max: 5 });
    m.links = m.links.filter((l: Rec) => !/no-change/i.test(l.from));
    m.links.push({ from: 'Median delivery cycle today', to: 'median delivery cycle', direction: 'positive', provenance: 'inferred', effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'inferred', definitional: true, basis: null });
    m.links.push({ from: 'No-change cycle increase per month', to: 'median delivery cycle', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null });
    m.identities = [{ outcome: 'median delivery cycle', operation: 'accumulation', factors: ['Median delivery cycle today', 'No-change cycle increase per month'], provenance: 'inferred', reading: 'net' }];
    return m;
  };
  it('the carrier is admitted; the goal keeps today\'s 8; target testability no longer fails P1 missing_goal_baseline', async () => {
    let registered: Rec | undefined;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) { registered = (body as Rec).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    };
    const call = (async () => ({ text: JSON.stringify(draft()) })) as unknown as CallStructuredModel;
    const r = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', brief, dispatch, call) as Rec;
    expect(r.ok).toBe(true);
    const g = goal(registered!.nodes);
    expect(g.nonlinear_identity?.operation).toBe('sum');
    expect([g.observed_state?.raw_value, g.goal_threshold_frame, g.goal_threshold]).toEqual([8, 'change_rel', -0.15]);
    const verdict = targetTestabilityOf(registered) as Rec;
    expect(JSON.stringify(verdict)).not.toContain('missing_goal_baseline');
  });
});
