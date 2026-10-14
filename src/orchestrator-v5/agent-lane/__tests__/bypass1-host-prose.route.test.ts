import { runPressToolResponse } from './fixtures/run-press-model.js';
/**
 * ⭐ BYPASS1 THROUGH THE ROUTE (DL, 14 Oct). Harness: target-not-testable-beside-ranges.route.test.ts (served b9-1 readback,
 * real route, scripted AI, no provider contacted). Was: S2l THROUGH THE ROUTE: what the model is sent when the user presses Explain on the SERVED Wave B9 unseen b9-1 Run
 * (guest, staging, CEE df15c8c1; `waveB9-unseen1-df15c8c-readback-pre-challenge.json`, the graph read verbatim). Its screen
 * showed three range lines; its not-testable record (scoped to `carry_on_as_now`) kept the producer's unscoped message,
 * and the Challenge said "Without sized profit effects, the model cannot test your £24,000 target." Harness copied from
 * decision-sensitivity-screen-gate.route.test.ts (real route, fixed narrator, no provider contacted).
 */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { RUN_COMPARISON_NOTE } from '../runtime/agent-capabilities.js';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('./fixtures/waveB9-unseen1-df15c8c-readback-pre-challenge.json', import.meta.url), 'utf8')) as { j: Json }).j;
const SCENARIO = '7e6d5c4b-3a2f-4e1d-8c9b-6a5f4e3d2c1b';
/** Capacity witness (CEE 351eeda0, `JUDGE-capacity-post2996-codex.md` row 4): the served graph read after its second Run. */
const CAPACITY = ((): Json => {
  const j = (JSON.parse(readFileSync(new URL('./fixtures/capacity-post2996-run2-read.json', import.meta.url), 'utf8')) as { j: Json }).j;
  return { ...j, scenario_id: SCENARIO };
})();
/**
 * Capacity on CEE 5b6e5eb7 (live run 2026-10-14T065335Z-capacity-post3017, judge row 4): the served graph read right after
 * turn 01, its bound current card saying "‘Add one specialist’: about 34% chance …" while the reply said it again.
 */
const CAPACITY_3017 = ((): Json => {
  const j = (JSON.parse(readFileSync(new URL('./fixtures/capacity-post3017-turn01-read.json', import.meta.url), 'utf8')) as { j: Json }).j;
  return { ...j, scenario_id: SCENARIO };
})();
const count = (text: string, part: string): number => text.split(part).length - 1;
/** The served Run's depends sentence (the route's own output on CAPACITY_3017, before and after #3027). */
const DEPENDS_3017 = 'It rests most on Olumi’s own estimate of how strongly ‘Additional specialist capacity’ affects ‘Weekly support capacity’: if that effect is weaker than Olumi assumed, the chance falls. Is that estimate right?';
/** The faces the shipped card displays: each option cell that shows a chance (`figure` or `range`). */
const cardFaces = (view: Json | undefined): string[] => ((view?.options ?? []) as { cell: { kind: string; face?: string } }[])
  .filter((o) => o.cell.kind === 'figure' || o.cell.kind === 'range').map((o) => o.cell.face!);

