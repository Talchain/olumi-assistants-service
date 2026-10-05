/**
 * DL WIRING PORTS 2+3, port 3 part (2): `schema-v3.ts` keeps a user-stated sizing bundle ONLY when it carries a
 * CONSISTENT clamp-at-persist marker (`clampForPersist`): |mean| exactly 1, the sign of its natural β, `clamped_from`
 * equal to that β, |β| > 1. A STRICT NARROWING: every other user-stated bundle whose natural β is not the stored mean is
 * withdrawn exactly as before. Rows call `projectGraphAndOptionsToV3`, the shared transform, directly.
 *
 * BYTE IDENTITY (DL condition (b)): the frozen Anthropic natural-effects fixture (records-v25, staging 890923c9), compiled
 * by the Anthropic route's own records-v25 seam, through every non-records caller entry point of the transform, hashes
 * exactly as at base 2bc3e53a61090ea889c6e47c71eb5c402c3f5a8d. The fixture is read from the FROZEN test file's own bytes
 * (pinned by records-v25-freeze), never copied.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectGraphAndOptionsToV3, transformResponseToV3 } from '../schema-v3.js';
import { projectGraphForStagedFrame } from '../../unified-pipeline/staged-graph-projection.js';
import { projectDraftRecords as projectFrozenRecords } from '../../draft/records-v25/seam.js';
import { normaliseDraftResponse } from '../../../adapters/llm/normalisation.js';

type Rec = Record<string, any>;
const FULL = 3;

/** A minimal V1 graph: one user-stated link with its natural size, at the stored mean and std given. */
function v1(mean: number, provenance: Rec, std = 0.25): Rec {
  return {
    version: '1', default_seed: 17,
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Revenue goal' },
      { id: 'fac_1', kind: 'factor', label: 'Price', data: { value: 0.5 } },
      { id: 'out_1', kind: 'outcome', label: 'Revenue' },
    ],
    edges: [
      { id: 'e1', from: 'fac_1', to: 'out_1', strength_mean: mean, strength_std: std, belief_exists: 0.9, effect_direction: mean < 0 ? 'negative' : 'positive',
        provenance: { source: 'brief_extraction', magnitude: 'user_stated', source_quote: 'Each £1 adds £3.', quote: 'Each £1 adds £3.', ...provenance } },
      { id: 'e2', from: 'out_1', to: 'goal_1', strength_mean: 0.5, strength_std: 0.15, belief_exists: 0.9, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } },
    ],
  };
}
const natural = (strength_mean: number): Rec => ({ natural_effect: { amount: 3, amount_unit: '£', per_source_change: 1, per_source_change_unit: '£', strength_mean, strength_mean_frame: 'edge_strength' } });
const stated = (graph: Rec): Rec => (projectGraphAndOptionsToV3(graph as never, { brief: '' }).graph.edges as Rec[]).find((e) => e.from === 'fac_1' && e.to === 'out_1')!;

describe('schema-v3: a CONSISTENT clamp marker keeps the user\'s sizing bundle', () => {
  it.each([1, -1])('kept (mean %s): magnitude user_stated, natural_effect and clamped_from through V3', (sign) => {
    const edge = stated(v1(sign, { ...natural(sign * FULL), clamped_from: sign * FULL }));
    expect(edge.strength.mean).toBe(sign);
    expect(edge.provenance).toMatchObject({ magnitude: 'user_stated', source: 'brief_extraction', clamped_from: sign * FULL });
    expect(edge.provenance.natural_effect.strength_mean).toBe(sign * FULL);
  });
});

describe('schema-v3 NEGATIVE rows: every inconsistent marker is STILL withdrawn (unchanged)', () => {
  const withdrawn = (edge: Rec): void => {
    expect(edge.provenance.magnitude).toBe('olumi_placeholder');
    expect(edge.provenance.source).toBe('cee_hypothesis');
    expect(edge.provenance.natural_effect).toBeUndefined();
  };
  it('wrong sign: mean 1, natural β -3, clamped_from -3', () => withdrawn(stated(v1(1, { ...natural(-FULL), clamped_from: -FULL }))));
  it('|mean| != 1: mean 0.9, natural β 3, clamped_from 3', () => withdrawn(stated(v1(0.9, { ...natural(FULL), clamped_from: FULL }))));
  it('clamped_from != natural β: mean 1, natural β 3, clamped_from 4', () => withdrawn(stated(v1(1, { ...natural(FULL), clamped_from: 4 }))));
  it('a marker on a β that needed no clamp: mean 1, natural β 0.8, clamped_from 0.8', () => withdrawn(stated(v1(1, { ...natural(0.8), clamped_from: 0.8 }))));
  it('no marker at all (today\'s case): mean 1, natural β 3', () => withdrawn(stated(v1(1, natural(FULL)))));
  it('a marker the boundary itself had to clamp: mean 3 (wasClamped), natural β 3, clamped_from 3', () => withdrawn(stated(v1(FULL, { ...natural(FULL), clamped_from: FULL }))));
  it('a consistent marker whose std the boundary moved is withdrawn as before (std 0 -> floor)', () => withdrawn(stated(v1(1, { ...natural(FULL), clamped_from: FULL }, 0))));
  it('control: a fitted bundle (natural β equals the mean, no marker) is kept, as before', () => {
    expect(stated(v1(0.6, natural(0.6))).provenance).toMatchObject({ magnitude: 'user_stated' });
  });
});

