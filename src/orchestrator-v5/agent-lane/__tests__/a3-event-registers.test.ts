/**
 * ⭐ A3 D1 (DL-3 ruling 3, 18 Oct; reverses B3 086e4624's "unless that graph cannot reach the goal"; Paul 13 Oct: coach, don't
 * refuse). Proof 1 D1: a deadline brief with no capacity stated was refused three turns running (`event_goal_unadmitted`): no
 * model at all, and the deadline the user gave at turn 2 was discarded with the refusal. The ordinary model now registers; the
 * event's chance is withheld on the existing carrier and its missing piece is the build's one ask. SYNTHETIC brief.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { admittedReachesGoal } from '../admit-model.js';

type Rec = Record<string, any>;
const SID = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const DEADLINE = 'We need to release the next app version before our deadline in four months.';
const BRIEF = `${DEADLINE} We are deciding whether to hire a contractor or move two people from support onto it.`;
const ASK = "Olumi couldn't connect your options to the launch date yet: it needs how much capacity each option adds.";

/** D1's shape: an event goal with its deadline words, options that set nothing, and no capacity basis at all. */
function noCapacityDraft(): Rec {
  return {
    goal: { kind: 'event_by_date', deliverable: 'the next app version', metric: 'Next app version', operator: '>=', unit: '% completion',
      value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred',
      horizon_months: 4, provenance: 'explicit', scope: null, quantity_frame: 'level', basis: null, source_quote: DEADLINE, deadline_words: DEADLINE },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [], added_capacity: null },
      { label: 'Hire a contractor', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [], added_capacity: null },
      { label: 'Move two people from support', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [], added_capacity: null },
    ],
    factors: [], risks: [], outcomes: [], links: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, statements: [],
  };
}

async function built(draft: Rec, brief = BRIEF): Promise<{ result: Rec; graphs: Rec[] }> {
  const graphs: Rec[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graphs.push(structuredClone((body as { graph: Rec }).graph)); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const result = await buildModelFromBrief(SID, brief, d, (async () => ({ text: JSON.stringify(draft) })) as unknown as CallStructuredModel) as Rec;
  return { result, graphs };
}

describe('A3 D1: a deadline brief with no capacity stated gets a model and one ask, never a refusal', () => {
  it('⭐ RED → GREEN: the ordinary model registers with the deadline; the missing capacity is the one ask; no chance can run', async () => {
    const { result, graphs } = await built(noCapacityDraft());
    expect(result, JSON.stringify(result).slice(0, 1500)).toMatchObject({ ok: true, mutated: true });
    expect(graphs).toHaveLength(1);
    expect(result.open_questions, JSON.stringify(result.open_questions)).toContain(ASK);
    expect((result.open_questions as string[]).filter((q) => q === ASK)).toHaveLength(1);
    const goal = graphs[0]!.nodes.find((n: Rec) => n.kind === 'goal');
    // The deadline the user gave is held on the goal (its existing carrier), not discarded with a refusal.
    expect(goal.goal_deadline_as_stated, JSON.stringify(goal)).toBe('four months');
    // Withheld, never runnable: no option reaches the goal until the capacity is answered.
    expect(admittedReachesGoal(graphs[0] as never)).toBe(false);
    // The withheld event is never counted as a link whose direction nobody stated: the three are the option links the draft left
    // without a direction, exactly as the ordinary admission withholds them.
    expect(result.not_represented).toContain('3 relationship(s) were left out because nobody has stated which way they run.');
  });
});
