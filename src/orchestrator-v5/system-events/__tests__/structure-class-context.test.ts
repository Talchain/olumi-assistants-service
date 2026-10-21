/**
 * ⭐ DL ruling 21 Oct (structure class): an item with no path to the goal cannot change the result, so it is CONTEXT —
 * kept in the model and on the canvas, said once, never a block on the Run. An option nothing links to the goal is left
 * out of the comparison with its own next step; the others are still compared. The REAL door: a core canvas gesture →
 * the committed graph → `assessCanonicalAnalysisReadiness` (the one readiness authority) → its Run submission. SYNTHETIC.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { withScenarioRevision } from '../../../../tests/utils/revision-store-double.js';
import { computeExpectedGraphCasHashes } from '../../context/graph-cas-conflict.js';
import { mapLivingModel } from '../../path-b/living-model/mapper.js';
import { KNOWN_ANSWER } from '../../path-b/living-model/__tests__/fixtures.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { decisionInputLines } from '../../agent-lane/decision-input-ask.js';
import { contextNodeIds } from '../../../orchestrator/graph-structure-validator.js';
import { NO_CHANCE } from '../../path-b/living-model/__tests__/track2-f2-event-risk.fixtures.js';

const append = vi.fn();
const loadGraph = vi.fn();
const readMostRecentPendingActions = vi.fn();
const readCommittedTurn = vi.fn();
const store = { append, loadGraph, readMostRecentPendingActions, readCommittedTurn };
vi.mock('../../session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));

import { dispatchSystemEvent } from '../dispatch.js';

type Rec = Record<string, any>;
type LM = typeof KNOWN_ANSWER;
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const stored = (lm: LM): Rec => ({ ...mapLivingModel(lm).graph, living_model: lm });
const AT = { restingText: 'Your results are ready.', questionsToggle: false, awaitingApproval: false, builtOrRan: true };
const CONTEXT_LINE = '"Office move" isn\'t connected to "Reach 100 units", so it doesn\'t change this result. It stays in your model as context; say how it affects "Reach 100 units" if it does.';

async function gesture(lm: LM, event: Rec): Promise<Rec> {
  const graph = stored(lm);
  loadGraph.mockResolvedValue(graph);
  const out = await dispatchSystemEvent({ requestId: 'req-1', coreScenarioCheck: true, payload: {
    turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', scenario_id: SCENARIO, stage: 'evaluate', kind: 'system_event',
    event: { ...event, base_graph_hash: computeExpectedGraphCasHashes(graph).expectedGraphAnalysisHash! },
  } as unknown as SystemEventTurnPayload });
  expect(out.commitPerformed, JSON.stringify(out.response)).toBe(true);
  return (append.mock.calls.at(-1)![0] as Rec).graph;
}
const codes = (g: Rec) => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => i.code);
const submitted = (g: Rec) => (assessCanonicalAnalysisReadiness(g).submission!.submittedOptions as Rec[]).map((o) => o.option_id ?? o.id);
const excluded = (g: Rec) => assessCanonicalAnalysisReadiness(g).submission!.gate.excluded.map((e) => [e.option_id, e.reason]);
/** An option that sets only "Office move", a factor nothing links to the goal (an option that sets nothing is a different
 * class, OPTION_NO_FACTOR_EDGES, and keeps its own coaching). */
const withPathlessOption = (lm: LM): LM => ({ ...lm,
  factors: [...lm.factors, { estimate_by: null, kind: 'factor', limit: null, id: 'office', label: 'Office move', value: 0, low: null, high: null, unit: null, defined_as: null, source: 'user', party: null, quote: null }],
  options: [...lm.options, { status: 'feasible', id: 'pivot', label: 'Pivot', developed_from: null, source: 'user', party: null, quote: null,
    settings: [{ estimate_by: null, factor_id: 'office', value: 1, low: null, high: null, unit: null, source: 'user', party: null, quote: null }] }] });

beforeEach(() => {
  vi.resetAllMocks();
  append.mockResolvedValue({ id: 'turn-1', revision: 8 });
  readMostRecentPendingActions.mockResolvedValue([]);
  readCommittedTurn.mockResolvedValue(null);
});

