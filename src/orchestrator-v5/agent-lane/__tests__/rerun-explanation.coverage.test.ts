/** Q4: calculation-input presence and unsaid changes through the real producer and reply composer. */
import { describe, expect, it } from 'vitest';
import { diffRunInputSnapshots } from '../../coaching/run-input-changes.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { buildRunInputSnapshot } from '../../tools/handlers/run-input-snapshot.js';
import { REPAIR_VOCABULARY_DENYLIST } from '../../../orchestrator/shared/repair-vocabulary-denylist.js';
import { checkMethodTurn } from '../guidance/index.js';
import { composeRerunExplanation, rerunExplanationPlan, rerunViewFailures, RERUN_NO_CHANGE_LINES } from '../rerun-explanation.js';

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
  for (const [name, delta] of cases) {
    it.each([
      'Nothing changed.', 'Nothing else changed.', 'Nothing else has been changed.',
      'Nothing in your model changed.', 'Nothing in your model has changed.',
      'It used the same inputs.', 'The input values stayed the same.',
      'No inputs were changed.', 'No changes were made.', 'This didn’t change anything.',
    ])(`${name}: %s is dropped through composition`, (claim) => {
      const p = plan(delta);
      const composed = composeRerunExplanation(`${WHY} ${claim}`, p);
      expect(composed).toEqual({ text: `${p.codeLine}\n\n${WHY}`, dropped: [claim], failed: ['RX-NO-CONTRARY-SAME'] });
      expect(composeRerunExplanation(claim, p).text, 'an all-rejected draft keeps the honest code line').toBe(p.codeLine);
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
});
