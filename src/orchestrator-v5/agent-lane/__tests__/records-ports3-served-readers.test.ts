/**
 * DL WIRING PORTS 3: each port's value reaches the SERVED reader the P2-ACCEPT table names, through the real records
 * build and the real reader — never a mock that writes the asserted field. Each row turns RED with its port removed.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { BRIEF, sealedRecordsVNext as sealedRecords } from '../../../cee/draft/records/__tests__/compile-spec/sealed-fixture-vnext.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { narrateWriteOutcome, openQuestionsForReply } from '../write-outcome.js';
import { parsePendingAction } from '../../session/pending-action.js';
import { goalScopeClaimInput } from '../../compose/goal-scope-claim-input.js';
import { constructionRecords, strictRecordsWire } from './records-wire-fixture.js';

async function build(records: DraftRecordSet, brief: string): Promise<{ result: ToolResult; writes: Record<string, unknown>[] }> {
  const writes: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { writes.push(body as Record<string, unknown>); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', brief, dispatch,
    async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  return { result, writes };
}

const DEADLINE = 'Does "Monthly recurring revenue" get there within 9 months? The model holds the deadline; no result answers that yet.';

describe('PORT 1: the deadline question reaches the served reply and the wire list, first', () => {
  it('the reply status line says it first, and `_agent.open_questions` carries it first', async () => {
    const { result } = await build(sealedRecords(), BRIEF);
    expect(result.ok).toBe(true);
    // The wire list (`_agent.open_questions`, UI serverOpenQuestions) in the producer's order: the deadline FIRST.
    expect(openQuestionsForReply(result)[0]).toBe(DEADLINE);
    // The served reply's status line (`narrateWriteOutcome` → `openQuestionsLine`, first 2 shown) says it first.
    const { status } = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [result]);
    expect(status).toContain(`Questions this model does not answer yet: ${DEADLINE}`);
  });

  it('contrast: a brief with no deadline asks none (the first question is the compiler\'s own)', async () => {
    const { result } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(result.ok).toBe(true);
    expect(openQuestionsForReply(result).some((q) => /get there within|Which date does/.test(q))).toBe(false);
  });
});

const PRO_SCOPE = { modelled: 'the Pro plan only', alternative: 'all plans together', stated_in_brief: false };
const PRO_BRIEF = 'Should we raise the Pro plan from £49 to £59 to reach £20k MRR?';
const SCOPE_QUESTION = 'The brief does not say whether your "MRR" goal covers the Pro plan only or all plans together, so the model '
  + 'measures it for the Pro plan only. Which did you mean?';
function proRecords(scope?: { modelled: string; alternative: string; stated_in_brief: boolean }): DraftRecordSet {
  const records = constructionRecords('Raise Pro to £59', 'MRR', 'Pro plan price');
  if (scope !== undefined) records.stated_items[0] = { ...records.stated_items[0]!, scope };
  return records;
}
function registeredGoal(writes: Record<string, unknown>[]): { id: string; label: string } {
  const goals = (writes[0]!.graph as { nodes: Array<{ id: string; kind: string; label: string }> }).nodes.filter((n) => n.kind === 'goal');
  expect(goals).toHaveLength(1);
  return goals[0]!;
}

describe('PORT 2 (C46): the unstated goal scope reaches the served route reader', () => {
  it('the route parses the action (agent-v1-turn parsePendingAction), keeps it unresolved (goalScopeClaimInput), and asks first', async () => {
    const { result, writes } = await build(proRecords(PRO_SCOPE), PRO_BRIEF);
    expect(result.ok).toBe(true);
    const goal = registeredGoal(writes);
    // The route's own filter (agent-v1-turn.ts freshScopeIssues): parsed, this scenario, reconcile_goal_scope.
    const parsed = parsePendingAction(result.pending_action);
    expect(parsed).not.toBeNull();
    expect(parsed!.scenario_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(parsed!.action).toMatchObject({ kind: 'reconcile_goal_scope', goal_id: goal.id, goal_label: 'MRR', expected: 'scope',
      declared_scope: PRO_SCOPE, question: SCOPE_QUESTION });
    // The route's composer (withRetainedScopeIssues -> goalScopeClaimInput) over the REGISTERED graph keeps it open.
    const input = goalScopeClaimInput([parsed!], writes[0]!.graph);
    expect(input.status).toBe('unresolved');
    expect(input.issues.map((issue) => issue.goal_id)).toEqual([goal.id]);
    // And the question leads the wire list (`_agent.open_questions`), ahead of any deadline, as legacy unshifts it.
    expect(openQuestionsForReply(result)[0]).toBe(SCOPE_QUESTION);
  });

  it('absent declaration: no action and no question is invented (same brief, same topology)', async () => {
    const { result } = await build(proRecords(), PRO_BRIEF);
    expect(result.ok).toBe(true);
    expect(result.pending_action).toBeUndefined();
    expect(openQuestionsForReply(result).some((q) => /goal covers|Which did you mean/.test(q))).toBe(false);
  });

  it('contrast: a scope the brief itself stated (stated_in_brief true) asks nothing', async () => {
    const { result } = await build(proRecords({ ...PRO_SCOPE, stated_in_brief: true }), PRO_BRIEF);
    expect(result.ok).toBe(true);
    expect(result.pending_action).toBeUndefined();
    expect(openQuestionsForReply(result).some((q) => /goal covers|Which did you mean/.test(q))).toBe(false);
  });
});
