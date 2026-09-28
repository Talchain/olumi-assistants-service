/**
 * R3-9 (AIQ #72 5866734772; DL 5866746362, owner Canonical) — THE ONE DEFINITIONAL-LINK PREDICATE.
 *
 * A node that declares a `nonlinear_identity` (MRR = price × subscribers) is computed from its operands, and an
 * evaluated identity never reads the strengths of the edges into it (ISL `definitional_edges`, R3-9e). Those edges are
 * DEFINITIONS, not beliefs: every operand (`factor_ids`) and every addend (`addends`), into the carrier. A user's edit to
 * one was stored and then silently ignored. Every edge writer asks THIS predicate and refuses in the user's words; the
 * coaching card's "never select a definition" (`next-move.ts` `definitionalLinks`) reads the same set.
 *
 * ⛔ READ THE RAW GRAPH, NEVER THE PARSED ONE. CEE's `NodeV3` declares only `{ operation: 'product', factor_ids }`
 * (`.strict()`, `.catch(undefined)`), so an identity with addends or a `sum` is DROPPED by `GraphV3.safeParse`, while
 * PLoT and ISL evaluate it. A predicate over the parsed graph would call a real definition an ordinary belief.
 *
 * "Declared", not "evaluated": whether ISL evaluates an identity is known only after a Run, and a link the next Run
 * defines must not be edited as a belief now. Total and pure; never throws on a malformed graph.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { selectRunAnalysisFact } from '../context/freshness.js';
import { composeEdgeIdentity } from './edge-address.js';

export interface DefinitionalLink {
  readonly carrier_id: string;
  readonly operation: 'product' | 'sum';
  /** The identity's `factor_ids`, in order. */
  readonly operand_ids: readonly string[];
  /** The identity's `addends` (absent → empty). */
  readonly addend_ids: readonly string[];
  /** True only when the declaration says the brief states it; anything else is Olumi's reading (AIQ 5867435409 (2)). */
  readonly stated_in_brief: boolean;
}

/**
 * What the LAST Run did with the declared identities (AIQ 5867435409 (1)): the carriers it WITHDREW — PLoT's
 * `_meta.identities_not_forwarded` (frameless or inconsistent, variants (b) and (c)) and any `identity_evaluations` row
 * with `evaluated: false`. A withdrawn identity leaves its node linear, so that Run DID use the link's strength.
 */
