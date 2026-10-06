/**
 * M2 RERUN-EXPLANATION through the LIVE route (CODEX CEE BUDDY preflight 5939219187: "rejected words must disappear from
 * wire/history/replay"). Request 2 of a result-first Run, with the selected Run's `current_read.run_delta` carrying the
 * final seed's two Accepts and `prior_withheld`. The model is stubbed; the store double reads rows back as the real store
 * does (the `result-first-replay.route` harness).
 *   · a reply claiming a movement → the wire says Olumi's code line, no stored row holds the claim, and a replay re-serves
 *     it (never the claim);
 *   · CONTROL: a clean model sentence is sent after the code line;
 *   · the typed provisional view (C5b) with a movement claim is not shown; CONTROL: a clean view is (Codex pre-review P1).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRunExplanationChip, RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { rerunExplanationPlan } from '../rerun-explanation.js';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-withheld-leader-0948Z.json', import.meta.url), 'utf8')) as {
  analysis_state: Record<string, unknown>;
  block: Record<string, unknown>;
};
const SCENARIO = '3c9b1e2d-4f5a-4b6c-8d7e-9f0a1b2c3d77';
const HASH = String(SERVED.block.computed_against_hash);
const GRAPH = { nodes: [
  { id: 'g', kind: 'goal', label: 'Quarterly revenue' },
  { id: 'ai_reporting_sprint', kind: 'option', label: 'AI Reporting Sprint' },
  { id: 'sprint_capacity_for_ai_reporting', kind: 'factor', label: 'Sprint capacity for AI reporting' },
  { id: 'ai_reporting_module_availability', kind: 'factor', label: 'AI reporting module availability' },
], edges: [] };
const READY = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
const RUN_DELTA = {
  attribution_case: 'C1_attributable', input_coverage: 'complete', win_probabilities: [], win_probabilities_unavailable: 'prior_withheld',
  leader: { changed: true, noise_verdict: 'not_noise_qualified' },
  input_changes: [{ entity_kind: 'link', entity_id: 'l1', link: { from: 'sprint_capacity_for_ai_reporting', to: 'ai_reporting_module_availability' },
    field: 'sizing', before: { raw: 'placeholder' }, after: { raw: 'olumi_accepted' }, change: 'changed' }],
};
const SAID = "You accepted Olumi's estimate for how much Sprint capacity for AI reporting changes AI reporting module availability.";
const MOVED = `${SAID}\nAI Reporting Sprint's chance rose to 57%.`;
const WHY = 'The model now shows a provisional comparison of the options.';
const VIEW = { view: 'Before comparing, test how much sprint capacity moves the goal.', reasoning: 'It needs the least new capacity.', confirm_step: 'Size the sprint capacity link.' };
const labels = new Map(GRAPH.nodes.map((n) => [n.id, n.label] as const));
const FALLBACK = rerunExplanationPlan(RUN_DELTA, (id) => labels.get(id), ['AI Reporting Sprint'], false)!.fallback;

type Row = Record<string, unknown>;
const rows: Row[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => {
    const r = rows.find((x) => x.turn_id === id);
    return r === undefined ? null : { id: String(r.turn_id), request_hash: r.request_hash, assistant_message: r.assistantMessage ?? null,
      user_message: r.userMessage ?? null, llm_calls_used: r.llm_calls_used ?? 0, pending_actions: r.pending_actions ?? [] };
  }),
  append: vi.fn(async (row: Row) => { rows.push({ ...row }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let modelText = MOVED;
let modelCalls = 0;
const state = () => ({ ...SERVED.analysis_state, run_state: { kind: 'complete_current', computed_at: '2026-10-01T09:48:47.190Z' } });

type Body = { assistant_text: string; suggested_actions: { id: string }[]; _agent: { session_id: string; provisional_view?: unknown } };

describe('M2 RERUN-EXPLANATION on the live route: a rejected claim never reaches the wire, the stored rows or a replay', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: modelText }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: HASH, blocks: [SERVED.block], analysis_state: state(), analysis_ready: READY }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: HASH, analysis_ready: READY,
      analysis_state: state(), analysis_result: SERVED.block, current_read: { run_delta: RUN_DELTA } }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.length = 0; modelCalls = 0; modelText = MOVED; });

  const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { scenario_id: SCENARIO, ...payload } });
  const runTurn = (turnId: string) => post({ turn_id: turnId, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } });
  const explainTurn = (turnId: string, first: Body) => {
    const chip = first.suggested_actions.find((c) => isRunExplanationChip(c.id));
    expect(chip, JSON.stringify(first.suggested_actions)).toBeDefined();
    return post({ turn_id: turnId, agent_session_id: first._agent.session_id, message: RUN_EXPLANATION_MESSAGE, chip: { id: chip!.id } });
  };

  it('RED: the model claims "rose" with no prior figures → the wire says RC\'s fallback; no stored row holds "rose"; a replay re-serves the fallback', async () => {
    const first = (await runTurn(randomUUID())).json() as Body;
    const e1 = randomUUID();
    const explained = (await explainTurn(e1, first)).json() as Body;
    expect(modelCalls, 'the model really answered').toBe(1);
    expect(explained.assistant_text).toContain(FALLBACK);
    expect(explained.assistant_text).not.toMatch(/\brose\b/);
    expect(rows.length, 'the control: rows were written').toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/\brose\b/);
    const replay = (await explainTurn(e1, first)).json() as Body;
    expect(modelCalls, 'a replay calls no model').toBe(1);
    expect(replay.assistant_text).toContain(FALLBACK);
    expect(replay.assistant_text).not.toMatch(/\brose\b/);
  });

  it('CONTROL: a clean model sentence is sent after Olumi\'s code line', async () => {
    modelText = WHY;
    const first = (await runTurn(randomUUID())).json() as Body;
    const explained = (await explainTurn(randomUUID(), first)).json() as Body;
    expect(explained.assistant_text).toContain(`${FALLBACK}\n\n${WHY}`);
  });

  /**
   * ⛔ CODEX r2 on #2517: the narrator repeats Olumi's code line first; the composer drops the repeat and prepends the SAME
   * line, rebuilding the narrator's text byte for byte. An equality-only guard then shaped the reply, putting the code
   * line's own caveats behind "Show more". The host composed it, so it ships whole.
   */
  it('IDENTICAL RECONSTRUCTION: the narrator repeats Olumi\'s code line, the host restores it → the reply is NOT shaped', async () => {
    modelText = `${FALLBACK}\n\n${WHY}\n- Both options are compared on the same goal.\n- The comparison is provisional.\nAsk me what would change it.`;
    const first = (await runTurn(randomUUID())).json() as Body;
    const explained = (await explainTurn(randomUUID(), first)).json() as Body & { _answer_shape?: unknown; blocks?: { type?: string }[] };
    expect(explained.assistant_text.trim(), 'the control: the host rebuilt the narrator\'s exact text').toBe(modelText.trim());
    expect((explained.blocks ?? []).some((b) => b.type === 'analysis_result'), 'the control: an analysis-bearing reply').toBe(true);
    expect(explained._answer_shape, 'the host composed it → shipped whole').toBeUndefined();
  });

  it.each([
    ['RED: a movement claim in the typed view\'s reasoning → no provisional view on the wire', { ...VIEW, reasoning: 'Its chance rose from 40% to 57%.' }, false],
    ['CONTROL: a clean typed view → shown', VIEW, true],
  ])('%s', async (_n, view, shown) => {
    modelText = JSON.stringify({ answer: WHY, provisional_view: view });
    const first = (await runTurn(randomUUID())).json() as Body;
    const explained = (await explainTurn(randomUUID(), first)).json() as Body;
    expect(explained.assistant_text).toContain(FALLBACK);
    expect(explained._agent.provisional_view !== undefined, JSON.stringify(explained._agent.provisional_view ?? null)).toBe(shown);
    expect(JSON.stringify(explained)).not.toMatch(/\brose\b/);
  });
});
