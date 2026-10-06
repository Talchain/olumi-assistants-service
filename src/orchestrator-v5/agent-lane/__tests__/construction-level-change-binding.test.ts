/**
 * ⭐ THE REAL COMMIT DOOR: a level change stated in the brief is the user's size, WITH their sentence (MC, DL bench
 * DIAGNOSIS §2a, 6 Oct 2026). The candidate is served draft acc__cut5-investor-stg3 (CEE 6ce136c), read back from its
 * registered graph by the DL bench's construction-arm reader (a switch's unset `plausible_max` written as 1, as the
 * schema needs); the brief is that draft's own. At staging 5a586cb9 both switch links registered as `olumi_estimate`
 * with no quote, so Olumi asked for the win-rate lift and the abandonment cut the user had already written.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const INV = 'We are a B2B SaaS company with £2.4M quarterly revenue. Option A: build the AI reporting module — enterprise prospects '
  + 'tell us it would lift our enterprise win rate from 20% to about 30%. Option B: fix the integration-step bug — about 30% '
  + 'of trial users abandon at that step today, and fixing it should roughly halve that. Option C: carry on with the current '
  + 'roadmap. Goal: grow quarterly revenue to £2.8M.';
const INV_A = 'Option A: build the AI reporting module — enterprise prospects tell us it would lift our enterprise win rate from 20% to about 30%.';
const INV_B = 'Option B: fix the integration-step bug — about 30% of trial users abandon at that step today, and fixing it should roughly halve that.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Dir = 'positive' | 'negative';
const link = (from: string, to: string, direction: Dir, amount: number, per: number, provenance = 'inferred', definitional = false) =>
  ({ from, to, direction, provenance, effect_amount: amount, effect_per_source_change: per, effect_provenance: 'ai_proposed', ...(definitional ? { definitional: true } : {}) });
const set = (factor_label: string, value: number, unit: string) => ({ factor_label, value, value_kind: 'absolute', unit, provenance: 'ai_proposed' });
const factor = (label: string, role: string, known: boolean, value: number, unit: string, provenance: string, max: number | null) =>
  ({ label, role, baseline_known: known, baseline_value: value, unit, provenance, plausible_max: max });

/** acc__cut5-investor-stg3, as its registered graph reads back (bench construction arm `candidateFromGraph`). */
const STG3 = {
  goal: { metric: 'quarterly revenue', operator: '>=', target_stated: true, frame: 'level', value: 2800000, unit: '£/quarter', horizon_months: null,
    provenance: 'explicit', baseline_known: true, baseline_value: 2400000, baseline_provenance: 'explicit', scope: null },
  constraints: [],
  options: [
    { label: 'Build AI reporting', provenance: 'explicit', interventions: [set('AI reporting availability', 1, ''), set('AI reporting delivery effort', 25, 'engineer-weeks/quarter')], changes: [], is_status_quo: null },
    { label: 'Fix integration bug', provenance: 'explicit', interventions: [set('Integration bug fixed', 1, ''), set('Integration bug-fix effort', 5, 'engineer-weeks/quarter')], changes: [], is_status_quo: null },
    { label: 'Current roadmap', provenance: 'explicit', interventions: [], changes: [], is_status_quo: true },
  ],
  factors: [
    factor('AI reporting availability', 'controllable', false, 0, 'binary', 'inferred', 1),
    factor('AI reporting delivery effort', 'controllable', false, 0, 'engineer-weeks/quarter', 'inferred', 100),
    factor('Enterprise win rate', 'observable', true, 20, '%', 'explicit', 100),
    factor('Integration bug fixed', 'controllable', false, 0, 'binary', 'inferred', 1),
    factor('Integration bug-fix effort', 'controllable', false, 0, 'engineer-weeks/quarter', 'inferred', 100),
    factor('Integration-step abandonment', 'observable', true, 30, '%', 'explicit', 100),
  ],
  risks: [{ label: 'Revenue lost to roadmap disruption', provenance: 'inferred', unit: '£/quarter', plausible_max: 500000 }],
  outcomes: [],
  links: [
    link('AI reporting delivery effort', 'AI reporting availability', 'positive', 0.125, 25),
    link('AI reporting availability', 'Enterprise win rate', 'positive', 10, 1, 'explicit'),
    link('Enterprise win rate', 'quarterly revenue', 'positive', 20000, 1),
    link('Integration bug-fix effort', 'Integration bug fixed', 'positive', 0.025, 5),
    link('Integration bug fixed', 'Integration-step abandonment', 'negative', -15, 1),
    link('Integration-step abandonment', 'quarterly revenue', 'negative', -5000, 1),
    link('AI reporting delivery effort', 'Revenue lost to roadmap disruption', 'positive', 2000, 1),
    link('Integration bug-fix effort', 'Revenue lost to roadmap disruption', 'positive', 2000, 1),
    link('Revenue lost to roadmap disruption', 'quarterly revenue', 'negative', -1, 1, 'inferred', true),
  ],
  identities: [],
  unknowns: [],
  decision_question: null,
};

type Edge = Record<string, any>;
async function build(wire: Record<string, unknown>, brief = INV): Promise<(from: string, to: string) => Edge> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: { nodes: Edge[]; edges: Edge[] } | null = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: { nodes: Edge[]; edges: Edge[] } }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('1e7e1c4a-0000-4000-8000-00000001e7e1', brief, dispatch, call) as { ok: boolean };
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const g = registered!;
  const idOf = (l: string) => g.nodes.find((n) => n.label === l)!.id;
  return (from, to) => g.edges.find((e) => e.from === idOf(from) && e.to === idOf(to))!;
}

describe('construction: a stated level change is the user\'s size, with their sentence', () => {
  it('RED: "from 20% to about 30%" registers +10 percentage points on ‘Enterprise win rate’ as the user\'s, quoted', async () => {
    const edge = await build(STG3);
    expect(edge('AI reporting availability', 'Enterprise win rate').provenance).toMatchObject({
      magnitude: 'user_stated', source_quote: INV_A,
      natural_effect: { amount: 10, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'switch' },
    });
  });

  it('RED: "roughly halve that" (of about 30%) registers −15 percentage points on the abandonment, quoted', async () => {
    const edge = await build(STG3);
    expect(edge('Integration bug fixed', 'Integration-step abandonment').provenance).toMatchObject({
      magnitude: 'user_stated', source_quote: INV_B,
      natural_effect: { amount: -15, amount_unit: 'percentage points' },
    });
  });

  it('CONTROL: a drafted +50 (the relative reading of 20% → 30%) is never the user\'s and carries no quote', async () => {
    const wire = { ...STG3, links: STG3.links.map((l) => (l.to === 'Enterprise win rate' ? { ...l, effect_amount: 50 } : l)) };
    const p = (await build(wire))('AI reporting availability', 'Enterprise win rate').provenance;
    expect(p.magnitude).not.toBe('user_stated');
    expect(p.source_quote).toBeUndefined();
  });

  it('CONTROL: with no level written ("would lift our enterprise win rate."), the +10 stays Olumi\'s', async () => {
    const p = (await build(STG3, INV.replace(' from 20% to about 30%', '')))('AI reporting availability', 'Enterprise win rate').provenance;
    expect(p.magnitude).not.toBe('user_stated');
    expect(p.source_quote).toBeUndefined();
  });
});
