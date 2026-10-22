/**
 * DL lease 22 Oct (candidate 4b, Track 3 RISK-BLOCKERS-4b-Q2: Q2 Run ok 4/8 → 0/14). Readiness counts Olumi's chance for a
 * risk only over the goal's current window (`riskOccurrenceIsCurrent`), and asks for a level on a ROOT that lacks one. A
 * core goal has no window in months, so an unmitigated Olumi risk (a root) blocked every Run as "this risk has no figure".
 * The mapper now holds that risk by the SAME predicate (`risk_window_not_goal_window`): no node, no links, the chance on
 * the goal withheld (never computed on less), and the Run proceeds. A mitigated risk and the person's own are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { riskOccurrenceIsCurrent } from '../../../agent-lane/risk-occurrence.js';
import { mapLivingModel } from '../mapper.js';
import { OLUMI_CHANCE, supplier } from './track2-f2-event-risk.fixtures.js';

type Rec = Record<string, any>;
const node = (g: { nodes: Rec[] }, id: string) => g.nodes.find((n) => n.id === id) as Rec | undefined;
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);
const readiness = (m: LivingModelT) => {
  const a = assessCanonicalAnalysisReadiness(projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })));
  return { safe: a.safeToAnalyse, blocking: a.blockingIssues.map((i: Rec) => `${i.code}:${i.factor_id ?? ''}`) };
};
/** A risk with no mitigation (a root), the goal with no window in months: the Q2 shape. */
const bare = (m: LivingModelT): LivingModelT => ({ ...m, options: m.options.map((o) => ({ ...o, settings: [] })), factors: [],
  risks: m.risks.map((r) => ({ ...r, mitigations: [] })) });

describe('an Olumi chance off the goal\'s window is held, so the Run is not refused as "no figure"', () => {
  it('Q2 shape: an unmitigated Olumi risk over 12 months, a goal with no window → no node, the held reason, a Run-ready model', () => {
    const { graph } = mapLivingModel(bare(OLUMI_CHANCE));
    expect(node(graph as never, 'supplier_fails')).toBeUndefined();
    expect((graph.edges as Rec[]).filter((e) => e.from === 'supplier_fails' || e.to === 'supplier_fails')).toEqual([]);
    expect(reasons(bare(OLUMI_CHANCE))).toEqual(['supplier_fails:risk_window_not_goal_window', 'gp:chance_rests_on_withheld']);
    expect(readiness(bare(OLUMI_CHANCE))).toEqual({ safe: true, blocking: [] });
  });

  it('contrast: the person\'s own unmitigated risk keeps its node, and the Run is ready', () => {
    const { graph } = mapLivingModel(bare(supplier('point')));
    expect(node(graph as never, 'supplier_fails')!.event_risk.occurrence.basis).toBe('user');
    expect(reasons(bare(supplier('point')))).toEqual([]);
    expect(readiness(bare(supplier('point')))).toEqual({ safe: true, blocking: [] });
  });

  it('contrast at the shared predicate: the same Olumi risk is current once the goal holds a 12-month window', () => {
    const { graph } = mapLivingModel(bare(supplier('point')));
    const olumi = { ...node(graph as never, 'supplier_fails')!, event_risk: { ...node(graph as never, 'supplier_fails')!.event_risk,
      occurrence: { ...node(graph as never, 'supplier_fails')!.event_risk.occurrence, basis: 'olumi' } } };
    const withWindow = { ...graph, nodes: (graph.nodes as Rec[]).map((n) => (n.kind === 'goal' ? { ...n, goal_horizon_months: 12 } : n)) };
    expect(riskOccurrenceIsCurrent(olumi, withWindow)).toBe(true);
    expect(riskOccurrenceIsCurrent(olumi, graph)).toBe(false);
  });

  // DL ruling 23 Oct (mitigated-risk window): a mitigated Olumi risk now counts only over the goal's window, held with its
  // preventer otherwise (mitigated-risk-window.test.ts). Over the goal's own 12 months it maps and readies as before.
  it('invariance: a mitigated Olumi risk over the goal\'s window, and F2 (the person\'s, mitigated), map and ready as before', () => {
    const windowed: LivingModelT = { ...OLUMI_CHANCE, aims: OLUMI_CHANCE.aims.map((a) => ({ ...a, target: { ...a.target!, period_months: 12 } })) };
    expect(node(mapLivingModel(windowed).graph as never, 'supplier_fails')!.event_risk.occurrence.basis).toBe('olumi');
    expect(reasons(windowed)).toEqual([]);
    expect(readiness(windowed)).toEqual({ safe: true, blocking: [] });
    expect(node(mapLivingModel(supplier('point')).graph as never, 'supplier_fails')!.event_risk.occurrence.basis).toBe('user');
    expect(reasons(supplier('point'))).toEqual([]);
    expect(readiness(supplier('point'))).toEqual({ safe: true, blocking: [] });
  });
});
