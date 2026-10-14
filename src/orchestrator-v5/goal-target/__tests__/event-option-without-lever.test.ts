/**
 * Paul's legacy-code brief (14 Oct, scenario c1494f4d): the event-by-date construction gives "Legacy-code reduction" no lever
 * (its drafted change, legacy time 25% → 15%, is on the reasoning chain the forecast does not use yet), so its Run arm is
 * identical to carrying on as now. Once the team's 7–8 months is saved and Runs work, that clone must never be shown as a
 * chance — it would say legacy reduction changes nothing, a finding the model does not support.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTeamShareEdit } from '../team-share-write.js';
import { withShareByDateChanceGate } from '../goal-chance-range.js';
import { unresolvedEventOptionIds } from '../event-by-date-model.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GOAL_FIGURES_SHARE_APPROXIMATION } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-paul-legacy-c1494f4d-graph.json', import.meta.url), 'utf8')) as { graph: Rec }).graph;
const LEGACY = 'event_option_2', CARRY_ON = 'event_option_1', HIRE = 'event_option_3';

/** The served graph with the team's own 7–8 months saved through the real writer (Paul's answer on that turn). */
function withTeamTime(): Rec {
  const out = applyTeamShareEdit(SERVED, { goal_id: 'event_goal', team_id: 'event_team', low_months: 7, high_months: 8,
    deadline: '2027-04-14', reference_date: '2026-10-14' } as never, computeAnalysisAffectingGraphHash(SERVED as never)!);
  if (out.kind !== 'mutated') throw new Error(`team time not written: ${JSON.stringify(out)}`);
  return out.mutatedGraph;
}
/** A Run envelope where the lever-less arm came back exactly as the baseline (the clone). */
const envelope = () => ({ option_comparison: [
  { option_id: CARRY_ON, probability_of_goal: 0.21, outcome: { p10: 0.6, p50: 0.8, p90: 0.95 } },
  { option_id: LEGACY, probability_of_goal: 0.21, outcome: { p10: 0.6, p50: 0.8, p90: 0.95 } },
  { option_id: HIRE, probability_of_goal: 0.47, outcome: { p10: 0.7, p50: 0.95, p90: 1.1 } },
], inference_warnings: [] as Rec[] });
const withheldFor = (e: Rec, id: string): Rec | undefined => (e.inference_warnings as Rec[])
  .find(w => w.code === GOAL_FIGURES_SHARE_APPROXIMATION && Array.isArray(w.option_ids) && w.option_ids.includes(id));

describe('an event option with no lever never shows a chance (Paul, c1494f4d)', () => {
  it('PRECONDITION (served): the legacy option\'s only setting is the hire switch at 0, as carrying on; it is recorded as unresolved', () => {
    const legacy = SERVED.nodes.find((n: Rec) => n.id === LEGACY);
    expect(legacy.interventions).toEqual(SERVED.nodes.find((n: Rec) => n.id === CARRY_ON).interventions);
    expect(unresolvedEventOptionIds(SERVED)).toEqual([LEGACY]);
  });

  it('⭐ with the team\'s time saved, the legacy clone\'s chance is withheld with why; carrying on and the hire are not', () => {
    const gated = withShareByDateChanceGate(envelope(), withTeamTime(), 'event_goal') as Rec;
    const w = withheldFor(gated, LEGACY);
    expect(w?.message).toBe("No chance is shown for this option yet: it changes ‘Time on legacy fixes’, which this deadline forecast doesn't use yet. "
      + 'Worth discussing: how much it would speed up the work, and from when.');
    expect(withheldFor(gated, CARRY_ON)).toBeUndefined();
    expect(withheldFor(gated, HIRE)).toBeUndefined();
  });

  it('CONTRAST: an unresolved option linked to no kept-out part keeps the plain reason', () => {
    const g = withTeamTime();
    g.edges = g.edges.filter((e: Rec) => !(e.from === LEGACY && String(e.to).startsWith('event_context_')));
    const w = withheldFor(withShareByDateChanceGate(envelope(), g, 'event_goal') as Rec, LEGACY);
    expect(w?.message).toBe("This option's effect on the deadline is not yet modelled. Say what it changes.");
  });
});
