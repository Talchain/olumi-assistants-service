/**
 * ⭐ STEP 1, ITEM 2 (DL 5947906652 marker-only; RC rule (1) `method_turns.shared.model_scale_outcome` @c04a14a1; HARNESS
 * #85 5947874597): on a run F1b marks `GOAL_OUTCOME_MODEL_SCALE`, the first explanation says WHY the outcome can't be read
 * in the goal's own units and ONE next step, Olumi's words first; the narrator never reads the marked outcome figures; a
 * narration that still names an internal value is replaced WHOLE (backstop).
 *
 * The run is SERVED: R3 f5 journey-10 (`fixtures/j10-no-target-run.json`), the RC corpus's internal-scale hit — a goal with
 * no target and no current level, option outcomes ≈ 0.02 on the model's scale. The marker is F1b's pinned shape (#85
 * 5947982233), added to that run's own `inference_warnings`; the producer is F1b's (not yet on staging). The model call is a
 * stubbed `fetch`: no provider is contacted.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  GOAL_OUTCOME_MODEL_SCALE, MODEL_SCALE_OUTCOME_COPY, modelScaleMarkerOf, modelScaleOutcomeLines, modelScaleOutcomeOptionIds,
} from '../model-scale-outcome.js';
import { analysisResultForAgent } from '../decision-sensitivity.js';

type Rec = Record<string, unknown>;
const RUN = JSON.parse(readFileSync(new URL('./fixtures/j10-no-target-run.json', import.meta.url), 'utf8')) as {
  scenario_id: string; graph: { nodes: Rec[] }; graph_hash: string; analysis_state: Rec; analysis_ready: unknown;
  analysis_result: { enrichment: { option_comparison: Rec[]; inference_warnings: Rec[] } } & Rec;
};
const OPTION_IDS = RUN.analysis_result.enrichment.option_comparison.map((o) => String(o.option_id ?? o.id));
const GOAL = 'Quarterly revenue';
/** F1b's pinned marker (#85 5947982233), P1: no current level on the goal. */
const P1_MARKER = { code: GOAL_OUTCOME_MODEL_SCALE, message: 'Outcome figures are on the model scale.', severity: 'info',
  node_ids: ['quarterly_revenue'], option_ids: OPTION_IDS, precondition: 'P1', goal_label: GOAL };
const withMarker = (marker: Rec | null) => {
  const r = structuredClone(RUN.analysis_result);
  if (marker !== null) r.enrichment.inference_warnings = [...r.enrichment.inference_warnings, marker];
  return r;
};
/** Does an option row still carry a model-scale figure: an outcome statistic, `expected_outcome` or a downside block? */
const figures = (r: Rec) => ['mean', 'std', 'p10', 'p50', 'p90'].some((k) => k in ((r.outcome ?? {}) as Rec)) || 'downside' in r || 'expected_outcome' in r;
const REASON_P1 = `Olumi can’t yet say what the options do to ${GOAL} in its own units: its current level isn’t set.`;
const NEXT_P1 = `Give today’s ${GOAL} and the next run can say it in its own units.`;

describe('model-scale-outcome: the marker\'s one reader (pure)', () => {
  it('RC\'s copy, verbatim (REASONING-INTERVENTIONS.json @c04a14a1 `method_turns.shared.model_scale_outcome`)', () => {
    expect(MODEL_SCALE_OUTCOME_COPY).toEqual({
      today_level: {
        reason: 'Olumi can’t yet say what the options do to {goal_label} in its own units: its current level isn’t set.',
        next_step: 'Give today’s {goal_label} and the next run can say it in its own units.',
      },
      placeholder_link: {
        reason: 'Olumi can’t yet say what the options do to {goal_label} in its own units: the link from {from_label} to {to_label} hasn’t been sized.',
        next_step: 'Size that link (accept Olumi’s estimate or give your own) and run again.',
      },
    });
  });
  it('P1 → the reason line, then the next step, filled verbatim from the marker', () => {
    expect(modelScaleOutcomeLines(modelScaleMarkerOf(withMarker(P1_MARKER)))).toEqual([REASON_P1, NEXT_P1]);
  });
  it('P5 → the link by its two labels; a missing fill drops BOTH lines (never an unresolved template)', () => {
    const p5 = { ...P1_MARKER, precondition: 'P5', from_label: 'AI reporting module availability', to_label: GOAL };
    expect(modelScaleOutcomeLines(modelScaleMarkerOf(withMarker(p5)))).toEqual([
      `Olumi can’t yet say what the options do to ${GOAL} in its own units: the link from AI reporting module availability to ${GOAL} hasn’t been sized.`,
      'Size that link (accept Olumi’s estimate or give your own) and run again.',
    ]);
    const { to_label: _gone, ...noTo } = p5;
    expect(modelScaleOutcomeLines(modelScaleMarkerOf(withMarker(noTo)))).toEqual([]);
    const { goal_label: _g, ...noGoal } = P1_MARKER;
    expect(modelScaleOutcomeLines(modelScaleMarkerOf(withMarker(noGoal)))).toEqual([]);
  });
  it('CONTROL: the served run as it is (no marker) → nothing is said and no option is marked', () => {
    expect(modelScaleMarkerOf(RUN.analysis_result)).toBeNull();
    expect(modelScaleOutcomeLines(modelScaleMarkerOf(RUN.analysis_result))).toEqual([]);
    expect([...modelScaleOutcomeOptionIds(RUN.analysis_result)]).toEqual([]);
  });
  it('a marker naming no options marks every option (fail closed)', () => {
    const { option_ids: _ids, ...all } = P1_MARKER;
    expect([...modelScaleOutcomeOptionIds(withMarker(all))]).toEqual(['*']);
  });
});

