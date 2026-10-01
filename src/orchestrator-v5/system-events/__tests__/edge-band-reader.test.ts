/**
 * ⭐ THE BAND READER — the canvas band pill's `band` (schemas 0.60.0 `edge_strength_edit.band`) reaches CEE's band
 * path, so the user's spread is kept (#2115 vendored the field; Canonical's condition 5858386465: no client sends
 * `band` until CEE reads it).
 *
 * THE DEFECT. 0.60.0 lets the event SAY which band the user chose. CEE parsed the field and ignored it: a pill choice
 * of "Strong" landed as the exact figure 0.55, so the writer kept Olumi's relative spread and flagged it Olumi's
 * (`std_defaulted`, A6f) — the band the user stated, and the spread it states, were lost.
 *
 * THE RULE.
 *  - ONE word map, `StrengthBand` → `InfluenceBand` (`edgeBandFromStrengthBand`; `slight` → `weak`, the same range).
 *  - A band on the event goes down #2096's band path: std = the band's (hi − lo)/√12 (`edgeBandStd`), NO
 *    `std_defaulted` (the user chose the spread), and a magnitude outside the named band is REFUSED
 *    (PARAMETER_INVALID) with the stored graph untouched.
 *  - CONTRAST: an event without `band` keeps today's exact-figure path (A6f's relative spread + the flag).
 *  - A band on `confirm_current` keeps the mean and sets the std from the band, so the analysis hash MOVES
 *    (schemas 0.60.0 turn-payload.js, "A BAND CONFIRM IS NOT HASH-NEUTRAL", AIQ N2).
 *
 * FIXTURE. The target edge is Olumi's placeholder shape from Paul's staging capture `17d1cd3a` (the same edge
 * `edge-std-stays-olumis.test.ts` pins verbatim): mean 0.0075, std 0.00375, `defaulted`, `cee_hypothesis`.
 */
import { describe, expect, it } from 'vitest';

import { SCHEMA_PACKAGE_VERSION } from '@talchain/schemas';
import {
  OrchestratorTurnPayloadSchema,
  StrengthBand,
  SystemEventTurnPayloadSchema,
  type SystemEventTurnPayload,
} from '@talchain/schemas/boundary';

import { GraphV3 } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { edgeBandFromStrengthBand, edgeBandStd } from '../../format/edge-strength-bands.js';
import type { InfluenceBand } from '../../format/influence-bands.js';
import { applyEdgeStrengthEdit, isProvenanceOnlyEdgeConfirmation } from '../edge-strength-edit.js';

type EdgeStrengthEditEvent = Extract<SystemEventTurnPayload['event'], { kind: 'edge_strength_edit' }>;
type RawEdge = Record<string, unknown> & {
  from: string;
  to: string;
  strength: { mean: number; std: number };
};
type RawGraph = { nodes: Record<string, unknown>[]; edges: RawEdge[] };

const SCENARIO_ID = '79a01a17-95c5-42cb-bfd2-0771bc7c94b1';
const TURN_ID = '11111111-1111-4111-8111-1111111111c7';
const FROM = 'price_sensitivity';
const TO = 'monthly_churn';

const OLUMI_EDGE = {
  to: TO,
  from: FROM,
  strength: { std: 0.00375, mean: 0.0075 },
  defaulted: true,
  provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' },
  effect_direction: 'positive',
  exists_probability: 0.8,
} as const;
const NODES = [
  { id: TO, kind: 'factor', label: 'Monthly churn', category: 'observable', provenance: 'ai_inferred' },
  { id: FROM, kind: 'risk', label: 'Price sensitivity', provenance: 'ai_inferred' },
] as const;

/** The canvas "Strong" pill's midpoint (`EDGE_STRENGTH_MIDPOINTS.strong`). */
const STRONG_MIDPOINT = 0.55;
/** (0.7 − 0.4)/√12 — the "strong" band read as uniform. Written from the cut points, not from `edgeBandStd`. */
const STRONG_BAND_STD = (0.7 - 0.4) / Math.sqrt(12);

