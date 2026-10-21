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
import { buildAnalysisSubmissionDisclosure } from '../../coaching/scaffold-disclosure.js';
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
  factors: [...lm.factors, { kind: 'factor', limit: null, id: 'office', label: 'Office move', value: 0, low: null, high: null, unit: null, defined_as: null, source: 'user', party: null, quote: null }],
  options: [...lm.options, { status: 'feasible', id: 'pivot', label: 'Pivot', developed_from: null, source: 'user', party: null, quote: null,
    settings: [{ factor_id: 'office', value: 1, low: null, high: null, unit: null, source: 'user', party: null, quote: null }] }] });

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
    expect(assessCanonicalAnalysisReadiness(g).submission!.gate.excluded.filter((e) => e.reason === 'no_path_to_goal')).toEqual([]);
    expect(decisionInputLines(g, AT, { onlyRiskKind: ['inert', 'context'] }).filter((l) => l.includes('isn\'t connected'))).toEqual([]);
  });

  it('CONTRAST A: a factor that IS on a path to the goal but has no level still blocks as a missing level', async () => {
    const g = await gesture(KNOWN_ANSWER, { kind: 'structural_add', node_id: 'office', node_kind: 'factor', label: 'Office move' });
    const lm = structuredClone(g.living_model as LM);
    lm.links.push({ id: 'office_f', from: 'office', to: 'f', source: 'user', party: null, quote: 'the office move lifts f',
      effect: { form: 'normal', value: 0.1, sd: 0.05, low: null, high: null, unit: null, sign: '+' } });
    expect(codes(stored(lm))).toContain('MISSING_FACTOR_LEVEL');
  });
});

describe('an option nothing links to the goal is left out of the comparison, never a block on the whole Run', () => {
  it('CONTRAST B (three options): the pathless one is withheld with its own reason and next step; the other two are compared', () => {
    const g = stored(withPathlessOption(KNOWN_ANSWER));
    expect(codes(g)).toEqual([]);
    expect(submitted(g)).toEqual(['hold', 'push']);
    expect(excluded(g)).toEqual([['pivot', 'no_path_to_goal']]);
    // The Run's reply says why, with the next step — never "it has no values set".
    const ready = assessCanonicalAnalysisReadiness(g);
    expect(buildAnalysisSubmissionDisclosure({ analysed: [], omitted: [] } as never, ready.submission!.gate.excluded)).toBe(
      ' \'Pivot\' was left out of this comparison because nothing links it to \'Reach 100 units\'. Say what \'Pivot\' changes that affects \'Reach 100 units\'.');
  });

  it('CONTRAST B (two options): with one left out, fewer than two remain, so the Run\'s existing comparison coaching names the next step', () => {
    const lm = withPathlessOption({ ...KNOWN_ANSWER, options: KNOWN_ANSWER.options.filter((o) => o.id === 'push') });
    const ready = assessCanonicalAnalysisReadiness(stored(lm));
    expect(ready.submission!.gate.excluded.map((e) => [e.option_id, e.reason])).toEqual([['pivot', 'no_path_to_goal']]);
    // The Run's own comparison floor (as for an option with no values set), not a readiness block on the model.
    expect(ready.submission!.comparisonRefusal?.nextStep).toBe('I\'ve left out options that nothing links to the goal, and that '
      + 'leaves fewer than two options, so there\'s nothing to compare yet. Say what \'Pivot\' changes that affects \'Reach 100 units\'.');
  });
});
