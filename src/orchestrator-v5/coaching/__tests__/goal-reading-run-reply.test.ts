/**
 * ⭐ THE RUN'S REPLY SAYS OLUMI'S READING OF THE GOAL — ADMITTED BY EXACT EQUALITY (AIQ 5895590866 (2); DL lease
 * 5895635885; MG 0-LLM check 5895465580: an append-only hook was silently swapped for the locked template).
 *
 * THE PATH: the REAL `buildModelFromBrief` on the served "cut costs" shape (R3-B 5894575583, `7c23be87`) → the
 * registered graph read back cold (`GraphV3`) → the REAL `run_analysis` handler, PLoT faked → the REAL registry forwarder
 * (`HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template`), i.e. the text the user receives. 0 LLM.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../../agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import { isAllowedRunAnalysisAssistantText } from '../analysis-result-headline.js';
import { buildGoalReadingDisclosure } from '../goal-reading-disclosure.js';

type Rec = Record<string, unknown>;
type Node = Rec & { id: string; kind: string; label: string };
type Graph = Rec & { nodes: Node[]; edges: Rec[]; goal_constraints?: unknown[] };

const SCENARIO = '6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b';
/** The served "cut costs" brief (R3-B 5894575583). */
const CLOUD = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';
const LEVEL_WORDS = 'Olumi reads your ‘£45k’ (‘Monthly spend is £45k’) as today\'s level of ‘costs’, so a 20% cut is £36,000 / month or less.';

/** The saved "costs" draft (11/12 of the saved change goals with no level): the £45k on no node. */
const COSTS = {
  goal: {
    metric: 'costs', operator: '<=', target_stated: true, value: -20, unit: '£/month', horizon_months: null, provenance: 'explicit',
    baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null, frame: 'change_rel',
  },
  constraints: [],
  options: [
    { label: 'Switch to GCP', provenance: 'explicit', changes: ['GCP workload share'], is_status_quo: false,
      interventions: [{ factor_label: 'GCP workload share', value: 100, value_kind: 'absolute', unit: '%', provenance: 'explicit' }] },
    { label: 'Stay on AWS', provenance: 'explicit', changes: ['GCP workload share'], is_status_quo: true,
      interventions: [{ factor_label: 'GCP workload share', value: 0, value_kind: 'absolute', unit: '%', provenance: 'explicit' }] },
  ],
  factors: [{ label: 'GCP workload share', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'inferred', plausible_max: 100 }],
  risks: [], outcomes: [], unknowns: [],
  links: [{ from: 'GCP workload share', to: 'costs', direction: 'negative', provenance: 'inferred' }],
};

let lastBuildResult: Rec | undefined;
async function build(brief: string, candidate: Rec): Promise<Graph> {
  let stored: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate) });
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  lastBuildResult = result;
  expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  return GraphV3.parse(JSON.parse(stored!)) as unknown as Graph;
}

/** The last request the faked PLoT received. */
let lastPlotRequest: Rec | undefined;
/** The REAL `run_analysis` handler over the graph, PLoT faked: its outcome. */
async function runOutcome(graph: Graph): Promise<Rec> {
  const run = vi.fn(async (request: unknown) => (lastPlotRequest = request as Rec, {
    meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed',
  }) as unknown as V2RunResponseEnvelope);
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const snapshot = {
    graph, rawPersistedGraph: graph,
    goal_node_id: graph.nodes.find((n) => n.kind === 'goal')!.id,
    goal_constraints: graph.goal_constraints,
    options: graph.nodes.filter((n) => n.kind === 'option').map((n) => ({
      id: n.id, option_id: n.id, label: n.label, interventions: mergeInterventionSourceObjects(n as never),
    })),
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: vi.fn(async () => snapshot) });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run, 'PLoT was called exactly once').toHaveBeenCalledTimes(1);
  return outcome as unknown as Rec;
}

/** What the user receives: the registry forwarder over the handler's outcome. */
function reply(outcome: Rec): string {
  const tmpl = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
  if (typeof tmpl !== 'function') throw new Error('expected a function template');
  return tmpl(outcome as never);
}
const count = (text: string, words: string): number => text.split(words).length - 1;
const goalId = (g: Graph): string => g.nodes.find((n) => n.kind === 'goal')!.id;

