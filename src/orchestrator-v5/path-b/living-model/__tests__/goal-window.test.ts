/**
 * DL ruling 22 Oct (goal-window carrier): the person's own duration counted from today ("within 12 months") is the goal's
 * window, held as Olumi's reading (`goal_target_basis`, effects_at_period_end false). Olumi's risk chance over that SAME window
 * then counts (`riskOccurrenceWindowMonths`); the goal's chance stays the static reading, with no window claimed for it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { goalChanceLicenceOf } from '../../../goal-target/goal-chance-licence.js';
import { goalHorizonVerdict } from '../../../goal-target/goal-horizon-verdict.js';
import { isLicensedChanceLine, licensedChancesOf } from '../../../agent-lane/licensed-chance-lines.js';
import { mapLivingModel } from '../mapper.js';
import { OLUMI_CHANCE, supplier } from './track2-f2-event-risk.fixtures.js';

type Rec = Record<string, any>;
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const withPeriod = (m: LivingModelT, months: number | null): LivingModelT =>
  ({ ...m, aims: m.aims.map((a) => ({ ...a, target: a.target === null ? null : { ...a.target, period_months: months } })) });
const bare = (m: LivingModelT): LivingModelT => ({ ...m, options: m.options.map((o) => ({ ...o, settings: [] })), factors: [],
  risks: m.risks.map((r) => ({ ...r, mitigations: [] })) });
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);
const readiness = (m: LivingModelT) => {
  const a = assessCanonicalAnalysisReadiness(projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })));
  return { safe: a.safeToAnalyse, blocking: a.blockingIssues.map((i: Rec) => `${i.code}:${i.factor_id ?? ''}`) };
};

/** The served F2 capture (21 Oct), its goal given the window exactly as the mapper writes it. */
const cap = JSON.parse(readFileSync(new URL('../../../../../tests/fixtures/track2-f2/served-f2-supplier-risk-20261021T222244Z.json', import.meta.url), 'utf8'));
const servedWithWindow = (): Rec => {
  const g: Rec = structuredClone(cap.graph);
  const goal = goalOf(g);
  goal.goal_target_basis = goalOf(mapLivingModel(withPeriod(supplier('point'), 12)).graph).goal_target_basis;
  goal.goal_target_basis.target_raw = goal.goal_threshold_raw;
  goal.goal_target_basis.effect_unit = goal.goal_threshold_unit;
  return g;
};

describe('the goal window: the person\'s stated months, read as Olumi\'s, counted for a risk over the same window', () => {
  it('invariance: a model saved before the field, and one with no months stated, map exactly as before', () => {
    const before = supplier('point');
    expect(mapLivingModel(withPeriod(before, null))).toEqual(mapLivingModel(before));
    expect(goalOf(mapLivingModel(before).graph as never)).not.toHaveProperty('goal_target_basis');
  });

  it('the stated months add ONLY the window on the goal (Olumi\'s reading, effects not read as in place by its end)', () => {
    const plain = mapLivingModel(supplier('point'));
    const windowed = mapLivingModel(withPeriod(supplier('point'), 12));
    const { goal_target_basis: basis, ...rest } = goalOf(windowed.graph as never);
    expect(basis).toEqual({ source: 'olumi_reading', quantity_frame: 'level', target_frame: 'level', target_raw: 12000, reference: 'today',
      period_months: 12, period_kind: 'at_end', effect_unit: '£', effects_at_period_end: false });
    expect(rest).toEqual(goalOf(plain.graph as never));
    expect({ ...windowed, graph: { ...windowed.graph, nodes: windowed.graph.nodes.map((n) => (n.kind === 'goal' ? rest : n)) } }).toEqual(plain);
  });

  it('served F2 invariance: same verdict, same chance and words; only the licence\'s target frame is named', () => {
    const lic = (g: Rec) => goalChanceLicenceOf(structuredClone(cap.envelope), g, 'gross_profit_floor', () => false, undefined, g, {}) as Rec;
    const plain = structuredClone(cap.graph);
    const windowed = servedWithWindow();
    expect(goalHorizonVerdict(plain, cap.envelope)).toBe('no_horizon');
    expect(goalHorizonVerdict(windowed, cap.envelope)).toBe('no_horizon');
    const { frame, ...target } = lic(windowed).target;
    expect(frame).toBe('level');
    expect({ ...lic(windowed), target }).toEqual(lic(plain));
  });

  it('DL ruling: a chance sentence naming the window is still refused; the plain chance sentence is still accepted', () => {
    const labels = ['Carry on as now', 'Dual-source the part'];
    const chances = licensedChancesOf(cap.envelope, servedWithWindow(), true);
    expect(chances).not.toHaveProperty('periodMonths');
    expect(isLicensedChanceLine('Dual-source the part has about 97% chance of meeting the goal.', chances, labels)).toBe(true);
    expect(isLicensedChanceLine('Within 12 months, Dual-source the part has about 97% chance of meeting the goal.', chances, labels)).toBe(false);
  });

  it('zero flip (Codex r1): a CHANGE target read at its period\'s end keeps naming that period, with no held month', () => {
    const g: Rec = structuredClone(cap.graph);
    const goal = goalOf(g);
    goal.goal_threshold_frame = 'change_abs';
    goal.goal_target_basis = { source: 'olumi_reading', quantity_frame: 'level', target_frame: 'change_abs', target_raw: goal.goal_threshold_raw,
      reference: 'today', denominator: 'today\'s level', period_months: 3, period_kind: 'at_end', effect_unit: goal.goal_threshold_unit,
      effects_at_period_end: false };
    expect(goalOf(g)).not.toHaveProperty('goal_horizon_months');
    expect(licensedChancesOf(cap.envelope, g, true)).toMatchObject({ periodMonths: 3 });
  });

  it('an Olumi risk over the goal\'s window counts: its node is kept and the Run is ready', () => {
    const m = withPeriod(bare(OLUMI_CHANCE), 12);
    expect((mapLivingModel(m).graph.nodes as Rec[]).find((n) => n.id === 'supplier_fails')!.event_risk.occurrence.basis).toBe('olumi');
    expect(reasons(m)).toEqual([]);
    expect(readiness(m)).toEqual({ safe: true, blocking: [] });
  });

  it('contrast: over a different window it is still held, and the goal\'s chance withheld', () => {
    const m = withPeriod(bare(OLUMI_CHANCE), 6);
    expect(reasons(m)).toEqual(['supplier_fails:risk_window_not_goal_window', 'gp:chance_rests_on_withheld']);
    expect(readiness(m)).toEqual({ safe: true, blocking: [] });
  });

  it('a change target is not covered yet: no window is written for it', () => {
    const change: LivingModelT = withPeriod({ ...supplier('point'), aims: supplier('point').aims.map((a) => ({ ...a,
      target: { ...a.target!, comparator: 'increase', value: 2000, change_kind: 'absolute', current: 16000 } })) }, 12);
    expect(goalOf(mapLivingModel(change).graph as never)).not.toHaveProperty('goal_target_basis');
  });
});
