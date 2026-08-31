/**
 * Real adapter -> V3 contract regression, with only the provider SDK mocked.
 * The first case uses immutable captured provider bytes. The other cases are
 * explicit controls for the accepted-completion and unresolved-framing paths.
 * This does not execute pipeline repair/package, persistence, ranking or a UI.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CEEGraphResponseV3 } from '../../../../schemas/cee-v3.js';
import { transformResponseToV3 } from '../../../transforms/schema-v3.js';
import { projectDraftRecords } from '../seam.js';
import { enumerateCompletionAsk, modelAnswerableAskItems } from '../completion.js';
import type { DraftRecordSet } from '../grammar.js';

const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/captured-question-records.json', import.meta.url), 'utf8',
)) as { provenance: { raw_sha256: string }; brief: string; raw_text: string };

const h = vi.hoisted(() => ({
  payload: '',
  completionPayload: JSON.stringify({ claims: [] }),
  streamCalls: 0,
  completionCalls: 0,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: () => {
        h.streamCalls++;
        const text = h.payload;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
          },
          async finalMessage() {
            return {
              content: [{ type: 'text', text }],
              usage: { input_tokens: 100, output_tokens: 50 },
              stop_reason: 'end_turn',
            };
          },
        };
      },
      create: async () => {
        h.completionCalls++;
        return {
          content: [{ type: 'text', text: h.completionPayload }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        };
      },
    };
  }
  return { default: MockAnthropic };
});

let draftGraphWithAnthropic: typeof import('../../../../adapters/llm/anthropic.js').draftGraphWithAnthropic;
const prior: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ['ANTHROPIC_API_KEY', 'CEE_ANTHROPIC_STRUCTURED_OUTPUTS']) prior[key] = process.env[key];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-option-framing';
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
  const { _resetConfigCache } = await import('../../../../config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import('../../../../adapters/llm/anthropic.js'));
});

afterAll(async () => {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const { _resetConfigCache } = await import('../../../../config/index.js');
  _resetConfigCache();
});

beforeEach(() => {
  h.payload = '';
  h.completionPayload = JSON.stringify({ claims: [] });
  h.streamCalls = 0;
  h.completionCalls = 0;
});

async function draft(rawText: string, brief: string) {
  h.payload = rawText;
  const result = await draftGraphWithAnthropic(
    { brief, docs: [], seed: 17, model: 'claude-sonnet-4-6' },
    { timeoutMs: 120_000, forceDefault: true },
  );
  expect(h.streamCalls).toBe(1);
  const wire = CEEGraphResponseV3.parse(transformResponseToV3({
    graph: result.graph,
    record_disclosures: result.record_disclosures,
  } as never, { brief }));
  return { result, wire };
}

const QUESTION = 'Should we expand delivery capacity?';
const CONTROL_BRIEF = `${QUESTION} Compare opening a second warehouse with partnering with a fulfilment provider. Our goal is to improve delivery reliability.`;
function unresolvedRecords(): DraftRecordSet {
  return {
    stated_items: [
      { kind: 'goal', source_quote: 'improve delivery reliability' },
      { kind: 'option', source_quote: QUESTION, is_baseline: true },
      { kind: 'option', source_quote: 'opening a second warehouse', is_baseline: false },
      { kind: 'option', source_quote: 'partnering with a fulfilment provider', is_baseline: false },
    ],
    claims: [
      { claim_kind: 'factor', label: 'Fulfilment capacity', category: 'controllable', basis: [2, 3] },
      { claim_kind: 'causal_link', label: 'Warehouse expands capacity', from_stated: 2, to_claim: 0, sets_to: 0.8 },
      { claim_kind: 'causal_link', label: 'Partner supplies capacity', from_stated: 3, to_claim: 0, sets_to: 0.6 },
      { claim_kind: 'causal_link', label: 'Capacity improves delivery', from_claim: 0, to_stated: 0, effect: 'positive' },
    ],
  };
}

describe('final adapter reconciliation before any graph consumer', () => {
  it('recovers the captured refinement with the same option ID, AI authorship, source quote and intervention', async () => {
    expect(createHash('sha256').update(fixture.raw_text).digest('hex')).toBe(fixture.provenance.raw_sha256);
    const records = JSON.parse(fixture.raw_text);
    const rawBefore = JSON.stringify(records);
    const original = projectDraftRecords(records, fixture.brief);
    expect(original.ok).toBe(true);
    if (!original.ok) throw new Error('Captured record set must validate');
    const before = original.projection.graph.nodes.find(n => n.id === 'e432b605')!;
    expect(before.label).toBe('We need to decide whether to raise prices 15% next quarter');
    expect(before.provenance?.merged_refinements).toEqual(['Hold Price (Status Quo)']);

    const { result, wire } = await draft(fixture.raw_text, fixture.brief);
    const adapterNode = result.graph.nodes.find(n => n.id === before.id)!;
    const node = wire.nodes.find(n => n.id === before.id)!;
    const option = wire.options.find(o => o.id === before.id)!;
    const ready = wire.analysis_ready!.options.find(o => o.id === before.id)!;
    expect(adapterNode.label).toBe('Hold Price (Status Quo)');
    expect(adapterNode.data?.interventions).toEqual(before.data?.interventions);
    expect(adapterNode.data?.raw_interventions).toEqual(before.data?.raw_interventions);
    expect(node.label).toBe(adapterNode.label);
    expect(option.label).toBe(node.label);
    expect(ready.label).toBe(node.label);
    expect(node.source_quote).toBe(before.label);
    expect(node.label_authored).toBe(true);
    expect(node.provenance).toBe('ai_inferred');
    expect(option.provenance?.source).toBe('cee_hypothesis');
    expect(option.is_baseline).toBe(true);
    expect(option.interventions['5f3b2b5d'].value).toBe(0.5);
    expect(option.raw_interventions).toEqual({ '5f3b2b5d': 1 });
    expect(ready.raw_interventions).toEqual(option.raw_interventions);
    expect(result.meta?.raw_llm_text).toBe(fixture.raw_text);
    expect(JSON.stringify(records)).toBe(rawBefore);
    expect(JSON.parse(result.meta!.raw_llm_text!).stated_items[3].source_quote).toBe(before.label);
  });

  it('uses a safe refinement added by an accepted completion before final reconciliation', async () => {
    const records = unresolvedRecords();
    const initial = projectDraftRecords(records, CONTROL_BRIEF);
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('Control records must validate');
    const question = initial.projection.graph.nodes.find(n => n.label === QUESTION)!;
    expect(question).toBeDefined();
    expect(question.provenance?.merged_refinements).toBeUndefined();
    expect(modelAnswerableAskItems(enumerateCompletionAsk(initial.records, initial.projection)).length).toBeGreaterThan(0);
    h.completionPayload = JSON.stringify({ claims: [
      { claim_kind: 'option_refinement', label: 'Hold Existing Delivery Capacity', basis: [1] },
      { claim_kind: 'causal_link', label: 'Hold capacity at the current level', from_claim: records.claims.length, to_claim: 0, sets_to: 0.4 },
    ] });

    const rawText = JSON.stringify(records);
    const { result, wire } = await draft(rawText, CONTROL_BRIEF);
    expect(h.completionCalls).toBe(1);
    const held = wire.options.find(o => o.id === question.id)!;
    expect(held, 'accepted completion must recover the original question option ID').toBeDefined();
    expect(held.label).toBe('Hold Existing Delivery Capacity');
    expect(held.raw_interventions).toEqual({ [initial.projection.graph.nodes.find(n => n.kind === 'factor')!.id]: 0.4 });
    expect(wire.nodes.find(n => n.id === question.id)?.source_quote).toBe(QUESTION);
    expect(wire.nodes.find(n => n.id === question.id)?.provenance).toBe('ai_inferred');
    expect(wire.record_disclosures?.some(d => d.reason === 'decision_framing_not_an_option')).not.toBe(true);
    expect(result.meta?.raw_llm_text).toBe(rawText);
    expect(JSON.parse(result.meta!.raw_llm_text!).claims).toHaveLength(records.claims.length);
  });

  it('excludes an unrecoverable question, preserves two genuine alternatives, and carries the framing gap to V3', async () => {
    const records = unresolvedRecords();
    const original = projectDraftRecords(records, CONTROL_BRIEF);
    expect(original.ok).toBe(true);
    if (!original.ok) throw new Error('Control records must validate');
    const question = original.projection.graph.nodes.find(n => n.label === QUESTION)!;
    const genuine = original.projection.graph.nodes.filter(n => n.kind === 'option' && n.id !== question.id);
    expect(genuine).toHaveLength(2);
    const rawText = JSON.stringify(records);
    const { result, wire } = await draft(rawText, CONTROL_BRIEF);
    expect(result.graph.nodes.some(n => n.id === question.id)).toBe(false);
    expect(result.graph.edges.some(e => e.from === question.id || e.to === question.id)).toBe(false);
    expect(wire.options.map(o => o.id).sort()).toEqual(genuine.map(n => n.id).sort());
    expect(wire.analysis_ready!.options.map(o => o.id).sort()).toEqual(genuine.map(n => n.id).sort());
    expect(wire.options.every(o => o.is_baseline !== true)).toBe(true);
    for (const retained of genuine) {
      expect(result.graph.nodes.find(n => n.id === retained.id)?.data?.interventions).toEqual(retained.data?.interventions);
      expect(wire.options.find(o => o.id === retained.id)?.raw_interventions).toEqual(retained.data?.raw_interventions);
    }
    expect(result.record_disclosures).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'decision_framing_not_an_option', node_id: question.id, label: QUESTION }),
    ]));
    const gap = wire.record_disclosures?.find(d => d.reason === 'decision_framing_not_an_option');
    expect(gap).toMatchObject({ label: QUESTION, withdrawn: true });
    expect(gap?.node_id).toBeUndefined();
    expect(result.meta?.raw_llm_text).toBe(rawText);
  });
});
