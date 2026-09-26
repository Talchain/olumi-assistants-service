/**
 * ⭐ A LEVEL LIMIT ON A LINKED FACTOR IS NOT "WORKED OUT FROM OTHER PARTS" — RED-first (P1-c, DL #70 5850069309).
 *
 * THE DEFECT (served 26 Sep, joined runs f-20260926T201724Z and f-20260926T202112Z, CEE d6b09c0 · PLoT 1f6ad52):
 * the automatic first pass carried the limit card "…it could not check your limit on “Monthly churn” (10%):
 * Olumi works that out from other parts of your model and cannot yet test a limit on a quantity like that."
 * Two turns later, after the starting values were approved, the SAME node — same incoming links — was
 * checked (`constraints_decision_grade: true` on every option). The cause the card stated was false.
 *
 * THE WRONG AUTHORITY: `sampleFrameIsAnchored` limb 3 (`d1-shared/constraint-target-alternative.ts`), the
 * estate's mirror of PLoT's anchor rule, pinned at PLoT `d68d4ffb` (16 Sep). PLoT `e2755cfe` / `30d7a60b`
 * (26 Sep) added the `observed_baseline_level` limb: a LEVEL-framed limit on a non-root target is anchored on
 * its observed baseline. On the served first pass churn simply had no baseline yet (PLoT's typed
 * `CONSTRAINT_NOT_CONVERTIBLE`), which the user fixes by giving a figure — not a structural refusal.
 *
 * THE RULE: a level-framed limit on a non-root target, with options to compare, is never PROVED
 * unanchorable, so neither the card nor the run summary states the structural cause for it. A limit with no
 * level frame on the same target keeps the proof (PLoT's three-limb verdict is unchanged for it).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectUnanchoredConstraintTargetIds } from '../../tools/handlers/d1-shared/constraint-target-alternative.js';
import { everyLimitProvedUnanchored } from '../bound-graph.js';
import { composeLimitUncheckedCard, limitCardArm } from '../limit-unchecked-card.js';

type Served = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  goal_constraints: Array<Record<string, unknown>>;
  options: Array<{ id: string; interventions: Record<string, unknown> }>;
};
// Verbatim from the served first pass (01-F1-brief.json: draft_graph nodes/edges/goal_constraints, analysis_ready.options).
const served = JSON.parse(
  readFileSync(new URL('./fixtures/served-first-pass-level-limit-20260926.json', import.meta.url), 'utf8'),
) as Served;
const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
const STRUCTURAL = /works? (that|those) out from other parts/;

const graphOf = (s: Served) => ({ nodes: s.nodes, edges: s.edges, goal_constraints: s.goal_constraints });

describe('P1-c: the served first pass does not state a structural cause for a level limit', () => {
  it('precondition: churn is a non-root target with no baseline, and the limit is level-framed', () => {
    const churn = served.nodes.find((n) => n.id === 'monthly_churn')!;
    expect(churn.observed_state ?? null).toBeNull();
    expect(served.edges.filter((e) => e.to === 'monthly_churn').length).toBeGreaterThan(0);
    expect(served.goal_constraints.find((c) => c.constraint_id === CHURN_LIMIT)?.value_frame).toBe('level');
  });

  it('RED: the collector does not PROVE the churn limit unanchorable', () => {
    expect([...collectUnanchoredConstraintTargetIds(served.goal_constraints, { ...graphOf(served), options: served.options })]).toEqual([]);
  });

  it('RED: the card does not take the proved-cause arm, and its body never says "works that out from other parts"', () => {
    const proved = everyLimitProvedUnanchored(graphOf(served), served.options);
    expect(proved).toBe(false);
    const card = composeLimitUncheckedCard(true, [{ label: 'Monthly churn', stated: '10%' }], limitCardArm(proved, null));
    expect(card.body).not.toMatch(STRUCTURAL);
    expect(card.action_prompt).not.toMatch(STRUCTURAL);
    // Positive control: the card still names the limit it could not confirm.
    expect(card.body).toContain('“Monthly churn” (10%)');
  });

  it('the same limit after the starting values are approved (served run 05: baseline 7%) is not collected either', () => {
    const withBaseline: Served = {
      ...served,
      nodes: served.nodes.map((n) => (n.id === 'monthly_churn'
        ? { ...n, observed_state: { unit: '% per month', value: 0.07, source: 'user_assumption', raw_value: 7 } } : n)),
    };
    expect([...collectUnanchoredConstraintTargetIds(withBaseline.goal_constraints, { ...graphOf(withBaseline), options: withBaseline.options })]).toEqual([]);
  });

  it('CONTRAST: the same target under a limit with NO level frame is still proved unanchorable (the structural words stay true there)', () => {
    const unframed = served.goal_constraints.map((c) => {
      const { value_frame: _drop, ...rest } = c;
      return rest;
    });
    expect([...collectUnanchoredConstraintTargetIds(unframed, { ...graphOf(served), options: served.options })]).toEqual([CHURN_LIMIT]);
    expect(everyLimitProvedUnanchored({ ...graphOf(served), goal_constraints: unframed }, served.options)).toBe(true);
  });

  it('CONTRAST: with NO options to compare, PLoT has no level plan either, so the same level limit stays collected', () => {
    expect([...collectUnanchoredConstraintTargetIds(served.goal_constraints, { ...graphOf(served), options: [] })]).toEqual([CHURN_LIMIT]);
  });
});
