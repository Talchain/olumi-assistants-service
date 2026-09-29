/**
 * ⭐ A6f — AN EXACT FIGURE KEEPS OLUMI'S SPREAD RELATIVE, AND SAYS IT IS OLUMI'S (AIQ N1 on CEE #2096, comment
 * 5856128077; train row A6f · edge-per-parameter-provenance, P2 slice-A exit check: "price_sensitivity->monthly_churn:
 * strength_mean user; strength_std and exists_probability marked Olumi default").
 *
 * THE DEFECT. An exact-figure user write (the canvas slider, the β field, "Confirm this estimate", an LLM or chip
 * `adjust_edge_strength`) moved `strength.mean` to the user's figure and KEPT Olumi's ABSOLUTE `strength.std`, while
 * the whole-edge `defaulted` was removed — so a std sized for Olumi's mean read as the user's. Paul's edge: std 0.00375
 * sized for 0.0075; on the user's 0.85 that is a CV of 0.4 %, and the analysis ran near-certain on a spread nobody
 * chose.
 *
 * THE RULE (AIQ): (a) the std is still Olumi's — flag it per field (`std_defaulted`), as existence is flagged
 * (`exists_defaulted`, #2096); (b) when the mean moves, keep Olumi's RELATIVE spread, std × |new| / |old|, falling back
 * to the estate's `DEFAULT_STRENGTH_STD` when no relative spread exists. A BAND write keeps its band std and is not
 * flagged; a write that states the spread clears the flag.
 *
 * FIXTURE PROVENANCE. The target edge below is the REAL pre-write edge, verbatim from Paul's staging capture
 * `17d1cd3a` (request 17d1cd3a-b2c8-403c-a7cf-ac002a665752, 27 Sep 08:57Z; `90b8f080` carries the same bytes). Its
 * post-write twin in `08bf9a1f` is `{ mean: 0.85, std: 0.00375 }`, source `user_specified` — the defect as served.
 */
import { describe, expect, it } from 'vitest';

import {
  OrchestratorTurnPayloadSchema,
  type SystemEventTurnPayload,
} from '@talchain/schemas/boundary';

import { DEFAULT_STRENGTH_STD } from '../../../cee/constants.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { runWithStatedLinkBand } from '../../agent-lane/stated-link-band-context.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { edgeBandStd } from '../../format/edge-strength-bands.js';
import type { InfluenceBand } from '../../format/influence-bands.js';
import { buildTypedChipMutationProposal } from '../../routing/typed-chip-mutation-proposal.js';
import type { ProposalAction } from '../../routing/types.js';
import { buildHandlerInvocation } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import {
  ADJUST_EDGE_STRENGTH_STD_MAX,
  createAdjustEdgeStrengthHandler,
  olumiSpreadForMean,
} from '../../tools/handlers/adjust-edge-strength.js';
import { applyEdgeStrengthEdit, isProvenanceOnlyEdgeConfirmation } from '../edge-strength-edit.js';

type EdgeStrengthEditEvent = Extract<SystemEventTurnPayload['event'], { kind: 'edge_strength_edit' }>;
type RawEdge = Record<string, unknown> & {
  from: string;
  to: string;
  strength: { mean: number; std: number };
  provenance?: Record<string, unknown>;
};
type RawGraph = { nodes: Record<string, unknown>[]; edges: RawEdge[] };

const SCENARIO_ID = '79a01a17-95c5-42cb-bfd2-0771bc7c94b1';
const TURN_ID = '11111111-1111-4111-8111-1111111111b6';
const FROM = 'price_sensitivity';
const TO = 'monthly_churn';

/** Capture `17d1cd3a`, `payloads.cee_response.draft_graph.edges[8]` — verbatim. */
const CAPTURED_EDGE_17D1CD3A = {
  to: 'monthly_churn',
  from: 'price_sensitivity',
  strength: { std: 0.00375, mean: 0.0075 },
  defaulted: true,
  provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' },
  effect_direction: 'positive',
  exists_probability: 0.8,
} as const;
/** Capture `17d1cd3a` — the two endpoint nodes, verbatim. */
const CAPTURED_NODES_17D1CD3A = [
  {
    id: 'monthly_churn', kind: 'factor', label: 'Monthly churn', category: 'observable', provenance: 'ai_inferred',
    scale_frame: 100,
    observed_state: { unit: '% per month', value: 0.03, source: 'cee_inference', raw_value: 3, extractionType: 'inferred' },
  },
  { id: 'price_sensitivity', kind: 'risk', label: 'Price sensitivity', provenance: 'ai_inferred' },
] as const;