export interface IdentityRunUse {
  readonly withdrawn: ReadonlySet<string>;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function ids(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.every((x) => typeof x === 'string' && x.length > 0) ? (value as string[]) : null;
}

function declaredIdentities(graph: unknown): DefinitionalLink[] {
  const nodes = rec(graph)?.nodes;
  if (!Array.isArray(nodes)) return [];
  const out: DefinitionalLink[] = [];
  for (const raw of nodes) {
    const node = rec(raw);
    const identity = rec(node?.nonlinear_identity);
    if (typeof node?.id !== 'string' || node.id.length === 0 || identity === null) continue;
    const operands = ids(identity.factor_ids);
    const addends = ids(identity.addends);
    if (operands === null || addends === null || operands.length === 0) continue;
    out.push({
      carrier_id: node.id,
      operation: identity.operation === 'sum' ? 'sum' : 'product',
      operand_ids: operands,
      addend_ids: addends,
      stated_in_brief: identity.stated_in_brief === true,
    });
  }
  return out;
}

/** The identity that DEFINES the edge `from → to`, or null when that edge is an ordinary belief. */
export function definitionalLinkOf(graph: unknown, from: string, to: string): DefinitionalLink | null {
  return declaredIdentities(graph).find(
    (d) => d.carrier_id === to && (d.operand_ids.includes(from) || d.addend_ids.includes(from)),
  ) ?? null;
}

/**
 * The newest SUCCESSFUL `run_analysis` fact decides (`selectRunAnalysisFact`). No Run → null: the link is refused, and
 * the next Run decides. Pure; never throws on a malformed fact.
 */
export function identityRunUseFromFacts(facts: readonly unknown[]): IdentityRunUse | null {
  // THE ONE ORDERING CORE (`context/freshness.ts` `selectRunAnalysisFact`; DL verdict + AIQ 5867961154): the newest
  // SUCCESSFUL run by time, never the first by position. A refused or failed Run after a withdrawing one carries no
  // identity decisions, and must not re-refuse the edit.
  const selected = selectRunAnalysisFact(facts as readonly HandlerFact[]);
  if (selected === null) return null;
  const run = rec(selected.fact);
  const enrichment = rec(rec(run?.result)?.enrichment);
  const withdrawn = new Set<string>();
  const notForwarded = rec(enrichment?._meta)?.identities_not_forwarded;
  for (const row of Array.isArray(notForwarded) ? notForwarded : []) {
    const id = rec(row)?.node_id;
    if (typeof id === 'string' && id.length > 0) withdrawn.add(id);
  }
  const evaluations = enrichment?.identity_evaluations;
  for (const row of Array.isArray(evaluations) ? evaluations : []) {
    const r = rec(row);
    if (r?.evaluated === false && typeof r.node_id === 'string' && r.node_id.length > 0) withdrawn.add(r.node_id);
  }
  return { withdrawn };
}

/**
 * The link a declared identity defines AND the last Run kept in use; null when it is an ordinary belief, or when the
 * last Run withdrew the identity (the strength was then used, additively: refusing would block the one lever that
 * moves the numbers, and "not something the analysis uses" would be false).
 */
export function definitionalLinkInUse(graph: unknown, from: string, to: string, lastRun: IdentityRunUse | null): DefinitionalLink | null {
  const link = definitionalLinkOf(graph, from, to);
  if (link === null) return null;
  return lastRun !== null && lastRun.withdrawn.has(link.carrier_id) ? null : link;
}

/** Every definitional edge, keyed by the card's own edge identity (`composeEdgeIdentity`). No graph → empty. */
export function definitionalLinks(graph: unknown): ReadonlySet<string> {
  const out = new Set<string>();
  for (const d of declaredIdentities(graph)) {
    for (const from of [...d.operand_ids, ...d.addend_ids]) out.add(composeEdgeIdentity(from, d.carrier_id));
  }
  return out;
}

/**
 * The refusal, in the user's labels. A STATED identity: "This link is defined by MRR = Pro plan price × Pro paying
 * subscribers, so its strength is not something the analysis uses … Change Pro plan price or Pro paying subscribers
 * instead." An INFERRED one is Olumi's reading: "Olumi reads MRR as … That reading is Olumi's, not yours; if MRR isn't that, say so."
 * (No promise to stop reading it: nothing can withdraw an inferred identity yet, AIQ 5868909577.)
 */
export function definitionalLinkRefusalText(graph: unknown, link: DefinitionalLink): string {
  const nodes = rec(graph)?.nodes;
  const labelOf = (id: string): string => {
    const node = Array.isArray(nodes) ? nodes.map(rec).find((n) => n?.id === id) : undefined;
    return typeof node?.label === 'string' && node.label.trim() !== '' ? node.label.trim() : id;
  };
  const term = link.operand_ids.map(labelOf).join(link.operation === 'sum' ? ' + ' : ' × ');
  const formula = [term, ...link.addend_ids.map(labelOf)].join(' + ');
  const parts = [...link.operand_ids, ...link.addend_ids].map(labelOf);
  const change = parts.length <= 2 ? parts.join(' or ') : `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
  const carrier = labelOf(link.carrier_id);
  // AIQ 5867435409 (2), CEE's N-c rule (`admit-model.ts`): a declaration the brief states is said as fact; any other is
  // Olumi's reading, said as such, with the way out.
  if (!link.stated_in_brief) {
    // AIQ 5868909577: no promise of an action nobody can take (there is no writer that withdraws an inferred identity).
    return `Olumi reads ${carrier} as ${formula}, so this link's strength isn't used while that holds, and I haven't changed it. `
      + `Change ${change} instead. That reading is Olumi's, not yours; if ${carrier} isn't that, say so.`;
  }
  return `This link is defined by ${carrier} = ${formula}, so its strength is not something the analysis uses, `
    + `and I haven't changed it. Change ${change} instead.`;
}
