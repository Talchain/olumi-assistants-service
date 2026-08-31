/** Live records at ac37890c, request eaec41fb-a316-4d34-82c9-8bde7fa1d946.
 * Provider record set copied from authenticated-pricing-question.json.
 * Replays source only: no provider, network, database, or UI calls.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../grammar.js';
import { projectRecordsToGraph } from '../projector.js';
import { projectDraftRecords } from '../seam.js';
import { projectGraphAndOptionsToV3 } from '../../../transforms/schema-v3.js';
import { buildAnalysisReadyPayload } from '../../../transforms/analysis-ready.js';
import { isWholeOptionDecisionFraming, reconcileDraftOptionFraming } from '../option-framing.js';
import capture from './fixtures/captured-question-records.json';

const QUESTION = 'We need to decide whether to raise prices 15% next quarter';
const BRIEF = capture.brief;
const LIVE_RECORDS: DraftRecordSet = JSON.parse(capture.raw_text);

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}

function withoutNodeProvenanceAndLabel(node: Record<string, unknown>) {
  const { label: _label, provenance: _provenance, ...rest } = node;
  return rest;
}

describe('whole-utterance framing discrimination', () => {
  it.each([
    QUESTION, 'decide whether to raise prices 15% next quarter',
    'Should we raise prices?', 'Do we hold prices?',
    'We are deciding between keeping prices and raising them',
    'The question is whether to raise prices',
  ])('recognises framing: %s', (text) => expect(isWholeOptionDecisionFraming(text)).toBe(true));

  it.each([
    'we could keep prices unchanged', 'Hire a researcher to figure out customer demand',
    'Launch the campaign named Why Pay More?', 'Keep prices unchanged',
    'Raise prices 15% next quarter', 'Survey customers about whether to raise prices',
    'Hold prices while deciding whether to restructure', 'Assess whether churn is price-related',
  ])('preserves an actual action: %s', (text) => expect(isWholeOptionDecisionFraming(text)).toBe(false));

  it.each(["'", '’'])('recognises only the supported framing with apostrophe %s', (apostrophe) => {
    expect(isWholeOptionDecisionFraming(`We${apostrophe}re deciding whether to raise prices`)).toBe(true);
    expect(isWholeOptionDecisionFraming(`I${apostrophe}m deciding between keeping and raising prices`)).toBe(true);
    for (const action of [
      `Keep the café${apostrophe}s prices unchanged`,
      `Launch the campaign named ${apostrophe}Should we raise prices?${apostrophe}`,
      `Hold prices while we${apostrophe}re deciding whether to restructure`,
      `We${apostrophe}re keeping prices unchanged`,
    ]) expect(isWholeOptionDecisionFraming(action)).toBe(false);
  });
});

describe('same-text typography does not lose a genuine refinement or admit a question', () => {
  function replay(records: DraftRecordSet, brief: string, sourceQuote: string, label: string) {
    const rawBefore = JSON.stringify(records);
    freeze(records);
    const seam = projectDraftRecords(records, brief);
    expect(seam.ok).toBe(true);
    if (!seam.ok) throw new Error('Typography control must pass the actual records seam');
    const original = freeze(seam.projection);
    const originalBytes = JSON.stringify(original);
    const question = original.graph.nodes.find((node) => node.provenance?.source_quote === sourceQuote)!;
    expect(question).toBeDefined();
    expect(question.provenance?.merged_refinements).toEqual([label]);
    expect(question.data?.raw_interventions).toEqual({ '5f3b2b5d': 1 });
    expect(question.data?.interventions).toEqual({ '5f3b2b5d': 0.5 });

    const seamBytes = JSON.stringify(seam.records);
    const result = reconcileDraftOptionFraming(freeze(seam.records), original);
    expect(result.unresolved).toEqual([]);
    expect(result.resolved).toEqual([{ option_id: question.id, label, source_quote: sourceQuote, claim_index: 0 }]);
    const repaired = result.projection.graph.nodes.find((node) => node.id === question.id)!;
    expect(withoutNodeProvenanceAndLabel(repaired as never)).toEqual(withoutNodeProvenanceAndLabel(question as never));
    expect(repaired.provenance).toEqual({ ...question.provenance, provenance_class: 'ai_inferred', label_authored: true });
    expect(result.projection.graph.edges).toEqual(original.graph.edges);
    expect(result.projection.graph.nodes.map((node) => node.id)).toEqual(original.graph.nodes.map((node) => node.id));

    const v3 = projectGraphAndOptionsToV3(result.projection.graph as never, { brief });
    const option = v3.options.find((entry) => entry.id === question.id)!;
    expect(option.label).toBe(label);
    expect(option.is_baseline).toBe(true);
    expect(option.raw_interventions).toEqual({ '5f3b2b5d': 1 });
    expect(option.interventions['5f3b2b5d'].value).toBe(0.5);
    expect(v3.graph.nodes.find((node) => node.id === question.id)?.source_quote).toBe(sourceQuote);
    const ready = buildAnalysisReadyPayload(v3.options, v3.goal_node_id, v3.graph);
    expect(ready.options.find((entry) => entry.id === question.id)?.label).toBe(label);
    expect(JSON.stringify(records)).toBe(rawBefore);
    expect(JSON.stringify(seam.records)).toBe(seamBytes);
    expect(JSON.stringify(original)).toBe(originalBytes);
    expect(reconcileDraftOptionFraming(seam.records, result.projection)).toEqual({ projection: result.projection, resolved: [], unresolved: [] });
    return question.id;
  }

  it.each(['NFC', 'NFD'] as const)('recovers the same captured option with a %s refinement label', (form) => {
    const records = structuredClone(LIVE_RECORDS);
    records.claims[0]!.label = 'Keep Café prices unchanged'.normalize(form);
    expect(replay(records, BRIEF, QUESTION, 'Keep Café prices unchanged')).toBe('e432b605');
  });

  it('matches NFC and NFD source quotations to the same original option', () => {
    const sourceQuote = 'We need to decide whether to raise Café prices 15% next quarter';
    const ids = (['NFC', 'NFD'] as const).map((form) => {
      const records = structuredClone(LIVE_RECORDS);
      const rawQuote = sourceQuote.normalize(form);
      records.stated_items[3]!.source_quote = rawQuote;
      return replay(records, BRIEF.replace(QUESTION, rawQuote), sourceQuote, 'Hold Price (Status Quo)');
    });
    expect(ids[0]).toBe(ids[1]);
  });

  it.each(["'", '’'])('recovers the genuine refinement behind the contraction with apostrophe %s', (apostrophe) => {
    const records = structuredClone(LIVE_RECORDS);
    const sourceQuote = `We${apostrophe}re deciding whether to raise prices 15% next quarter`;
    records.stated_items[3]!.source_quote = sourceQuote;
    replay(records, BRIEF.replace(QUESTION, sourceQuote), sourceQuote, 'Hold Price (Status Quo)');
  });

  it.each(['NFC', 'NFD'] as const)('preserves a genuine %s action without a refinement', (form) => {
    const records: DraftRecordSet = { stated_items: [
      { kind: 'option', source_quote: 'Keep Café prices unchanged'.normalize(form), is_baseline: true },
      { kind: 'option', source_quote: 'Raise Café prices 15%'.normalize(form), is_baseline: false },
    ], claims: [] };
    const projection = freeze(projectRecordsToGraph(records));
    expect(reconcileDraftOptionFraming(freeze(records), projection)).toEqual({ projection, resolved: [], unresolved: [] });
  });

  it.each([
    ['Keep Cafe prices unchanged', 'Keep Café prices unchanged'],
    ["Keep the café's prices unchanged", 'Keep the café’s prices unchanged'],
  ])('does not equate a different refinement %s with receipt %s', (rawLabel, receipt) => {
    const records = structuredClone(LIVE_RECORDS);
    records.claims[0]!.label = rawLabel;
    const projection = projectRecordsToGraph(records, BRIEF);
    const question = projection.graph.nodes.find((node) => node.id === 'e432b605')!;
    const provenance = { ...question.provenance!, merged_refinements: [receipt] };
    question.provenance = provenance;
    const inconsistentProjection = {
      ...projection, provenance: { ...projection.provenance, [question.id]: provenance },
    };
    const result = reconcileDraftOptionFraming(freeze(records), freeze(inconsistentProjection));
    expect(result.resolved).toEqual([]);
    expect(result.unresolved.map((entry) => entry.node_id)).toEqual([question.id]);
    expect(result.projection.graph.nodes.some((node) => node.id === question.id)).toBe(false);
  });
});

describe('captured live merge: recover the producer name without changing its maths', () => {
  it('replays the defect before correcting it, preserving IDs, source, values, and links', () => {
    const records = freeze(structuredClone(LIVE_RECORDS));
    const original = freeze(projectRecordsToGraph(records, BRIEF));
    const originalBytes = JSON.stringify(original);
    const question = original.graph.nodes.find((node) => node.provenance?.source_quote === QUESTION)!;
    expect(question.label).toBe(QUESTION);
    expect(question.provenance?.merged_refinements).toEqual(['Hold Price (Status Quo)']);
    expect(question.is_baseline).toBe(true);
    const beforeV3 = projectGraphAndOptionsToV3(original.graph as never, { brief: BRIEF });
    expect(beforeV3.options.find((option) => option.id === question.id)?.label).toBe(QUESTION);

    const result = reconcileDraftOptionFraming(records, original);
    expect(result.resolved).toEqual([{ option_id: question.id, label: 'Hold Price (Status Quo)', source_quote: QUESTION, claim_index: 0 }]);
    expect(result.unresolved).toEqual([]);
    expect(JSON.stringify(original)).toBe(originalBytes);
    expect(records).toEqual(LIVE_RECORDS);
    const repaired = result.projection.graph.nodes.find((node) => node.id === question.id)!;
    expect(withoutNodeProvenanceAndLabel(repaired as never)).toEqual(withoutNodeProvenanceAndLabel(question as never));
    expect(repaired.provenance).toEqual({ ...question.provenance, provenance_class: 'ai_inferred', label_authored: true });
    expect(result.projection.provenance[question.id]).toEqual(repaired.provenance);
    expect(result.projection.graph.nodes.filter((node) => node.id !== question.id)).toEqual(original.graph.nodes.filter((node) => node.id !== question.id));
    expect(result.projection.graph.edges).toEqual(original.graph.edges);
    expect(result.projection.graph.meta).toEqual(original.graph.meta);
    expect(result.projection.dropped).toEqual(original.dropped);

    const afterV3 = projectGraphAndOptionsToV3(result.projection.graph as never, { brief: BRIEF });
    const option = afterV3.options.find((entry) => entry.id === question.id)!;
    const node = afterV3.graph.nodes.find((entry) => entry.id === question.id)!;
    expect(option.label).toBe('Hold Price (Status Quo)');
    expect(node.label).toBe(option.label);
    expect(node.source_quote).toBe(QUESTION);
    expect(node.label_authored).toBe(true);
    expect(node.provenance).toBe('ai_inferred');
    expect(option.provenance?.source).toBe('cee_hypothesis');
    expect(option.provenance?.brief_quote).toBeUndefined();
    expect(option.interventions).toEqual(beforeV3.options.find((entry) => entry.id === question.id)!.interventions);
    expect(afterV3.graph.edges).toEqual(beforeV3.graph.edges);
    expect(afterV3.options.map((entry) => entry.id)).toEqual(beforeV3.options.map((entry) => entry.id));
    const ready = buildAnalysisReadyPayload(afterV3.options, afterV3.goal_node_id, afterV3.graph);
    expect(ready.options.find((entry) => entry.id === question.id)?.label).toBe(option.label);
    expect(reconcileDraftOptionFraming(records, result.projection)).toEqual({ projection: result.projection, resolved: [], unresolved: [] });
  });
});

describe('unresolved framing is removed without removing usable alternatives', () => {
  it('does not invent a name from a baseline flag without a unique merge receipt', () => {
    const original = projectRecordsToGraph(LIVE_RECORDS, BRIEF);
    const question = original.graph.nodes.find((node) => node.provenance?.source_quote === QUESTION)!;
    const { merged_refinements: _receipt, ...withoutReceipt } = question.provenance!;
    question.provenance = withoutReceipt;
    const input = { ...original, provenance: { ...original.provenance, [question.id]: withoutReceipt } };
    freeze(input);
    const result = reconcileDraftOptionFraming(LIVE_RECORDS, input);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toEqual({ reason: 'decision_framing_not_an_option', node_id: question.id, label: QUESTION, original_node: question, incident_edges: input.graph.edges.filter((edge) => edge.from === question.id || edge.to === question.id) });
    expect(result.projection.graph.nodes).toEqual(input.graph.nodes.filter((node) => node.id !== question.id));
    expect(result.projection.graph.edges).toEqual(input.graph.edges.filter((edge) => edge.from !== question.id && edge.to !== question.id));
    expect(result.projection.provenance[question.id]).toBeUndefined();
    expect(result.projection.graph.nodes.filter((node) => node.kind === 'option').length).toBeGreaterThanOrEqual(2);
    expect(result.projection.graph.meta.roots).not.toContain(question.id);
    expect(result.projection.graph.meta.leaves).not.toContain(question.id);
  });

  it('never chooses between competing refinements; preserves their separate alternatives', () => {
    const records = structuredClone(LIVE_RECORDS);
    const refinementIndex = records.claims.length;
    records.claims.push({ claim_kind: 'option_refinement', label: 'Reduce Price 5%', basis: [3], is_baseline: false });
    records.claims.push({ claim_kind: 'causal_link', label: 'discount lowers price', from_claim: refinementIndex, to_claim: 4, effect: 'positive', sets_to: 0.95 });
    const original = freeze(projectRecordsToGraph(records, BRIEF));
    const question = original.graph.nodes.find((node) => node.provenance?.source_quote === QUESTION)!;
    const result = reconcileDraftOptionFraming(records, original);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved.map((entry) => entry.node_id)).toEqual([question.id]);
    expect(result.projection.graph.nodes).toEqual(original.graph.nodes.filter((node) => node.id !== question.id));
    expect(result.projection.graph.nodes.some((node) => node.label === 'Hold Price (Status Quo)')).toBe(true);
    expect(result.projection.graph.nodes.some((node) => node.label === 'Reduce Price 5%')).toBe(true);
  });

  it('does not treat an unquantified refinement as a proven modelled alternative', () => {
    const records = structuredClone(LIVE_RECORDS);
    delete records.claims[10]!.sets_to;
    const result = reconcileDraftOptionFraming(records, projectRecordsToGraph(records, BRIEF));
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
  });

  it('rejects an invalid refinement target even when the parent carries a different real effect', () => {
    const records = structuredClone(LIVE_RECORDS);
    records.claims[10]!.to_claim = 999;
    records.claims.push({ claim_kind: 'causal_link', label: 'Question parent owns a different value',
      from_stated: 3, to_claim: 4, effect: 'positive', sets_to: 0.9 });
    const original = freeze(projectRecordsToGraph(records, BRIEF));
    const question = original.graph.nodes.find((node) => node.provenance?.source_quote === QUESTION)!;
    expect(question.provenance?.merged_refinements).toEqual(['Hold Price (Status Quo)']);
    expect(Object.values(question.data!.raw_interventions as object)).toEqual([0.9]);
    const result = reconcileDraftOptionFraming(records, original);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved.map((entry) => entry.node_id)).toEqual([question.id]);
    expect(result.projection.graph.nodes).toEqual(original.graph.nodes.filter((node) => node.id !== question.id));
  });

  it('rejects a projection whose carried value differs from the refinement effect', () => {
    const projection = projectRecordsToGraph(LIVE_RECORDS, BRIEF);
    const question = projection.graph.nodes.find((node) => node.provenance?.source_quote === QUESTION)!;
    const factorId = Object.keys(question.data!.raw_interventions as object)[0]!;
    question.data!.raw_interventions = { [factorId]: 0.9 };
    question.data!.interventions = { [factorId]: 0.45 };
    const result = reconcileDraftOptionFraming(LIVE_RECORDS, freeze(projection));
    expect(result.resolved).toEqual([]);
    expect(result.unresolved.map((entry) => entry.node_id)).toEqual([question.id]);
  });

  it('quarantines whole-question labels on AI-authored options too', () => {
    const records = structuredClone(LIVE_RECORDS);
    records.claims[1]!.label = 'Should we raise prices?';
    const projection = freeze(projectRecordsToGraph(records, BRIEF));
    const question = projection.graph.nodes.find((node) => node.label === 'Should we raise prices?')!;
    expect(question.provenance?.provenance_class).toBe('ai_inferred');
    const result = reconcileDraftOptionFraming(records, projection);
    expect(result.unresolved.map((entry) => entry.node_id)).toContain(question.id);
    expect(result.projection.graph.nodes.some((node) => node.id === question.id)).toBe(false);
    expect(result.resolved).toHaveLength(1);
  });

  it('does not resolve contradictory explicit baseline flags', () => {
    const records = structuredClone(LIVE_RECORDS);
    records.claims[0]!.is_baseline = false;
    const result = reconcileDraftOptionFraming(records, projectRecordsToGraph(records, BRIEF));
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
  });

  it('returns the incomplete remainder without fabricating the missing option', () => {
    const records: DraftRecordSet = {
      stated_items: [{ kind: 'option', source_quote: QUESTION, is_baseline: true }, { kind: 'option', source_quote: 'Raise prices 15%', is_baseline: false }],
      claims: [],
    };
    const result = reconcileDraftOptionFraming(records, projectRecordsToGraph(records, QUESTION));
    expect(result.unresolved).toHaveLength(1);
    expect(result.projection.graph.nodes.filter((node) => node.kind === 'option').map((node) => node.label)).toEqual(['Raise prices 15%']);
  });
});

describe('honest baseline and no-baseline controls', () => {
  it.each([true, false])('leaves genuine labels and baseline flag %s unchanged', (isBaseline) => {
    const records: DraftRecordSet = { stated_items: [
      { kind: 'option', source_quote: 'Keep prices unchanged', is_baseline: isBaseline },
      { kind: 'option', source_quote: 'Raise prices 15%', is_baseline: false },
    ], claims: [] };
    const projection = freeze(projectRecordsToGraph(records));
    const result = reconcileDraftOptionFraming(records, projection);
    expect(result.projection).toBe(projection);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});
