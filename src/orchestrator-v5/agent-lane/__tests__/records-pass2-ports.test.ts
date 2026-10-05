/**
 * PASS 2 PORTS (DL rulings 5 Oct ~02:1xZ): build-time outputs the legacy constructor produced that the records build
 * must also produce. Every row is bound by IDENTITY — the exact node id, label and value it names — on the body the
 * records build actually sent to `/graph/register`, never on a count another object could satisfy.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { strictRecordsWire } from './records-wire-fixture.js';

const SID = '22222222-2222-4222-8222-222222222222';

async function build(records: DraftRecordSet, brief: string) {
  const writes: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Registration body must be an object.');
      writes.push(body as Record<string, unknown>);
      return { status: 200, json: {} };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromRecords(SID, brief, dispatch, async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  return { result, writes };
}

type SentGraph = {
  nodes: Array<{ id: string; kind: string; label: string }>;
  goal_constraints?: Array<Record<string, unknown>>;
};

/** One located user limit on claim 1 ("Monthly churn"), stated in the brief. */
const LIMIT_BRIEF = 'MRR. Raise Pro to £59. Monthly churn under 4%.';
const limitRecords = (): DraftRecordSet => ({
  stated_items: [
    { kind: 'goal', source_quote: 'MRR' },
    { kind: 'option', source_quote: 'Raise Pro to £59' },
    { kind: 'constraint', source_quote: 'Monthly churn under 4%', value: 4, unit: '%', direction: 'ceiling',
      direction_span: { start: 14, end: 19 }, value_span: { start: 20, end: 21 }, applies_to_claim: 1 },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Pro plan price', value: 49, unit: 'GBP', value_scale: 'raw_count' },
    { claim_kind: 'factor', label: 'Monthly churn', value: 3, unit: '%', value_scale: 'raw_count' },
    { claim_kind: 'outcome', label: 'Monthly recurring revenue' },
    { claim_kind: 'causal_link', label: 'Price effect', from_claim: 0, to_claim: 2, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Churn effect', from_claim: 1, to_claim: 2, effect: 'negative' },
    { claim_kind: 'causal_link', label: 'Revenue reaches goal', from_claim: 2, to_stated: 0, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Price level', from_stated: 1, to_claim: 0, sets_to: 59, unit: 'GBP', value_scale: 'raw_count', effect: 'positive' },
  ],
});

describe('P2-P1: the stated limit persists with the registered graph, compiled by the compound-goals authority', () => {
  it('registers exactly the churn ceiling, on the churn factor, as a framed level', async () => {
    const { result, writes } = await build(limitRecords(), LIMIT_BRIEF);
    expect(result).toMatchObject({ ok: true, mutated: true, goal_constraints_carried: 1 });
    expect(writes).toHaveLength(1);
    const graph = writes[0]!.graph as SentGraph;
    const churn = graph.nodes.filter((node) => node.kind === 'factor' && node.label === 'Monthly churn');
    expect(churn, 'identity: the one churn factor').toHaveLength(1);
    expect(graph.goal_constraints).toEqual([expect.objectContaining({
      node_id: churn[0]!.id, operator: '<=', value: 0.04, unit: 'fraction', value_frame: 'level',
      source_quote: 'Monthly churn under 4%', provenance: 'explicit',
    })]);
    // Not the raw projection row: its unframed `4 %` is not compilation authority.
    expect(graph.goal_constraints![0]).not.toMatchObject({ value: 4, unit: '%' });
  });

  it('contrast: an unlocated record limit is not replaced by a label-bound regex row from the same brief', async () => {
    const records = limitRecords();
    records.stated_items[2] = { ...records.stated_items[2]!, source_quote: 'Something nobody modelled under 4%', applies_to_claim: 999 } as DraftRecordSet['stated_items'][number];
    const { result, writes } = await build(records, LIMIT_BRIEF);
    expect(result.ok).toBe(true);
    const graph = writes[0]!.graph as SentGraph;
    // The brief's own churn sentence is NOT label-bound onto the churn factor by the regex producer.
    expect('goal_constraints' in graph).toBe(false);
    expect(result.goal_constraints_carried).toBe(0);
  });
});
