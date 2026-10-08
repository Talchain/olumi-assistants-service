/** Q4: calculation-input presence and unsaid changes through the real producer and reply composer. */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { log } from '../../../utils/telemetry.js';
import { diffRunInputSnapshots } from '../../coaching/run-input-changes.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { buildRunInputSnapshot } from '../../tools/handlers/run-input-snapshot.js';
import { REPAIR_VOCABULARY_DENYLIST } from '../../../orchestrator/shared/repair-vocabulary-denylist.js';
import { checkMethodTurn } from '../guidance/index.js';
import { composeRerunExplanation, rerunExplanationPlan, rerunViewFailures, RERUN_FALLBACK_LINES, RERUN_NO_CHANGE_LINES } from '../rerun-explanation.js';

const dropLog = vi.spyOn(log, 'info').mockImplementation(() => {});
afterEach(() => dropLog.mockClear());
afterAll(() => dropLog.mockRestore());

const GRAPH = {
  nodes: [{ id: 'price', kind: 'factor', label: 'Pro plan price' },
    { id: 'risk', kind: 'risk', label: 'Feature release slips' },
    { id: 'mrr', kind: 'goal', label: 'MRR' }],
  edges: [{ from: 'price', to: 'risk', strength: { mean: -0.5 } },
    { from: 'risk', to: 'mrr', strength: { mean: -0.5 } }],
};
const labels = new Map(GRAPH.nodes.map((n) => [n.id, n.label] as const));
const labelOf = (id: string) => labels.get(id);
const snapshot = (wireGraph: typeof GRAPH) => {
  const result = buildRunInputSnapshot({
    submittedOptions: [], rawObjectsPerOption: [], wirePerOption: [], heldFactorIdsByOptionId: new Map(),
    optionsNotSent: [], wireGraph, plotPayload: { graph: wireGraph, goal_node_id: 'mrr' },
    persistedEdges: GRAPH.edges,
  });
  expect(result, 'the real snapshot builder records the calculation inputs').not.toBeNull();
  return result!;
};
const included = snapshot(GRAPH);
const noLinks = snapshot({ ...GRAPH, edges: [] });
const PRESENCE = diffRunInputSnapshots(noLinks, included);
const NAMED = PRESENCE[0]!;
const UNKNOWN = { ...NAMED, link: { from: 'gone', to: 'mrr' } };
const ENTERED = [
  'The link from ‘Pro plan price’ to ‘Feature release slips’ is now part of the analysis.',
  'The link from ‘Feature release slips’ to ‘MRR’ is now part of the analysis.',
];
const LEFT = [
  'The link from ‘Pro plan price’ to ‘Feature release slips’ is no longer part of the analysis.',
  'The link from ‘Feature release slips’ to ‘MRR’ is no longer part of the analysis.',
];
const DELTA = { attribution_case: 'C1_attributable', input_coverage: 'complete', win_probabilities: [{ option_id: 'o' }] };
const plan = (over: Record<string, unknown>) => rerunExplanationPlan({ ...DELTA, ...over }, labelOf, [], false)!;
const WHY = 'The comparison uses the current calculation inputs.';

