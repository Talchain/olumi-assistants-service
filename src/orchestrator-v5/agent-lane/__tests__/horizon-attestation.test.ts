/**
 * ⭐ THE GOAL'S DEADLINE IS HELD ONLY WHEN THE BRIEF ATTESTS IT — MG's `attestHorizon`, consumed by G1
 * (`holdStatedGoalAttributes`). Codex PJ-A2 rows 25 ("12 subscribers" is not twelve months), 26 ("over the next year"
 * holds twelve months with no literal 12) and 27 ("by Q3" with no year stays unresolved, its wording kept).
 *
 * ATTEST, NEVER EXTRACT: the drafter types `goal.horizon_months`; the brief can only confirm that exact count as a
 * forward duration in months or years. Every row below either calls the helper directly or drives the REAL
 * `buildModelFromBrief` (model call faked, nothing live) and reads the goal a fresh GraphV3 parse of the stored bytes
 * holds.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import type { CandidateModel } from '../admit-model.js';
import { attestHorizon } from '../horizon-attestation.js';
import { holdStatedGoalAttributes } from '../stated-by-user.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, unknown>;
const SCENARIO = '26262626-2626-4262-8262-262626262626';

/** Paul's Pricing A brief (export olumi-debug-17d1cd3a-20260927), the one PJ-A2 rows 25–27 edit. */
const BRIEF = 'Given our goal of reaching £100k MRR within 12 months [Currently 75k] while keeping monthly churn under 4%, '
  + 'should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const withDeadline = (words: string): string => BRIEF.replace('within 12 months', words);
/** PJ-A2 row 25's brief, verbatim: a 12 that counts subscribers. */
const SUBSCRIBERS = 'We have £75k MRR and aim for £100k MRR. We have 12 subscribers. Should we increase the Pro plan price from £49 to £59?';

function candidate(horizon: number | null): CandidateModel {
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: 'GBP', horizon_months: horizon,
      provenance: 'explicit', baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: [
      { label: 'Increase the Pro plan price to £59', provenance: 'explicit', is_status_quo: false, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Keep the Pro plan price at £49', provenance: 'explicit', is_status_quo: true, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [{ label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 100 }],
    risks: [], outcomes: [],
    links: [{ from: 'Pro plan price', to: 'MRR', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null }],
    identities: [], unknowns: [], decision_question: null,
  } as CandidateModel;
}

/** The goal node a fresh GraphV3 parse of the registered bytes holds. */
async function registeredGoal(brief: string, horizon: number | null): Promise<Rec> {
  let stored: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate(horizon)) });
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
  const goals = GraphV3.parse(JSON.parse(stored!)).nodes.filter((n) => n.kind === 'goal');
  expect(goals).toHaveLength(1);
  return goals[0] as Rec;
}