describe('the model never reads a marked outcome; the panel\'s data is untouched (`analysisResultForAgent`)', () => {
  const rowsOf = (v: unknown) => ((v as { enrichment: { option_comparison: Rec[] } }).enrichment.option_comparison);
  it('RED: marked → every option row loses its outcome statistics and `downside`; its share and sample count stay', () => {
    const served = rowsOf(withMarker(P1_MARKER));
    expect(served.every(figures), 'the control: the served rows carry model-scale figures').toBe(true);
    const seen = rowsOf(analysisResultForAgent(withMarker(P1_MARKER)));
    expect(seen.map(figures)).toEqual(seen.map(() => false));
    expect(seen.map((r) => r.win_probability)).toEqual(served.map((r) => r.win_probability));
    expect(seen.map((r) => (r.outcome as Rec).n_samples)).toEqual(served.map((r) => (r.outcome as Rec).n_samples));
  });
  it('CONTROL: unmarked → the same rows keep their figures (a withhold-free run is unchanged)', () => {
    expect(rowsOf(analysisResultForAgent(withMarker(null))).every(figures)).toBe(true);
  });
  it('only the options the marker names', () => {
    const one = { ...P1_MARKER, option_ids: [OPTION_IDS[0]] };
    expect(rowsOf(analysisResultForAgent(withMarker(one))).map(figures)).toEqual(OPTION_IDS.map((_id, i) => i !== 0));
  });
});

// ── The route: the Run button, then "Explain this result" (fast path 3, request 2) ──────────────────────────────────────
let resultBlock: Rec = withMarker(P1_MARKER);
const rows = new Map<string, { id: string; turn_id: string; request_hash: string; assistant_message: string | null }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

let callModelOutputs: Record<string, unknown>[][] = [];
const modelBodies: Rec[] = [];
type Body = { assistant_text: string; narration?: { status: string }; _answer_shape?: unknown; suggested_actions: { id: string; message?: string }[];
  _diagnostic_trace: { fast_path?: string }; _agent: { session_id?: string } };

