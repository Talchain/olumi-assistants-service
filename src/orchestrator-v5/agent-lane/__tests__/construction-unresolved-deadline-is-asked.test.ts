/**
 * ⛔ T2 — A DEADLINE THE BRIEF WRITES BUT NO MONTH COUNT CAN HOLD IS ASKED IN THE BRIEF'S OWN WORDS (journey E, PJ-E-A2).
 *
 * Served (fixture `served-journey-e-by-q3-20260928.json`, run pj-20260928T074951Z E01): the brief says "ship the new
 * platform by Q3". `attestHorizon` reads that as `unresolved` with the wording "by Q3" (a year and a fiscal calendar are
 * needed to count months), and `holdStatedGoalAttributes` returns it — but nothing read it. The registered goal held no
 * deadline, the manifest marked "Q3" `prose_only`, and the reply never said "Q3": the drafter's own question about it
 * sat 8th of 10 and the reply shows two. Had the drafter typed a month count for it, the reply would have asked that
 * count ("within 9 months") as if it were the user's deadline.
 *
 * The fix asks the brief's wording in the deadline slot. It does NOT hold the wording on the goal node: no stored field
 * can carry "by Q3" without converting it (Canonical's shape, PJ-A2 row 27 second half), so that stays out of scope.
 * Every row drives the REAL `buildModelFromBrief` (model call faked, nothing live).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, unknown>;
const SCENARIO = '72727272-7272-4727-8727-727272727272';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-journey-e-by-q3-20260928.json', import.meta.url), 'utf8')) as {
  brief: string;
  served: { goal_node: Rec; drafter_q3_question: string };
  candidate: CandidateModel;
};
const BRIEF = SERVED.brief;
/** The same brief with the deadline written as a figure, and with none (the contrasts). */
const BRIEF_6_MONTHS = BRIEF.replace('by Q3', 'within 6 months');
const BRIEF_NO_DEADLINE = BRIEF.replace(' by Q3', '');

const ASK_BY_Q3 = 'Which date does "by Q3" mean? It is the deadline your brief sets for "ship the new platform", '
  + 'but the model does not hold it yet, so no result answers whether it is met by then.';

function candidate(horizon: number | null): CandidateModel {
  const c = structuredClone(SERVED.candidate) as CandidateModel;
  (c.goal as { horizon_months: number | null }).horizon_months = horizon;
  return c;
}

/** The fixture must be one the real drafter schema would accept (the pattern `construction-goal-losses-are-said` uses). */
function assertRealSchemaWouldAccept(payload: Rec): void {
  const schema = buildCandidateSchema() as { required: string[]; properties: Record<string, { required?: string[] }> };
  for (const key of schema.required) expect(payload, `the real schema requires \`${key}\``).toHaveProperty(key);
  for (const inner of schema.properties.goal?.required ?? []) expect(payload.goal, `the real schema requires \`goal.${inner}\``).toHaveProperty(inner);
}

async function build(brief: string, c: CandidateModel): Promise<{ result: Rec; goal: Rec; questions: string[] }> {
  assertRealSchemaWouldAccept(c as unknown as Rec);
  let stored: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(c) });
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(stored, 'the build registered a graph').toBeDefined();
  const goals = GraphV3.parse(JSON.parse(stored!)).nodes.filter((n) => n.kind === 'goal');
  expect(goals).toHaveLength(1);
  return { result, goal: goals[0] as Rec, questions: (result.open_questions ?? []) as string[] };
}

/** The line the server appends to the user's reply for this build (`write-outcome.ts`). */
const replyLine = (questions: string[]): string => String(narrateWriteOutcome(
  'Here is the model.',
  [{ name: 'build_model_from_brief' }],
  [{ ok: true, mutated: true, model_version: { version_number: 1 }, open_questions: questions }],
).status ?? '');

describe('T2: journey E\'s "by Q3" reaches the user in their own words', () => {
  it('PRECONDITION: the served goal is the one this fixture builds, and the brief says "by Q3" once', async () => {
    const { goal } = await build(BRIEF, candidate(null));
    expect(goal.id).toBe(SERVED.served.goal_node.id);
    expect(goal.label).toBe(SERVED.served.goal_node.label);
    expect(BRIEF.split('by Q3')).toHaveLength(2);
  });

  it('⭐ RED (served E01, drafter typed no count): "by Q3" is the FIRST open question, verbatim, and the reply shows it', async () => {
    const { questions } = await build(BRIEF, candidate(null));
    expect(questions[0], JSON.stringify(questions)).toBe(ASK_BY_Q3);
    expect(questions.filter((q) => q === ASK_BY_Q3), 'asked once').toHaveLength(1);
    const line = replyLine(questions);
    expect(line, line).toContain(ASK_BY_Q3);
    // The drafter's own question is kept, unchanged, behind it.
    expect(questions).toContain(SERVED.served.drafter_q3_question);
  });

  it('⭐ RED (drafter guessed 9 months for "by Q3"): the guess is never asked as the user\'s deadline; "by Q3" is', async () => {
    const { questions } = await build(BRIEF, candidate(9));
    expect(questions[0], JSON.stringify(questions)).toBe(ASK_BY_Q3);
    expect(questions.some((q) => /within 9 months/.test(q)), JSON.stringify(questions)).toBe(false);
  });

  it('INVARIANT: "by Q3" is never converted onto the goal — no month count, no Q3 on the registered node', async () => {
    for (const h of [null, 9]) {
      const { goal } = await build(BRIEF, candidate(h));
      expect(Object.hasOwn(goal, 'goal_horizon_months'), String(h)).toBe(false);
      expect(JSON.stringify(goal), String(h)).not.toContain('Q3');
    }
  });
});

describe('CONTRAST: every other deadline shape reads exactly as before', () => {
  it('a written "within 6 months" the drafter typed as 6 is HELD, and its question is unchanged', async () => {
    const { goal, questions } = await build(BRIEF_6_MONTHS, candidate(6));
    expect(goal.goal_horizon_months).toBe(6);
    expect(questions[0]).toBe('Does "ship the new platform" get there within 6 months? The model holds the deadline; no result answers that yet.');
    expect(questions.some((q) => q.startsWith('Which date does'))).toBe(false);
  });

  it('no deadline in the brief and none typed: no deadline question at all', async () => {
    const { questions } = await build(BRIEF_NO_DEADLINE, candidate(null));
    expect(questions.some((q) => /Which date does|get there within/.test(q)), JSON.stringify(questions)).toBe(false);
  });

  it('no deadline in the brief but a count typed: the unattested question is unchanged', async () => {
    const { goal, questions } = await build(BRIEF_NO_DEADLINE, candidate(6));
    expect(Object.hasOwn(goal, 'goal_horizon_months')).toBe(false);
    expect(questions[0]).toBe('Does "ship the new platform" get there within 6 months? The model holds no deadline yet, so no result answers that.');
    expect(questions.some((q) => q.startsWith('Which date does'))).toBe(false);
  });
});
