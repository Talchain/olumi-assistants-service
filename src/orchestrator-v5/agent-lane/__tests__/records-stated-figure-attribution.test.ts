/**
 * #2576 RT-2 (DL; red-team #87 5992417601): a user's stated current figure, restated by one of Olumi's claims, is shown
 * as the USER's (`brief_extraction`), never "Olumi estimate — not yet confirmed" (`cee_inference`). Through the REAL
 * records build; bound by node identity (kind + registered label) and the figure's own value.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { BRIEF, sealedRecordsVNext as sealedRecords } from '../../../cee/draft/records/__tests__/compile-spec/sealed-fixture-vnext.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { strictRecordsWire } from './records-wire-fixture.js';

type Rec = Record<string, any>;
async function graphOf(records: DraftRecordSet): Promise<Rec> {
  const writes: Rec[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { writes.push(body as Rec); return { status: 200, json: {} }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', BRIEF, dispatch, async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  expect(result.ok).toBe(true);
  return writes[0]!.graph as Rec;
}
const node = (g: Rec, kind: string, label: string): Rec => {
  const found = (g.nodes as Rec[]).filter((n) => n.kind === kind && n.label === label);
  expect(found, `${kind} "${label}"`).toHaveLength(1);
  return found[0]!;
};

describe('#2576 RT-2: a claim restating the user\'s bound current figure is the user\'s', () => {
  it('the sealed "£120,000 monthly recurring revenue" registers as brief_extraction on the MRR outcome', async () => {
    const records = sealedRecords();
    // Identity of the case: the claim names the stated figure's own quantity, with the figure's own value.
    const figure = records.stated_items[0]!;
    expect(figure).toMatchObject({ kind: 'figure', role: 'baseline', value: 120000, quantity: 0 });
    expect(records.claims[3]).toMatchObject({ claim_kind: 'outcome', label: 'Monthly recurring revenue', value: 120000, quantity: 0 });
    const mrr = node(await graphOf(records), 'outcome', 'Monthly recurring revenue');
    expect(mrr.observed_state).toMatchObject({ raw_value: 120000, source: 'brief_extraction' });
  });

  it('contrast: Olumi\'s own levels stay Olumi\'s (Starter 0% on "Price rise" cee_hypothesis; "Price rise" level cee_inference)', async () => {
    const g = await graphOf(sealedRecords());
    const price = node(g, 'factor', 'Price rise');
    expect(price.observed_state.source).toBe('cee_inference');
    const starter = node(g, 'option', 'Launch a Starter Tier at £49 a Month');
    expect(starter.interventions[price.id]).toMatchObject({ raw_value: 0, source: 'cee_hypothesis' });
  });

  it('twin: the same claim with a DIFFERENT value from the figure stays Olumi\'s (the number must be the figure\'s)', async () => {
    const records = sealedRecords();
    records.claims[3] = { ...records.claims[3]!, value: 125000 };
    const mrr = node(await graphOf(records), 'outcome', 'Monthly recurring revenue');
    expect(mrr.observed_state.source).toBe('cee_inference');
  });
});