/** The user's figure on the served write (`08bf9a1f`). */
const USER_FIGURE = 0.85;

function paulGraph(edge: Partial<RawEdge> = {}): RawGraph {
  const g = JSON.parse(JSON.stringify({ nodes: CAPTURED_NODES_17D1CD3A, edges: [CAPTURED_EDGE_17D1CD3A] })) as RawGraph;
  Object.assign(g.edges[0]!, edge);
  return g;
}

function eventFor(overrides: Partial<EdgeStrengthEditEvent> = {}): EdgeStrengthEditEvent {
  return {
    kind: 'edge_strength_edit',
    from: FROM,
    to: TO,
    magnitude: USER_FIGURE,
    direction_intent: 'preserve',
    expected: { mean: 0.0075, effect_direction: 'positive' },
    intent: 'set',
    ...overrides,
  };
}

async function apply(graph: unknown, event: EdgeStrengthEditEvent) {
  const payload = OrchestratorTurnPayloadSchema.parse({
    kind: 'system_event', turn_id: TURN_ID, scenario_id: SCENARIO_ID, stage: 'frame', event,
  });
  if (payload.kind !== 'system_event') throw new Error('expected a system_event payload');
  return await applyEdgeStrengthEdit({ payload, event, requestId: 'req-a6-std', persistedGraph: graph });
}

async function applyStated(graph: unknown, event: EdgeStrengthEditEvent, band: InfluenceBand) {
  return await runWithStatedLinkBand(
    { scenarioId: SCENARIO_ID, proposalId: 'p-a6-std', from: FROM, to: TO, band },
    () => apply(graph, event),
  );
}

function persistedEdge(result: Awaited<ReturnType<typeof apply>>): RawEdge {
  if (result.kind !== 'mutated') throw new Error(`expected mutated, got ${result.kind}: ${result.reason}`);
  const edge = (result.mutatedGraph as RawGraph).edges.find((e) => e.from === FROM && e.to === TO);
  if (edge === undefined) throw new Error('target edge missing from the persisted graph');
  return edge;
}