/** The frozen fixture's own literals, evaluated from the frozen file's bytes (records-v25-freeze pins them). */
function frozenFixture(): { brief: string; records: Rec } {
  const src = readFileSync(new URL('../../draft/records-v25/__tests__/stated-natural-effects.served.test.ts', import.meta.url), 'utf8');
  const b0 = src.indexOf('const BRIEF =');
  const b1 = src.indexOf(';', b0);
  const r0 = src.indexOf('const records = ');
  const r1 = src.indexOf('} satisfies DraftRecordSet;', r0);
  expect([b0, b1, r0, r1].every((i) => i > 0)).toBe(true);
  const brief = new Function(`return (${src.slice(b0 + 'const BRIEF ='.length, b1)});`)() as string;
  const records = new Function(`return (${src.slice(r0 + 'const records = '.length, r1 + 1)});`)() as Rec;
  return { brief, records };
}
const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/**
 * Hashes recorded by running THIS row at base 2bc3e53a61090ea889c6e47c71eb5c402c3f5a8d (PRINT_BASE_HASHES=1), before the
 * narrowing. Callers (production, non-records): unified-pipeline/stages/boundary.ts:64 (`transformResponseToV3`, also
 * every tools/ and scripts/ caller) and unified-pipeline/staged-graph-projection.ts:142 (`projectGraphForStagedFrame`).
 */
const BASE = {
  boundary_raw: '29832a3bc6c5fab391573d31bbb96d7134d27e2575cee492deacac94907742f1',
  boundary_normalised: '29832a3bc6c5fab391573d31bbb96d7134d27e2575cee492deacac94907742f1',
  staged_raw: '310d2dd6a4e97ba76fefafe63432a1ce9f2426b8e514bb953783e95de8fd7663',
  staged_normalised: '310d2dd6a4e97ba76fefafe63432a1ce9f2426b8e514bb953783e95de8fd7663',
};

describe('BYTE IDENTITY: the frozen Anthropic natural-effects fixture, every non-records caller, head == base', () => {
  it('six sized effects, £120,000, 80-250: identical V3 output through boundary.ts:64 and staged-graph-projection.ts:142', () => {
    const { brief, records } = frozenFixture();
    expect(brief).toContain('£120,000');
    expect(brief).toContain('between 80 and 250');
    const compiled = projectFrozenRecords(structuredClone(records) as never, brief);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.detail);
    const raw = compiled.projection.graph as Rec;
    // Positive control: the class the narrowing touches is present (user-stated natural sizes).
    expect(raw.edges.filter((e: Rec) => e.provenance?.natural_effect !== undefined).length).toBeGreaterThanOrEqual(6);
    const normalised = normaliseDraftResponse(structuredClone(raw) as never) as Rec;
    const out = {
      boundary_raw: sha(transformResponseToV3({ graph: structuredClone(raw) } as never, { brief, requestId: 'byte-identity', strictMode: false, includeDebug: false })),
      boundary_normalised: sha(transformResponseToV3({ graph: structuredClone(normalised) } as never, { brief, requestId: 'byte-identity', strictMode: false, includeDebug: false })),
      staged_raw: sha(projectGraphForStagedFrame(structuredClone(raw) as never, 'v3', 'byte-identity', brief)),
      staged_normalised: sha(projectGraphForStagedFrame(structuredClone(normalised) as never, 'v3', 'byte-identity', brief)),
    };
    if (process.env.PRINT_BASE_HASHES === '1') console.log(`BASE_HASHES ${JSON.stringify(out)}`);
    expect(out).toEqual(BASE);
  });
});
