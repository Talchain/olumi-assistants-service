import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../grammar.js';
import { replayRecordSet } from '../../replay.js';
import { reconcileStatedDispositions, type StatedDisposition } from '../../stated-dispositions.js';
import { buildModelFromRecords, omitOptionalRecordNulls } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { projectGraphForPersistence } from '../../../../../orchestrator-v5/persisted-graph-projection.js';
import { assignEntityRefs } from '../../../../../orchestrator-v5/graph/entity-refs.js';
import { GraphV3, type GraphV3T } from '../../../../../schemas/cee-v3.js';
import type { InternalDispatch } from '../../../../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { BRIEF } from './sealed-fixture.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
type Registration = { graph: GraphV3T; stated_dispositions: readonly StatedDisposition[] };
const fixtures = [1, 2, 3].map(draw => ({ draw, raw: JSON.parse(readFileSync(new URL(`./fixtures/s2-sealed-d${draw}.records.json`, import.meta.url), 'utf8')) as unknown }));
function readPath(value: unknown, path: readonly string[]): unknown {
  for (const key of path) value = (value as Record<string, unknown>)[key];
  return value;
}

describe('A16 banked sealed compile → registered → stored carriers (zero providers)', () => {
  for (const { draw, raw } of fixtures) it(`sealed draw ${draw}: every input index is resolved by identity`, async () => {
    const records = omitOptionalRecordNulls(raw) as DraftRecordSet;
    const replay = await replayRecordSet(records, { brief: BRIEF });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.detail);
    let registered: Registration | undefined;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) { registered = body as Registration; return { status: 200, json: { model_version: 1 } }; }
      if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [], edges: [] } } };
      throw new Error(`unexpected offline route ${path}`);
    };
    const result = await buildModelFromRecords(SCENARIO, BRIEF, dispatch, async () => ({ text: JSON.stringify(raw), status: 'completed' }));
    expect(result).toMatchObject({ ok: true, mutated: true });
    const rows = registered!.stated_dispositions;
    expect(rows.map(row => row.stated_index)).toEqual(records.stated_items.map((_, index) => index));
    expect(rows.map(row => row.stated_item)).toEqual(records.stated_items);
    const stored = assignEntityRefs(projectGraphForPersistence(registered!.graph), null).graph;
    // Read the actual persisted location, including edge endpoints (V3 has no edge id).
    for (const row of rows) {
      if (row.disposition !== 'carried') continue;
      const location = row.location;
      const carrier = location.kind === 'node' ? stored.nodes.find(n => n.id === location.node_id)
        : stored.edges.find(e => e.from === location.from && e.to === location.to);
      expect(carrier, `stated_items[${row.stated_index}]`).toBeDefined();
      expect(location.path.length === 0 ? { id: (carrier as { id: string }).id } : readPath(carrier, location.path)).toEqual(row.stored_value);
    }
    expect(reconcileStatedDispositions(rows, stored)).toEqual(rows);
    // The receipts ride the register SIDECAR, never the submitted graph; the register route is the one writer of
    // `graph.stated_dispositions` (DL ruling 5 Oct 2026). CEE GraphV3 now DECLARES the key, so every real receipt
    // from the sealed draws must survive a strict GraphV3 read verbatim — a stripped or rewritten row would be lost
    // on the first read after registration.
    expect(stored).not.toHaveProperty('stated_dispositions');
    // P1: the stored receipt is bound to the identity of the graph it was reconciled against.
    const bound = { reconciled_against: 'a'.repeat(64), rows };
    expect(GraphV3.parse({ ...stored, stated_dispositions: bound }).stated_dispositions).toEqual(bound);

    const row = (index: number) => rows[index];
    const goalId = draw === 3 ? '6144a59c' : '876e0d81';
    const targetIndex = draw === 1 ? 7 : 6;
    const horizonIndex = draw === 1 ? 6 : 7;
    expect(row(targetIndex)).toMatchObject({ stated_index: targetIndex, disposition: 'carried', location: { kind: 'node', node_id: goalId, path: ['goal_threshold_raw'] }, stored_value: 150000 });
    expect(row(horizonIndex)).toMatchObject({ stated_index: horizonIndex, disposition: 'carried', location: { kind: 'node', node_id: goalId, path: ['goal_horizon_months'] }, stored_value: 9 });
    expect(replay.projection.dropped.filter(drop => drop.node_id === goalId && drop.reason === 'stated_target_value_dropped')).toEqual([]);
    if (draw !== 3) {
      expect(row(0)).toMatchObject({ stated_index: 0, disposition: 'carried', location: { kind: 'node', node_id: goalId, path: ['observed_state', 'raw_value'] }, stored_value: 120000 });
      expect(row(1)).toMatchObject({ stated_index: 1, disposition: 'rejected', reason: 'unconnected_to_goal' });
      // B2 names the undeclared lever; B5 names draw 2's existing non-whole offset. Neither may earn a setting.
      expect(row(4)).toMatchObject({ stated_index: 4, disposition: 'rejected', reason: draw === 1 ? 'option_lever_undeclared' : 'literal_not_whole_amount' });
    }
    if (draw === 1) {
      expect(row(13)).toMatchObject({ stated_index: 13, disposition: 'carried', location: { kind: 'edge', from: '19b1afd6', to: '1d05778b' }, stored_value: { amount: 6, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'subscribers' } });
      // A2 preserves this measurement instead of merging it into stated_items[8].
      expect(replay.projection.graph.nodes.find(n => n.id === '56015172')).toMatchObject({ kind: 'factor', quantity_ref: 3, data: { unit: '%' } });
    } else if (draw === 2) {
      // B4 refuses both relationships targeting the ambiguous q0 claim carriers, never choosing an alias.
      for (const index of [10, 12]) {
        expect(row(index)).toMatchObject({ stated_index: index, disposition: 'rejected', reason: 'relationship_endpoint_ambiguous' });
        expect(stored.edges.filter(e=>e.provenance?.source_quote===records.stated_items[index]!.source_quote && e.provenance?.natural_effect)).toHaveLength(0);
      }
      expect(replay.projection.graph.nodes.find(n => n.id === goalId)?.quantity_ref).toBe(0);
    } else {
      expect(row(0)).toMatchObject({ stated_index: 0, disposition: 'rejected', reason: 'unconnected_to_goal' });
      expect(row(13)).toMatchObject({ stated_index: 13, disposition: 'carried', location: { kind: 'node', node_id: '22ae8802', path: ['interventions', '19b1afd6', 'raw_value'] }, stored_value: 150 });
      // B4 refuses the two q0 claim carriers instead of choosing the old endpoint by emission order.
      expect(row(15)).toMatchObject({ stated_index: 15, disposition: 'rejected', reason: 'relationship_endpoint_ambiguous' });
      expect(stored.edges.filter(e=>e.provenance?.source_quote===records.stated_items[15]!.source_quote && e.provenance?.natural_effect)).toHaveLength(0);
    }
  });
});
