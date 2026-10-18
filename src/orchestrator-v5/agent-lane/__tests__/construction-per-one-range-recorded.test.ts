/**
 * ⭐ A3 (T01(1); AIE-approved text, prompt/AIE-A3-COMMON-20261017-v1.json; Lane A's host change, design spec v2.1 A1/A3): both
 * LOW-end producers are retired. A money size the brief states PER ONE of something, as a RANGE, keeps its countable and its
 * per-one link, and the range is recorded on that link with NO size: never one of its ends, never a middle. A draft that records
 * it is complete (no retry asked); a retry that records it is adopted for it (`carriedRanges`, one authority). Where a chance
 * rests on that unsized link, the Run withholds ONLY that claim, and the user's range stays on the link. SYNTHETIC brief.
 *
 * Real path: `buildModelFromBrief` (scripted drafter) → `/graph/register` → persisted projection → cold load
 * (`loadScenarioSnapshotForRunAnalysis`) → the REAL `run_analysis` handler, PLoT faked → the request PLoT receives and the Run's facts.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, firstConstructInput, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { linkHoldsStatedRange } from '../../statement-door/statements.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

/** The notes and issues ride the drafter's input JSON-encoded: a fragment as it appears there. */
const sent = (words: string): string => JSON.stringify(words).slice(1, -1);

type Rec = Record<string, any>;
const SID = 'a3a3a3a3-0000-4a3a-8a3a-a3a3a3a3a3a3';
const AIM = 'We need to bring in at least £600k of new contract value this year.';
const SIZE = 'Our broker says each contract we sign is worth between £40k and £60k.';
const BRIEF = `${AIM} ${SIZE} We could hire a second salesperson or start a referral scheme.`;
const GOAL = 'New contract value';
const COUNT = 'Contracts signed';

function draft(withRange: 'recorded' | 'denied' | 'none'): Rec {
  const link = (from: string, to: string): Rec => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 600000, unit: '£', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Hire a second salesperson', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Salespeople', value: 2, value_kind: 'absolute', unit: 'people', provenance: 'explicit' }] },
    ],
    factors: [{ label: 'Salespeople', role: 'controllable', baseline_known: true, baseline_value: 1, unit: 'people', provenance: 'inferred', plausible_max: 5 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    outcomes: [{ label: COUNT, provenance: 'inferred', unit: 'contracts', plausible_max: 30 }],
    // The per-one link is kept, with no size: the range is not one size.
    links: [link('Salespeople', COUNT), { ...link(COUNT, GOAL), provenance: 'explicit' }],
    statements: [
      { quote: AIM, speaker: 'user', subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound',
        value: 600000, low: null, high: null, unit: '£', qualifier: null, conditions: null },
      ...(withRange === 'none' ? [] : [{ quote: SIZE, speaker: 'user', subject: { kind: 'link', label: COUNT, to_label: GOAL, factor_label: null },
        field: 'effect', form: 'range', value: null, low: 40000, high: 60000, unit: '£', qualifier: null, conditions: null,
        ...(withRange === 'denied' ? { negated: true } : {}) }]),
    ],
  };
}

async function build(drafts: readonly Rec[]) {
  let body: unknown = null;
  const inputs: string[] = [];
  const call = (async (req: { input: string }) => {
    inputs.push(req.input);
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]), status: 'completed' };
  }) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SID, BRIEF, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 800)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Rec, raw: body as Rec, inputs };
}
const ends = (g: Rec): { from: string; to: string } => ({ from: g.nodes.find((n: Rec) => n.label === COUNT).id, to: g.nodes.find((n: Rec) => n.kind === 'goal').id });
const rangeRecord = (g: Rec, from: string, to: string): Rec | undefined => ((g.nodes as Rec[]).find((n) => n.id === from)?.user_statements as Rec[] | undefined)
  ?.find((r: Rec) => r.subject_key === `link|${from}|${to}||effect`);

