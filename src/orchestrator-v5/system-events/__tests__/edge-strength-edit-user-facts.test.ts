/**
 * ⭐ A6c + A6e — A USER'S STRENGTH EDIT WRITES THE USER'S FACTS
 * (DL #70 5855068711 / 5855338670; AIQ 5855345225, 5855430153; Canonical 5855416983).
 *
 * The writer stamps a user write `source: 'user_specified'` and used to keep everything else Olumi had said about
 * the link, so the stamp claimed facts the user never stated:
 *
 *  · A6c — `provenance.reasoning` (the MODEL's why) stayed under the user's stamp, and decision review reads it as
 *    "the producer's stated reason" (`decision-review-graph-projection.ts` `readEdgeReasoning`).
 *  · A6e — a named band kept Olumi's `strength.std`. Served `08bf9a1f` (Paul, 27 Sep): the user's "very strong"
 *    price_sensitivity → monthly_churn was stored `{ mean: 0.85, std: 0.00375 }` — CV 0.4%, a precision the user
 *    never claimed. And deleting the whole-edge `defaulted` lost that the link's EXISTENCE (0.8) is still Olumi's.
 *
 * The fixture edge is the served one. Pre-write shape: `price_sensitivity → monthly_churn` as Olumi drafted it on
 * the same brief (captures `17d1cd3a` / `90b8f080`: mean 0.0075, std 0.00375, `defaulted: true`, provenance
 * `{ cee_hypothesis, olumi_placeholder }`, exists 0.8); post-write shape: `08bf9a1f` (mean 0.85, std 0.00375,
 * user_specified). ⚠ No captured copy of THIS edge carries `provenance.reasoning`; the reasoning below is the served
 * producer string from the repair edges of the same `08bf9a1f` graph, grafted onto it so A6c has a real sentence
 * to misattribute.
 *
 * WHICH WRITES ARE A BAND. Only the Agent's `propose_link_strength` is band-origin on the wire CEE can see: the
 * user NAMED the band, and the approval carries it in-process (`stated-link-band-context.ts`). The UI sends the
 * same `edge_strength_edit` from a band pill, a 0.01-step slider, a β number field and "Confirm this estimate"
 * (DecisionGuideAI staging `507d8ef8`), and the event has no field saying which — so a write with no stated band
 * is an exact FIGURE, whose std stays Olumi's — rescaled to the new mean and flagged `std_defaulted` (A6f, AIQ N1;
 * `edge-std-stays-olumis.test.ts`). Both halves are pinned below.
 */
import { describe, expect, it } from 'vitest';

import {
  OrchestratorTurnPayloadSchema,
  type SystemEventTurnPayload,
} from '@talchain/schemas/boundary';

import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { runWithStatedLinkBand } from '../../agent-lane/stated-link-band-context.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { edgeBandStd } from '../../format/edge-strength-bands.js';
import type { InfluenceBand } from '../../format/influence-bands.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { ProposalAction } from '../../routing/types.js';
import { buildD1Fixture, buildHandlerInvocation } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { createAdjustEdgeStrengthHandler } from '../../tools/handlers/adjust-edge-strength.js';
import { createSetFactorValueHandler } from '../../tools/handlers/set-factor-value.js';
import { applyEdgeStrengthEdit, isProvenanceOnlyEdgeConfirmation } from '../edge-strength-edit.js';

type EdgeStrengthEditEvent = Extract<SystemEventTurnPayload['event'], { kind: 'edge_strength_edit' }>;
type RawEdge = Record<string, unknown> & { strength: { mean: number; std: number }; provenance?: Record<string, unknown> };
type RawGraph = { nodes: Record<string, unknown>[]; edges: RawEdge[] };

const SCENARIO_ID = '79a01a17-95c5-42cb-bfd2-0771bc7c94b1'; // Paul's 08bf9a1f scenario
const TURN_ID = '11111111-1111-4111-8111-1111111111a6';
const FROM = 'price_sensitivity';
const TO = 'monthly_churn';
/** Served producer reasoning (08bf9a1f repair edges), grafted — see the header. */
const SERVED_REASONING = 'Connectivity repair wired this option to a factor another option targets; no effect value is implied';
/** Olumi's std on the served edge, before AND after the user's "very strong" (08bf9a1f). */
const OLUMI_STD = 0.00375;