/** Olumi's edge with `edge` laid over it; an override of `undefined` removes the key. */
function graph(edge: Partial<RawEdge> = {}): RawGraph {
  const g = JSON.parse(JSON.stringify({ nodes: NODES, edges: [OLUMI_EDGE] })) as RawGraph;
  const target = g.edges[0]!;
  for (const [key, value] of Object.entries(edge)) {
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
  return g;
}

function eventFor(overrides: Partial<EdgeStrengthEditEvent> = {}): EdgeStrengthEditEvent {
  return {
    kind: 'edge_strength_edit',
    from: FROM,
    to: TO,
    magnitude: STRONG_MIDPOINT,
    direction_intent: 'preserve',
    expected: { mean: 0.0075, effect_direction: 'positive' },
    intent: 'set',
    ...overrides,
  };
}

/** Through the production root parser (B1), then the writer — the event the writer sees is the PARSED one. */
async function apply(persistedGraph: unknown, event: EdgeStrengthEditEvent) {
  const payload = OrchestratorTurnPayloadSchema.parse({
    kind: 'system_event', turn_id: TURN_ID, scenario_id: SCENARIO_ID, stage: 'frame', event,
  });
  if (payload.kind !== 'system_event' || payload.event.kind !== 'edge_strength_edit') {
    throw new Error('expected an edge_strength_edit system_event payload');
  }
  return await applyEdgeStrengthEdit({ payload, event: payload.event, requestId: 'req-band-reader', persistedGraph });
}

function persistedEdge(result: Awaited<ReturnType<typeof apply>>): RawEdge {
  if (result.kind !== 'mutated') throw new Error(`expected mutated, got ${result.kind}: ${result.reason}`);
  const edge = (result.mutatedGraph as RawGraph).edges.find((e) => e.from === FROM && e.to === TO);
  if (edge === undefined) throw new Error('target edge missing from the persisted graph');
  return edge;
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) The pill's band reaches the writer
// ─────────────────────────────────────────────────────────────────────────────
describe('(a) the UI event with band "strong" and magnitude 0.55', () => {
  it('⭐ RED: std is the band’s (0.7 − 0.4)/√12 ≈ 0.0866, mean 0.55, NO `std_defaulted`', async () => {
    const result = await apply(graph(), eventFor({ band: 'strong' }));
    const edge = persistedEdge(result);
    expect(edge.strength.mean).toBe(0.55);
    expect(edge.strength.std).toBe(STRONG_BAND_STD);
    expect(edge.strength.std).toBeCloseTo(0.0866, 4);
    expect(edge).not.toHaveProperty('std_defaulted');
    // The dispatcher's post-commit confirmation guard reads this same answer.
    if (result.kind === 'mutated') expect(result.statedBand).toBe('strong');
    // Existence is still Olumi's (A6e) — the band speaks only for the strength.
    expect(edge.exists_defaulted).toBe(true);
    expect(edge.exists_probability).toBe(0.8);
    expect(edge.provenance).toStrictEqual({ source: 'user_specified' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) The one mapping, one row per contract band
// ─────────────────────────────────────────────────────────────────────────────
const MAPPING_ROWS: ReadonlyArray<readonly [StrengthBand, InfluenceBand, number, number]> = [
  // [wire band, CEE band, the pill's midpoint, the band's own std from its cut points]
  ['very_strong', 'very strong', 0.85, (1 - 0.7) / Math.sqrt(12)],
  ['strong', 'strong', 0.55, (0.7 - 0.4) / Math.sqrt(12)],
  ['moderate', 'moderate', 0.3, (0.4 - 0.2) / Math.sqrt(12)],
  ['slight', 'weak', 0.1, (0.2 - 0) / Math.sqrt(12)],
];

describe('(b) StrengthBand → InfluenceBand: one row per contract band, through the writer', () => {
  it('the rows cover EXACTLY the contract’s StrengthBand literals', () => {
    expect(MAPPING_ROWS.map((r) => r[0]).sort()).toStrictEqual([...StrengthBand.options].sort());
  });

  it.each(MAPPING_ROWS)('⭐ %s → %s: a write at %s stores the band’s spread, unflagged', async (wire, cee, midpoint, bandStd) => {
    expect(edgeBandFromStrengthBand(wire)).toBe(cee);
    const result = await apply(graph(), eventFor({ band: wire, magnitude: midpoint }));
    const edge = persistedEdge(result);
    expect(edge.strength.mean).toBe(midpoint);
    expect(edge.strength.std).toBeCloseTo(bandStd, 12);
    expect(edge.strength.std).toBe(edgeBandStd(cee));
    expect(edge).not.toHaveProperty('std_defaulted');
    if (result.kind === 'mutated') expect(result.statedBand).toBe(cee);
  });

  it('`slight` names the weak RANGE: std (0.2 − 0)/√12 ≈ 0.0577', async () => {
    const edge = persistedEdge(await apply(graph(), eventFor({ band: 'slight', magnitude: 0.1 })));
    expect(edge.strength.std).toBeCloseTo(0.0577, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) A magnitude outside the named band is refused
// ─────────────────────────────────────────────────────────────────────────────
describe('(c) band "slight" with magnitude 0.55 (outside the band)', () => {
  it('⭐ RED: refused, PARAMETER_INVALID, and the stored graph is byte-identical', async () => {
    const stored = graph();
    const bytesBefore = JSON.stringify(stored);
    const result = await apply(stored, eventFor({ band: 'slight' }));
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toBe('parameter_invalid_at_execute');
    expect(result).not.toHaveProperty('mutatedGraph');
    expect(JSON.stringify(stored)).toBe(bytesBefore);
  });

  it('a band CONFIRM of a link outside that band is refused too (0.55 confirmed as "slight")', async () => {
    const stored = graph({ strength: { mean: 0.55, std: 0.2 } });
    const bytesBefore = JSON.stringify(stored);
    const result = await apply(
      stored,
      eventFor({ intent: 'confirm_current', band: 'slight', expected: { mean: 0.55, effect_direction: 'positive' } }),
    );
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('parameter_invalid_at_execute');
    expect(JSON.stringify(stored)).toBe(bytesBefore);
  });

  it('CONTRAST: the same 0.55 under the band that contains it ("strong") lands', async () => {
    expect((await apply(graph(), eventFor({ band: 'strong' }))).kind).toBe('mutated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) CONTRAST — no band: today's exact-figure path
// ─────────────────────────────────────────────────────────────────────────────
describe('(d) CONTRAST: the same event WITHOUT `band` is an exact figure (A6f)', () => {
  it('⭐ Olumi’s relative spread (0.00375 / 0.0075 × 0.55 = 0.275) and `std_defaulted: true`', async () => {
    const result = await apply(graph(), eventFor());
    const edge = persistedEdge(result);
    expect(edge.strength.mean).toBe(0.55);
    expect(edge.strength.std).toBeCloseTo(0.275, 15);
    expect(edge.strength.std).not.toBe(STRONG_BAND_STD);
    expect(edge.std_defaulted).toBe(true);
    if (result.kind === 'mutated') expect(result).not.toHaveProperty('statedBand');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) confirm_current + band
// ─────────────────────────────────────────────────────────────────────────────
describe('(e) confirm_current with a band: the mean stays, the std becomes the band’s, the hash moves', () => {
  /** A link the user earlier set to 0.55 by figure: Olumi's relative spread, flagged. */
  const figureSet = () =>
    graph({
      strength: { mean: 0.55, std: 0.275 },
      std_defaulted: true,
      defaulted: undefined,
      exists_defaulted: true,
      provenance: { source: 'user_specified' },
      provenance_display: 'user_set',
    });
  const confirm = (band?: StrengthBand) =>
    eventFor({
      intent: 'confirm_current',
      expected: { mean: 0.55, effect_direction: 'positive' },
      ...(band !== undefined ? { band } : {}),
    });

  // R11 (AIQ #72 5872082179): a confirm is review, so the flag is KEPT and the band recorded in `reviewed_by_user`
  // (before R11 this row pinned the flag CLEARED on a band confirm).
  it('⭐ RED: mean unchanged, std = the band std, flag KEPT (R11), band recorded, analysis hash MOVES', async () => {
    const base = figureSet();
    const result = await apply(base, confirm('strong'));
    const edge = persistedEdge(result);
    expect(edge.strength).toStrictEqual({ mean: 0.55, std: STRONG_BAND_STD });
    expect(edge.std_defaulted).toBe(true);
    expect((edge.provenance as Record<string, unknown>).reviewed_by_user).toMatchObject({ intent: 'confirm', band: 'strong' });
    if (result.kind !== 'mutated') return;
    expect(result.statedBand).toBe('strong');
    expect(computeAnalysisAffectingGraphHash(result.graph)).not.toBe(
      computeAnalysisAffectingGraphHash(GraphV3.parse(base)),
    );
  });

  it('CONTRAST: the same confirm without `band` keeps the std exactly and the hash does not move', async () => {
    const base = figureSet();
    const result = await apply(base, confirm());
    const edge = persistedEdge(result);
    expect(edge.strength).toStrictEqual({ mean: 0.55, std: 0.275 });
    expect(edge.std_defaulted).toBe(true);
    if (result.kind !== 'mutated') return;
    expect(computeAnalysisAffectingGraphHash(result.graph)).toBe(computeAnalysisAffectingGraphHash(GraphV3.parse(base)));
  });

  it('⭐ the confirm guard admits the band std ONLY with the band the event carried', async () => {
    const base = figureSet();
    const result = await apply(base, confirm('strong'));
    if (result.kind !== 'mutated') throw new Error(result.reason);
    const judge = (statedBand?: InfluenceBand) =>
      isProvenanceOnlyEdgeConfirmation({
        before: base, after: result.mutatedGraph, from: FROM, to: TO, ...(statedBand ? { statedBand } : {}),
      });
    expect(judge('strong')).toBe(true);
    expect(judge()).toBe(false); // no band → a figure confirm may not move the std
    expect(judge('very strong')).toBe(false); // another band's spread is not this write's
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) The real 0.60.0 schema carries `band` to the writer
// ─────────────────────────────────────────────────────────────────────────────
describe('(f) the event is parsed by the real 0.60.0 schema and `band` survives to the writer', () => {
  const WIRE = JSON.stringify({
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    event: {
      kind: 'edge_strength_edit', from: FROM, to: TO, magnitude: 0.55, direction_intent: 'preserve',
      expected: { mean: 0.0075, effect_direction: 'positive' }, intent: 'set', band: 'strong',
    },
  });

  it('the vendored contract is 0.70.0 (band unchanged since 0.60.0; re-derived in schemas-0.42-edge-strength-edit-reader)', () => {
    expect(SCHEMA_PACKAGE_VERSION).toBe('0.70.0');
  });

  it('⭐ SystemEventTurnPayloadSchema keeps `band`, and the writer stores that band’s spread', async () => {
    const payload = SystemEventTurnPayloadSchema.parse(JSON.parse(WIRE));
    if (payload.event.kind !== 'edge_strength_edit') throw new Error('expected edge_strength_edit');
    expect(payload.event.band).toBe('strong');
    const result = await applyEdgeStrengthEdit({
      payload, event: payload.event, requestId: 'req-band-reader-wire', persistedGraph: graph(),
    });
    const edge = persistedEdge(result);
    expect(edge.strength).toStrictEqual({ mean: 0.55, std: STRONG_BAND_STD });
    expect(edge).not.toHaveProperty('std_defaulted');
  });

  it('the production root (B1) parser keeps `band` byte-for-byte', () => {
    const parsed = OrchestratorTurnPayloadSchema.parse(JSON.parse(WIRE));
    expect(parsed).toStrictEqual(JSON.parse(WIRE));
  });

  it('CONTRAST: the wire speaks the contract’s words — CEE’s own `weak` / `very strong` are rejected', () => {
    for (const band of ['weak', 'very strong']) {
      const raw = JSON.parse(WIRE) as { event: Record<string, unknown> };
      raw.event.band = band;
      expect(SystemEventTurnPayloadSchema.safeParse(raw).success, band).toBe(false);
    }
  });
});