/** The stored model loaded cold for the Run, the REAL Run handler, PLoT faked: the request PLoT receives and the Run's facts. */
async function runOnStored(raw: Rec): Promise<{ request: Rec; enrichment: Rec }> {
  const stored = GraphV3.parse(projectGraphForPersistence(raw)) as unknown as Rec;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'req-load', {
    readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(stored), briefText: BRIEF }),
    loadGraph: async () => structuredClone(stored),
  } as never);
  let request: Rec = {};
  const plotRun = vi.fn(async (payload: Rec) => {
    request = structuredClone(payload);
    return { ...structuredClone(minimalFixture), inference_warnings: [],
      results: payload.options.map((o: Rec) => ({ option_id: o.id ?? o.option_id, option_label: o.label, win_probability: 1 / payload.options.length })),
      option_comparison: payload.options.map((o: Rec, i: number) => ({ option_id: o.id ?? o.option_id, option_label: o.label,
        win_probability: 1 / payload.options.length, probability_of_goal: 0.4 + i / 10,
        outcome: { p10: 0, p50: 1 + i, p90: 3, mean: 1 + i, std: 1, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' } })),
    } as unknown as V2RunResponseEnvelope;
  });
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot });
  const outcome = await handler({ payload: { kind: 'message', scenario_id: SID, turn_id: 't-run' },
    requestId: 'req-run', signal: new AbortController().signal, context: {}, orientationText: '' } as unknown as HandlerInvocation) as unknown as Rec;
  expect(plotRun, 'PLoT was called exactly once').toHaveBeenCalledOnce();
  return { request, enrichment: (outcome.handler_facts as Rec[]).find((f) => f.fact_type === 'run_analysis')!.result.enrichment as Rec };
}

describe('A3: a per-one range is recorded on its link, never sized at an end', () => {
  it('the first construct\'s note asks the per-one rule with the range recorded and no size; no "LOW end" anywhere', () => {
    const input = firstConstructInput(BRIEF);
    expect(input).toContain(sent('retain "£40k and £60k" as the complete stated effect range in statements on that directed link'));
    expect(input).toContain(sent('Leave the point size null unless a separately supported point size is supplied.'));
    expect(input).not.toMatch(/LOW end/u);
  });

  it('⭐ real build → register: a draft that records the range on the per-one link is complete in ONE call; the link keeps no size of the user\'s', async () => {
    const { graph, raw, inputs } = await build([draft('recorded')]);
    expect(inputs, 'no retry is asked for a range the draft already holds').toHaveLength(1);
    const { from, to } = ends(graph);
    const edge = graph.edges.find((e: Rec) => e.from === from && e.to === to);
    expect(edge.provenance.magnitude).not.toBe('user_stated');
    expect(edge.provenance.natural_effect?.stated_range).toBeUndefined();
    // The user's range is theirs, on the link, both ends as written.
    expect(linkHoldsStatedRange(raw, from, to)).toBe(true);
    expect(rangeRecord(raw, from, to)!.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: SIZE, form: 'range', low: 40000, high: 60000 })]);
  });

  it('CONTRAST: a draft that holds the range nowhere is still asked it, with the new per-one words', async () => {
    const { inputs } = await build([draft('none'), draft('recorded')]);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain(sent('The brief writes "£40k and £60k" and no link in the model carries it.'));
    expect(inputs[1]).toContain(sent('retain "£40k and £60k" as the complete stated effect range in statements on that directed link'));
    expect(inputs[1]).not.toMatch(/LOW end/u);
  });

  it('⭐ RED→GREEN (retry adoption, one authority): a retry that records the asked range is ADOPTED, so the registered link holds it', async () => {
    const { raw, inputs } = await build([draft('none'), draft('recorded')]);
    expect(inputs, 'PRECONDITION: the range was asked of the retry').toHaveLength(2);
    const { from, to } = ends(GraphV3.parse(raw) as unknown as Rec);
    expect(linkHoldsStatedRange(raw, from, to), 'the adopted retry\'s recorded range is on the registered link').toBe(true);
  });

  it('CONTRAST: a range the AI marks DENIED is not held, so it is still asked', async () => {
    const { inputs } = await build([draft('denied'), draft('recorded')]);
    expect(inputs).toHaveLength(2);
  });

  it('⭐ register → cold read → prepared request: both ends and their provenance survive; the request never sizes the link at an end', async () => {
    const { raw } = await build([draft('recorded')]);
    const { from, to } = ends(GraphV3.parse(raw) as unknown as Rec);
    const { request } = await runOnStored(raw);
    const cold = GraphV3.parse(projectGraphForPersistence(raw)) as unknown as Rec;
    expect(rangeRecord(cold, from, to)!.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: SIZE, form: 'range', low: 40000, high: 60000 })]);
    const wireEdge = (request.graph.edges as Rec[]).find((e) => e.from === from && e.to === to);
    expect(wireEdge, 'PRECONDITION: the per-one link is in the request').toBeDefined();
    expect(wireEdge!.provenance?.magnitude).not.toBe('user_stated');
    expect(JSON.stringify(wireEdge)).not.toMatch(/40000|60000/u);
  });

  it('⭐ withheld claim: a chance resting on the unsized per-one link is withheld for that reason only; outcomes and the range stay', async () => {
    const { raw } = await build([draft('recorded')]);
    const { from, to } = ends(GraphV3.parse(raw) as unknown as Rec);
    const { enrichment } = await runOnStored(raw);
    const placeholder = (enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH');
    expect(placeholder, JSON.stringify(enrichment.inference_warnings)).toBeDefined();
    const cause = enrichment.__cee_unsized_path_leader_cause as Rec;
    expect((cause.links as Rec[]).some((l) => l.from === from && l.to === to), JSON.stringify(cause)).toBe(true);
    for (const id of placeholder!.option_ids as string[]) {
      const row = (enrichment.option_comparison as Rec[]).find((r) => r.option_id === id)!;
      expect(row).not.toHaveProperty('probability_of_goal');
      expect(row.outcome).toBeDefined();
    }
    expect(linkHoldsStatedRange(raw, from, to)).toBe(true);
  });
});
