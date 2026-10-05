/**
 * RT-10 B′ follow-through, Science R3 (#87 5999608477): ONE target reader.
 *
 * Served (red team #87 5999041843, guest 078e521e, CEE 7b1d8414): after the user confirmed "at most 400" in the goal
 * panel, the Model row read "Not set", and the chat asked "What is the most that 'monthly cancellations' can be? I'll
 * propose it as your target." — the target they had just given. The goal panel writes ONLY the `<=` goal_constraints
 * row (never `goal_threshold_raw`, which is ISL's ≥ channel), and those readers looked only at the node's own fields.
 *
 * Fixture: the red team's post-edit graph (verbatim), its pre-edit graph, and the same post-edit graph with the target
 * row turned into a DEADLINE (contrast: a time limit is not a target).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractPersistedGoalTarget } from '../../compose/goal-target-receipt-guard.js';
import { projectGoalTargetRecord } from '../../context/goal-target-record.js';
import { ContextPackGoalTargetSchema } from '../../context/context-pack-schema.js';
import { decisionInputAsk } from '../../agent-lane/decision-input-ask.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';

type Rec = Record<string, unknown>;
const FIXTURE = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_without_target: Rec; graph_with_target: Rec;
};
const ASK_CTX = { restingText: '', questionsToggle: false, awaitingApproval: false, builtOrRan: true } as const;

/** The post-edit graph with the goal's `<=` row turned into a deadline ("within 12 months"). */
const deadlineOnly = (): Rec => {
  const g = structuredClone(FIXTURE.graph_with_target);
  for (const row of g.goal_constraints as Rec[]) row.deadline_metadata = { months: 12 };
  return g;
};

describe('B′ R3 — "at most 400" is a recorded target everywhere it is read', () => {
  it('precondition: the post-edit goal holds no raw threshold; the target lives only in its own <= row', () => {
    const goal = (FIXTURE.graph_with_target.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    expect(goal.goal_threshold_raw ?? null).toBeNull();
    expect(goal.success_threshold ?? null).toBeNull();
    expect((FIXTURE.graph_with_target.goal_constraints as Rec[])[0]).toMatchObject({ node_id: goal.id, operator: '<=', value: 400 });
  });

  it('the receipt reads at most 400 — the value, its unit, its frame and the comparator', () => {
    expect(extractPersistedGoalTarget(FIXTURE.graph_with_target)).toEqual({
      value: 400, unit: 'cancellations/month', frame: 'level', held: '<=',
    });
  });

  it('the model\'s record is set, with the comparator, and the strict schema admits it', () => {
    const record = projectGoalTargetRecord(FIXTURE.graph_with_target);
    expect(record).toEqual({ status: 'set', value: 400, unit: 'cancellations/month', operator: '<=' });
    expect(ContextPackGoalTargetSchema.safeParse(record).success).toBe(true);
  });

  it('the chat never asks for the target again', () => {
    expect(decisionInputAsk(FIXTURE.graph_with_target, ASK_CTX)).toBeNull();
  });

  it('the receipt and testability read the SAME answer (one reader)', () => {
    const verdict = targetTestabilityOf(FIXTURE.graph_with_target);
    expect(verdict.kind).not.toBe('no_target');
    expect(extractPersistedGoalTarget(FIXTURE.graph_with_target)?.value).toBe(400);
  });

  it('CONTRAST: before the edit there is no target — unset, and the one question asks for it', () => {
    expect(extractPersistedGoalTarget(FIXTURE.graph_without_target)).toBeNull();
    expect(projectGoalTargetRecord(FIXTURE.graph_without_target)).toEqual({ status: 'unset' });
    expect(decisionInputAsk(FIXTURE.graph_without_target, ASK_CTX)).toMatch(/as your target\.$/);
  });

  it('CONTRAST: a deadline-only row is a time limit, not a target — still unset, and still no_target', () => {
    const g = deadlineOnly();
    expect(extractPersistedGoalTarget(g)).toBeNull();
    expect(projectGoalTargetRecord(g)).toEqual({ status: 'unset' });
    expect(targetTestabilityOf(g).kind).toBe('no_target');
  });
});