describe('Q4 presence: the snapshot records analysis membership, not a structural edit', () => {
  it('Paul\'s two added links produce exactly two true sentences and never the unknown line', () => {
    const p = plan({ input_changes: PRESENCE });
    expect(p.changes).toEqual(ENTERED);
    expect(p.codeLine).not.toContain(RERUN_NO_CHANGE_LINES.unknown);
    expect(checkMethodTurn('RERUN-EXPLANATION', p.codeLine, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });

  it('excluding and re-including the retained risk produces the same presence words through participation → snapshot → diff', () => {
    const retained = { ...GRAPH, nodes: GRAPH.nodes.map((n) => n.id === 'risk' ? { ...n, analysis_participation: 'retained_excluded' } : n) };
    const excluded = guardAnalysisParticipation(retained, { goalNodeId: 'mrr' });
    expect(excluded).toMatchObject({ excludedNodeIds: ['risk'], prunedEdgeCount: 2, refusals: [] });
    expect(retained.edges).toEqual(GRAPH.edges);
    expect(retained.nodes.find((n) => n.id === 'risk')).toMatchObject({ label: 'Feature release slips', analysis_participation: 'retained_excluded' });
    const excludedSnapshot = snapshot(excluded.graph);
    const leaving = diffRunInputSnapshots(included, excludedSnapshot);
    expect(leaving.map((r) => r.field)).toEqual(['presence', 'presence']);
    expect(plan({ input_changes: leaving }).changes).toEqual(LEFT);
    const reincluded = guardAnalysisParticipation({ ...retained,
      nodes: retained.nodes.map((n) => ({ ...n, analysis_participation: 'included' })),
    }, { goalNodeId: 'mrr' });
    const entering = diffRunInputSnapshots(excludedSnapshot, snapshot(reincluded.graph));
    expect(entering).toEqual(PRESENCE);
    expect(plan({ input_changes: entering }).changes).toEqual(ENTERED);
  });

  it.each([...ENTERED, ...LEFT])('presence copy passes the repo guards: %s', (line) => {
    expect(findForbiddenPhraseHit(line)).toBeNull();
    for (const ban of REPAIR_VOCABULARY_DENYLIST) expect(line).not.toMatch(ban);
  });
});

describe('Q4 narrator: any unsaid change prevents a contrary no-change claim', () => {
  const cases = [
    ['all skipped', { input_changes: [UNKNOWN] }],
    ['one named and one skipped', { input_changes: [NAMED, UNKNOWN] }],
    ['partial coverage with no named row', { input_changes: [], input_coverage: 'partial' }],
    ['partial coverage beside a named row', { input_changes: [NAMED], input_coverage: 'partial' }],
    ['unrecorded coverage', { input_changes: [], input_coverage: 'not_recorded' }],
    ['an older delta with no row record', {}],
    ['a malformed row record', { input_changes: [null] }],
  ] as const;
  const paraphrases = [
    'Nothing else was altered.', 'No other inputs moved.', 'The rest stayed the same.',
    'No other changes were made.', 'No other input changed.', 'None of the other inputs changed.',
    'Everything else is unchanged.', 'The other inputs stayed as they were.',
    'No other change was made.', 'None of the other input changed.',
    'Unchanged were the other inputs.', 'As they were, the other inputs stayed.',
    'The inputs did not move.', 'The inputs never altered.',
  ];
  for (const [name, delta] of cases) {
    it.each([
      'Nothing changed.', 'Nothing else changed.', 'Nothing else has been changed.',
      'Nothing in your model changed.', 'Nothing in your model has changed.',
      'It used the same inputs.', 'The input values stayed the same.',
      'No inputs were changed.', 'No changes were made.', 'This didn’t change anything.',
      ...paraphrases,
    ])(`${name}: %s is dropped through composition`, (claim) => {
      const p = plan(delta);
      const composed = composeRerunExplanation(`${WHY} ${claim}`, p);
      expect(composed).toEqual({ text: `${p.codeLine}\n\n${WHY}`, dropped: [claim], failed: ['RX-NO-CONTRARY-SAME'] });
      expect(composeRerunExplanation(claim, p).text, 'an all-rejected draft keeps the honest code line').toBe(p.codeLine);
    });

    it.each([
      '‘Carry on’ doesn\'t meet the limit.',
      'Olumi isn\'t naming an option on this run.',
    ])(`${name}: a negation unrelated to input changes is kept: %s`, (draft) => {
      const p = plan(delta);
      expect(composeRerunExplanation(draft, p)).toEqual({ text: `${p.codeLine}\n\n${draft}`, dropped: [], failed: [] });
      expect(dropLog).not.toHaveBeenCalled();
    });
  }

  it('a filtered malformed row never becomes a complete empty record', () => {
    expect(plan({ input_changes: [null] }).codeLine).toBe(RERUN_NO_CHANGE_LINES.unknown);
  });

  for (const [name, delta] of cases) {
    it.each([
      'Olumi cannot confirm that nothing else changed.',
      'Olumi can\'t confirm that nothing else changed.',
      'Olumi isn\'t sure whether anything else changed.',
    ])(`${name}: honest uncertainty survives composition and provisional-view checking: %s`, (uncertainty) => {
      const p = plan(delta);
      expect(p.inputs.changes_unsaid).toBe(true);
      expect.soft(composeRerunExplanation(uncertainty, p)).toEqual({ text: `${p.codeLine}\n\n${uncertainty}`, dropped: [], failed: [] });
      expect.soft(rerunViewFailures({ reasoning: uncertainty }, p)).toEqual([]);
    });

    it.each([
      'Nothing else changed.',
      'Olumi can confirm that nothing else changed.',
      'Olumi is sure that nothing else changed.',
      'Olumi cannot confirm the earlier comparison, but nothing else changed.',
      'Olumi can\'t confirm the earlier comparison, but nothing else changed.',
      'Olumi isn\'t sure about the earlier comparison, but nothing else changed.',
    ])(`${name}: contrary claims still fail composition and provisional-view checking: %s`, (claim) => {
      const p = plan(delta);
      expect(composeRerunExplanation(claim, p)).toEqual({ text: p.codeLine, dropped: [claim], failed: ['RX-NO-CONTRARY-SAME'] });
      expect(rerunViewFailures({ reasoning: claim }, p)).toEqual(['RX-NO-CONTRARY-SAME']);
    });
  }

  it('honest uncertainty does not exempt a later contrary claim in the same draft or view', () => {
    const p = plan({ input_changes: [NAMED, UNKNOWN] });
    const uncertainty = 'Olumi cannot confirm that nothing else changed.';
    const claim = 'Nothing else changed.';
    expect(composeRerunExplanation(`${uncertainty} ${claim}`, p)).toEqual({
      text: `${p.codeLine}\n\n${uncertainty}`, dropped: [claim], failed: ['RX-NO-CONTRARY-SAME'],
    });
    expect(rerunViewFailures({ reasoning: `${uncertainty} ${claim}` }, p)).toEqual(['RX-NO-CONTRARY-SAME']);
    const joinedClaim = `${uncertainty.slice(0, -1)}, but nothing else changed.`;
    expect(composeRerunExplanation(joinedClaim, p)).toEqual({ text: p.codeLine, dropped: [joinedClaim], failed: ['RX-NO-CONTRARY-SAME'] });
    expect(rerunViewFailures({ reasoning: joinedClaim }, p)).toEqual(['RX-NO-CONTRARY-SAME']);
  });

  it('CONTROL: full coverage beside a named change still permits Nothing else changed', () => {
    const p = plan({ input_changes: [NAMED] });
    const claim = 'Nothing else changed.';
    expect(composeRerunExplanation(claim, p)).toEqual({ text: `${p.codeLine}\n\n${claim}`, dropped: [], failed: [] });
    expect(composeRerunExplanation('Nothing in your model changed.', p).failed).toContain('RX-NO-CONTRARY-SAME');
  });

  it('CONTROL: a complete empty record keeps the existing no-change behaviour', () => {
    const p = plan({ input_changes: [] });
    const claim = 'Nothing in your model changed.';
    expect(p.codeLine).toBe(RERUN_NO_CHANGE_LINES.nothing);
    expect(composeRerunExplanation(claim, p)).toEqual({ text: `${p.codeLine}\n\n${claim}`, dropped: [], failed: [] });
  });

  it.each(paraphrases)('CONTROL: full coverage keeps the prior paraphrase behaviour: %s', (claim) => {
    const p = plan({ input_changes: [NAMED] });
    expect(p.inputs.changes_unsaid).toBe(false);
    expect(composeRerunExplanation(claim, p)).toEqual({ text: `${p.codeLine}\n\n${claim}`, dropped: [], failed: [] });
    expect(dropLog).not.toHaveBeenCalled();
  });

  it('CONTROL: full coverage does not normalize a new claim into a legacy match', () => {
    const p = plan({ input_changes: [NAMED] });
    const claim = 'No 2 changes were made.';
    expect(composeRerunExplanation(claim, p)).toEqual({ text: `${p.codeLine}\n\n${claim}`, dropped: [], failed: [] });
  });

  it('a model label consisting of a contrary assertion cannot hide that narrator claim', () => {
    const p = plan({ input_changes: [NAMED, UNKNOWN] });
    const claim = 'No other input changed.';
    const labelled = { ...p, inputs: { ...p.inputs, model_labels: ['No other input changed'] } };
    expect(composeRerunExplanation(claim, labelled)).toEqual({ text: p.codeLine, dropped: [claim], failed: ['RX-NO-CONTRARY-SAME'] });
  });

  it.each([
    ['recorded skipped row', { input_changes: [NAMED, UNKNOWN] }, RERUN_FALLBACK_LINES.other],
    ['incomplete coverage', { input_changes: [NAMED], input_coverage: 'partial' }, RERUN_FALLBACK_LINES.unverified],
  ] as const)('%s: every dropped sentence keeps the honest line and logs its index without narrator text', (_name, delta, honest) => {
    const p = plan(delta);
    const first = 'Nothing else was altered.';
    const second = 'No other input changed.';
    const draft = `${WHY} ${first}\nOlumi isn't naming an option on this run. ${second}`;
    const composed = composeRerunExplanation(draft, p);
    expect(composed.dropped).toEqual([first, second]);
    expect(composed.text).toContain(honest);
    expect(dropLog.mock.calls).toEqual([
      [{ event: 'agent_lane.rerun_sentence_dropped', policy_id: 'RERUN-EXPLANATION', sentence_index: 1, failed: ['RX-NO-CONTRARY-SAME'] }, 'agent-lane: rerun explanation sentence dropped'],
      [{ event: 'agent_lane.rerun_sentence_dropped', policy_id: 'RERUN-EXPLANATION', sentence_index: 3, failed: ['RX-NO-CONTRARY-SAME'] }, 'agent-lane: rerun explanation sentence dropped'],
    ]);
  });

  it('whitespace-heavy narrator composition scales from 2k to 20k characters within 20x', () => {
    const p = plan({ input_changes: [NAMED, UNKNOWN] });
    const draft = (length: number) => `No${' '.repeat(length - 'No other inputs moved.'.length)} other inputs moved.`;
    const short = draft(2_000);
    const long = draft(20_000);
    expect(short).toHaveLength(2_000);
    expect(long).toHaveLength(20_000);
    const measure = (reply: string) => {
      const samples = Array.from({ length: 5 }, () => {
        const started = performance.now();
        for (let i = 0; i < 50; i++) composeRerunExplanation(reply, p);
        return (performance.now() - started) / 50;
      }).sort((a, b) => a - b);
      return samples[2]!;
    };
    for (let i = 0; i < 20; i++) { composeRerunExplanation(short, p); composeRerunExplanation(long, p); }
    const shortMs = measure(short);
    const longMs = measure(long);
    const ratio = longMs / shortMs;
    console.info('rerun composition scaling', { shortMs, longMs, ratio });
    if (process.env.RERUN_TIMING_OUTPUT) writeFileSync(process.env.RERUN_TIMING_OUTPUT, JSON.stringify({ shortMs, longMs, ratio }));
    // Relative cost is the CI gate; wall-clock milliseconds are evidence, not a machine-dependent bar.
    expect(ratio).toBeLessThan(20);
    expect(composeRerunExplanation(long, p)).toEqual({ text: p.codeLine, dropped: [long], failed: ['RX-NO-CONTRARY-SAME'] });
    expect(p.codeLine).toContain(RERUN_FALLBACK_LINES.other);
  });
});
