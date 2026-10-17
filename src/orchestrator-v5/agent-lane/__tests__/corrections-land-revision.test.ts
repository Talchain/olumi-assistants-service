import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';

// Synthetic domains: no pilot text or captured graphs are used by these rows.
const cases = [
  { id: 'freight', label: 'Freight expenditure', unit: 'GBP', old: 17000, next: 6000,
    words: 'Correct Freight expenditure to £6,000. The earlier £17,000 was a commitment.' },
  { id: 'temperature', label: 'Storage temperature', unit: 'degrees', old: 14, next: 9,
    words: 'Correct Storage temperature to 9 degrees; 14 degrees was the old reading.' },
] as const;

function world(row: typeof cases[number]) {
  let graph = { nodes: [
    { id: 'goal', kind: 'goal', label: 'Reliable delivery' },
    { id: row.id, kind: 'factor', label: row.label, provenance: 'unverified_brief',
      observed_state: { value: 0.5, raw_value: row.old, cap: row.old * 2, declared_scale: 'unit_interval', unit: row.unit,
        source: 'cee_inference', extractionType: 'inferred', user_material_unverified: true } },
    { id: 'other', kind: 'factor', label: 'Staff availability', provenance: 'ai_inferred',
      observed_state: { value: 0.6, raw_value: 60, unit: '%', source: 'cee_inference' } },
  ], edges: [] };
  let writes = 0;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(graph), graph_hash: `h${writes}` } };
    const b = body as Record<string, unknown>;
    if (path !== '/orchestrate/v2/turn' || b.kind !== 'system_event') throw new Error(`Unexpected dispatch: ${path}`);
    const event = b.event as Record<string, unknown>;
    const result = await applyFactorValueEdit({ payload: b as never, event: event as never,
      requestId: 'synthetic-write', persistedGraph: graph as never, priorFacts: [] });
    if (result.kind !== 'mutated') throw new Error(`Writer refused: ${JSON.stringify(result)}`);
    graph = result.mutatedGraph as typeof graph;
    writes += 1;
    const fact = result.handlerFacts.find(f => f.fact_type === 'set_factor_value');
    return { status: 200, json: { graph_hash: `h${writes}`, blocks: [{ type: 'graph_patch', status: 'applied',
      operation: 'set_factor_value', target_id: event.target_id, after: fact?.result.after }] } };
  };
  const store = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, store);
  const context = (words: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-446655440061',
    authenticated_user_id: null, request_id: 'synthetic', user_text: words, user_turn_text: words,
    verified_user_messages: [words], user_text_complete: true });
  const args = (revise: boolean, value: number = row.next, words: string = row.words) => ({ assumptions: [{
    factor_label: row.label, unit: row.unit, value, user_stated: true, revise, basis: words,
    statements: [{ quote: words, form: 'point', value }],
  }] });
  return { caps, store, context, args, graph: () => graph, writes: () => writes };
}

describe('explicit revision and held-figure confirmation remain separate acts', () => {
  it.each(cases)('$id: a sourced revision with statements reaches its existing card and real writer', async row => {
    const w = world(row);
    const beforeOther = structuredClone(w.graph().nodes.find(n => n.id === 'other'));
    const card = await w.caps.proposeAssumptions(w.context(row.words), w.args(true) as never);
    expect(card.ok, JSON.stringify(card)).toBe(true);
    expect(card.mutated).toBe(false);
    expect(w.writes()).toBe(0);
    expect(w.graph().nodes.find(n => n.id === row.id)?.observed_state?.raw_value).toBe(row.old);
    const proposal = w.store.get(String(card.proposal_id))!;
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]).toMatchObject({ op: 'set_factor_value', path: row.id,
      value: { value: row.next, unit: row.unit, authored_by: 'user_stated' } });
    expect(card.assumptions).toEqual([expect.objectContaining({ factor: row.label, value: row.next, replaces: row.old })]);
    const applied = await w.caps.authoriseChange(w.context('Yes'), { proposal_id: String(card.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(w.writes()).toBe(1);
    const readback = structuredClone(w.graph());
    expect(readback.nodes.find(n => n.id === row.id)?.observed_state).toMatchObject({ raw_value: row.next, unit: row.unit,
      source: 'user_override' });
    expect(readback.nodes.find(n => n.id === 'other')).toEqual(beforeOther);
    const replay = await w.caps.authoriseChange(w.context('Yes'), { proposal_id: String(card.proposal_id) });
    expect(replay.ok, JSON.stringify(replay)).toBe(true);
    expect(w.writes()).toBe(1);
  });

  it.each(cases)('$id: confirmation without revision still refuses a different figure', async row => {
    const w = world(row);
    const result = await w.caps.proposeAssumptions(w.context(row.words), w.args(false) as never);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'not_the_held_figure' });
    expect(w.writes()).toBe(0);
    expect(w.store.outstanding(w.context(row.words).scenario_id, null)).toEqual([]);
  });

  it.each(cases)('$id: revision cannot claim an absent number as human source', async row => {
    const w = world(row);
    const words = `Please correct ${row.label}; I have not supplied the replacement reading.`;
    const result = await w.caps.proposeAssumptions(w.context(words), w.args(true, row.next, words) as never);
    expect(result.ok).toBe(false);
    expect(w.writes()).toBe(0);
    expect(w.store.outstanding(w.context(words).scenario_id, null)).toEqual([]);
  });

  it.each(cases)('$id: a verified old figure cannot attest a different replacement argument', async row => {
    const w = world(row);
    const words = `${row.label} is ${row.unit === 'GBP' ? '£17,000' : '14 degrees'}.`;
    const args = w.args(true, row.next, words);
    args.assumptions[0]!.statements[0]!.value = row.old;
    const result = await w.caps.proposeAssumptions(w.context(words), args as never);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'not_the_held_figure' });
    expect(w.writes()).toBe(0);
    expect(w.store.outstanding(w.context(words).scenario_id, null)).toEqual([]);
  });

  it('an unrelated money figure never acquires verified authorship of this field', async () => {
    const row = cases[0], w = world(row);
    const words = 'Revenue was £6,000 as of 2026-09-01; please review Freight expenditure.';
    const card = await w.caps.proposeAssumptions(w.context(words), w.args(true, row.next, words) as never);
    if (card.ok) {
      const value = w.store.get(String(card.proposal_id))!.operations[0]!.value as Record<string, unknown>;
      expect(value.user_material_unverified).toBe(true);
      expect(value).not.toHaveProperty('confirmed_from');
      expect(value.confirmation).toEqual({ source: words, quote: words });
    }
    expect(w.writes()).toBe(0);
  });
});