function adjustProposal(parameters: ProposalAction['parameters']): ProposalAction {
  return {
    handler_id: 'adjust_edge_strength',
    entity: { id: `${FROM}→${TO}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters,
    cited_context_fields: ['graph.edges'],
  };
}

async function runHandler(proposal: ProposalAction, graph: RawGraph = paulGraph()): Promise<RawEdge> {
  const outcome = await createAdjustEdgeStrengthHandler()(buildHandlerInvocation({ proposal, graph }));
  const edge = (outcome.mutated_graph as RawGraph).edges.find((e) => e.from === FROM && e.to === TO);
  if (edge === undefined) throw new Error('target edge missing from the handler graph');
  return edge;
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Paul's shape
// ─────────────────────────────────────────────────────────────────────────────
describe('(a) Paul’s captured edge (17d1cd3a): the user writes the exact figure 0.85', () => {
  it('⭐ RED: the std keeps Olumi’s RELATIVE spread — 0.425 (CV 0.5), not the absolute 0.00375 (CV 0.4 %)', async () => {
    const edge = persistedEdge(await apply(paulGraph(), eventFor()));
    expect(edge.strength.mean).toBe(USER_FIGURE);
    expect(edge.strength.std).toBe(0.425);
    expect(edge.strength.std / Math.abs(edge.strength.mean)).toBe(
      CAPTURED_EDGE_17D1CD3A.strength.std / CAPTURED_EDGE_17D1CD3A.strength.mean,
    );
    expect(edge.strength.std).not.toBe(CAPTURED_EDGE_17D1CD3A.strength.std);
  });

  it('⭐ RED: the std is flagged Olumi’s (`std_defaulted: true`), existence stays Olumi’s as #2096 set it', async () => {
    const result = await apply(paulGraph(), eventFor());
    const edge = persistedEdge(result);
    expect(edge.std_defaulted).toBe(true);
    expect(edge.exists_defaulted).toBe(true);
    expect(edge.exists_probability).toBe(0.8);
    expect(edge).not.toHaveProperty('defaulted');
    expect(edge.provenance).toStrictEqual({ source: 'user_specified' });
    // The parsed view every reader gets keeps the flag (EdgeV3 declares it).
    if (result.kind !== 'mutated') return;
    expect(result.graph.edges.find((e) => e.from === FROM && e.to === TO)?.std_defaulted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) CONTRAST — a band write
// ─────────────────────────────────────────────────────────────────────────────
describe('(b) CONTRAST: a band the user named keeps the band’s spread and is NOT flagged', () => {
  it('⭐ the Agent’s "very strong" (band set): std is the band’s, no `std_defaulted`', async () => {
    const edge = persistedEdge(await applyStated(paulGraph(), eventFor(), 'very strong'));
    expect(edge.strength).toStrictEqual({ mean: USER_FIGURE, std: edgeBandStd('very strong') });
    expect(edge).not.toHaveProperty('std_defaulted');
    expect(edge.exists_defaulted).toBe(true);
  });

  it('⭐ a band write on an edge a FIGURE had flagged clears the flag — the band states the spread', async () => {
    const flagged = paulGraph({
      strength: { mean: 0.5, std: 0.25 },
      std_defaulted: true,
      exists_defaulted: true,
      defaulted: undefined,
      provenance: { source: 'user_specified' },
      provenance_display: 'user_set',
    });
    const edge = persistedEdge(await applyStated(flagged, eventFor({ expected: { mean: 0.5, effect_direction: 'positive' } }), 'very strong'));
    expect(edge.strength.std).toBe(edgeBandStd('very strong'));
    expect(edge).not.toHaveProperty('std_defaulted');
  });

  // R11 (AIQ #72 5872082179): a confirm is REVIEW, not authorship, so it keeps every authorship flag exactly — the
  // band's spread is stored (A6f/A6e) and the band recorded in `reviewed_by_user`. Before R11 this row pinned the flag
  // CLEARED on a band confirm.
  it('the Agent’s band CONFIRM (mean kept): band std, flag KEPT (R11), band recorded, admitted by the confirm guard', async () => {
    const inBand = paulGraph({ strength: { mean: USER_FIGURE, std: 0.425 }, std_defaulted: true });
    const result = await applyStated(
      inBand,
      eventFor({ intent: 'confirm_current', expected: { mean: USER_FIGURE, effect_direction: 'positive' } }),
      'very strong',
    );
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    const edge = persistedEdge(result);
    expect(edge.strength).toStrictEqual({ mean: USER_FIGURE, std: edgeBandStd('very strong') });
    expect(edge.std_defaulted).toBe(true);
    expect(edge.provenance?.reviewed_by_user).toMatchObject({ intent: 'confirm', band: 'very strong' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) No relative spread exists
// ─────────────────────────────────────────────────────────────────────────────
describe('(c) no relative spread exists → the estate’s DEFAULT_STRENGTH_STD, flagged', () => {
  it('⭐ Olumi’s mean was 0: the std is DEFAULT_STRENGTH_STD (0.125), `std_defaulted: true`', async () => {
    const zero = paulGraph({ strength: { mean: 0, std: 0.00375 } });
    const edge = persistedEdge(await apply(zero, eventFor({ expected: { mean: 0, effect_direction: 'positive' } })));
    expect(edge.strength).toStrictEqual({ mean: USER_FIGURE, std: DEFAULT_STRENGTH_STD });
    expect(DEFAULT_STRENGTH_STD).toBe(0.125);
    expect(edge.std_defaulted).toBe(true);
  });

  it('the user’s new mean is 0 (a relative spread of 0 would break std > 0): DEFAULT_STRENGTH_STD, flagged', async () => {
    const edge = persistedEdge(await apply(paulGraph(), eventFor({ magnitude: 0 })));
    expect(edge.strength).toStrictEqual({ mean: 0, std: DEFAULT_STRENGTH_STD });
    expect(edge.std_defaulted).toBe(true);
  });

  it('the relative spread is held to the writer’s own std bound (ADJUST_EDGE_STRENGTH_STD_MAX, 0.5)', async () => {
    const wide = paulGraph({ strength: { mean: 0.01, std: 0.3 } });
    const edge = persistedEdge(await apply(wide, eventFor({ magnitude: 0.9, expected: { mean: 0.01, effect_direction: 'positive' } })));
    expect(ADJUST_EDGE_STRENGTH_STD_MAX).toBe(0.5);
    expect(edge.strength.std).toBe(ADJUST_EDGE_STRENGTH_STD_MAX);
    expect(edge.std_defaulted).toBe(true);
  });

  it('the pure rule: exact on an unmoved magnitude (confirm, sign flip), relative otherwise', () => {
    expect(olumiSpreadForMean({ oldMean: 0.3, oldStd: 0.07, newMean: 0.3 })).toBe(0.07);
    expect(olumiSpreadForMean({ oldMean: 0.3, oldStd: 0.07, newMean: -0.3 })).toBe(0.07);
    expect(olumiSpreadForMean({ oldMean: 0.2, oldStd: 0.05, newMean: 0.4 })).toBeCloseTo(0.1, 15);
    expect(olumiSpreadForMean({ oldMean: -0.2, oldStd: 0.05, newMean: 0.4 })).toBeCloseTo(0.1, 15);
    expect(olumiSpreadForMean({ oldMean: 0, oldStd: 0.05, newMean: 0.4 })).toBe(DEFAULT_STRENGTH_STD);
    expect(olumiSpreadForMean({ oldMean: 0.2, oldStd: Number.POSITIVE_INFINITY, newMean: 0.4 })).toBe(DEFAULT_STRENGTH_STD);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) The analysis hash
// ─────────────────────────────────────────────────────────────────────────────
describe('(e) the analysis hash: the std change is IN it, `std_defaulted` is NOT', () => {
  it('⭐ the figure write moves the std, so the prior run is stale (hash changes beyond the mean alone)', async () => {
    const base = paulGraph();
    const result = await apply(base, eventFor());
    if (result.kind !== 'mutated') throw new Error(result.reason);
    // The same write with the stale absolute std would hash differently: the std itself is an analysis input.
    const staleStd = JSON.parse(JSON.stringify(result.mutatedGraph)) as RawGraph;
    staleStd.edges[0]!.strength.std = CAPTURED_EDGE_17D1CD3A.strength.std;
    expect(computeAnalysisAffectingGraphHash(result.graph)).not.toBe(
      computeAnalysisAffectingGraphHash(GraphV3.parse(staleStd)),
    );
    expect(computeAnalysisAffectingGraphHash(result.graph)).not.toBe(computeAnalysisAffectingGraphHash(GraphV3.parse(base)));
  });

  it('⭐ `std_defaulted` alone does not move it (a label on a value, not an input)', async () => {
    const result = await apply(paulGraph(), eventFor());
    if (result.kind !== 'mutated') throw new Error(result.reason);
    const unflagged = JSON.parse(JSON.stringify(result.mutatedGraph)) as RawGraph;
    delete unflagged.edges[0]!.std_defaulted;
    const reparsed = GraphV3.parse(result.mutatedGraph);
    expect(reparsed.edges[0]!.std_defaulted).toBe(true); // the hashed input really carries it
    expect(computeAnalysisAffectingGraphHash(reparsed)).toBe(computeAnalysisAffectingGraphHash(GraphV3.parse(unflagged)));
  });

  // R11: the flag is KEPT exactly on a confirm (before R11 a figure confirm added `std_defaulted: true`).
  it('a figure CONFIRM keeps the std exactly, so the analysis stays fresh (review only, R11)', async () => {
    const base = paulGraph({ strength: { mean: USER_FIGURE, std: 0.00375 } });
    const result = await apply(base, eventFor({ intent: 'confirm_current', expected: { mean: USER_FIGURE, effect_direction: 'positive' } }));
    if (result.kind !== 'mutated') throw new Error(result.reason);
    expect(persistedEdge(result).strength).toStrictEqual({ mean: USER_FIGURE, std: 0.00375 });
    expect(persistedEdge(result)).not.toHaveProperty('std_defaulted');
    expect(computeAnalysisAffectingGraphHash(result.graph)).toBe(computeAnalysisAffectingGraphHash(GraphV3.parse(base)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) The confirmation guard
// ─────────────────────────────────────────────────────────────────────────────
describe('(f) isProvenanceOnlyEdgeConfirmation admits exactly the std-provenance change and nothing else', () => {
  const before = () => paulGraph({ strength: { mean: USER_FIGURE, std: 0.00375 } });

  /**
   * The writer's projection for a confirm of `b` — R11 (AIQ #72 5872082179): every authorship byte KEPT, the review
   * recorded (with the band, for a band confirm), and this row's std / flag. `stdDefaulted` omitted = the flag kept as
   * it was. (Before R11 this modelled the #2096 stamp: `user_specified`, `user_set`, `defaulted` → `exists_defaulted`,
   * Olumi's sizing dropped, and the A6f flag set.)
   */
  function stamped(b: RawGraph, opts: { bandStd?: number; band?: InfluenceBand; stdDefaulted?: boolean | null } = {}): RawGraph {
    const after = structuredClone(b);
    const e = after.edges[0]!;
    e.provenance = {
      ...e.provenance,
      reviewed_by_user: { intent: 'confirm', at: '2026-09-28T15:00:00.000Z', ...(opts.band ? { band: opts.band } : {}) },
    };
    if (opts.bandStd !== undefined) e.strength = { ...e.strength, std: opts.bandStd };
    if (opts.stdDefaulted === null) delete e.std_defaulted;
    else if (opts.stdDefaulted !== undefined) e.std_defaulted = opts.stdDefaulted;
    return after;
  }
  const guard = (b: RawGraph, a: RawGraph, statedBand?: InfluenceBand) =>
    isProvenanceOnlyEdgeConfirmation({ before: b, after: a, from: FROM, to: TO, ...(statedBand ? { statedBand } : {}) });

  // R11: a confirm keeps `std_defaulted` EXACTLY. Before R11 a figure confirm had to flip it absent → true, and a
  // confirm that left it absent was refused as "the N1 defect as a write".
  it('⭐ R11: a figure confirm: std kept exactly, `std_defaulted` kept (absent → absent): admitted', () => {
    const b = before();
    expect(guard(b, stamped(b))).toBe(true);
    const flagged = paulGraph({ strength: { mean: USER_FIGURE, std: 0.00375 }, std_defaulted: true });
    expect(guard(flagged, stamped(flagged))).toBe(true);
  });

  it('⭐ R11: a figure confirm that ADDS or REMOVES the flag → refused (a confirm restates no authorship)', () => {
    const b = before();
    expect(guard(b, stamped(b, { stdDefaulted: true }))).toBe(false);
    expect(guard(b, stamped(b, { stdDefaulted: false }))).toBe(false);
    const flagged = paulGraph({ strength: { mean: USER_FIGURE, std: 0.00375 }, std_defaulted: true });
    expect(guard(flagged, stamped(flagged, { stdDefaulted: null }))).toBe(false);
  });

  it('⭐ a figure confirm that changes the std ANY way → refused (rescaled, default, or band’s)', () => {
    const b = before();
    expect(guard(b, stamped(b, { bandStd: 0.425 }))).toBe(false);
    expect(guard(b, stamped(b, { bandStd: DEFAULT_STRENGTH_STD }))).toBe(false);
    expect(guard(b, stamped(b, { bandStd: edgeBandStd('very strong') }))).toBe(false);
  });

  // R11: a band confirm stores the band's spread and records the band, but keeps the flag exactly. Before R11 it had
  // to CLEAR the flag (present → absent admitted, kept refused).
  it('R11: a band confirm: band std, band recorded, flag KEPT (absent → absent, present → present): admitted', () => {
    const b = before();
    expect(guard(b, stamped(b, { bandStd: edgeBandStd('very strong'), band: 'very strong' }), 'very strong')).toBe(true);
    const flagged = paulGraph({ strength: { mean: USER_FIGURE, std: 0.425 }, std_defaulted: true });
    expect(guard(flagged, stamped(flagged, { bandStd: edgeBandStd('very strong'), band: 'very strong' }), 'very strong')).toBe(true);
  });

  it('⭐ TAMPER (R11): a band confirm that sets or clears `std_defaulted` → refused', () => {
    const b = before();
    expect(guard(b, stamped(b, { bandStd: edgeBandStd('very strong'), band: 'very strong', stdDefaulted: true }), 'very strong')).toBe(false);
    const flagged = paulGraph({ strength: { mean: USER_FIGURE, std: 0.425 }, std_defaulted: true });
    expect(guard(flagged, stamped(flagged, { bandStd: edgeBandStd('very strong'), band: 'very strong', stdDefaulted: null }), 'very strong')).toBe(false);
  });

  it('TAMPER: `std_defaulted` added to ANOTHER edge → refused', () => {
    const b = before();
    b.edges.push({ from: TO, to: FROM, strength: { mean: 0.2, std: 0.1 }, effect_direction: 'positive', exists_probability: 0.7 });
    const a = stamped(b);
    a.edges[1]!.std_defaulted = true;
    expect(guard(b, a)).toBe(false);
  });

  it('the dispatcher’s own figure confirm lands through both guards (pre-commit adapter → mutated)', async () => {
    const result = await apply(before(), eventFor({ intent: 'confirm_current', expected: { mean: USER_FIGURE, effect_direction: 'positive' } }));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) Every exact-figure writer — one row per path
// ─────────────────────────────────────────────────────────────────────────────
describe('(g) every exact-figure path rescales Olumi’s spread and flags it', () => {
  it('⭐ UI `edge_strength_edit` set — the slider / β field / an un-Agent band pill (no band in-process)', async () => {
    const edge = persistedEdge(await apply(paulGraph(), eventFor()));
    expect(edge.strength).toStrictEqual({ mean: USER_FIGURE, std: 0.425 });
    expect(edge.std_defaulted).toBe(true);
  });

  it('⭐ UI `edge_strength_edit` set with a DIRECTION flip (magnitude moves too): relative to |mean|', async () => {
    const edge = persistedEdge(await apply(paulGraph(), eventFor({ direction_intent: 'negative' })));
    expect(edge.strength).toStrictEqual({ mean: -USER_FIGURE, std: 0.425 });
    expect(edge.effect_direction).toBe('negative');
    expect(edge.std_defaulted).toBe(true);
  });

  // R11: a confirm is review — the std and every flag kept exactly (before R11: std kept, flagged `std_defaulted`).
  it('⭐ UI `edge_strength_edit` confirm_current, no band ("Confirm this estimate"): std exactly kept, flags kept (R11)', async () => {
    const base = paulGraph();
    const edge = persistedEdge(await apply(base, eventFor({ intent: 'confirm_current', magnitude: 0.0075 })));
    expect(edge.strength).toStrictEqual(CAPTURED_EDGE_17D1CD3A.strength);
    expect(edge).not.toHaveProperty('std_defaulted');
    expect(edge.defaulted).toBe(true);
    expect(edge.provenance).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_placeholder', reviewed_by_user: { intent: 'confirm' } });
  });

  it('⭐ Agent approval whose band is NOT this write’s (restored proposal / another link): a figure', async () => {
    const result = await runWithStatedLinkBand(
      { scenarioId: SCENARIO_ID, proposalId: 'p-other', from: TO, to: FROM, band: 'very strong' },
      () => apply(paulGraph(), eventFor()),
    );
    const edge = persistedEdge(result);
    expect(edge.strength).toStrictEqual({ mean: USER_FIGURE, std: 0.425 });
    expect(edge.std_defaulted).toBe(true);
  });

  it('⭐ LLM `adjust_edge_strength` set (edit_graph → the handler, no std)', async () => {
    const edge = await runHandler(adjustProposal([{ name: 'strength', value: USER_FIGURE, operator: 'set', source: 'user_explicit' }]));
    expect(edge.strength).toStrictEqual({ mean: USER_FIGURE, std: 0.425 });
    expect(edge.std_defaulted).toBe(true);
  });

  it('⭐ LLM `adjust_edge_strength` increase / multiply: relative to the RESULTING mean', async () => {
    const inc = await runHandler(adjustProposal([{ name: 'strength', value: 0.0075, operator: 'increase', source: 'user_explicit' }]));
    expect(inc.strength.mean).toBe(0.015);
    expect(inc.strength.std).toBeCloseTo(0.0075, 15);
    expect(inc.std_defaulted).toBe(true);
    const mul = await runHandler(adjustProposal([{ name: 'strength', value: 0.5, operator: 'multiply', source: 'user_explicit' }]));
    expect(mul.strength.mean).toBe(0.00375);
    expect(mul.strength.std).toBeCloseTo(0.001875, 15);
    expect(mul.std_defaulted).toBe(true);
  });

  it('⭐ typed chip `adjust_edge_strength` without std (chip → proposal → the handler)', async () => {
    const built = buildTypedChipMutationProposal('adjust_edge_strength', { from: FROM, to: TO, value: USER_FIGURE }, GraphV3.parse(paulGraph()));
    if (!built.matched) throw new Error(built.reason);
    const edge = await runHandler(built.proposal);
    expect(edge.strength).toStrictEqual({ mean: USER_FIGURE, std: 0.425 });
    expect(edge.std_defaulted).toBe(true);
  });

  it('CONTRAST: a write that STATES the spread (chip / LLM `std`) takes it and clears the flag', async () => {
    const built = buildTypedChipMutationProposal('adjust_edge_strength', { from: FROM, to: TO, value: USER_FIGURE, std: 0.2 }, GraphV3.parse(paulGraph({ std_defaulted: true })));
    if (!built.matched) throw new Error(built.reason);
    const edge = await runHandler(built.proposal, paulGraph({ std_defaulted: true }));
    expect(edge.strength).toStrictEqual({ mean: USER_FIGURE, std: 0.2 });
    expect(edge).not.toHaveProperty('std_defaulted');
  });
});
