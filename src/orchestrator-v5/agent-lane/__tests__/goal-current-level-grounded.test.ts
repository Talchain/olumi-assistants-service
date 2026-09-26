/**
 * ⛔ THE GOAL'S CURRENT LEVEL IS RECORDED AS THE USER'S ONLY WHEN THE USER WROTE THE FIGURE (the #1978 class).
 *
 * Runtime's seam review of #1985 (CEE issue comment 5845078745, read at cc5ff29e): whose figure it is rested on the
 * Agent's own `user_stated: true` — the model's self-report, the same flag that stored a served 0% churn as the user's
 * (#70 5843805457). So the Agent could say "your MRR is £12,000 today" from its own reading, and one approval
 * recorded it with the user's stamp (`user_override`, read as `user_stated` by the obligation rule) on the goal the
 * headline chance of reaching the target is measured against.
 *
 * THE RULE (#1978's own, `stated-by-user.ts`): the figure — as recorded, with a stated k/m suffix already scaled —
 * must be PRESENT in what the user TYPED in this conversation (`ctx.user_text`, bound by the route from composer
 * messages only). Not there ⇒ nothing is prepared, it is said plainly, and the Agent asks for today's figure.
 *
 * THE CONTRACT FOR ANOTHER TURN (pinned from #1978's `userWordsOf`): words the user typed EARLIER in this session
 * are theirs ("Our current MRR is £12,000." then "Please record that."), including on a later chip click. After a
 * restart those earlier words are gone, and the figure is refused and asked for — under-claiming, never over.
 *
 * FIXTURE: Paul's stored graph (`cbd15f83`). Goal `mrr`: target 20000 "GBP MRR", cap 25000, frame `level`, no
 * `observed_state`. The harness is the Agent's real `dispatchTool` → `createAgentCapabilities` → the real
 * `ProposalStore`; the graph read and register are a fake store with the route's CAS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { HistoryStore } from '../history-store.js';
import { typedByUser, userWordsOf } from '../stated-by-user.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';

const TOOL = 'propose_goal_current_level';
const GOAL = 'mrr';
const CAP = 25000;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400ca';
const SESSION = 'sess-goal-grounded';

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> } & Record<string, unknown>;
type Graph = { nodes: Node[]; edges: unknown[] } & Record<string, unknown>;
type Proposed = ToolResult & { proposal_id?: string; refusal?: string; detail?: string; current_level?: { value: number; unit?: string } };

const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as Graph;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const goalOf = (g: Graph): Node => g.nodes.find((n) => n.id === GOAL)!;

/** What the Agent passes for the goal's current level, claiming it as the user's. */
const T2 = { goal_label: 'MRR', value: 12000, unit: 'GBP', goal_is: 'at_least', user_stated: true };

/** The tool context the route builds: the user's own typed words, or none bound. */
const ctxSaying = (user_text: string | undefined) => ({
  scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-goal-grounded', ...(user_text !== undefined ? { user_text } : {}),
});

function setup() {
  let graph = clone(paulGraph);
  let rev = 0;
  const registers: unknown[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      return { status: 200, json: { graph: clone(graph), graph_hash: `h${rev}`, graph_identity_hash: { value: `id-h${rev}` } } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const b = clone(body) as { graph: Graph; expected_graph_hash?: string };
      registers.push(b);
      if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph;
      rev += 1;
      return { status: 200, json: { graph_hash: `h${rev}`, model_version: { version_number: rev + 1, version_id: `v${rev}`, mutation_id: `m${rev}` } } };
    }
    return { status: 500, json: {} };
  };
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals);
  const call = (name: string, args: Record<string, unknown>, userText: string | undefined): Promise<Proposed> =>
    dispatchTool(name, JSON.stringify(args), ctxSaying(userText), caps) as Promise<Proposed>;
  return { call, proposals, registers, graph: () => graph };
}

/** Refused as not the user's figure: nothing prepared, nothing registered, the goal unchanged, and the ask is said. */
async function refusedAsNotWritten(args: Record<string, unknown>, userText: string | undefined): Promise<Proposed> {
  const s = setup();
  const r = await s.call(TOOL, args, userText);
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.mutated).toBe(false);
  expect(r.refusal, JSON.stringify(r)).toBe('figure_not_in_users_words');
  expect(r).not.toHaveProperty('proposal_id');
  expect(s.proposals.outstanding(SCENARIO, null)).toEqual([]);
  expect(s.registers).toEqual([]);
  expect(goalOf(s.graph())).toStrictEqual(goalOf(paulGraph));
  expect(r.detail).toContain('"MRR"');
  expect(r.detail).toContain('Nothing was prepared');
  expect(r.detail).toContain('ask the user');
  return r;
}

