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

/** Two options the user named, one Olumi added (an `option_refinement` claim), and the model's own status quo. */
const AUTHORSHIP_BRIEF = 'Hire a tech lead or hire two developers for Delivery reliability.';
const authorshipRecords = (): DraftRecordSet => ({
  stated_items: [
    { kind: 'goal', source_quote: 'Delivery reliability' },
    { kind: 'option', source_quote: 'Hire a tech lead' },
    { kind: 'option', source_quote: 'hire two developers' },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Team capacity', value: 5, unit: 'people', value_scale: 'raw_count' },
    { claim_kind: 'outcome', label: 'Delivery reliability' },
    { claim_kind: 'causal_link', label: 'Lead sets capacity', from_stated: 1, to_claim: 0, sets_to: 7, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Developers set capacity', from_stated: 2, to_claim: 0, sets_to: 8, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Capacity affects result', from_claim: 0, to_claim: 1, effect: 'positive', strength: 0.5 },
    { claim_kind: 'causal_link', label: 'Result reaches goal', from_claim: 1, to_stated: 0, effect: 'positive', strength: 1 },
    { claim_kind: 'option_refinement', label: 'Phased hiring' },
    { claim_kind: 'causal_link', label: 'Phased level', from_claim: 6, to_claim: 0, sets_to: 6, effect: 'positive' },
    { claim_kind: 'option_refinement', label: 'Carry on as now', is_baseline: true },
  ],
});

type AuthoredNode = { id: string; kind: string; label: string; proposed_by?: string; is_baseline?: boolean; interventions?: Record<string, unknown> };

describe('P2-P2: an option Olumi added carries proposed_by olumi, from the record\'s own typed origin', () => {
  it('marks exactly the claim-minted option, never a stated option or the model\'s status quo', async () => {
    const { result, writes } = await build(authorshipRecords(), AUTHORSHIP_BRIEF);
    expect(result).toMatchObject({ ok: true, mutated: true });
    const options = (writes[0]!.graph as { nodes: AuthoredNode[] }).nodes.filter((node) => node.kind === 'option');
    const byLabel = (label: string) => { const hit = options.filter((o) => o.label === label); expect(hit, label).toHaveLength(1); return hit[0]!; };
    expect(byLabel('Phased hiring').proposed_by).toBe('olumi');
    expect(byLabel('Hire a Tech Lead').proposed_by).toBeUndefined();
    expect(byLabel('Hire Two Developers').proposed_by).toBeUndefined();
    expect(byLabel('Carry on as now')).toMatchObject({ is_baseline: true });
    expect(byLabel('Carry on as now').proposed_by).toBeUndefined();
    expect(options.filter((o) => o.proposed_by === 'olumi').map((o) => o.id)).toEqual([byLabel('Phased hiring').id]);
  });

  it('the licence leaves the Olumi option out exactly as on the legacy path (excluded_olumi_proposed)', async () => {
    const { filterOlumiProposedOptions } = await import('../../tools/handlers/olumi-option-filter.js');
    const { writes } = await build(authorshipRecords(), AUTHORSHIP_BRIEF);
    const graph = writes[0]!.graph as { nodes: AuthoredNode[] };
    const submitted = graph.nodes.filter((n) => n.kind === 'option' && n.is_baseline !== true)
      .map((n) => ({ option_id: n.id, label: n.label, interventions: n.interventions ?? {} }));
    expect(submitted, 'control: three options with levels are submitted').toHaveLength(3);
    const phased = graph.nodes.find((n) => n.kind === 'option' && n.label === 'Phased hiring')!;
    const out = filterOlumiProposedOptions({ submitted, graph });
    expect(out.participation).toEqual([{ option_id: phased.id, state: 'excluded_olumi_proposed' }]);
    expect(out.options.map((o) => o.option_id)).toEqual(submitted.filter((o) => o.option_id !== phased.id).map((o) => o.option_id));
    expect(out.keptOlumiProvisional).toBe(false);
  });
});

describe('P2-P3: an oversized records draft is refused model_too_large by the legacy size gate, before any write', () => {
  it('refuses the 35-extra-factor draft with the legacy refusal shape, zero writes, no retry', async () => {
    const { COMPACT_LIMITS } = await import('../construction-size-gate.js');
    const { oversizedConstructionRecords } = await import('./records-wire-fixture.js');
    const { result, writes } = await build(oversizedConstructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(writes, 'nothing registered').toHaveLength(0);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'model_too_large', retried: false, limits: COMPACT_LIMITS });
    // Counted on the graph that WOULD have registered: the five-claim topology plus 35 factors Olumi added, by origin.
    expect(result.by_kind).toMatchObject({ factor: 36, option: 1, goal: 1, outcome: 1 });
    // Every node minted from an UNBASED claim is Olumi's addition: the 35 extra factors plus the base topology's own two
    // claims (factor 'Team capacity', outcome 'Delivery reliability'); the stated goal and option are the user's.
    expect(result.added_beyond_brief).toBe(35 + 2);
    expect(result.from_your_brief).toBe(2);
    expect(result.nodes).toBeGreaterThan(COMPACT_LIMITS.maxNodes);
  });

  it('contrast: the same topology without the extra factors registers, with the compact verdict on the success', async () => {
    const { constructionRecords } = await import('./records-wire-fixture.js');
    const { result, writes } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(writes).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, mutated: true, within_compact_limits: true, size_retried: false });
    expect('admitted_over_limit_because' in result).toBe(false);
  });
});
