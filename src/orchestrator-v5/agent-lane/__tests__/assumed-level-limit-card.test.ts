/**
 * ⭐ RULING 4 — A LIMIT CHECKED ONLY AGAINST AN ASSUMED LEVEL IS SAID AS SUCH — RED-first (DL #70 5854470460, AIQ
 * meaning 5854466559; served MG eng-hiring-4, traced by AIQ 5851938306).
 *
 * THE DEFECT (CEE 3c4d9cc): every option sets "Annual salary spend" at Olumi's £220k estimate against the user's
 * £400k limit, so rule (d) withholds the verdict — and the card said "Your limit could not be checked", the same words
 * as a limit that was genuinely not scored. It WAS checked, only against an assumed figure; the move that makes it a
 * real check is the real figure, and the card offered only "What this means for my limit".
 *
 * THE RULE: when the readback's persisted rule-(d) ids (`constraint_verdict.estimate_only_constraint_ids`, schemas
 * 0.60.0) cover EVERY limit the bound graph ratifies, on an `unevaluated` verdict, the one card says the limit was
 * checked only against an assumed figure, not a measured one, and asks for the real figure. The words name NO owner
 * (the set spans Olumi's draft, a figure the user adopted, a system repair and no readable owner) and NO leader (the
 * leader claim is withheld). Absent/null ids → today's words, byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTurnCoaching, type CapturedAnalysis, type RunTurnCoachingFinal } from '../analysis-coaching-pass-through.js';
import { everyRatifiedLimitRestsOnAnAssumedLevel } from '../../coaching/limit-unchecked-card.js';
import { ELICITATION_CLOSE, RUN_TURN_COACHING_CONTRACT } from '../../coaching/fragile-link-challenge.js';

type Served = {
  graph_hash: string;
  analysis_state: Record<string, unknown>;
  analysis_result: Record<string, unknown>;
  analysis_ready: unknown;
  draft_graph: Record<string, unknown> & { goal_constraints: Array<Record<string, unknown>> };
  served_card_signal_id: string;
};
// Verbatim wire fields of the served explicit Run (enghiring-4 S3_run).
const served = JSON.parse(readFileSync(
  new URL('../../coaching/__tests__/fixtures/served-run-enghiring4-rule-d-20260927.json', import.meta.url), 'utf8',
)) as Served;
const SALARY = 'agent-lane:annual_salary_spend:<=';

const cardFor = (ids: readonly string[] | null | undefined) => {
  const captured: CapturedAnalysis = {
    scenario_id: 'enghiring-4', status: 200, trigger: 'explicit_run',
    analysis_state: served.analysis_state, analysis_ready: served.analysis_ready, blocks: [served.analysis_result],
  };
  const final: RunTurnCoachingFinal = {
    scenarioId: 'enghiring-4', graphHash: served.graph_hash, analysisState: served.analysis_state,
    analysisResult: served.analysis_result, graph: served.draft_graph,
    // The served card took the `unchecked` arm, which only `unevaluated` licenses.
    constraintVerdictState: 'unevaluated',
    ...(ids === undefined ? {} : { constraintEstimateOnlyIds: ids }),
  };
  return runTurnCoaching(captured, final).blocks.filter((b) => (b as { signal_id: string }).signal_id.startsWith('coach:limit_unchecked:')) as
    Array<{ signal_id: string; title: string; body: string; action_label: string; action_prompt: string }>;
};

describe('ruling 4: a limit checked only against an assumed level', () => {
  it('precondition: the served run withholds for the limit, and the served card said "could not be checked"', () => {
    expect(served.analysis_state.leader_claim).toMatchObject({ withheld_reason: 'constraint_verdict_withheld' });
    expect(served.draft_graph.goal_constraints.map((c) => c.constraint_id)).toEqual([SALARY]);
    expect(served.served_card_signal_id.endsWith(':named:unchecked')).toBe(true);
  });

  it('CONTRAST: ids not recorded (absent or null) → the served card, byte-identical signal', () => {
    expect(cardFor(undefined).map((c) => c.signal_id)).toEqual([served.served_card_signal_id]);
    expect(cardFor(null).map((c) => c.signal_id)).toEqual([served.served_card_signal_id]);
  });

  it('CONTRAST: recorded as [] (no limit rests on an assumed level) → still "could not be checked"', () => {
    expect(cardFor([]).map((c) => c.signal_id)).toEqual([served.served_card_signal_id]);
  });

  it('RED: the persisted rule-(d) ids cover the one limit → the assumed-figure arm, asking for the real figure', () => {
    const cards = cardFor([SALARY]);
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card!.signal_id.endsWith(':named:assumed')).toBe(true);
    expect(card!.title).toBe('Your limit was checked only against an assumed figure');
    expect(card!.body).toContain('only against an assumed figure for what an option sets, not a measured one');
    expect(card!.body).toContain('“Annual salary spend”');
    expect(card!.action_label).toBe('Give the real figure');
    expect(card!.action_prompt).toContain('Ask me what the real figure is and what it rests on.');
    expect(card!.action_prompt.endsWith(ELICITATION_CLOSE)).toBe(true);
    // Owner-neutral, leader-free, never a compliance claim.
    expect(`${card!.title} ${card!.body} ${card!.action_prompt}`).not.toMatch(/Olumi|your figure|\bmet\b|\bmeets?\b|could not be checked/);
    const { title_max, body_max, action_label_max, action_prompt_max } = RUN_TURN_COACHING_CONTRACT.limits;
    expect(card!.title.length).toBeLessThanOrEqual(title_max);
    expect(card!.body.length).toBeLessThanOrEqual(body_max);
    expect(card!.action_label.length).toBeLessThanOrEqual(action_label_max);
    expect(card!.action_prompt.length).toBeLessThanOrEqual(action_prompt_max);
  });
});

describe('everyRatifiedLimitRestsOnAnAssumedLevel — EVERY ratified limit, on an unevaluated verdict, never guessed', () => {
  const twoLimits = {
    ...served.draft_graph,
    goal_constraints: [
      ...served.draft_graph.goal_constraints,
      { constraint_id: 'agent-lane:hires:>=', node_id: 'hires', operator: '>=', value: 5, unit: 'hires', label: 'Hires', provenance: 'explicit' },
    ],
  };
  it('two limits, only one in the set → false (the other may be unscored)', () => {
    expect(everyRatifiedLimitRestsOnAnAssumedLevel(twoLimits, 'unevaluated', [SALARY])).toBe(false);
  });
  it('two limits, both in the set → true', () => {
    expect(everyRatifiedLimitRestsOnAnAssumedLevel(twoLimits, 'unevaluated', [SALARY, 'agent-lane:hires:>='])).toBe(true);
  });
  it('any state other than unevaluated → false', () => {
    for (const s of ['evaluated_feasible', 'evaluated_infeasible', 'identity_unresolved', 'not_applicable', null, undefined]) {
      expect(everyRatifiedLimitRestsOnAnAssumedLevel(served.draft_graph, s, [SALARY])).toBe(false);
    }
  });
  it('not recorded (null/undefined) or recorded-empty → false', () => {
    expect(everyRatifiedLimitRestsOnAnAssumedLevel(served.draft_graph, 'unevaluated', null)).toBe(false);
    expect(everyRatifiedLimitRestsOnAnAssumedLevel(served.draft_graph, 'unevaluated', undefined)).toBe(false);
    expect(everyRatifiedLimitRestsOnAnAssumedLevel(served.draft_graph, 'unevaluated', [])).toBe(false);
  });
});
