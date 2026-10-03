/**
 * SLICE C2 — the add-risk transaction builder (PURE). Canonical State ruling #70 5855234599.
 *
 * Paul's served test (27 Sep, export 90b8f080): he asked for a "competitive response" risk, the Agent offered it, he
 * said "Yes." and nothing could be added — no writer the Agent reaches could add a risk atomically. This builds the
 * ONE batch the product's own held-edit seam then referees, holds (`graph_management_held_v1`) and, on the user's
 * confirm, applies in ONE commit (`executeGmHeldResume`) — the same seam as the typed add-option
 * (`add-option-transaction.ts`), reused, not a new mechanism.
 *
 * THE BATCH:
 *   · `add_node` FIRST — `{id, kind: 'risk', label}` and nothing else: the node carries no CEE-owned field (no value,
 *     no category, no provenance). It is first so the referee's intra-batch sequencing sees the node before any edge
 *     that names it, and so the hold's handle is `gmHeldProposalRef(scenario, 'node:<risk id>')`.
 *   · then ONE `add_edge` per link (`from::to`), each Olumi's PLACEHOLDER hypothesis (`hypothesisEdgeValue`:
 *     default strength, `defaulted: true`, `provenance.source: 'cee_hypothesis'`), signed by the stated direction —
 *     never `user_specified`: nobody sized the link.
 *
 * ⛔ THE KIND PAIRS ARE DECIDED HERE, NOT LEFT TO A LATER VALIDATOR. A new risk may be linked ONLY
 * factor → risk (what drives it), risk → outcome and risk → goal (what it threatens). NEVER risk → factor: a risk is
 * not a mediator. `v3-validator.ts` happens to omit risk→factor from its allow-list today; this builder does not rely
 * on that — any other pair is refused (`kind_pair_not_allowed`) with nothing built.
 *
 * PURE + TOTAL + FAIL-SAFE: every malformed or unresolvable input is `{ matched: false, reason }`. Never throws, never
 * mutates its inputs.
 */
import { z } from 'zod';

import { normaliseIdBase } from '../../cee/utils/id-normalizer.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import { TYPED_TRANSACTION_ENVELOPE_CAP } from '../graph-management/types.js';
import { hypothesisEdgeValue, reachesGoal, sameLabel, type AddOptionGraphView } from './add-option-transaction.js';

/** One link of the new risk: EXACTLY one end is named — the other end is the new risk itself. */
const RiskLinkSchema = z
  .object({
    /** A factor that drives the risk (factor → risk). */
    from_id: z.string().min(1).optional(),
    /** The goal or an outcome the risk threatens (risk → goal | outcome). */
    to_id: z.string().min(1).optional(),
    effect_direction: z.enum(['positive', 'negative']),
  })
  .strict();

const AddRiskParamsSchema = z
  .object({
    risk: z.object({ id: z.string().min(1).optional(), label: z.string().trim().min(1) }).strict(),
    links: z.array(RiskLinkSchema),
  })
  .strict();

export type AddRiskParams = z.input<typeof AddRiskParamsSchema>;

export type AddRiskSkipReason =
  | 'parameters_invalid'
  | 'no_graph'
  | 'risk_label_exists'
  | 'risk_id_invalid'
  | 'risk_id_collision'
  | 'no_links'
  | 'link_endpoint_invalid'
  | 'node_not_found'
  | 'kind_pair_not_allowed'
  | 'duplicate_link'
  | 'no_affects_link'
  | 'risk_unreachable'
  | 'too_many_links';

export interface AddRiskProposal {
  readonly operations: PatchOperation[];
  readonly riskId: string;
  readonly riskLabel: string;
  /** `from::to` of every link, in batch order. */
  readonly links: readonly { readonly from: string; readonly to: string; readonly effect_direction: 'positive' | 'negative' }[];
}

export type AddRiskBuildResult =
  | { readonly matched: true; readonly proposal: AddRiskProposal }
  | { readonly matched: false; readonly reason: AddRiskSkipReason };

/** Canonical id pattern (mirrors NodeV3 `id`). */
const CANONICAL_ID_RE = /^[a-z0-9_:-]+$/;

const fail = (reason: AddRiskSkipReason): AddRiskBuildResult => ({ matched: false, reason });

/** The kinds a new risk may be linked FROM (what drives it) and TO (what it threatens). Nothing else. */
const DRIVES_A_RISK: ReadonlySet<string> = new Set(['factor']);
const THREATENED_BY_A_RISK: ReadonlySet<string> = new Set(['outcome', 'goal']);

