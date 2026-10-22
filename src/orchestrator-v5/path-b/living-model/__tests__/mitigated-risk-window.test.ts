/**
 * An Olumi risk is converted to a known goal window, with its preventer intact. An unknown goal window still holds it
 * with its preventer switch and the options' settings on that switch, so nothing is stranded.
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { mapLivingModel } from '../mapper.js';
import { OLUMI_CHANCE, supplier } from './track2-f2-event-risk.fixtures.js';

type Rec = Record<string, any>;
const withPeriod = (m: LivingModelT, months: number | null): LivingModelT =>
  ({ ...m, aims: m.aims.map((a) => ({ ...a, target: a.target === null ? null : { ...a.target, period_months: months } })) });
const nodesOf = (m: LivingModelT): Rec[] => mapLivingModel(m).graph.nodes as Rec[];
const edgesOf = (m: LivingModelT): Rec[] => mapLivingModel(m).graph.edges as Rec[];
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);
const readiness = (m: LivingModelT) => {
  const a = assessCanonicalAnalysisReadiness(projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })));
  return { safe: a.safeToAnalyse, blocking: a.blockingIssues.map((i: Rec) => `${i.code}:${i.factor_id ?? ''}`) };
};

describe('a mitigated Olumi risk counts only over the goal\'s window', () => {
  it('invariance first: over the SAME window it still counts, with its preventer, exactly as before', () => {
    const m = withPeriod(OLUMI_CHANCE, 12);
    expect(nodesOf(m).find((n) => n.id === 'supplier_fails')!.event_risk).toMatchObject({ occurrence: { basis: 'olumi' },
      mitigations: [{ factor_id: 'dual_sourcing', occurrence_reduction: 0.7 }] });
    expect(nodesOf(m).find((n) => n.id === 'dual_sourcing')).toBeDefined();
    expect(edgesOf(m).some((e) => e.from === 'dual_sourcing' && e.to === 'supplier_fails')).toBe(true);
    expect(nodesOf(m).find((n) => n.id === 'dual_source')!.interventions).toHaveProperty('dual_sourcing');
    expect(reasons(m)).toEqual([]);
    expect(readiness(m)).toEqual({ safe: true, blocking: [] });
  });

  it('over a DIFFERENT known window it is converted, with its preventer and settings intact', () => {
    const m = withPeriod(OLUMI_CHANCE, 6);
    expect(nodesOf(m).find((n) => n.id === 'supplier_fails')!.event_risk).toEqual({ version: 1,
      occurrence: { basis: 'olumi', p_low: 1 - 0.95 ** 0.5, p_high: 1 - 0.85 ** 0.5 }, horizon: { months: 6 },
      mitigations: [{ factor_id: 'dual_sourcing', occurrence_reduction: 0.7 }] });
    expect(nodesOf(m).find((n) => n.id === 'dual_sourcing')).toBeDefined();
    expect(edgesOf(m).some((e) => e.from === 'dual_sourcing' && e.to === 'supplier_fails')).toBe(true);
    expect(nodesOf(m).find((n) => n.id === 'dual_source')!.interventions).toHaveProperty('dual_sourcing');
    expect(reasons(m)).toEqual([]);
    expect(readiness(m)).toEqual({ safe: true, blocking: [] });
  });

  it('and with no goal window at all (the core default today), the same: held, not counted over its own 12 months', () => {
    const m = OLUMI_CHANCE;
    expect(nodesOf(m).find((n) => n.id === 'supplier_fails')).toBeUndefined();
    expect(reasons(m)).toEqual(expect.arrayContaining(['supplier_fails:risk_window_not_goal_window', 'gp:chance_rests_on_withheld']));
    expect(readiness(m)).toEqual({ safe: true, blocking: [] });
  });

  it('the person\'s own mitigated risk (F2) is unchanged, with or without a goal window', () => {
    for (const m of [supplier('point'), withPeriod(supplier('point'), 6)]) {
      expect(nodesOf(m).find((n) => n.id === 'supplier_fails')!.event_risk.occurrence.basis).toBe('user');
      expect(nodesOf(m).find((n) => n.id === 'dual_sourcing')).toBeDefined();
      expect(reasons(m)).toEqual([]);
      expect(readiness(m)).toEqual({ safe: true, blocking: [] });
    }
  });

  it('Codex r1: a limit on the removed switch goes with it; no limit row names a node that is gone', () => {
    const m: LivingModelT = { ...OLUMI_CHANCE, factors: OLUMI_CHANCE.factors.map((f) => (f.id === 'dual_sourcing'
      ? { ...f, limit: { comparator: '<=', value: 1, source: 'user', party: null, quote: 'we single-source today' } } : f)) } as LivingModelT;
    const g = mapLivingModel(withPeriod(m, null)).graph as Rec;
    expect(g.nodes.find((n: Rec) => n.id === 'dual_sourcing')).toBeUndefined();
    expect((g.goal_constraints ?? []).filter((c: Rec) => c.node_id === 'dual_sourcing')).toEqual([]);
    // Over the goal's own window the switch and its limit stay.
    const kept = mapLivingModel(withPeriod(m, 12)).graph as Rec;
    expect((kept.goal_constraints ?? []).some((c: Rec) => c.node_id === 'dual_sourcing')).toBe(true);
  });

  it('with an unknown window and mitigation the ONLY difference, the Run is refused, with risk and switch named as held', () => {
    const only: LivingModelT = { ...OLUMI_CHANCE, links: OLUMI_CHANCE.links.filter((l) => l.id !== 'cost_gp') };
    const m = withPeriod(only, null);
    expect(reasons(m)).toEqual(expect.arrayContaining(['supplier_fails:risk_window_not_goal_window', 'dual_sourcing:risk_window_not_goal_window']));
    expect(readiness(m).safe).toBe(false);
  });

  it('Codex r1: a switch that is also a part of a definition stays, so the definition never names a node that is gone', () => {
    const m: LivingModelT = { ...OLUMI_CHANCE, factors: [...OLUMI_CHANCE.factors,
      { estimate_by: null, kind: 'factor', limit: null, id: 'insurance', label: 'Insurance in place', value: 1, low: null, high: null, unit: null,
        defined_as: null, source: 'user', party: null, quote: 'we are insured' },
      { estimate_by: null, kind: 'factor', limit: null, id: 'cover', label: 'Supply cover', value: 1, low: null, high: null, unit: null,
        defined_as: { op: 'sum', of: ['dual_sourcing', 'insurance'], source: 'user', party: null, quote: 'cover is dual sourcing plus insurance' },
        source: 'user', party: null, quote: 'cover is dual sourcing plus insurance' }] } as LivingModelT;
    const g = mapLivingModel(withPeriod(m, null)).graph as Rec;
    expect(g.nodes.find((n: Rec) => n.id === 'supplier_fails')).toBeUndefined();
    expect(g.nodes.find((n: Rec) => n.id === 'dual_sourcing')).toBeDefined();
    const ids = (g.nodes as Rec[]).map((n) => n.id);
    for (const n of g.nodes as Rec[]) for (const part of n.nonlinear_identity?.factor_ids ?? []) expect(ids).toContain(part);
  });

  it('Codex r2: no line about the removed switch\'s figure reaches the AI', () => {
    const ranged: LivingModelT = { ...OLUMI_CHANCE, factors: OLUMI_CHANCE.factors.map((f) => (f.id === 'dual_sourcing' ? { ...f, low: 0, high: 1 } : f)) };
    expect(mapLivingModel(withPeriod(ranged, null)).assumed.filter((a) => a.id === 'dual_sourcing')).toEqual([]);
    // Over the goal's own window the switch stays, and so does what is said about its figure.
    expect(mapLivingModel(withPeriod(ranged, 12)).assumed.some((a) => a.id === 'dual_sourcing')).toBe(true);
  });
});