describe('the explanation of a marked run (real route, stubbed provider)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')) as Rec);
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: RUN.graph_hash, blocks: [resultBlock],
      analysis_ready: RUN.analysis_ready, analysis_state: RUN.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: RUN.graph, graph_hash: RUN.graph_hash, analysis_state: RUN.analysis_state, analysis_ready: RUN.analysis_ready, analysis_result: resultBlock,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); callModelOutputs = []; modelBodies.length = 0; resultBlock = withMarker(P1_MARKER); });

  let seq = 0;
  const tid = () => { seq += 1; return `6e5d4c3b-2a1f-4e0d-9c8b-${String(seq).padStart(12, '0')}`; };
  const say = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
  /** Run, then press the Run's own "Explain this result" chip; the narrator says `text`. */
  const explain = async (text: string, scenario: string) => {
    const first = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: scenario, message: 'Run analysis.', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: tid(),
    } });
    expect(first.statusCode, first.body.slice(0, 300)).toBe(200);
    const chip = (first.json() as Body).suggested_actions.find((c) => c.id.startsWith('agent-explain-run:'));
    expect(chip, 'the control: the Run offers its explanation').toBeDefined();
    callModelOutputs = [say(text)];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      scenario_id: scenario, agent_session_id: (first.json() as Body)._agent.session_id, turn_id: tid(), message: chip!.message, chip: { id: chip!.id },
    } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect(callModelOutputs, 'the control: the narrator was called once').toEqual([]);
    const b = r.json() as Body;
    expect(b._diagnostic_trace.fast_path).toBe('explain');
    return b;
  };
  /** A served narration with bullets and no internal-value term (RC corpus 'clean' family). */
  const CLEAN = [
    'Neither sprint separates clearly from the other on this run.',
    '',
    '- AI Reporting Module Sprint and Integration Bug Fix Sprint come out close.',
    '- Continue Current Plan holds today’s recorded values.',
    '',
    'The next useful step is to set where quarterly revenue stands today.',
  ].join('\n');

  it('RED: a marked run → Olumi\'s reason line and next step FIRST, then the narrator\'s words; on the face (not shaped)', async () => {
    const b = await explain(CLEAN, '7f6e5d4c-3b2a-4f1e-8d0c-000000000001');
    expect(b.assistant_text).toBe(`${REASON_P1} ${NEXT_P1}\n\n${CLEAN}`);
    expect(b.narration?.status).toBe('ready');
    expect('_answer_shape' in b, 'Olumi\'s lines are host lines: never folded behind Show more').toBe(false);
  });

  /** The interpreter's own run payload: the LAST input item's text, parsed (it is JSON inside an input_text). */
  const interpreterRows = (): Rec[] => {
    const input = modelBodies.at(-1)?.input as { content?: { text?: string }[] }[];
    const payload = JSON.parse(input.at(-1)!.content![0]!.text!) as { result: { enrichment: { option_comparison: Rec[] } } };
    return payload.result.enrichment.option_comparison;
  };
  const MEAN = String((RUN.analysis_result.enrichment.option_comparison[0]!.outcome as Rec).mean);

  it('RED: the narrator\'s input carries NO model-scale figure of a marked option; CONTROL inside: the comparison is read', async () => {
    await explain(CLEAN, '7f6e5d4c-3b2a-4f1e-8d0c-000000000002');
    const read = interpreterRows();
    expect(read.length, 'the control: the narrator reads the option rows').toBe(OPTION_IDS.length);
    expect(read.map(figures)).toEqual(read.map(() => false));
    expect(JSON.stringify(modelBodies.at(-1)?.input).includes(MEAN), 'the served outcome mean, anywhere in the input').toBe(false);
  });

  it('CONTROL: the same run without the marker → no lead line (shaped as before), and the narrator reads the figures', async () => {
    resultBlock = withMarker(null);
    const b = await explain(CLEAN, '7f6e5d4c-3b2a-4f1e-8d0c-000000000003');
    expect(b.assistant_text.startsWith('Olumi can’t yet say')).toBe(false);
    expect(b._answer_shape, 'no host line: shaped, as before').toBeDefined();
    expect(interpreterRows().every(figures)).toBe(true);
  });

  it('BACKSTOP: a narration that names an internal value is replaced WHOLE (Olumi\'s lines + its own line); never trimmed', async () => {
    const leak = 'AI Reporting Module Sprint has a computed outcome, but only on an internal scale—not interpretable quarterly revenue.';
    const b = await explain(`${CLEAN}\n\n${leak}`, '7f6e5d4c-3b2a-4f1e-8d0c-000000000004');
    expect(b.assistant_text.startsWith(`${REASON_P1} ${NEXT_P1}\n\n`)).toBe(true);
    expect(b.assistant_text).not.toContain('internal scale');
    expect(b.assistant_text, 'whole, not per sentence: none of the narrator\'s words survive').not.toContain('come out close');
    expect(b.narration?.status).toBe('unavailable');
  });

  it('BACKSTOP on a SERVED reply (AIQ corpus `paired-57f903c/M.rep3`, which says "normalised scale") → replaced whole', async () => {
    resultBlock = withMarker(null);
    const served = (JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as
      { replies: { id: string; text: string }[] }).replies.find((r) => r.id === 'paired-57f903c/M.rep3')!.text;
    expect(served, 'the control: the served reply names an internal value').toMatch(/normalised scale/u);
    const b = await explain(served, '7f6e5d4c-3b2a-4f1e-8d0c-000000000006');
    expect(b.assistant_text).not.toMatch(/normalised scale/u);
    expect(b.assistant_text.includes(served.slice(0, 60)), 'none of the narrator\'s words survive').toBe(false);
    expect(b.narration?.status).toBe('unavailable');
  });

  it('CONTROL (label masking): a user\'s own label that says "internal scale" is the user\'s word → the narration stands', async () => {
    resultBlock = withMarker(null);
    const named = structuredClone(RUN.graph);
    (named.nodes.find((n) => n.kind === 'option') as Rec).label = 'Internal scale-up plan';
    const prior = RUN.graph;
    (RUN as { graph: unknown }).graph = named;
    try {
      const text = `${CLEAN}\n\nInternal scale-up plan holds today’s values.`;
      const b = await explain(text, '7f6e5d4c-3b2a-4f1e-8d0c-000000000005');
      expect(b.narration?.status).toBe('ready');
      expect(b.assistant_text).toContain('Internal scale-up plan holds today’s values.');
      expect(b.assistant_text).toContain('come out close');
    } finally { (RUN as { graph: unknown }).graph = prior; }
  });
});
