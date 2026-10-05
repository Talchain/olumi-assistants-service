/**
 * S2 (Lead/Science, 5 Oct): fix (a)'s typed escape made the register CONTRADICT the graph. The sealed ideal sent through
 * the strict wire (`strictRecordsWire(sealedRecordsVNext())`, Science row 4's fixture) types the goal's absent `unit`
 * "unresolved"; the compile resolves it from the goal's quantity declaration ("£/month") and carries the goal at
 * `goal_threshold_raw` 150000, yet the receipt said asked/link_unresolved and the reply asked for the unit.
 * Rule: a carried item is reported carried; an unresolved link raises an ask ONLY when the compile could not resolve it.
 */
import { describe, expect, it } from 'vitest';
import { BRIEF, sealedRecordsVNext } from './sealed-fixture-vnext.js';
import { strictRecordsWire } from '../../../../../orchestrator-v5/agent-lane/__tests__/records-wire-fixture.js';
import { buildModelFromRecords } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import type { DraftRecordSet } from '../../grammar.js';

type Json = Record<string, any>;
const GOAL = 6, CONTEXT_FIGURE = 14;

async function construct(wire: unknown): Promise<{ result: Json; body: Json }> {
  let body: Json | undefined;
  const result: Json = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', BRIEF,
    async (path, b) => { if (path.endsWith('/register')) { body = b as Json; return { status: 200, json: { model_version: 1 } }; } return { status: 200, json: { graph: { nodes: [], edges: [] } } }; },
    async () => ({ text: JSON.stringify(wire), status: 'completed' }));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { result, body: body! };
}
const row = (body: Json, index: number): Json => (body.stated_dispositions as Json[]).find(d => d.stated_index === index)!;
const goalQuote = (records: DraftRecordSet): string => records.stated_items[GOAL]!.source_quote;

describe('S2: a link the compile resolves is not asked, and a carried item is reported carried', () => {
  it('row-4 fixture: the goal unit typed "unresolved" is resolved by its quantity declaration — carried, no ask', async () => {
    const records = sealedRecordsVNext();
    const { result, body } = await construct(strictRecordsWire(records));
    const goal = (body.graph.nodes as Json[]).find(n => n.kind === 'goal')!;
    expect(goal.goal_threshold_unit).toBe('£/month');
    expect(row(body, GOAL)).toMatchObject({ disposition: 'carried', location: { node_id: goal.id, path: ['goal_threshold_raw'] }, stored_value: 150000 });
    expect((result.not_represented as Json[]).filter(d => d.stated_index === GOAL && d.reason === 'link_unresolved')).toEqual([]);
    expect((result.open_questions as string[]).some(q => q.includes(`"${goalQuote(records)}"`) && q.includes('the unit it is measured in'))).toBe(false);
  });
  it('CONTRAST item 14 (a context figure, quantity unresolved: nothing resolves it) stays asked, with its question', async () => {
    const records = sealedRecordsVNext();
    const { result, body } = await construct(strictRecordsWire(records));
    expect(row(body, CONTEXT_FIGURE)).toMatchObject({ disposition: 'asked', reason: 'link_unresolved' });
    expect(result.not_represented).toContainEqual(expect.objectContaining({ stated_index: CONTEXT_FIGURE, reason: 'link_unresolved', unresolved_field: 'quantity' }));
    const quote = records.stated_items[CONTEXT_FIGURE]!.source_quote;
    expect((result.open_questions as string[]).filter(q => q.includes(`"${quote}"`))).toHaveLength(1);
  });
  it('a carried goal whose direction the compile cannot resolve: carried receipt AND the direction ask', async () => {
    const records = sealedRecordsVNext();
    const wire = structuredClone(strictRecordsWire(records)) as Json;
    wire.stated_items[GOAL].direction = 'unresolved';
    const { result, body } = await construct(wire);
    expect(row(body, GOAL)).toMatchObject({ disposition: 'carried', stored_value: 150000 });
    expect(result.not_represented).toContainEqual(expect.objectContaining({ stated_index: GOAL, reason: 'link_unresolved', unresolved_field: 'direction' }));
    expect((result.open_questions as string[]).some(q => q.includes(`"${goalQuote(records)}"`) && q.includes('whether it is a floor (at least) or a ceiling (at most)'))).toBe(true);
  });
  it('the unit is asked when no declaration supplies it (the goal names no quantity)', async () => {
    const records = sealedRecordsVNext();
    delete records.stated_items[GOAL]!.quantity;
    const { result } = await construct(strictRecordsWire(records));
    expect(result.not_represented).toContainEqual(expect.objectContaining({ stated_index: GOAL, reason: 'link_unresolved', unresolved_field: 'unit' }));
  });
});