describe('context: an item with no path to the goal is kept, said, and never blocks the Run', () => {
  it('RED (real path): a factor the person adds and links to nothing is kept, the Run proceeds with both options, and Olumi says it once', async () => {
    const g = await gesture(KNOWN_ANSWER, { kind: 'structural_add', node_id: 'office', node_kind: 'factor', label: 'Office move' });
    expect((g.living_model as LM).factors.map((f) => f.id), 'kept in the saved model').toContain('office');
    expect((g.nodes as Rec[]).map((n) => n.id), 'kept on the canvas').toContain('office');
    expect(codes(g), 'was ORPHAN_NODE before the ruling').toEqual([]);
    expect(submitted(g)).toEqual(['hold', 'push']);
    expect(excluded(g)).toEqual([]);
    expect(decisionInputLines(g, AT, { onlyRiskKind: ['inert', 'context'] })).toEqual([CONTEXT_LINE]);
  });

  it('the line is said on the build turn and every Run, not on a follow-up, and is gone once the item is linked to the goal', async () => {
    const g = await gesture(KNOWN_ANSWER, { kind: 'structural_add', node_id: 'office', node_kind: 'factor', label: 'Office move' });
    expect(decisionInputLines(g, { ...AT, builtOrRan: false }, { onlyRiskKind: ['inert', 'context'] })).toEqual([]);
    const linked = { ...g, edges: [...(g.edges as Rec[]), { from: 'office', to: 'g' }] };
    expect(decisionInputLines(linked, AT, { onlyRiskKind: ['inert', 'context'] })).toEqual([]);
  });

  it('NEGATIVE KEPT: an item linked only through one the model withholds (a risk with no stated chance) is NOT context — it keeps its refusal, never "isn\'t connected"', () => {
    const g = stored(NO_CHANCE);
    expect(mapLivingModel(NO_CHANCE).withheld.map((w) => w.reason)).toContain('risk_occurrence_unknown');
    expect(codes(g)).toContain('NO_PATH_TO_GOAL');
    expect(decisionInputLines(g, AT, { onlyRiskKind: ['inert', 'context'] }).filter((l) => l.includes('isn\'t connected'))).toEqual([]);
  });

  it('buddy SIMPLER on #3584: an item linked only to ANOTHER aim (not the goal this Run evaluates) is context for this Run', () => {
    const lm: LM = structuredClone(KNOWN_ANSWER);
    lm.aims.push({ ...structuredClone(lm.aims[0]!), id: 'g2', text: 'Keep the team happy', target: null, quote: null });
    lm.factors.push({ kind: 'factor', limit: null, id: 'office', label: 'Office move', estimate_by: null, value: 0.5, low: null, high: null, unit: null, defined_as: null, source: 'user', party: null, quote: null });
    lm.links.push({ id: 'office_g2', from: 'office', to: 'g2', source: 'user', party: null, quote: null,
      effect: { estimate_by: null, form: 'normal', value: 1, sd: 0.5, low: null, high: null, unit: null, sign: '+' } });
    const g = stored(lm);
    expect((g.nodes as Rec[]).find((n) => n.kind === 'goal')!.id, 'the Run evaluates g').toBe('g');
    expect(contextNodeIds(g as never).has('office')).toBe(true);
    expect(codes(g)).not.toContain('ORPHAN_NODE');
    expect(codes(g)).not.toContain('NO_PATH_TO_GOAL');
  });

  it('Codex r2 on #3584: a set-aside item is context unless an option the Run SUBMITS still sets it (a removed option does not count)', () => {
    const graph = (status: string | undefined) => ({ nodes: [
      { id: 'g', kind: 'goal', label: 'Goal' }, { id: 'd', kind: 'decision', label: 'D' },
      { id: 'f', kind: 'factor', label: 'F' }, { id: 'c', kind: 'factor', label: 'C', analysis_participation: 'retained_excluded' },
      { id: 'a', kind: 'option', label: 'A', interventions: { f: 1 } },
      { id: 'x', kind: 'option', label: 'X', interventions: { c: 1 }, ...(status ? { option_status: status } : {}) },
    ], edges: [{ from: 'd', to: 'a' }, { from: 'd', to: 'x' }, { from: 'a', to: 'f' }, { from: 'f', to: 'g' }, { from: 'x', to: 'c' }] });
    expect(contextNodeIds(graph(undefined) as never).has('c'), 'an active option still sets it: the participation refusal').toBe(false);
    expect(contextNodeIds(graph('removed') as never).has('c'), 'only a removed option sets it').toBe(true);
    expect(contextNodeIds(graph('infeasible') as never).has('c')).toBe(true);
  });

  it('CONTRAST A: a factor that IS on a path to the goal but has no level still blocks as a missing level', async () => {
    const g = await gesture(KNOWN_ANSWER, { kind: 'structural_add', node_id: 'office', node_kind: 'factor', label: 'Office move' });
    const lm = structuredClone(g.living_model as LM);
    lm.links.push({ id: 'office_f', from: 'office', to: 'f', source: 'user', party: null, quote: 'the office move lifts f',
      effect: { estimate_by: null, form: 'normal', value: 0.1, sd: 0.05, low: null, high: null, unit: null, sign: '+' } });
    expect(codes(stored(lm))).toContain('MISSING_FACTOR_LEVEL');
  });
});

// ⭐ DL ruling on #3584 (split): an OPTION with no path to the goal is not context. It keeps today's honest whole-Run
// refusal, named, with its coaching; only items that are not options become context.
describe('CONTRAST B: an option nothing links to the goal still refuses, as before', () => {
  it('three options, one pathless (it sets only "Office move"): readiness names it NO_PATH_TO_GOAL; "Office move" itself is context', () => {
    const g = stored(withPathlessOption(KNOWN_ANSWER));
    const ready = assessCanonicalAnalysisReadiness(g);
    expect(ready.safeToAnalyse).toBe(false);
    expect(ready.blockingIssues.filter((i) => i.code === 'NO_PATH_TO_GOAL').map((i) => i.option_id)).toEqual(['pivot']);
    expect(contextNodeIds(g as never).has('office')).toBe(true);
    expect(ready.blockingIssues.filter((i) => i.factor_id === 'office')).toEqual([]);
  });
});
