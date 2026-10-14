/**
 * event_risk.v1 × route-once (#2755) — the JOINED POINT, pinned (DL 7 Oct).
 *
 * Route-once's `endsOfGraph` reads `event_risk.mitigations[].factor_id` LOOSELY to mark a preventer→risk link
 * `fixedByIsl` (ISL fixes that coefficient; it is never a doubted route). That loose read is only safe if every door
 * that WRITES `event_risk` produces exactly that key. The writers:
 *  · the register door (`EventRiskV1`, strict): its mitigation is `{ factor_id, occurrence_reduction }` and nothing else
 *    (the same shape as schemas 0.82.0 `EventRiskMitigationV1Schema` and ISL `EventRiskMitigationV1`);
 *  · the chat add-risk door (slice 2a) and the draft door (slice 2c): both write `readStatedEventRisk`'s block, which
 *    carries NO `mitigations`, so route-once excludes nothing on their account.
 */
import { describe, expect, it } from 'vitest';
import { EventRiskV1 } from '../../../schemas/event-risk.js';
import { endsOfGraph } from '../../goal-target/held-user-links.js';
import { readStatedEventRisk } from '../stated-event-risk.js';
import { holdStatedEventRisks } from '../../agent-lane/stated-event-risk-draft.js';

const STATED = 'Our key developer might leave, a 10–30% chance in the next 6 months.';

function graphWith(eventRisk: unknown) {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Delivery' },
      { id: 'cover', kind: 'factor', label: 'Cover arranged' },
      { id: 'workload', kind: 'factor', label: 'Workload' },
      { id: 'risk_dev', kind: 'risk', label: 'Key developer leaves', event_risk: eventRisk },
    ],
    edges: [
      { from: 'cover', to: 'risk_dev', strength: { mean: -0.5, std: 0.1 } },
      { from: 'workload', to: 'risk_dev', strength: { mean: 0.3, std: 0.1 } },
      { from: 'risk_dev', to: 'goal', strength: { mean: -0.4, std: 0.1 } },
    ],
  };
}
const fixed = (g: ReturnType<typeof graphWith>, from: string) =>
  endsOfGraph(g)(g.edges.find((e) => e.from === from && e.to === 'risk_dev')).fixedByIsl === true;

describe('event_risk.v1 × route-once: the mitigation key every writer produces is the one fixedByIsl reads', () => {
  it('JOIN: a mitigation the register door ACCEPTS marks exactly its preventer→risk link fixedByIsl (contrast: a non-preventer parent is not)', () => {
    const parsed = EventRiskV1.safeParse({
      version: 1,
      occurrence: { p_low: 0.1, p_high: 0.3, basis: 'user', meaning: 'at_least_once_within_horizon' },
      horizon: { months: 6 },
      mitigations: [{ factor_id: 'cover', occurrence_reduction: 0.5 }],
    });
    expect(parsed.success).toBe(true);
    const g = graphWith(parsed.success ? parsed.data : undefined);
    expect(fixed(g, 'cover')).toBe(true);
    expect(fixed(g, 'workload')).toBe(false);
  });

  it('REFUSAL: a mis-keyed mitigation (`factor`, not `factor_id`) never passes the door, so the loose read cannot meet one', () => {
    const misKeyed = {
      version: 1,
      occurrence: { p_low: 0.1, p_high: 0.3, basis: 'user', meaning: 'at_least_once_within_horizon' },
      horizon: { months: 6 },
      mitigations: [{ factor: 'cover', occurrence_reduction: 0.5 }],
    };
    expect(EventRiskV1.safeParse(misKeyed).success).toBe(false);
    // What the loose reader would do with it (why the door must refuse): it fixes nothing.
    expect(fixed(graphWith(misKeyed), 'cover')).toBe(false);
  });

  it('2a + 2c: the block both new doors write passes the door schema unchanged and carries no `mitigations`', () => {
    const stated = readStatedEventRisk(STATED)!;
    expect(stated).toBeDefined();
    expect(EventRiskV1.parse(stated.event_risk)).toEqual(stated.event_risk);
    expect('mitigations' in stated.event_risk).toBe(false);
    const drafted = holdStatedEventRisks(
      [{ id: 'risk_dev', kind: 'risk', label: 'Key developer leaves' }],
      [{ from: 'risk_dev', to: 'goal' }],
      STATED,
    ).nodes.find((n) => n.id === 'risk_dev')!.event_risk!;
    expect(drafted).toEqual(stated.event_risk);
    const g = graphWith(drafted);
    expect(fixed(g, 'cover')).toBe(false);
    expect(fixed(g, 'workload')).toBe(false);
  });
});
