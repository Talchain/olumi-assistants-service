/** event_risk.v1 slice 2c: hold only an unambiguous occurrence stated in the brief. */
import { readStatedEventRiskWithBindingSpan, splitStatedLikelihoodClauses } from '../routing/stated-event-risk.js';
import type { EventRiskV1T } from '../../schemas/event-risk.js';

const WORD = /(?<![\p{L}\p{N}])[\p{L}\p{N}]{1,100}(?![\p{L}\p{N}])/gu;
const words = (text: string): string[] => [...text.toLowerCase().matchAll(WORD)]
  .map((m) => m[0].replace(/s$/, ''));

export function holdStatedEventRisks<
  N extends { readonly id: string; readonly kind?: unknown; readonly label?: unknown; readonly event_risk_basis_text?: unknown },
  E extends { readonly from: string; readonly to: string },
>(nodes: readonly N[], edges: readonly E[], brief: string): {
  nodes: readonly (N & { event_risk?: EventRiskV1T })[];
  edges: readonly E[];
  held: Array<{ risk_id: string; quote: string }>;
  refused: Array<{ risk_id: string; reason: 'has_cause_link' }>;
} {
  const risks = nodes.filter((n) => n.kind === 'risk' && typeof n.label === 'string')
    .map((node) => ({ node, names: words(node.label as string) }));
  const claims = new Map<string, Array<NonNullable<ReturnType<typeof readStatedEventRiskWithBindingSpan>>>>();
  for (const clause of splitStatedLikelihoodClauses(brief)) {
    const stated = readStatedEventRiskWithBindingSpan(clause);
    if (stated === undefined) continue;
    const named = new Set(words(stated.binding_span));
    // Stricter than nearest-word binding: EVERY label word must be written in this
    // reader-exposed likelihood clause, and exactly one risk may match. The reader
    // keeps comma-attached event context but excludes names across a semicolon.
    // No figure/likelihood on a node is read.
    const matches = risks.filter((r) => r.names.length > 0 && r.names.every((w) => named.has(w)));
    // Another risk named anywhere in the clause makes the binding ambiguous ("Supplier fails, unlike Release slips, has…").
    const inClause = new Set(words(stated.clause_text));
    const clauseMatches = risks.filter((r) => r.names.length > 0 && r.names.every((w) => inClause.has(w)));
    if (matches.length !== 1 || clauseMatches.length !== 1) continue;
    const id = matches[0]!.node.id;
    const previous = claims.get(id) ?? [];
    previous.push(stated);
    claims.set(id, previous);
  }
  const incoming = new Set(edges.map((e) => e.to));
  const blocks = new Map<string, EventRiskV1T>();
  const held: Array<{ risk_id: string; quote: string }> = [];
  const refused: Array<{ risk_id: string; reason: 'has_cause_link' }> = [];
  for (const [id, statements] of claims) {
    if (statements.length !== 1) continue;
    if (incoming.has(id)) {
      refused.push({ risk_id: id, reason: 'has_cause_link' });
      continue;
    }
    blocks.set(id, statements[0]!.event_risk);
    held.push({ risk_id: id, quote: statements[0]!.quote });
  }
  if (held.length === 0) return { nodes, edges, held, refused };
  return {
    nodes: nodes.map((node) => {
      if (!blocks.has(node.id)) return node;
      const { event_risk_basis_text: _olumiBasis, ...rest } = node;
      return { ...rest, event_risk: blocks.get(node.id)! } as N & { event_risk: EventRiskV1T };
    }),
    // Science Q7: occurrence is the uncertainty; impact existence is 1. Its size,
    // defaulted marker and provenance remain Olumi's unsized placeholder.
    edges: edges.map((edge) => blocks.has(edge.from) ? { ...edge, exists_probability: 1 } : edge),
    held, refused,
  };
}

/** The shared occurrence words for draft disclosures and held approval cards. */
export function eventRiskLikelihoodWords(block: EventRiskV1T): string {
  const figure = (p: number): number => {
    if (block.occurrence.basis !== 'olumi') return Number((p * 100).toFixed(6));
    const rounded = Math.round(p * 100);
    // Rounded words must not turn a small possibility into impossibility or a high chance into certainty.
    if (p > 0 && rounded === 0) return Number((p * 100).toPrecision(2));
    if (p < 1 && rounded === 100) return Number((100 - Number(((1 - p) * 100).toPrecision(2))).toPrecision(12));
    return rounded;
  };
  const low = figure(block.occurrence.p_low);
  const high = figure(block.occurrence.p_high);
  const likelihood = low === high ? `${low}%` : `${low}–${high}%`;
  const months = block.horizon.months;
  const horizon = months === 1 ? 'a month' : `${months} months`;
  return `about ${likelihood} within ${horizon}`;
}

/** The approval card's likelihood line: one string for the card record AND the confirm chip the user sees. */
export function eventRiskCardLine(block: EventRiskV1T, basisText?: string): string {
  if (block.occurrence.basis === 'olumi') {
    const basis = basisText?.trim();
    if (!basis) return 'May happen; its likelihood still needs a basis.';
    return `May happen: ${eventRiskLikelihoodWords(block)} (Olumi's estimate, based on ${basis}).`;
  }
  if (block.occurrence.basis === 'reference') return `May happen: ${eventRiskLikelihoodWords(block)} (reference figure).`;
  return `It may happen: ${eventRiskLikelihoodWords(block)}, as you said.`;
}

/** The draft's disclosure for a held event risk, said back as the user's own. */
export function heldEventRiskLine(label: string, block: EventRiskV1T): string {
  return `Held your stated likelihood for ${label}: it may happen (${eventRiskLikelihoodWords(block)}), as you wrote.`;
}

/** The draft's disclosure when a stated likelihood is not modelled because the risk has a cause (ISL v1 refuses it). */
export function refusedEventRiskLine(label: string): string {
  return `${label} has a stated likelihood, but it has a cause in the model, so it's kept as an ordinary risk for now.`;
}
