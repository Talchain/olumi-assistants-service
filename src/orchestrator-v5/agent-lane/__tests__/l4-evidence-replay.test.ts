import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, questionsAfterSumAdmission, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { proposeProductIdentity } from '../identity-proposal.js';
import { applyIdentityConfirmEdit, identityConfirmReadingToken } from '../../system-events/identity-confirm-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Rec = Record<string, any>;
const SCENARIO = 'cd3d9c25-0000-4000-8000-0000000012a1';
const read = (name: string): string => readFileSync(new URL(`./fixtures/l4-drafter/${name}`, import.meta.url), 'utf8');
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const GOAL = 'weekly_support_capacity';
const QUOTE = 'Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity.';

async function construct(run: string) {
  const response = JSON.parse(read(`${run}-call-1-response.raw.json`));
  const raw = response.output.flatMap((o: Rec) => o.content ?? []).filter((c: Rec) => c.type === 'output_text').map((c: Rec) => c.text).join('');
  const brief = read(`${run}-brief.txt`);
  let graph: Rec | undefined;
  let retainedBrief: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = GraphV3.parse((body as Rec).graph) as Rec;
      retainedBrief = (body as Rec).brief_text;
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  // Exact recorded text, not JSON.parse/stringify or a repaired version of the drafter output.
  const call = vi.fn(async () => ({ text: raw })) as unknown as CallStructuredModel;
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok).toBe(true);
  expect(call).toHaveBeenCalledTimes(1);
  expect(retainedBrief).toBe(brief);
  return { graph: graph!, result, brief, raw };
}

async function runRequest(graph: Rec, brief: string): Promise<Rec> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-l4', {
    loadGraphAndBriefText: async () => ({ graph: GraphV3.parse(graph), briefText: brief, revision: 2 }),
    readMostRecentPendingActions: async () => [],
  } as never);
  let payload: Rec | undefined;
  const handler = createRunAnalysisHandler({
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snapshot,
    probe: async (sent) => { payload = sent.plotPayload as Rec; },
  });
  await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
    session_id: SCENARIO, request_id: 'req-l4', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [],
    scenarioBriefText: null, persistedGraph: null },
  payload: makeMessagePayload({ turn_id: 't-l4', scenario_id: SCENARIO, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
  requestId: 'req-l4', signal: new AbortController().signal, orientationText: '' } as never);
  expect(payload).toBeDefined();
  return payload!;
}

describe('L4 recorded evidence, no provider or PLoT calls', () => {
  it('pins every verbatim response and brief', () => {
    const manifest = JSON.parse(read('manifest.json')) as { file: string; sha256: string }[];
    for (const entry of manifest) expect(createHash('sha256').update(read(entry.file)).digest('hex')).toBe(entry.sha256);
  });

  it('row (a) A-d2: a declaration is outside calculation before whole-card approval', async () => {
    const { graph, brief } = await construct('A-d2');
    const sent = await runRequest(graph, brief);
    expect(node(sent.graph, GOAL).nonlinear_identity).toEqual(undefined);
    for (const id of ['existing_weekly_support_capacity', 'additional_specialist_capacity']) {
      const p = graph.edges.find((e: Rec) => e.from === id && e.to === GOAL).provenance;
      expect([p.source, p.magnitude, p.source_quote]).toEqual(['cee_hypothesis', 'olumi_estimate', QUOTE]);
    }
  });

  it('row (a) A-d2: existing whole-card approval preserves AI origin separately from approval', async () => {
    const { graph, brief } = await construct('A-d2');
    const card = proposeProductIdentity(graph);
    expect(card, 'the existing card must offer the declared multi-part sum').not.toBeNull();
    if (card === null) return;
    const hash = computeAnalysisAffectingGraphHash(graph as never);
    if (hash === null) throw new Error('The approval card needs a valid graph hash');
    const approved = applyIdentityConfirmEdit({ ...card, persistedGraph: graph, brief_text: brief,
      expected_graph_hash: hash, reading_token: identityConfirmReadingToken(card) });
    expect(approved.kind).toBe('mutated');
    if (approved.kind !== 'mutated') return;
    const expected = { operation: 'sum', factor_ids: ['existing_weekly_support_capacity', 'additional_specialist_capacity'], stated_in_brief: false };
    expect(node(approved.graph, GOAL).nonlinear_identity).toEqual(expected);
    expect(node((await runRequest(approved.graph, brief)).graph, GOAL).nonlinear_identity).toEqual(expected);
  });

  it('row (b) A-d1: unvalidated specialist TODAY prevents derivation; fallback is truthful', async () => {
    const { graph, result, raw } = await construct('A-d1');
    const refused = 'Olumi read "Weekly support capacity" as "Existing team capacity" and "Additional specialist capacity" added together, but "Weekly support capacity" has no figure today, so that was not used and nothing about it is assumed.';
    expect(node(graph, GOAL).nonlinear_identity).toEqual(undefined);
    expect(node(graph, GOAL).observed_state).toEqual(undefined);
    expect(result.open_questions).toEqual([
      `${refused} What definition and current figures should be used for "Weekly support capacity"?`,
      JSON.parse(raw).unknowns[1], JSON.parse(raw).unknowns[2],
    ]);
    expect(result.not_represented).toContain(refused);
    expect(JSON.stringify(result).includes('the model derives 80')).toBe(false);
  });

  it.each(['N1-d1', 'N1-d2', 'N2-d1', 'N2-d2'])('row (d) %s: no identity at admission, store or PLoT body', async (run) => {
    const { graph, brief } = await construct(run);
    expect(graph.nodes.flatMap((n: Rec) => n.nonlinear_identity ?? [])).toEqual([]);
    const sent = await runRequest(graph, brief);
    expect(sent.graph.nodes.flatMap((n: Rec) => n.nonlinear_identity ?? [])).toEqual([]);
  });

  it('row (e) N2-d2: supported spread reaches PLoT; the stored literal remains unchanged', async () => {
    const { graph, brief } = await construct('N2-d2');
    const id = 'per_specialist_ticket_resolution_capacity';
    const original = node(JSON.parse(read('N2-d2-postimage.json')), id).observed_state;
    expect(node(graph, id).observed_state).toEqual(original);
    const before = JSON.stringify(graph);
    const sent = await runRequest(graph, brief);
    expect(JSON.stringify(graph)).toBe(before);
    expect(typeof node(sent.graph, id).observed_state.std).toBe('number');
    // This is a missing-carrier witness, not an assertion of a chosen distribution or coverage.
  });
});

describe('sum refusal question producer', () => {
  it('uses the typed refusal, removes only quantity-bound draft text, and leaves unrelated questions exact', () => {
    const loss = [{ field_path: 'nodes[total].nonlinear_identity_rejected',
      before: { operation: 'sum', outcome: 'Total output', factors: ['Existing output', 'Added output'] },
      after: null, reason: 'The sum was not used.', severity: 'warn' }] as never;
    expect(questionsAfterSumAdmission(['TOTAL OUTPUT is 80.', 'Check “Added output”.', 'Which source supports the rate?'], loss))
      .toEqual(['The sum was not used. What definition and current figures should be used for "Total output"?', 'Which source supports the rate?']);
  });
  it('does not touch an unrelated refusal or a model without a refused sum', () => {
    const questions = ['The model derives a level.'];
    expect(questionsAfterSumAdmission(questions, [])).toBe(questions);
    expect(questionsAfterSumAdmission(questions, [{ field_path: 'nodes[x].nonlinear_identity_rejected',
      before: { operation: 'product', outcome: 'x' }, after: null, reason: 'refused', severity: 'warn' }] as never)).toBe(questions);
  });
});