const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  // The canonical view ships only when the stored scenario still matches the read (`canonicalViewBasisUnchanged`): the
  // served read's own graph and revision, else no view (as before).
  readExistingScenario: vi.fn(async () => servedScenario()),
};
let servedScenario = (): { revision: unknown; graph: unknown } | null => null;
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const NO_TARGET_GRAPH = ((): Json => {
  const g = structuredClone(READ.graph) as Json;
  const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
  for (const k of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold_cap_provenance', 'success_threshold', 'threshold_source']) delete goal[k];
  return g;
})();
const CHANCE_LINE = /% chance of meeting your goal, in this model/;
/** The AIE's two texts (#94 6158232014): Q4 reaches Agent and Explain; the stated-figure rule only calls that offer tools. */
const Q4 = 'When the supplied, current bound state records a blocker for this turn';
const STATED_FIGURE = 'When the user supplies a figure that an available proposing tool can faithfully represent';
const ESTIMATES_FACE = /Olumi's estimates: \d+, see Check estimates\./;

describe('BYPASS1: host prose stops only where the AI wrote the reply; the facts reach the AI', () => {
  let app: FastifyInstance;
  let graph: Json = READ.graph;
  let state: Json = READ.analysis_state;
  const sent: string[] = [];
  /** Scripted model outputs, one per provider call; empty → the plain answer below. */
  let outputs: Record<string, unknown>[][] = [];
  /** A served graph read, verbatim (its own canonical view); null → the b9-1 read above. */
  let served: Json | null = null;
  /** The Run response's own state, when it differs from the read's (another Run's stamp); null → the read's. */
  let runResponseState: Json | null = null;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const runCall = runPressToolResponse(JSON.parse(String(init?.body ?? '{}')));
      if (runCall) return runCall;
      sent.push(typeof init?.body === 'string' ? init.body : '');
      const output = outputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis ran.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: served?.graph_hash ?? READ.graph_hash,
      blocks: [served?.analysis_result ?? READ.analysis_result], analysis_ready: served?.analysis_ready ?? READ.analysis_ready,
      analysis_state: runResponseState ?? served?.analysis_state ?? state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => served ?? withCanonicalAnalysisView({
      graph, graph_hash: READ.graph_hash, analysis_state: state,
      analysis_ready: READ.analysis_ready, analysis_result: READ.analysis_result,
    }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); sent.length = 0; graph = READ.graph; state = READ.analysis_state; outputs = []; served = null; runResponseState = null; });
  servedScenario = () => served === null ? null
    : { revision: (served.canonical_analysis_view as Json | undefined)?.staleness?.revision, graph: served.graph };

  /** DGAI's own Run press (sendTurn → buildV5Payload, e218e3d2: turn_class 'frame', a bound run_analysis chip). */
  const runPress = async (): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };

  const NO_LEADER_CLOSING = /No single option can be put forward/;
  const RANKING = 'Open Clifton shop is the best option to choose.';

  it('NEGATIVE (host-written): the Run press is the host\'s reply, so it keeps every host line', async () => {
    const run = await runPress();
    expect(run._diagnostic_trace.reply_author).toBe('host');
    expect(run.assistant_text).toMatch(CHANCE_LINE);
    expect(run.assistant_text).toMatch(ESTIMATES_FACE);
  });

  it('AI-written Run (a typed "Run it"): the chance face stays, and the step the host no longer asks is in the AI\'s input', async () => {
    graph = NO_TARGET_GRAPH;
    outputs = [[{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis ran.' }] }]];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: 'Run it', source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json() as Json;
    expect((b._agent.tool_calls as { name: string }[]).map((c) => c.name)).toContain('run_analysis');
    expect(b._diagnostic_trace.reply_author).toBe('ai');
    expect(b.assistant_text).toMatch(CHANCE_LINE);
    expect(b.assistant_text).toContain('The analysis ran.');
    expect(sent[0] ?? '').toContain('goal_target_missing');
    expect(sent[0] ?? '').toContain(Q4);
    expect(sent[0] ?? '').toContain(STATED_FIGURE);
  });

  it('AI-written Explain with a ranking sentence: the gate still drops it (authority) and says why it cut it', async () => {
    // The served Run named its leader; here the comparison is withheld (the separation could not be established).
    state = { ...READ.analysis_state, leader_claim: { permitted: false, separation: 'not_separated', withheld_reason: 'separation_unavailable' } };
    const run = await runPress();
    const chip = (run.suggested_actions as { id: string }[]).find((c) => c.id.startsWith('agent-explain-run:'));
    expect(chip, JSON.stringify(run.suggested_actions)).toBeDefined();
    sent.length = 0;
    outputs = [[{ type: 'message', content: [{ type: 'output_text', text: `The analysis ran. ${RANKING}` }] }]];
    const e = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: RUN_EXPLANATION_MESSAGE, source: 'chip_click', chip: { id: chip!.id } } });
    expect(e.statusCode, e.body).toBe(200);
    const explain = e.json() as Json;
    expect(explain._diagnostic_trace.fast_path).toBe('explain');
    expect(explain._diagnostic_trace.reply_author).toBe('ai');
    expect(explain.assistant_text).toContain('The analysis ran.');
    expect(explain.assistant_text).not.toContain(RANKING);
    // The gate appends its reason only when it cut a sentence: the reply accounts for the cut (CI on #3001: 9 protected rows).
    expect(explain.assistant_text).toMatch(NO_LEADER_CLOSING);
    expect(sent[0] ?? '').toContain('goal_chance_range_display');
    // Tool-less Explain: the next-step rule, never the tool-use rule.
    expect(sent[0] ?? '').toContain(Q4);
    expect(sent[0] ?? '').not.toContain(STATED_FIGURE);
  });

  it('the typed blocker reaches the AI as a fact: a goal with no target is the ONE step, and no host line says it', async () => {
    graph = NO_TARGET_GRAPH;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: 'What should I do next?', source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    const body = sent.find((b) => b.includes('CURRENT MODEL STATE'));
    expect(body, 'the converse call carries the state').toBeDefined();
    const state = JSON.stringify(JSON.parse(body!));
    expect(state).toContain('next_step_blocker');
    expect(state).toContain('goal_target_missing');
    expect(state).toContain('monthly profit');
    const reply = (r.json() as Json).assistant_text as string;
    expect(reply.startsWith('The analysis ran.')).toBe(true);
    // No host target ask: the AI asks it from the fact (the conditional basis, whose sentence the AI lacks, stays).
    expect(reply).not.toMatch(/as your target\./);
  });

  /**
   * ⭐ CAPACITY WITNESS (351eeda0): the Run's card (DGAI `goalChanceDetailLines`, from this response's
   * `canonical_analysis_view.goal_chance`) says the status quo line and the notes; the reply said them again, so the user
   * read "Doing nothing: … by assumption." twice. Each is now on screen ONCE: in the card, not repeated in the reply.
   */
  it('capacity Run press: the card says the status quo line and the notes, and the reply does not repeat them', async () => {
    served = CAPACITY;
    const run = await runPress();
    const detail = run.canonical_analysis_view?.goal_chance as { status_quo: { line: string }; notes: string[] };
    expect((run.blocks as { type: string }[])[0]?.type).toBe('analysis_result');
    expect(detail.status_quo.line).toBe('Doing nothing: no change to ‘Weekly support capacity’ in this model, by assumption.');
    expect(detail.notes.length).toBeGreaterThan(0);
    const reply = run.assistant_text as string;
    for (const line of [detail.status_quo.line, ...detail.notes]) expect(count(reply, line), line).toBe(0);
    // ⭐ AMENDED (DL, PL #94 07:24Z: THE RESULT CARD IS THE CHANCE). Was "the headline stays in the reply: the chance and its
    // shortfall sentence, once each". The card's own cell face carries both, so the reply says neither again.
    const faces = cardFaces(run.canonical_analysis_view);
    expect(faces).toEqual([expect.stringContaining('In its worst 1 in 20 runs of this model, ‘Add one specialist’ falls short of your target by 20 tickets per week or more.')]);
    for (const face of faces) expect(count(reply, face), face).toBe(0);
    expect(reply).not.toMatch(CHANCE_LINE);
    expect(count(reply, 'In its worst 1 in 20 runs of this model, ‘Add one specialist’ falls short of your target by 20 tickets per week or more.')).toBe(0);
    // DL ruling on #3027 (PL 07:45Z): the coaching question on the consequential assumption, and what would change it, stay.
    expect(count(reply, 'It rests most on Olumi’s own assumption that ‘Additional specialist capacity’ affects ‘Weekly support capacity’: in the model runs without that link, the chance is less than 1%. Is that right?')).toBe(1);
    expect(count(reply, 'What would change it: ')).toBe(1);
  });

  it('CONTRAST: with no canonical view to ship, the card cannot say the detail, so the reply still says it once', async () => {
    const { canonical_analysis_view: _dropped, ...withoutView } = CAPACITY;
    served = withoutView;
    const run = await runPress();
    expect(run.canonical_analysis_view).toBeUndefined();
    expect(count(run.assistant_text as string, 'Doing nothing: no change to ‘Weekly support capacity’ in this model, by assumption.')).toBe(1);
    // The truthful fallback: no card displays the chance, so the reply says it, with its shortfall, once.
    expect(run.assistant_text).toMatch(CHANCE_LINE);
    expect(count(run.assistant_text as string, 'In its worst 1 in 20 runs of this model, ‘Add one specialist’ falls short of your target by 20 tickets per week or more.')).toBe(1);
  });

  /**
   * ⭐ THE RESULT CARD IS THE CHANCE, ON THE SERVED 5b6e5eb7 TURN-01 SHAPE (capacity post3017 row 4). The card (DGAI
   * `V5AnalysisResultBlock`, bound to this response's `canonical_analysis_view` by run id and hash) displays each option's
   * face; the host does not say it again in the reply, so the chance is on screen once. No displayed card → the line stays.
   */
  it('RED (served 5b6e5eb7 turn 01): the bound current card displays the chance, and the reply does not say it again', async () => {
    served = CAPACITY_3017;
    const run = await runPress();
    const view = run.canonical_analysis_view as Json;
    expect(view.run.graph_hash_at_run).toBe(CAPACITY_3017.analysis_result.computed_against_hash);
    expect(view.staleness.stale).toBe(false);
    const faces = cardFaces(view);
    expect(faces).toEqual([expect.stringMatching(/^‘Add one specialist’: about 34% chance of meeting your goal, in this model/)]);
    const reply = run.assistant_text as string;
    expect(count(reply, faces[0]!)).toBe(0);
    expect(reply).not.toMatch(CHANCE_LINE);
    // DL ruling on #3027 (PL 07:45Z): what the chance rests on is still said, once, and so is what would change it.
    expect(count(reply, DEPENDS_3017)).toBe(1);
    expect(count(reply, 'What would change it: ')).toBe(1);
  });

  it('CONTRAST (served 5b6e5eb7 turn 01, no card to display): the reply keeps the canonical chance line, once', async () => {
    const { canonical_analysis_view: view, ...withoutView } = CAPACITY_3017;
    served = withoutView;
    const run = await runPress();
    expect(run.canonical_analysis_view).toBeUndefined();
    const face = cardFaces(view as Json)[0]!;
    expect(count(run.assistant_text as string, face)).toBe(1);
    expect(count(run.assistant_text as string, DEPENDS_3017)).toBe(1);
  });

  /**
   * ⛔ EQUAL VALUES ARE NOT THE RUN'S IDENTITY (DL lesson 08:08Z). DGAI binds the card to the SAME turn's view only by a
   * non-empty `run.run_id` and the block's `computed_against_hash` equal to `run.graph_hash_at_run` (`mapV5Blocks`,
   * `matchesCanonicalRun(by 'card')`). Hashes that are both absent are equal, and a view with no run id has an equal hash,
   * but neither card displays the face, so the reply keeps the line.
   */
  it('ADVERSARIAL (served 5b6e5eb7 turn 01): the hashes agree but the view names no Run, so no card shows the face; the line stays', async () => {
    const view = structuredClone(CAPACITY_3017.canonical_analysis_view) as Json;
    delete view.run.run_id;
    expect(view.run.graph_hash_at_run).toBe(CAPACITY_3017.analysis_result.computed_against_hash);
    served = { ...CAPACITY_3017, canonical_analysis_view: view };
    const run = await runPress();
    expect(count(run.assistant_text as string, cardFaces(view)[0]!)).toBe(1);
  });

  it('ADVERSARIAL (served 5b6e5eb7 turn 01): both hashes absent are equal but bind nothing; the line stays', async () => {
    const view = structuredClone(CAPACITY_3017.canonical_analysis_view) as Json;
    delete view.run.graph_hash_at_run;
    const { computed_against_hash: _gone, ...result } = CAPACITY_3017.analysis_result as Json;
    served = { ...CAPACITY_3017, canonical_analysis_view: view, analysis_result: result };
    const run = await runPress();
    expect(count(run.assistant_text as string, cardFaces(view)[0]!)).toBe(1);
  });

  it('ADVERSARIAL (Codex r1 probe, served 5b6e5eb7 turn 01): an EARLIER Run of the same graph is not this turn\'s Run; the line stays', async () => {
    const view = structuredClone(CAPACITY_3017.canonical_analysis_view) as Json;
    view.run = { ...view.run, run_id: 'earlier-run', computed_at: '2026-10-13T06:54:24.046Z' };
    expect(view.run.graph_hash_at_run).toBe(CAPACITY_3017.analysis_result.computed_against_hash);
    served = { ...CAPACITY_3017, canonical_analysis_view: view };
    const run = await runPress();
    expect(count(run.assistant_text as string, cardFaces(view)[0]!)).toBe(1);
  });

  it('ADVERSARIAL (Codex r1 probe, capacity Run 2): a card face WITHOUT the shortfall sentence leaves the whole line said', async () => {
    const shortfall = 'In its worst 1 in 20 runs of this model, ‘Add one specialist’ falls short of your target by 20 tickets per week or more.';
    const view = structuredClone(CAPACITY.canonical_analysis_view) as Json;
    const cell = (view.options as { cell: Json }[]).find((o) => o.cell.kind === 'figure')!.cell;
    expect(cell.face).toContain(shortfall);
    cell.face = (cell.face as string).replace(` ${shortfall}`, '');
    served = { ...CAPACITY, canonical_analysis_view: view };
    const run = await runPress();
    expect(count(run.assistant_text as string, shortfall)).toBe(1);
    expect(count(run.assistant_text as string, cell.face as string)).toBe(1);
  });

  /**
   * ⭐ THE CARD SAYS IT (Paul via DL, 14 Oct): the withheld line the host added to a Run reply repeated the card's own
   * "Not shown. …" cell. The served 5b6e5eb7 turn-01 read with its Run withholding both options' chance (a
   * `GOAL_FIGURES_HORIZON_NOT_TESTED` warning added to that read, and both card cells withheld with its words: constructed
   * from the served read, not served). The owed line is the producer's own `say` for that result
   * (`goalChanceWithheldForAgent`), by identity; it asks the date, so no `say_shown` promise.
   */
  const NOT_TESTABLE = { code: 'GOAL_FIGURES_HORIZON_NOT_TESTED', severity: 'warning',
    message: "Not shown. Olumi can compare your options, but can't yet test them against your deadline.",
    say: "This Run can't yet show each option's chance by your deadline. Which date does \"by the end of that quarter\" mean?",
    node_ids: ['weekly_support_capacity'], option_ids: ['keep_current_staffing', 'add_one_specialist'] };
  const withNotTestable = (cardCells: boolean): Json => {
    const read = structuredClone(CAPACITY_3017) as Json;
    const enrichment = read.analysis_result.enrichment as Json;
    enrichment.inference_warnings = [...(enrichment.inference_warnings ?? []), NOT_TESTABLE];
    if (cardCells) for (const o of read.canonical_analysis_view.options as Json[]) {
      o.cell = { kind: 'withheld', face: 'Not shown', why: NOT_TESTABLE.message, reasons: [{ code: NOT_TESTABLE.code, message: NOT_TESTABLE.message }] };
    }
    return read;
  };
  /** The withheld line the host owes for that Run: the producer's own `say`, never retyped here. */
  const owedSay = (read: Json): string => goalChanceWithheldForAgent(read.analysis_result, read.graph)!.say;
  /** How often each sentence of that line is in the reply (the composer may lay its question out as a bullet). */
  const saidTimes = (reply: string, read: Json): number[] => (owedSay(read).match(/[^.?!]+[.?!]/g) ?? []).map((x) => count(reply, x.trim()));

  it('RED (the card says it): the bound current card shows both options withheld with the reason; the reply does not repeat it', async () => {
    served = withNotTestable(true);
    const run = await runPress();
    expect((run.canonical_analysis_view.options as Json[]).map((o) => o.cell.why)).toEqual([NOT_TESTABLE.message, NOT_TESTABLE.message]);
    expect(owedSay(served).includes('?'), 'no say_shown promise').toBe(true);
    expect(saidTimes(run.assistant_text as string, served)).toEqual([0, 0]);
  });

  it('CONTRAST (the card says it): with no card to show the withheld cells, the reply keeps the line, once', async () => {
    const { canonical_analysis_view: _dropped, ...withoutView } = withNotTestable(true);
    served = withoutView;
    const run = await runPress();
    expect(run.canonical_analysis_view).toBeUndefined();
    expect(saidTimes(run.assistant_text as string, served)).toEqual([1, 1]);
  });

  it('CONTRAST (the card says it): a bound card that still shows a figure for an option the line covers keeps the line', async () => {
    served = withNotTestable(false);
    const run = await runPress();
    expect(saidTimes(run.assistant_text as string, served)).toEqual([1, 1]);
  });

  /**
   * ⭐ COACH ON THE NEW RESULT, AGAINST THE PRECEDING RUN (Paul #94 6166259456; DL 14 Oct). The served capacity Run 2 read
   * (CEE 351eeda0) holds its preceding Run's delta (`current_read.run_delta`, C1). The Run's own output to the AI now carries
   * the comparison facts and the note, so the AI's reply can coach and compare; proven in the AI's actual request body.
   */
  const comparisonSent = (): Json | undefined => {
    for (const body of sent) {
      const parsed = JSON.parse(body) as Json;
      const items = (parsed.input ?? []) as Json[];
      for (const item of items) {
        if (item.type !== 'function_call_output' || typeof item.output !== 'string') continue;
        const out = JSON.parse(item.output) as Json;
        if (out.run_comparison !== undefined) return out.run_comparison as Json;
      }
    }
    return undefined;
  };

  /** The AI's own Run (a typed "Run it": its run_analysis call), whose tool output reaches the AI's next request. */
  const aiRun = async (): Promise<Json> => {
    outputs = [[{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis ran.' }] }]];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: 'Run it', source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json() as Json;
    expect((b._agent.tool_calls as { name: string }[]).map((c) => c.name)).toContain('run_analysis');
    return b;
  };

  it('RED (coach and compare): after a Run with a preceding Run, the AI receives the comparison facts and the note', async () => {
    served = CAPACITY;
    expect(CAPACITY.current_read.run_delta).toBeDefined();
    await aiRun();
    const comparison = comparisonSent();
    expect(comparison?.note).toBe(RUN_COMPARISON_NOTE);
    expect(comparison?.run_delta !== undefined || comparison?.rerun_record !== undefined).toBe(true);
  });

  it('CONTRAST (coach and compare): a first Run (no preceding Run) gets no comparison', async () => {
    served = CAPACITY_3017;
    expect(CAPACITY_3017.current_read.run_delta).toBeUndefined();
    await aiRun();
    expect(comparisonSent()).toBeUndefined();
  });

  it('ADVERSARIAL (coach and compare): a read whose selected Run is not this Run (same hash, another computed_at) adds nothing', async () => {
    served = CAPACITY;
    runResponseState = { ...CAPACITY.analysis_state, run_state: { ...CAPACITY.analysis_state.run_state, computed_at: '2026-10-13T06:54:24.046Z' } };
    await aiRun();
    expect(comparisonSent()).toBeUndefined();
  });

  it('CONTRAST (served 5b6e5eb7 turn 01, a stale card): the card is not the current Run, so the reply keeps the line', async () => {
    const view = structuredClone(CAPACITY_3017.canonical_analysis_view) as Json;
    view.staleness = { ...view.staleness, stale: true };
    served = { ...CAPACITY_3017, canonical_analysis_view: view };
    const run = await runPress();
    expect(count(run.assistant_text as string, cardFaces(view)[0]!)).toBe(1);
  });
});