describe('the Run reply says Olumi\'s goal readings, admitted only as the builder\'s exact output for THIS graph', () => {
  it('⭐ RED (the served cut-costs shape): the reply the user receives says the £45k reading ONCE, after the Run\'s text', async () => {
    const g = await build(CLOUD, COSTS);
    const outcome = await runOutcome(g);
    const tail = buildGoalReadingDisclosure(g, goalId(g));
    expect(tail, 'PRECONDITION: the reading speaks for this graph').toContain(LEVEL_WORDS);
    const text = reply(outcome);
    expect(count(text, LEVEL_WORDS)).toBe(1);
    expect(text).toBe(outcome.assistant_text);
    expect(text.startsWith('Ran analysis on your current scenario.') || !text.startsWith(tail.trim())).toBe(true);
  });

  it('a MODEL-WRITTEN lookalike ("Olumi reads …", not the builder\'s output for this graph) → rejected, never shown', async () => {
    const g = await build(CLOUD, COSTS);
    const outcome = await runOutcome(g);
    const tail = buildGoalReadingDisclosure(g, goalId(g));
    const lookalike = ' Olumi reads your ‘£45k’ (‘Monthly spend is £45k’) as today\'s level of ‘costs’, so a 20% cut is £30,000 / month or less.';
    const forged = { ...outcome, assistant_text: String(outcome.assistant_text).replace(tail, lookalike) };
    expect(String(forged.assistant_text), 'PRECONDITION: the forged reply carries the lookalike').toContain(lookalike);
    const text = reply(forged);
    expect(text).not.toContain('Olumi reads');
    // The same lookalike with NO reading on the graph at all (the channel absent) → rejected too.
    const { __goal_reading_source: _gone, ...bare } = forged as Rec;
    expect(reply(bare)).not.toContain('Olumi reads');
  });

  it('a STALE reading (the level edited since: another figure) → the builder says nothing, and the old words are refused', async () => {
    const g = await build(CLOUD, COSTS);
    const fresh = await runOutcome(g);
    const oldTail = buildGoalReadingDisclosure(g, goalId(g));
    const edited = { ...g, nodes: g.nodes.map((n) => (n.kind === 'goal' ? { ...n, observed_state: { ...(n.observed_state as Rec), raw_value: 44000, value: 44000 } } : n)) } as Graph;
    expect(buildGoalReadingDisclosure(edited, goalId(edited))).toBe('');
    const staleRun = await runOutcome(edited);
    expect(String(staleRun.assistant_text)).not.toContain('Olumi reads');
    expect(Object.keys(staleRun)).not.toContain('__goal_reading_source');
    // The OLD words carried onto the stale Run's outcome (a cached reply) are refused: the rebuild is '' now.
    const replayed = { ...staleRun, assistant_text: String(fresh.assistant_text) };
    expect(String(replayed.assistant_text), 'PRECONDITION').toContain(oldTail);
    expect(reply(replayed)).not.toContain('Olumi reads');
  });

  it('CONTROL: a brief with no reading → no tail, no channel, the reply exactly as before', async () => {
    const g = await build('Should we switch our cloud provider from AWS to GCP? We want to cut costs by 20% this year.', COSTS);
    const outcome = await runOutcome(g);
    expect(Object.keys(outcome)).not.toContain('__goal_reading_source');
    expect(reply(outcome)).not.toContain('Olumi reads');
  });
});

// ⛔ PR Review CR on #2307 @ 23ebebd2: the drafter TYPES the support team's £45,000 as the cloud bill's level
// (`baseline_known`, `explicit`): the subject rule governs this "user wrote it" route too.
const SUPPORT = 'Our support team costs £45,000 a month and we want to cut our cloud bill by 15%.';
const typedLevel = (brief: string) => ({
  ...COSTS,
  goal: { ...COSTS.goal, metric: 'Monthly cloud bill', value: -15, unit: 'GBP per month', baseline_known: true, baseline_value: 45000, baseline_provenance: 'explicit' },
  links: [{ from: 'GCP workload share', to: 'Monthly cloud bill', direction: 'negative', provenance: 'inferred' }],
  _brief: brief,
});
describe('a figure stated for ANOTHER quantity never becomes the goal\'s level, whoever typed it', () => {
  it('RED (real build → Run): the drafter-typed support-team £45,000 → no base on the goal, none on the wire, no reading said', async () => {
    const { _brief, ...cand } = typedLevel(SUPPORT);
    const g = await build(_brief, cand);
    const goal = g.nodes.find((n) => n.kind === 'goal')!;
    expect(goal.observed_state).toBeUndefined();
    expect(goal.goal_level_reading).toBeUndefined();
    expect(JSON.stringify(lastBuildResult)).toContain('Tell me the current level of ‘Monthly cloud bill’');
    const outcome = await runOutcome(g);
    const wireGoal = ((lastPlotRequest!.graph as Graph).nodes).find((n) => n.id === goal.id)!;
    expect(wireGoal.observed_state).toBeUndefined();
    expect(reply(outcome)).not.toContain('Olumi reads');
  });
  it('CONTROL: the same typed level where the brief says it of the cloud bill → the user\'s own level is kept', async () => {
    const { _brief, ...cand } = typedLevel('Our cloud bill is £45,000 a month and we want to cut it by 15%.');
    const g = await build(_brief, cand);
    const goal = g.nodes.find((n) => n.kind === 'goal')!;
    expect((goal.observed_state as Rec | undefined)?.raw_value).toBe(45000);
    expect((goal.observed_state as Rec | undefined)?.source).toBe('brief_extraction');
  });
});

describe('isAllowedRunAnalysisAssistantText: the exact tail, once, straight after an admitted base', () => {
  const T = 'Ran analysis on your current scenario.';
  const TAIL = ` ${LEVEL_WORDS}`;
  it.each<[string, string, string, boolean]>([
    ['template + the exact tail', T + TAIL, TAIL, true],
    ['the same text, no tail passed (today\'s allow-list) → rejected', T + TAIL, '', false],
    ['the tail twice', T + TAIL + TAIL, TAIL, false],
    ['the tail with no base before it', TAIL.trim(), TAIL, false],
    ['a different figure in the passed text', T + TAIL.replace('£36,000', '£30,000'), TAIL, false],
    ['a tail carrying a raw decimal (the content defences stay)', T + ' Olumi reads your ‘£4.5k’.', ' Olumi reads your ‘£4.5k’.', false],
  ])('%s', (_why, text, tail, allowed) => {
    expect(isAllowedRunAnalysisAssistantText(text, tail)).toBe(allowed);
  });
});
