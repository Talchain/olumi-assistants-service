/**
 * Codex r6 on #3522: a stated deadline lost its effect on the core path. The mapper kept `by_when` as display words only, so
 * a goal "by 2027-04-12" read `no_horizon` (a chance on today's numbers) where the legacy lane, holding the same deadline in
 * `goal_horizon.deadline` (`goal-horizon-write.ts`), withholds it. The core goal now holds it the same way, read by the
 * existing parser (`deadline-date.ts`), so the existing licence gives the legacy reason. No new timing science.
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { goalHorizonVerdict } from '../../../goal-target/goal-horizon-verdict.js';
import { goalHorizonWithholdDetail } from '../../../goal-target/goal-horizon-detail.js';
import { applyGoalHorizonEdit } from '../../../goal-target/goal-horizon-write.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
const byWhen = (when: string | null): LivingModelT => {
  const m = structuredClone(KNOWN_ANSWER);
  m.aims[0] = { ...m.aims[0]!, target: { ...m.aims[0]!.target!, by_when: when } };
  return m;
};
const stored = (m: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Rec;
/** The legacy lane on the SAME model: the goal's deadline written by its one writer, as after the user's Yes on the date card. */
const legacy = (deadline: string): Rec => {
  const r = applyGoalHorizonEdit(stored(byWhen(null)), { goal_id: 'g', deadline, expected_deadline: null });
  if (r.kind !== 'mutated') throw new Error(r.kind);
  return r.mutatedGraph;
};
const reason = (g: Rec) => ({ verdict: goalHorizonVerdict(g), detail: goalHorizonWithholdDetail(g) });

describe('a stated deadline holds on the core goal as it does on the legacy one', () => {
  it('"2027-04-12": core and legacy withhold for the same reason', () => {
    const core = stored(byWhen('2027-04-12'));
    expect((core.nodes as Rec[]).find((n) => n.id === 'g')).toMatchObject({ goal_horizon: { deadline: '2027-04-12' }, goal_deadline_as_stated: '2027-04-12' });
    expect(reason(core)).toEqual(reason(legacy('2027-04-12')));
    expect(reason(core).verdict).toBe('withhold');
  });

  it('a date in words, with its year, is the same deadline: "by 12 April 2027", "end of Q2 2027"', () => {
    expect(reason(stored(byWhen('by 12 April 2027')))).toEqual(reason(legacy('2027-04-12')));
    expect(reason(stored(byWhen('end of Q2 2027')))).toEqual(reason(legacy('2027-06-30')));
  });

  // Codex r1 on #3577: the stored projection's parse can hide a malformed horizon, so the mapper's own output is read too.
  it('the mapper itself holds the well-formed date, and never a relative year read against its reference', () => {
    const raw = (when: string) => (mapLivingModel(byWhen(when)).graph.nodes as Rec[]).find((n) => n.id === 'g')!.goal_horizon;
    expect(raw('2027-04-12')).toEqual({ deadline: '2027-04-12' });
    expect(raw('end of Q2 2027')).toEqual({ deadline: '2027-06-30' });
    for (const when of ['Review 2032-03 plan by March next year', 'Review 2021-12 plan by end of this year']) expect(raw(when), when).toBeUndefined();
  });

  it('CONTRAST: no deadline is no horizon on both lanes', () => {
    expect(reason(stored(byWhen(null)))).toEqual({ verdict: 'no_horizon', detail: null });
  });

  it('NEGATIVE: words that need today ("in six months", "by March") stay words: the mapper has no clock and regenerates every revision', () => {
    for (const when of ['in six months', 'by March']) {
      const g = (stored(byWhen(when)).nodes as Rec[]).find((n) => n.id === 'g')!;
      expect(g, when).not.toHaveProperty('goal_horizon');
      expect(g.goal_deadline_as_stated).toBe(when);
    }
  });
});
