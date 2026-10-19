/**
 * ⭐ STEP 8 (Codex R2 #3443: "remove the blanket mocks; keep truthful withheld-path expectations and separate genuinely
 * representable supported controls"). The two ways a user's size on a link can carry a SUPPORTED spread today, each written
 * through the ACTUAL writer, never by setting a flag:
 *   - `withNamedBand`: the user names a band for a chat strength (`adjust_edge_strength` with the approval's band, A6e), which
 *     moves the strength to that band and records `std_defaulted: false` (AIE 764e9c72). Naming the band a link already sits
 *     in is a review (R11) and attests nothing, so a different band is required.
 *   - `withStatedSd`: the user states the standard deviation of their own physical size (the STEP 8 producer, AIE df3304b7),
 *     through `edge_strength_edit` and the chat writer, keeping the size and its source; the spread stays exactly as stored.
 * A spec uses one only for a SYNTHETIC case whose subject is not the spread rule; a captured real case keeps its truthful
 * withholding (AIE cc9fbadf).
 */
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';

import type { InfluenceBand } from '../../format/influence-bands.js';
import { EDGE_STRENGTH_MIDPOINTS } from '../../format/edge-strength-bands.js';
import { createAdjustEdgeStrengthHandler } from '../../tools/handlers/adjust-edge-strength.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { applyEdgeStrengthEdit } from '../../system-events/edge-strength-edit.js';
import { runWithStatedLinkBand } from '../../agent-lane/stated-link-band-context.js';

type Rec = Record<string, any>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const edgeOf = (g: Rec, from: string, to: string): Rec => {
  const e = (g.edges as Rec[]).find((x) => x.from === from && x.to === to);
  if (e === undefined) throw new Error(`no link ${from} -> ${to}`);
  return e;
};

/**
 * The user names `band` for the chat strength on `from → to`; the actual writer records it as theirs, attested. On a link holding
 * the user's own figure, `replacesUserFigure` is their explicit "replace my figure with …" (F1), without which the writer refuses.
 */
export async function withNamedBand(graph: Rec, from: string, to: string, band: InfluenceBand, o: { replacesUserFigure?: true } = {}): Promise<Rec> {
  const edge = edgeOf(graph, from, to);
  if (EDGE_STRENGTH_MIDPOINTS[band] === Math.abs(edge.strength.mean)) throw new Error('naming the band a link sits in is a review: pick another band');
  const value = (edge.strength.mean < 0 ? -1 : 1) * EDGE_STRENGTH_MIDPOINTS[band];
  const outcome = await createAdjustEdgeStrengthHandler()({
    context: { session_id: 'supported-spread', stage: 'frame', request_id: 'req-supported-spread', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: { kind: 'message', scenario_id: 'supported-spread', turn_id: '11111111-1111-4111-8111-1111111115ad', stage: 'frame', message: 'Yes, record that.' },
    requestId: 'req-supported-spread', signal: new AbortController().signal, orientationText: '', graphForTurn: graph,
    proposal: { handler_id: 'adjust_edge_strength', cited_context_fields: [],
      entity: { id: `${from}→${to}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [{ name: 'strength', value, operator: 'set', source: 'user_explicit' }] },
    edgeStrengthBandAuthority: band,
    ...(o.replacesUserFigure === true ? { edgeStrengthReplacesUserFigureAuthority: true } : {}),
  } as unknown as HandlerInvocation);
  const out = clone(outcome.mutated_graph) as Rec;
  if (edgeOf(out, from, to).std_defaulted !== false) throw new Error('the writer did not attest the band');
  return out;
}

/** `withNamedBand` on each listed link in turn, naming "strong" (or "moderate" where a link already sits at strong's midpoint). */
export async function withNamedBands(graph: Rec, links: ReadonlyArray<readonly [string, string]>): Promise<Rec> {
  let out = graph;
  for (const [from, to] of links) {
    const band: InfluenceBand = Math.abs(edgeOf(out, from, to).strength.mean) === EDGE_STRENGTH_MIDPOINTS.strong ? 'moderate' : 'strong';
    out = await withNamedBand(out, from, to, band);
  }
  return out;
}

/**
 * The user states the standard deviation of their own physical size on `from → to`, with a basis; recorded through the actual
 * adapter and chat writer (the STEP 8 producer). By default the SD the link's spread already maps to, so no engine input moves;
 * `statedSd` (in the size's own unit) where that spread is beyond what the writer records.
 */
export async function withStatedSd(graph: Rec, scenarioId: string, from: string, to: string, statedSd?: number): Promise<Rec> {
  const edge = edgeOf(graph, from, to);
  const ne = edge.provenance?.natural_effect as Rec | undefined;
  if (ne === undefined) throw new Error(`${from} -> ${to} holds no physical size`);
  const sd = statedSd ?? edge.strength.std * Math.abs(ne.amount / ne.strength_mean);
  const uncertainty = { stated_as: 'standard_deviation' as const, sd, distribution: 'normal' as const, distribution_origin: 'olumi_provisional' as const,
    assessor: 'you', basis: 'our last eight weeks of records', source_quote: `the standard deviation is ${sd} ${String(ne.amount_unit)}` };
  const event = { kind: 'edge_strength_edit' as const, from, to, intent: 'set' as const, direction_intent: 'preserve' as const,
    magnitude: Math.abs(edge.strength.mean), expected: { mean: edge.strength.mean, effect_direction: edge.effect_direction } };
  const payload = OrchestratorTurnPayloadSchema.parse({ kind: 'system_event', turn_id: '11111111-1111-4111-8111-1111111115ae', scenario_id: scenarioId, stage: 'frame', event });
  if (payload.kind !== 'system_event' || payload.event.kind !== 'edge_strength_edit') throw new Error('unexpected payload');
  const ev = payload.event;
  const result = await runWithStatedLinkBand({ scenarioId, proposalId: 'p-supported-spread', from, to, uncertainty },
    () => applyEdgeStrengthEdit({ payload, event: ev, requestId: 'req-supported-spread', persistedGraph: clone(graph) }));
  if (result.kind !== 'mutated') throw new Error(`the writer refused the stated spread: ${JSON.stringify(result).slice(0, 600)}`);
  const out = clone(result.mutatedGraph) as Rec;
  if (edgeOf(out, from, to).std_defaulted !== false) throw new Error('the writer did not attest the stated spread');
  return out;
}

/**
 * `withStatedSd` on every size the user stated in their own units, in graph order. A definition, or a link into a node an identity
 * defines, draws no spread of its own (the writer refuses it), so it is left as it is.
 */
export async function withStatedSds(graph: Rec, scenarioId: string): Promise<Rec> {
  const defined = new Set((graph.nodes as Rec[]).filter((n) => n.nonlinear_identity !== undefined).map((n) => n.id));
  let out = graph;
  for (const e of graph.edges as Rec[]) {
    const p = e.provenance as Rec | undefined;
    if (p?.magnitude === 'user_stated' && p.natural_effect !== undefined && p.definitional !== true && !defined.has(e.to)) {
      out = await withStatedSd(out, scenarioId, e.from, e.to);
    }
  }
  return out;
}