/**
 * Build the atomic add-risk batch against the current graph, or a classified refusal. A refusal builds nothing.
 */
export function buildAddRiskTransaction(params: unknown, graph: AddOptionGraphView | null): AddRiskBuildResult {
  if (graph === null) return fail('no_graph');
  // Several individually checked risks share the existing atomic held transaction.
  if (params !== null && typeof params === 'object' && Object.hasOwn(params, 'risks')) {
    const batch = z.object({ risks: z.array(AddRiskParamsSchema).min(1).max(4) }).strict().safeParse(params);
    if (!batch.success) return fail('parameters_invalid');
    const view = { nodes: [...graph.nodes], edges: [...graph.edges] };
    const proposals: AddRiskProposal[] = [];
    for (const spec of batch.data.risks) {
      const built = buildAddRiskTransaction(spec, view);
      if (!built.matched) return built;
      proposals.push(built.proposal);
      view.nodes.push({ id: built.proposal.riskId, kind: 'risk', label: built.proposal.riskLabel });
    }
    const operations = proposals.flatMap((p) => p.operations);
    if (operations.length > TYPED_TRANSACTION_ENVELOPE_CAP) return fail('too_many_links');
    return { matched: true, proposal: { ...proposals[0]!, operations, links: proposals.flatMap((p) => p.links) } };
  }
  const parsed = AddRiskParamsSchema.safeParse(params);
  if (!parsed.success) return fail('parameters_invalid');
  const { risk, links } = parsed.data;
  const label = risk.label.trim();

  // A second node by the same name is not a new risk: the user could not tell the two apart.
  if (graph.nodes.some((n) => sameLabel(n.label, label))) return fail('risk_label_exists');

  let riskId: string;
  if (risk.id !== undefined) {
    if (!CANONICAL_ID_RE.test(risk.id)) return fail('risk_id_invalid');
    if (graph.nodes.some((n) => n.id === risk.id)) return fail('risk_id_collision');
    riskId = risk.id;
  } else {
    const base = `risk_${normaliseIdBase(label)}`;
    riskId = base;
    for (let k = 2; graph.nodes.some((n) => n.id === riskId); k += 1) riskId = `${base}_${k}`;
  }

  if (links.length === 0) return fail('no_links');
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind] as const));
  const resolved: { from: string; to: string; effect_direction: 'positive' | 'negative' }[] = [];
  for (const link of links) {
    // Exactly one end is named; the other is the new risk.
    if ((link.from_id === undefined) === (link.to_id === undefined)) return fail('link_endpoint_invalid');
    const other = (link.from_id ?? link.to_id)!;
    const otherKind = kindOf.get(other);
    if (otherKind === undefined) return fail('node_not_found');
    // ⛔ The ONLY pairs a new risk may have. risk → factor (a risk as a mediator) is refused here, by the door.
    const allowed = link.from_id !== undefined ? DRIVES_A_RISK.has(otherKind) : THREATENED_BY_A_RISK.has(otherKind);
    if (!allowed) return fail('kind_pair_not_allowed');
    const from = link.from_id !== undefined ? other : riskId;
    const to = link.from_id !== undefined ? riskId : other;
    // One link per pair: two `add_edge`s to one pair hold, then fail "Edge already exists" at apply (#70 5844092217 B1).
    if (resolved.some((r) => r.from === from && r.to === to)) return fail('duplicate_link');
    resolved.push({ from, to, effect_direction: link.effect_direction });
  }

  // A risk that threatens nothing cannot change the comparison: at least one link OUT, and one of those must lead to the goal.
  const out = resolved.filter((r) => r.from === riskId);
  if (out.length === 0) return fail('no_affects_link');
  if (!out.some((r) => reachesGoal(graph, r.to))) return fail('risk_unreachable');

  // The typed transaction's own ceiling (the hold records it for the confirm): the node plus one op per link.
  if (1 + resolved.length > TYPED_TRANSACTION_ENVELOPE_CAP) return fail('too_many_links');

  const operations: PatchOperation[] = [
    { op: 'add_node', path: riskId, value: { id: riskId, kind: 'risk', label } },
    ...resolved.map((r): PatchOperation => ({
      op: 'add_edge',
      path: `${r.from}::${r.to}`,
      value: hypothesisEdgeValue(r.from, r.to, r.effect_direction),
    })),
  ];
  return { matched: true, proposal: { operations, riskId, riskLabel: label, links: resolved } };
}
