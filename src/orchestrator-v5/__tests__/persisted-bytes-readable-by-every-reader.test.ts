/**
 * The persisted form is readable by every strict reader (served defect, CEE
 * `319dde1`, Canvas witness 5842091415).
 *
 * The UI's `/graph/register` sent `extractionType: null` on a user-set factor.
 * Stored verbatim, those bytes failed `GraphV3` — and every system-event adapter
 * fails CLOSED on that parse, so each later canvas edit returned 500. The
 * fixture is the SERVED persisted graph, read back from staging, not authored.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { GraphV3 } from '../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { dropNullOptionalGraphFields } from '../drop-null-optional-fields.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { computeGraphIdentityHash } from '../context/graph-identity.js';
import { applyEdgeStrengthEdit } from '../system-events/edge-strength-edit.js';

type Rec = Record<string, unknown>;
const SERVED = (
  JSON.parse(
    readFileSync(new URL('./fixtures/register-ui-null-stamp.served-319dde1.json', import.meta.url), 'utf8'),
  ) as { graph: Rec }
).graph;
const nodes = (g: Rec) => g.nodes as Rec[];
const node = (g: Rec, id: string) => nodes(g).find((n) => n.id === id)!;

describe('the persisted form is readable by every strict reader', () => {
  it('PRECONDITION: the served bytes fail GraphV3 exactly at the null stamp (the 500 cause)', () => {
    const parsed = GraphV3.safeParse(SERVED);
    expect(parsed.success).toBe(false);
    const paths = parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
    const idx = nodes(SERVED).findIndex((n) => n.id === 'fac_adoption_friction');
    expect(paths.sort()).toEqual([`nodes.${idx}.extractionType`, `nodes.${idx}.observed_state.extractionType`].sort());
  });

  it('⭐ the projected served bytes parse as GraphV3 — the null stamp is gone, every value kept', () => {
    const projected = projectGraphForPersistence(SERVED) as Rec;
    expect(GraphV3.safeParse(projected).success).toBe(true);
    const after = node(projected, 'fac_adoption_friction');
    expect('extractionType' in after).toBe(false);
    expect('extractionType' in (after.observed_state as Rec)).toBe(false);
    expect((after.observed_state as Rec).value).toBe(0.65);
    expect((after.observed_state as Rec).source).toBe('user_override');
    // Nothing else moved: only the two null keys differ.
    const strip = (g: Rec) => JSON.parse(JSON.stringify(g, (k, v) => (k === 'extractionType' && v === null ? undefined : v)));
    expect(projected).toEqual(projectGraphForPersistence(strip(SERVED)));
  });

  it('dropping the stamp moves NO analysis hash — every CAS base and run pin the UI holds stays valid', () => {
    // The identity hash DOES move (identity reads the stamp), and correctly so:
    // the register's ack identity is computed on the projected bytes it stores
    // (`graphForStore`), so the ack and the next read still agree CEE-to-CEE.
    expect(computeAnalysisAffectingGraphHash(dropNullOptionalGraphFields(SERVED) as never)).toBe(
      computeAnalysisAffectingGraphHash(SERVED as never),
    );
    const projected = projectGraphForPersistence(SERVED);
    expect(computeGraphIdentityHash(projectGraphForPersistence(projected) as never)?.value).toBe(
      computeGraphIdentityHash(projected as never)?.value,
    );
  });

  it('⭐ JOURNEY: the edge-strength edit Canvas sent (served body) commits on the projected bytes; on the served bytes it failed closed', async () => {
    // Verbatim from Canvas's served request (seq 5, request_id 46fd0cff…), which returned 500.
    const event = {
      kind: 'edge_strength_edit', from: 'fac_adoption_friction', to: 'out_bottom_up_growth', magnitude: 0.55,
      direction_intent: 'preserve', expected: { mean: -0.35040983606557374, effect_direction: 'negative' }, intent: 'set',
    };
    const payload = { kind: 'system_event', turn_id: 'turn-edge', scenario_id: '91aad963-3363-4f56-9438-f52d0747ddb8', stage: 'analyse', event };
    const run = (persistedGraph: unknown) =>
      applyEdgeStrengthEdit({ payload, event, requestId: 'req-edge', persistedGraph } as never);
    await expect(run(SERVED)).rejects.toThrow(/GraphV3/);
    const ok = await run(projectGraphForPersistence(SERVED));
    expect(ok.kind).toBe('mutated');
  });

  it('the WHOLE class: any schema-optional null is dropped, at graph, node, observed_state, edge and option level', () => {
    const g = projectGraphForPersistence({
      goal_node_id: 'g',
      goal_constraints: null,
      nodes: [
        { id: 'g', kind: 'goal', label: 'Revenue', goal_threshold: null, display_value: null },
        { id: 'f', kind: 'factor', label: 'Price', observed_state: { value: 0.4, raw_value: null, unit: null } },
        { id: 'f2', kind: 'factor', label: 'Churn', observed_state: null },
        { id: 'd', kind: 'decision', label: 'Which price' },
        { id: 'o', kind: 'option', label: 'Raise', interventions: { f: 0.5 }, is_baseline: null },
      ],
      edges: [
        { from: 'd', to: 'o', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', edge_type: null },
        { from: 'o', to: 'f', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive', provenance: null },
        { from: 'f2', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
      ],
    }) as Rec;
    const parsed = GraphV3.safeParse(g);
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'))).toEqual([]);
    expect('goal_constraints' in g).toBe(false);
    expect('goal_threshold' in node(g, 'g')).toBe(false);
    expect(node(g, 'f').observed_state).toEqual({ value: 0.4 });
    expect('observed_state' in node(g, 'f2')).toBe(false);
    expect('is_baseline' in node(g, 'o')).toBe(false);
    expect((g.edges as Rec[]).some((e) => 'edge_type' in e || 'provenance' in e)).toBe(false);
  });

  it('a null another pass gives a MEANING keeps it: an option\'s interventions:null becomes {} (P0-A), never absent', () => {
    const g = projectGraphForPersistence({
      nodes: [
        { id: 'd', kind: 'decision', label: 'Which' },
        { id: 'o', kind: 'option', label: 'Raise', interventions: null },
      ],
      edges: [{ from: 'd', to: 'o', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' }],
    }) as Rec;
    expect(node(g, 'o').interventions).toEqual({});
  });

  it('never invents absence of a REQUIRED field: a null observed_state.value is left for the readers to refuse', () => {
    const g = projectGraphForPersistence({
      nodes: [{ id: 'f', kind: 'factor', label: 'Price', observed_state: { value: null } }],
      edges: [],
    }) as Rec;
    expect((node(g, 'f').observed_state as Rec).value).toBeNull();
  });

  it('CONTROL: a graph with nothing to drop is returned as the SAME reference (byte-identical writes)', () => {
    const clean = projectGraphForPersistence(SERVED);
    expect(projectGraphForPersistence(clean)).toBe(clean);
  });
});