/** Paul's graph around the edge — nodes verbatim from 08bf9a1f. */
function paulGraph(edge: Partial<RawEdge> = {}): RawGraph {
  return {
    nodes: [
      { id: 'price_sensitivity', kind: 'risk', label: 'Price sensitivity', provenance: 'ai_inferred' },
      {
        id: 'monthly_churn', kind: 'factor', label: 'Monthly churn', category: 'observable', provenance: 'user_set',
        scale_frame: 100, display_value: '3 % per month',
        observed_state: { unit: '% per month', value: 0.03, source: 'user_assumption', raw_value: 3 },
      },
    ],
    edges: [
      {
        from: FROM,
        to: TO,
        strength: { mean: 0.0075, std: OLUMI_STD },
        defaulted: true,
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', reasoning: SERVED_REASONING },
        effect_direction: 'positive',
        exists_probability: 0.8,
        ...edge,
      },
    ],
  };
}

function eventFor(overrides: Partial<EdgeStrengthEditEvent> = {}): EdgeStrengthEditEvent {
  return {
    kind: 'edge_strength_edit',
    from: FROM,
    to: TO,
    magnitude: 0.85,
    direction_intent: 'preserve',
    expected: { mean: 0.0075, effect_direction: 'positive' },
    intent: 'set',
    ...overrides,
  };
}

async function apply(graph: unknown, event: EdgeStrengthEditEvent) {
  const payload = OrchestratorTurnPayloadSchema.parse({
    kind: 'system_event', turn_id: TURN_ID, scenario_id: SCENARIO_ID, stage: 'frame', event,
  }) as SystemEventTurnPayload;
  return await applyEdgeStrengthEdit({ payload, event, requestId: 'req-a6ce', persistedGraph: graph });
}

/** The Agent's approval path: the user NAMED `band`, and the approval carries it in-process to the writer. */
async function applyStated(graph: unknown, event: EdgeStrengthEditEvent, band: InfluenceBand) {
  return await runWithStatedLinkBand(
    { scenarioId: SCENARIO_ID, proposalId: 'p-a6ce', from: FROM, to: TO, band },
    () => apply(graph, event),
  );
}