/** Proposed as the user's figure, and on approval recorded with the user's stamp at `raw`. */
async function proposedAndRecorded(args: Record<string, unknown>, userText: string | undefined, raw: number) {
  const s = setup();
  const r = await s.call(TOOL, args, userText);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(typeof r.proposal_id).toBe('string');
  expect(s.proposals.get(r.proposal_id!)?.provenance.authored_by).toBe('user_stated');
  expect(r.current_level?.value).toBe(raw);
  const applied = await s.call('authorise_change', { proposal_id: r.proposal_id }, userText);
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  expect(goalOf(s.graph()).observed_state).toMatchObject({ raw_value: raw, baseline: raw / CAP, source: USER_EDIT_SOURCE });
  return { s, r };
}

describe('RED — the Agent says user_stated: true, but the user never wrote the figure → nothing prepared, and asked for', () => {
  it('the user typed no figure at all ("Record our current MRR as the baseline.")', async () => {
    const r = await refusedAsNotWritten(T2, 'Record our current MRR as the baseline.');
    expect(r.detail).toContain('12000');
  });

  it('the user typed another figure — the target ("We want MRR of at least £20,000.") — never today\'s level', async () => {
    await refusedAsNotWritten(T2, 'We want MRR of at least £20,000.');
  });

  it('no words bound to the tool at all → nothing is the user\'s', async () => {
    await refusedAsNotWritten(T2, undefined);
    await refusedAsNotWritten(T2, '');
  });

  it('the figure is only in Olumi\'s own text (a chip replaying the Agent\'s label) — never typed, so never the user\'s', async () => {
    const chip = { kind: 'message', source: 'chip', chip: { id: 'agent-approve-proposal:gcl_1' }, message: 'Yes, record MRR as £12,000.' };
    expect(typedByUser(chip)).toBe(false);
    await refusedAsNotWritten(T2, userWordsOf(['What is our chance of reaching £20k MRR?'], typedByUser(chip) ? chip.message : null));
  });

  it('"£12k" typed, the Agent dropped the suffix ({12, GBP}) → never recorded as £12 (1000x too small)', async () => {
    await refusedAsNotWritten({ ...T2, value: 12, unit: 'GBP' }, 'Our MRR is £12k right now.');
  });

  it('the user wrote 12% (another kind) — never a GBP figure of 12', async () => {
    await refusedAsNotWritten({ ...T2, value: 12, unit: 'GBP' }, 'Churn is about 12% a month.');
  });
});

describe('CONTROLS — a figure the user typed is proposed, and recorded as theirs', () => {
  it('"our MRR is £12,000 today" → proposed, and recorded as raw 12000 with the user\'s stamp', async () => {
    await proposedAndRecorded(T2, 'our MRR is £12,000 today', 12000);
  });

  it('"£12k" typed, the Agent passes {12, "£k"} → proposed and scaled to 12000, with the M-rung\'s stamp', async () => {
    const { s } = await proposedAndRecorded({ ...T2, value: 12, unit: '£k' }, 'Our MRR is £12k right now.', 12000);
    expect(goalOf(s.graph()).observed_state?.provenance_unit_normalised).toStrictEqual({ rule: 'agent_lane_limit_magnitude_v1', original_value: 12, original_unit: '£k' });
  });

  it('"£12k" typed, the Agent passes the figure in full ({12000, GBP}) → proposed', async () => {
    await proposedAndRecorded(T2, 'Our MRR is £12k right now.', 12000);
  });
});

describe('ANOTHER TURN of the user\'s own words (#1978\'s `userWordsOf` contract, pinned)', () => {
  /** The route's own three lines (`agent-v1-turn.ts`), over a real HistoryStore: typed words are recorded, chips never. */
  const turn = (histories: HistoryStore, body: Record<string, unknown>): string => {
    const typedNow = typedByUser(body) ? String(body.message) : null;
    const userText = userWordsOf(histories.typedWords(SESSION), typedNow);
    if (typedNow !== null) histories.recordTyped(SESSION, typedNow);
    return userText;
  };

  it('typed in an EARLIER turn ("Our current MRR is £12,000."), recorded on "Please record that." → proposed', async () => {
    const histories = new HistoryStore();
    turn(histories, { kind: 'message', message: 'Our current MRR is £12,000.' });
    const now = turn(histories, { kind: 'message', message: 'Please record that as today\'s level.' });
    await proposedAndRecorded(T2, now, 12000);
  });

  it('typed earlier, then a chip click (whose own text is not the user\'s) → still the user\'s figure, proposed', async () => {
    const histories = new HistoryStore();
    turn(histories, { kind: 'message', message: 'Our current MRR is £12,000.' });
    const now = turn(histories, { kind: 'message', source: 'chip', chip: { id: 'agent-suggestion' }, message: 'Record the current level.' });
    await proposedAndRecorded(T2, now, 12000);
  });

  it('after a restart the earlier words are gone (a fresh store) → refused and asked for, never assumed', async () => {
    const histories = new HistoryStore();
    const now = turn(histories, { kind: 'message', source: 'chip', chip: { id: 'agent-suggestion' }, message: 'Record the current level.' });
    await refusedAsNotWritten(T2, now);
  });
});
