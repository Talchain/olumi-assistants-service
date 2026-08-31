/**
 * THE WIRING, MEASURED — not inferred from a three-line diff.
 *
 * `cause-framing.test.ts` proves the guard is correct in isolation. A correct
 * guard nobody calls is the estate's #1 chronic failure, so this file drives the
 * REAL adapter (`draftGraphWithAnthropic`) with only the provider SDK mocked and
 * asserts the WITNESSED record set reaches the V3 wire as the mapping shape,
 * with the withdrawal disclosed.
 *
 * The harness is the one `option-framing-adapter.test.ts` established: same SDK
 * mock, same `forceDefault: true` (so no prompt store or network is touched),
 * same `transformResponseToV3` egress. Nothing here executes pipeline repair,
 * persistence, ranking or a UI.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CEEGraphResponseV3 } from '../../../src/schemas/cee-v3.js';
import { transformResponseToV3 } from '../../../src/cee/transforms/schema-v3.js';
import type { DraftRecordSet } from '../../../src/cee/draft/records/grammar.js';

const capture = JSON.parse(readFileSync(
  new URL('./diagnosis-hypotheses-as-options-1287.json', import.meta.url), 'utf8',
)) as { brief: string; raw_text: string };

const h = vi.hoisted(() => ({ payload: '', streamCalls: 0 }));

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
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ claims: [] }) }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      }),
    };
  }
  return { default: MockAnthropic };
});

let draftGraphWithAnthropic:
  typeof import('../../../src/adapters/llm/anthropic.js').draftGraphWithAnthropic;
const prior: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ['ANTHROPIC_API_KEY', 'CEE_ANTHROPIC_STRUCTURED_OUTPUTS']) {
    prior[key] = process.env[key];
  }
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-cause-framing';
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
  const { _resetConfigCache } = await import('../../../src/config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import('../../../src/adapters/llm/anthropic.js'));
});

afterAll(async () => {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const { _resetConfigCache } = await import('../../../src/config/index.js');
  _resetConfigCache();
});

beforeEach(() => {
  h.payload = '';
  h.streamCalls = 0;
});

async function draft(records: DraftRecordSet | string, brief: string) {
  h.payload = typeof records === 'string' ? records : JSON.stringify(records);
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

const HYPOTHESIS_IDS = ['b83e6409', 'd6d8938d', 'dc2b4f19', 'fcf60fe7'];

describe('the #1287 diagnosis brief reaches the wire as a model, not a menu', () => {
  it('ships zero options and zero decisions, with the hypotheses kept as factors', async () => {
    const { result, wire } = await draft(capture.raw_text, capture.brief);

    const kinds = (nodes: readonly { kind?: string; id: string }[], kind: string) =>
      nodes.filter((node) => node.kind === kind).map((node) => node.id).sort();

    // The adapter's own graph, and the V3 wire, agree: no comparison was shipped.
    expect(kinds(result.graph.nodes as never, 'option')).toEqual([]);
    expect(kinds(result.graph.nodes as never, 'decision')).toEqual([]);
    expect(wire.options).toEqual([]);
    expect(kinds(wire.nodes as never, 'option')).toEqual([]);

    // Bound by identity: not one of the four hypothesis ids survives as a node
    // of any kind, and the second modelling of them as factors is intact.
    for (const id of HYPOTHESIS_IDS) {
      expect(wire.nodes.find((node) => node.id === id), `hypothesis ${id} still on the wire`)
        .toBeUndefined();
    }
    expect(wire.nodes.find((node) => node.id === '6c1aebc3')?.label).toBe('Migration backlog size');
    expect(kinds(wire.nodes as never, 'factor')).toContain('80e43e0a');
    expect(kinds(wire.nodes as never, 'goal')).toEqual(['646fde87']);
  });

  it('discloses the withdrawal rather than performing it silently', async () => {
    const { result } = await draft(capture.raw_text, capture.brief);
    const disclosures = (result.record_disclosures ?? []) as { reason?: string; node_id?: string }[];
    const causes = disclosures.filter((d) => d.reason === 'cause_framing_not_an_option');
    expect(causes.map((d) => d.node_id).sort()).toEqual([...HYPOTHESIS_IDS].sort());
    expect(disclosures.filter((d) => d.reason === 'no_comparison_after_cause_withdrawal'))
      .toHaveLength(2); // the surviving action, plus the minted decision node
  });
});

describe('the discriminating twin still reaches the wire WITH its options', () => {
  const BRIEF =
    'Fulfilment is straining. Ops want to open a second warehouse in Leeds, finance would '
    + 'rather we stay with one warehouse, and everyone agrees we must improve delivery reliability.';
  const RECORDS = {
    stated_items: [
      { kind: 'goal', source_quote: 'improve delivery reliability' },
      { kind: 'option', source_quote: 'open a second warehouse in Leeds', is_baseline: false },
      { kind: 'option', source_quote: 'stay with one warehouse', is_baseline: true },
    ],
    claims: [
      { claim_kind: 'factor', label: 'Fulfilment capacity', category: 'controllable', basis: [1, 2] },
      { claim_kind: 'causal_link', label: 'Leeds expands capacity', from_stated: 1, to_claim: 0, sets_to: 0.8 },
      { claim_kind: 'causal_link', label: 'One warehouse holds capacity', from_stated: 2, to_claim: 0, sets_to: 0.4 },
      { claim_kind: 'causal_link', label: 'Capacity improves delivery', from_claim: 0, to_stated: 0, effect: 'positive' },
    ],
  } as unknown as DraftRecordSet;

  it('keeps both alternatives and raises no cause-framing disclosure', async () => {
    const { wire } = await draft(RECORDS, BRIEF);
    expect(wire.options.length).toBeGreaterThanOrEqual(2);
    expect(wire.nodes.filter((node) => node.kind === 'decision')).toHaveLength(1);
    const disclosures = (wire.record_disclosures ?? []) as { reason?: string }[];
    expect(disclosures.filter((d) => d.reason === 'cause_framing_not_an_option')).toEqual([]);
    expect(disclosures.filter((d) => d.reason === 'no_comparison_after_cause_withdrawal')).toEqual([]);
  });
});