/** The target edge in the persisted BYTES the dispatcher writes (not only the parsed view). */
function persistedEdge(result: Awaited<ReturnType<typeof apply>>): RawEdge {
  if (result.kind !== 'mutated') throw new Error(`expected mutated, got ${result.kind}: ${result.reason}`);
  return (result.mutatedGraph as RawGraph).edges.find((e) => e.from === FROM && e.to === TO)!;
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) Paul's shape — a user "very strong", named to the Agent
// ─────────────────────────────────────────────────────────────────────────────
describe('(1) Paul’s served edge, recorded "very strong" by the user through the Agent', () => {
  const write = () => applyStated(paulGraph(), eventFor(), 'very strong');

  it('⭐ RED A6e: std is the very-strong band’s own spread (0.0866), not Olumi’s 0.00375', async () => {
    const edge = persistedEdge(await write());
    expect(edge.strength.mean).toBe(0.85);
    expect(edge.strength.std).toBe(edgeBandStd('very strong'));
    expect(edge.strength.std).toBeCloseTo(0.0866, 4);
    expect(edge.strength.std).not.toBe(OLUMI_STD);
  });

  it('⭐ RED A6e: existence stays Olumi’s — `exists_defaulted: true`, exists_probability 0.8 unchanged, whole-edge `defaulted` gone', async () => {
    const result = await write();
    const edge = persistedEdge(result);
    expect(edge.exists_defaulted).toBe(true);
    expect(edge.exists_probability).toBe(0.8);
    expect(edge).not.toHaveProperty('defaulted');
    // And the parsed view every reader gets keeps it (EdgeV3 declares it).
    if (result.kind !== 'mutated') return;
    const parsed = result.graph.edges.find((e) => e.from === FROM && e.to === TO)!;
    expect(parsed.exists_defaulted).toBe(true);
  });

  it('⭐ RED A6c: the model’s `provenance.reasoning` does not survive under the user’s stamp', async () => {
    const edge = persistedEdge(await write());
    expect(edge.provenance?.source).toBe('user_specified');
    expect(edge.provenance).not.toHaveProperty('reasoning');
    expect(edge.provenance).toStrictEqual({ source: 'user_specified' });
    expect(edge.provenance_display).toBe('user_set');
  });

  it('direction is unchanged', async () => {
    expect(persistedEdge(await write()).effect_direction).toBe('positive');
  });

  it('CONTRAST (exact FIGURE — the same event with no stated band, as the UI sends it): std stays OLUMI’S — its relative spread, flagged (A6f); reasoning and the existence flag still move', async () => {
    const edge = persistedEdge(await apply(paulGraph(), eventFor()));
    // A6f (AIQ N1): 0.00375 was sized for 0.0075; Olumi's CV 0.5 carried to 0.85, not the absolute std.
    expect(edge.strength).toStrictEqual({ mean: 0.85, std: 0.425 });
    expect(edge.std_defaulted).toBe(true);
    expect(edge.provenance).toStrictEqual({ source: 'user_specified' });
    expect(edge.exists_defaulted).toBe(true);
    expect(edge).not.toHaveProperty('defaulted');
  });

  it('CONTRAST: a stated band for ANOTHER link is not this write’s band — a figure: Olumi’s spread, flagged (A6f)', async () => {
    const result = await runWithStatedLinkBand(
      { scenarioId: SCENARIO_ID, proposalId: 'p-other', from: TO, to: FROM, band: 'very strong' },
      () => apply(paulGraph(), eventFor()),
    );
    expect(persistedEdge(result).strength.std).toBe(0.425);
    expect(persistedEdge(result).std_defaulted).toBe(true);
  });

  it('an edge that was never defaulted gets no existence flag', async () => {
    const graph = paulGraph();
    delete (graph.edges[0] as Record<string, unknown>).defaulted;
    const edge = persistedEdge(await applyStated(graph, eventFor(), 'very strong'));
    expect(edge).not.toHaveProperty('exists_defaulted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) confirm_current from a band — keep the figure, record it as theirs
// ─────────────────────────────────────────────────────────────────────────────
// R11 (AIQ #72 5872082179, adopted by the DL): a confirm is REVIEW, not authorship. The mean is kept, a named band still
// stores its spread (A6e), and every authorship byte — source, magnitude, reasoning, `defaulted`, the per-field flags —
// is KEPT, with the review recorded in `provenance.reviewed_by_user`. Before R11 these rows pinned the `user_specified`
// stamp, `defaulted` → `exists_defaulted`, and (figure) `std_defaulted: true`.
describe('(2) confirm_current from a band: the whole strength is kept (#2473 CR), the band recorded', () => {
  /** The link already sits in the band the user named (0.85 is very strong), still Olumi's. */
  const inBand = () => paulGraph({ strength: { mean: 0.85, std: OLUMI_STD } });
  const confirm = () => eventFor({ intent: 'confirm_current', magnitude: 0.85, expected: { mean: 0.85, effect_direction: 'positive' } });

  // ⛔ #2473 CR (CODEX_CLI_OVERFLOW 5937437431, DL concur): this row used to pin std → the very-strong band's spread on
  // a confirm that keeps 0.85 — a no-change approval that moved σ and staled the Run. Every confirm is byte-equal.
  it('⭐ RED (#2473): the Agent’s confirm keeps 0.85 AND Olumi’s std, byte-equal; the band is recorded in the review', async () => {
    const result = await applyStated(inBand(), confirm(), 'very strong');
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    const edge = persistedEdge(result);
    expect(edge.strength).toStrictEqual({ mean: 0.85, std: OLUMI_STD });
    expect(edge.strength.std).not.toBe(edgeBandStd('very strong'));
    const { reviewed_by_user: review, ...kept } = edge.provenance!;
    // L4 (DL 5929790081): an approved placeholder is sized (`olumi_estimate`); source and reasoning stay Olumi's.
    expect(kept).toStrictEqual({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', reasoning: SERVED_REASONING });
    expect(review).toMatchObject({ intent: 'confirm', band: 'very strong' });
    expect(edge.defaulted).toBe(true);
    expect(edge).not.toHaveProperty('exists_defaulted');
    expect(edge.exists_probability).toBe(0.8);
    expect(edge.effect_direction).toBe('positive');
    expect(result.kind === 'mutated' && result.response.assistant_text).toContain('Confirmed the current strength');
  });

  it('#2473: the ONLY analysis input that moves is the placeholder’s sizing (L4) — never the std', async () => {
    const graph = inBand();
    const result = await applyStated(graph, confirm(), 'very strong');
    if (result.kind !== 'mutated') throw new Error(result.reason);
    const sized = structuredClone(graph) as GraphV3T;
    for (const e of sized.edges) if (e.from === FROM && e.to === TO) (e.provenance as Record<string, unknown>).magnitude = 'olumi_estimate';
    expect(computeAnalysisAffectingGraphHash(result.graph)).toBe(computeAnalysisAffectingGraphHash(sized));
  });

  it('CONTRAST (a confirm of the exact FIGURE — the UI’s "Confirm this estimate", no stated band): std untouched, still admitted', async () => {
    const graph = inBand();
    const result = await apply(graph, confirm());
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    const edge = persistedEdge(result);
    expect(edge.strength).toStrictEqual({ mean: 0.85, std: OLUMI_STD });
    // R11: flags kept exactly (the whole-edge `defaulted` still says the numbers are Olumi's).
    expect(edge).not.toHaveProperty('std_defaulted');
    expect(edge.defaulted).toBe(true);
    const { reviewed_by_user: review, ...kept } = edge.provenance!;
    // L4 (DL 5929790081): an approved placeholder is sized (`olumi_estimate`); source and reasoning stay Olumi's.
    expect(kept).toStrictEqual({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', reasoning: SERVED_REASONING });
    expect(review).toMatchObject({ intent: 'confirm' });
    expect(review).not.toHaveProperty('band');
    if (result.kind !== 'mutated') return;
    // L4: the ONLY analysis input that moves is the placeholder's sizing (`olumi_estimate`) — never the std.
    const sized = structuredClone(graph) as GraphV3T;
    for (const e of sized.edges) if (e.from === edge.from && e.to === edge.to) (e.provenance as Record<string, unknown>).magnitude = 'olumi_estimate';
    expect(computeAnalysisAffectingGraphHash(result.graph)).toBe(computeAnalysisAffectingGraphHash(sized));
  });

  it('CONTRAST: a stated band the link does NOT sit in is not a band for this write — std untouched', async () => {
    const result = await applyStated(inBand(), confirm(), 'strong');
    expect(persistedEdge(result).strength.std).toBe(OLUMI_STD);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (3) The confirmation guard — exactly the new removals/flags, nothing wider
// ─────────────────────────────────────────────────────────────────────────────
describe('(3) isProvenanceOnlyEdgeConfirmation admits the user-fact changes and nothing else', () => {
  const before = () => paulGraph({ strength: { mean: 0.85, std: OLUMI_STD } });

  /**
   * The writer's projection for a confirm of `before` — R11: everything kept, the review recorded (with the band the
   * `bandStd` belongs to, when the caller names one). Before R11 this modelled the #2096 stamp (`user_specified`,
   * `user_set`, reasoning/sizing dropped, `defaulted` → `exists_defaulted`, A6f flag).
   */
  function stamped(b: RawGraph, opts: { bandStd?: number; band?: InfluenceBand } = {}): RawGraph {
    const after = structuredClone(b);
    const e = after.edges[0]!;
    e.provenance = {
      ...e.provenance!,
      reviewed_by_user: { intent: 'confirm', at: '2026-09-28T15:00:00.000Z', ...(opts.band ? { band: opts.band } : {}) },
    };
    if (opts.bandStd !== undefined) e.strength = { ...e.strength, std: opts.bandStd };
    return after;
  }
  /** The pre-R11 adoption stamp, kept so the guard is shown to REFUSE it. */
  function adopted(b: RawGraph, opts: { bandStd?: number } = {}): RawGraph {
    const after = structuredClone(b);
    const e = after.edges[0]!;
    const { natural_effect: _n, magnitude: _m, reasoning: _r, ...rest } = e.provenance ?? {};
    e.provenance = { ...rest, source: 'user_specified' };
    e.provenance_display = 'user_set';
    if (e.defaulted === true) e.exists_defaulted = true;
    delete e.defaulted;
    if (opts.bandStd !== undefined) e.strength = { ...e.strength, std: opts.bandStd };
    if (opts.bandStd === undefined) e.std_defaulted = true;
    return after;
  }
  const guard = (b: RawGraph, a: RawGraph, statedBand?: InfluenceBand) =>
    isProvenanceOnlyEdgeConfirmation({ before: b, after: a, from: FROM, to: TO, ...(statedBand ? { statedBand } : {}) });

  // ⛔ #2473 CR: a band confirm keeps the std too (this row once admitted std → the stated band's spread).
  it('⭐ R11 + #2473: reasoning, sizing, `defaulted` AND std KEPT, band recorded: admitted; std → the band’s, or the old adoption stamp: refused', () => {
    const b = before();
    expect(guard(b, stamped(b, { band: 'very strong' }), 'very strong')).toBe(true);
    expect(guard(b, stamped(b, { bandStd: edgeBandStd('very strong'), band: 'very strong' }), 'very strong')).toBe(false);
    expect(guard(b, adopted(b, { bandStd: edgeBandStd('very strong') }), 'very strong')).toBe(false);
  });

  it('⭐ R11: a figure confirm (std kept, no stated band): everything kept, review recorded: admitted; the old adoption stamp: refused', () => {
    const b = before();
    expect(guard(b, stamped(b))).toBe(true);
    expect(guard(b, adopted(b))).toBe(false);
  });

  it('TAMPER: reasoning ADDED (absent before, present after) → refused', () => {
    const b = before();
    delete b.edges[0]!.provenance!.reasoning;
    const a = stamped(b);
    a.edges[0]!.provenance = { ...a.edges[0]!.provenance, reasoning: 'added by the write' };
    expect(guard(b, a)).toBe(false);
  });

  it('TAMPER: reasoning REWRITTEN (present before, different after) → refused', () => {
    const b = before();
    const a = stamped(b);
    a.edges[0]!.provenance = { ...a.edges[0]!.provenance, reasoning: 'rewritten' };
    expect(guard(b, a)).toBe(false);
  });

  it('TAMPER: a std that is NOT the stated band’s → refused', () => {
    const b = before();
    expect(guard(b, stamped(b, { bandStd: 0.05, band: 'very strong' }), 'very strong')).toBe(false);
    expect(guard(b, stamped(b, { bandStd: edgeBandStd('weak'), band: 'very strong' }), 'very strong')).toBe(false);
  });

  it('TAMPER: the band’s std with NO stated band → refused (a figure confirm keeps its std)', () => {
    const b = before();
    expect(guard(b, stamped(b, { bandStd: edgeBandStd('very strong') }))).toBe(false);
  });

  it('TAMPER: a stated band the link does not sit in → refused, even with that band’s std', () => {
    const b = before();
    expect(guard(b, stamped(b, { bandStd: edgeBandStd('strong'), band: 'strong' }), 'strong')).toBe(false);
  });

  it('TAMPER: the mean moves on a band confirm → refused', () => {
    const b = before();
    const a = stamped(b, { bandStd: edgeBandStd('very strong'), band: 'very strong' });
    a.edges[0]!.strength = { ...a.edges[0]!.strength, mean: 0.8500001 };
    expect(guard(b, a, 'very strong')).toBe(false);
  });

  // R11: a confirm keeps `defaulted` exactly — removed alone or with the per-field pair, it is refused.
  it('TAMPER (R11): `defaulted` removed, with or without `exists_defaulted` → refused', () => {
    const b = before();
    const a = stamped(b);
    delete a.edges[0]!.defaulted;
    expect(guard(b, a)).toBe(false);
    a.edges[0]!.exists_defaulted = true;
    expect(guard(b, a)).toBe(false);
  });

  it('TAMPER: `exists_defaulted: false` added → refused', () => {
    const b = before();
    const a = stamped(b);
    a.edges[0]!.exists_defaulted = false;
    expect(guard(b, a)).toBe(false);
  });

  it('TAMPER: `exists_defaulted` added to an edge that was never defaulted → refused', () => {
    const b = before();
    delete b.edges[0]!.defaulted;
    const a = stamped(b);
    a.edges[0]!.exists_defaulted = true;
    expect(guard(b, a)).toBe(false);
  });

  it('TAMPER: exists_probability changed → refused', () => {
    const b = before();
    const a = stamped(b, { bandStd: edgeBandStd('very strong'), band: 'very strong' });
    a.edges[0]!.exists_probability = 0.9;
    expect(guard(b, a, 'very strong')).toBe(false);
  });

  it('TAMPER: direction changed → refused', () => {
    const b = before();
    const a = stamped(b);
    a.edges[0]!.effect_direction = 'negative';
    expect(guard(b, a)).toBe(false);
  });

  it('TAMPER: any other change (a node label) → refused, band or not', () => {
    const b = before();
    const a = stamped(b, { bandStd: edgeBandStd('very strong'), band: 'very strong' });
    a.nodes[0]!.label = 'Price sensitivity (edited)';
    expect(guard(b, a, 'very strong')).toBe(false);
    const a2 = stamped(b);
    a2.nodes[0]!.label = 'Price sensitivity (edited)';
    expect(guard(b, a2)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (5) The per-field existence flag survives every reader and writer
// ─────────────────────────────────────────────────────────────────────────────
describe('(5) `exists_defaulted` is a declared EdgeV3 member: it survives re-parse, persistence and later writes', () => {
  const flagged = () => paulGraph({
    strength: { mean: 0.85, std: OLUMI_STD },
    provenance: { source: 'user_specified' },
    provenance_display: 'user_set',
    defaulted: undefined,
    exists_defaulted: true,
  });
  const clean = (g: RawGraph): RawGraph => JSON.parse(JSON.stringify(g)) as RawGraph;

  it('⭐ RED: a GraphV3 (D1) re-parse keeps it', () => {
    const parsed = GraphV3.parse(clean(flagged()));
    expect(parsed.edges[0]!.exists_defaulted).toBe(true);
  });

  it('CONTRAST: an undeclared edge key is still stripped by the same parse', () => {
    const g = clean(flagged());
    (g.edges[0] as Record<string, unknown>).display_note = 'not declared';
    const parsed = GraphV3.parse(g);
    expect(parsed.edges[0]).not.toHaveProperty('display_note');
    expect(parsed.edges[0]!.exists_defaulted).toBe(true);
  });

  it('a malformed value is dropped, never a reason to refuse a stored graph', () => {
    const g = clean(flagged());
    (g.edges[0] as Record<string, unknown>).exists_defaulted = 'yes';
    const parsed = GraphV3.safeParse(g);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.edges[0]!.exists_defaulted).toBeUndefined();
  });

  it('it is OUT of the analysis-affecting hash (a flag, not an input); CONTRAST: std is in it', () => {
    const g = clean(flagged());
    const without = clean(g);
    delete (without.edges[0] as Record<string, unknown>).exists_defaulted;
    // Parsed through GraphV3, which KEEPS the declared flag — so the hashed input really carries it.
    expect(GraphV3.parse(g).edges[0]!.exists_defaulted).toBe(true);
    expect(computeAnalysisAffectingGraphHash(GraphV3.parse(g))).toBe(computeAnalysisAffectingGraphHash(GraphV3.parse(without)));
    const otherStd = clean(g);
    otherStd.edges[0]!.strength.std = 0.05;
    expect(computeAnalysisAffectingGraphHash(GraphV3.parse(otherStd))).not.toBe(computeAnalysisAffectingGraphHash(GraphV3.parse(g)));
  });

  it('the persisted form keeps it', () => {
    const projected = projectGraphForPersistence(clean(flagged()), { scenarioId: SCENARIO_ID });
    expect((projected.edges[0] as Record<string, unknown>).exists_defaulted).toBe(true);
  });

  it('a later LINK write on the flagged edge admits it and keeps it (set, then a figure confirm)', async () => {
    const set = await apply(clean(flagged()), eventFor({ magnitude: 0.55, expected: { mean: 0.85, effect_direction: 'positive' } }));
    expect(persistedEdge(set).exists_defaulted).toBe(true);
    expect(persistedEdge(set).strength.mean).toBe(0.55);
    const confirmed = await apply(clean(flagged()), eventFor({ intent: 'confirm_current', magnitude: 0.85, expected: { mean: 0.85, effect_direction: 'positive' } }));
    expect(confirmed.kind === 'refused' ? confirmed.reason : confirmed.kind).toBe('mutated');
    expect(persistedEdge(confirmed).exists_defaulted).toBe(true);
  });

  it('a VALUE write elsewhere in the graph keeps it on the edge', async () => {
    const graph: RawGraph = JSON.parse(JSON.stringify(buildD1Fixture()));
    (graph.edges[0] as Record<string, unknown>).exists_defaulted = true;
    const proposal: ProposalAction = {
      handler_id: 'set_factor_value',
      entity: { id: 'f-churn', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [{ name: 'value', value: { value: 5, unit: '%', cap: 100 }, operator: 'set', source: 'user_explicit' }],
      cited_context_fields: [],
    };
    const outcome = await createSetFactorValueHandler()(buildHandlerInvocation({ proposal, graph }));
    const mutated = outcome.mutated_graph as RawGraph;
    expect(mutated.nodes.find((n) => n.id === 'f-churn')).toMatchObject({ observed_state: { value: 0.05 } });
    expect((mutated.edges[0] as Record<string, unknown>).exists_defaulted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The canonical handler itself — the band is a trusted side band, never a parameter
// ─────────────────────────────────────────────────────────────────────────────
describe('adjust_edge_strength: the stated band is honoured only when it contains the result', () => {
  const proposalFor = (strength: number): ProposalAction => ({
    handler_id: 'adjust_edge_strength',
    entity: { id: `${FROM}\u2192${TO}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'strength', value: strength, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: ['graph.edges'],
  });
  const run = (strength: number, band?: InfluenceBand) =>
    createAdjustEdgeStrengthHandler()({
      ...buildHandlerInvocation({ proposal: proposalFor(strength), graph: paulGraph() }),
      ...(band !== undefined ? { edgeStrengthBandAuthority: band } : {}),
    });
  const edgeOut = (outcome: Awaited<ReturnType<typeof run>>) =>
    (outcome.mutated_graph as RawGraph).edges.find((e) => e.from === FROM && e.to === TO)!;

  it('a band that does NOT contain the resulting strength refuses rather than storing the wrong range\u2019s spread', async () => {
    await expect(run(0.85, 'weak')).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
  });

  it('CONTRAST: the band that contains it sets that band\u2019s spread', async () => {
    expect(edgeOut(await run(0.85, 'very strong')).strength).toStrictEqual({ mean: 0.85, std: edgeBandStd('very strong') });
  });

  it('the Agent-less paths (an LLM or chip `adjust_edge_strength` carries a FIGURE, and can carry no band) keep Olumi’s RELATIVE spread, flagged (A6f)', async () => {
    const edge = edgeOut(await run(0.6));
    expect(edge.strength).toStrictEqual({ mean: 0.6, std: 0.3 });
    expect(edge.std_defaulted).toBe(true);
    expect(edge.provenance).toStrictEqual({ source: 'user_specified' });
    expect(edge.exists_defaulted).toBe(true);
  });
});