describe('attestHorizon: the brief confirms the drafter\'s month count, or it is not held', () => {
  it('⭐ RED (PJ-A2 row 26): "over the next year" attests twelve months, with the brief\'s own wording', () => {
    const brief = withDeadline('over the next year');
    expect(brief).not.toContain('12 months');
    expect(attestHorizon(brief, { horizon_months: 12 })).toEqual({ months: 12, wording: 'over the next year', status: 'attested' });
  });

  it('⭐ RED (PJ-A2 row 27): "by Q3" with no year is unresolved — no month count, the wording kept', () => {
    expect(attestHorizon(withDeadline('by Q3'), { horizon_months: null })).toEqual({ months: null, wording: 'by Q3', status: 'unresolved' });
  });

  it('⭐ "by Q3" stays unresolved even when the drafter guessed a month count for it', () => {
    expect(attestHorizon(withDeadline('by Q3'), { horizon_months: 9 })).toEqual({ months: null, wording: 'by Q3', status: 'unresolved' });
  });

  it('⭐ CONTRAST (PJ-A2 row 25): "12 subscribers" is absent — a figure beside another noun is never a deadline', () => {
    expect(attestHorizon(SUBSCRIBERS, { horizon_months: 12 })).toEqual({ months: null, wording: '', status: 'absent' });
  });

  it('CONTRAST: "within 12 months" attests twelve, wording kept whole', () => {
    expect(attestHorizon(BRIEF, { horizon_months: 12 })).toEqual({ months: 12, wording: 'within 12 months', status: 'attested' });
  });

  it.each([
    ['within a year', 12, 'within a year'],
    ['in the next month', 1, 'in the next month'],
    ['within 2 years', 24, 'within 2 years'],
    ['on a 12-month horizon', 12, '12-month'],
    ['over the next 18 months', 18, 'over the next 18 months'],
  ])('attests "%s" as %d months', (words, months, wording) => {
    expect(attestHorizon(withDeadline(words), { horizon_months: months })).toEqual({ months, wording, status: 'attested' });
  });

  it.each([
    ['over the last 12 months', 'a past period'],
    ['12 months ago', 'a past period'],
    ['in 3-12 months', 'the far end of a range'],
  ])('CONTRAST: "%s" never attests 12 (%s)', (words) => {
    expect(attestHorizon(withDeadline(words), { horizon_months: 12 }).status).not.toBe('attested');
  });

  it('CONTRAST: a written duration that is not the drafter\'s count is unresolved, never the brief\'s figure swapped in', () => {
    expect(attestHorizon(BRIEF, { horizon_months: 18 })).toEqual({ months: null, wording: 'within 12 months', status: 'unresolved' });
  });

  it.each([['within twelve months', 12], ['at month 9', 9]])('CONTRAST: %s is proposed, never silently held', (words, months) => {
    expect(attestHorizon(withDeadline(words), { horizon_months: months })).toMatchObject({ months: null, proposed_months: months, status: 'unresolved' });
  });

  it('absence-tolerant: no brief, no goal, or an older candidate with no horizon', () => {
    expect(attestHorizon(undefined, { horizon_months: 12 }).status).toBe('absent');
    expect(attestHorizon(BRIEF, null).status).toBe('unresolved');
    expect(attestHorizon(BRIEF, {}).wording).toBe('within 12 months');
    for (const bad of [0, -12, 12.5, '12']) expect(attestHorizon(BRIEF, { horizon_months: bad }).status, String(bad)).not.toBe('attested');
  });
});

describe('G1 holds exactly what attestHorizon attests, on the registered goal', () => {
  it('⭐ RED (PJ-A2 row 26): "over the next year" -> goal_horizon_months 12 after a fresh read', async () => {
    const goal = await registeredGoal(withDeadline('over the next year'), 12);
    expect(goal.goal_horizon_months).toBe(12);
  });

  it('⭐ CONTRAST (PJ-A2 row 25): "12 subscribers" -> no goal_horizon_months', async () => {
    const goal = await registeredGoal(SUBSCRIBERS, 12);
    expect(Object.hasOwn(goal, 'goal_horizon_months')).toBe(false);
  });

  it('CONTRAST: "within 12 months" -> 12, attested', async () => {
    expect((await registeredGoal(BRIEF, 12)).goal_horizon_months).toBe(12);
  });

  it('PJ-A2 row 27\'s first half: "by Q3" holds no month count on any node', async () => {
    const goal = await registeredGoal(withDeadline('by Q3'), null);
    expect(Object.hasOwn(goal, 'goal_horizon_months')).toBe(false);
  });

  it('⭐ HAND-OFF: the unresolved wording reaches the admission call site on the typed result, never the node', () => {
    const nodes = [{ id: 'g', kind: 'goal', goal_threshold_raw: 100000 }];
    const goal = { operator: '>=', horizon_months: null, provenance: 'explicit', unit: 'GBP' };
    const r = holdStatedGoalAttributes(nodes, goal, withDeadline('by Q3'));
    expect(r.horizon).toEqual({ months: null, wording: 'by Q3', status: 'unresolved' });
    expect(r.held.horizon).toBe(false);
    expect(JSON.stringify(r.nodes)).not.toContain('Q3');
    const held = holdStatedGoalAttributes(nodes, { ...goal, horizon_months: 12 }, withDeadline('over the next year'));
    expect(held.horizon.status).toBe('attested');
    expect((held.nodes[0] as Rec).goal_horizon_months).toBe(12);
  });
});
