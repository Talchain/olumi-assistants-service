/** event_risk.v1 slice 2c: hold only an unambiguous occurrence stated in the brief. */
import { readStatedEventRisk } from '../routing/stated-event-risk.js';
import type { EventRiskV1T } from '../../schemas/event-risk.js';

// Single-character sentence boundaries; a decimal point is not a boundary. Both regexes
// have bounded lookarounds/tokens and no nested repetition or overlapping alternatives.
const SENTENCE_END = /[.!?](?=\s|$)|[\r\n]/u;
const WORD = /(?<![\p{L}\p{N}])[\p{L}\p{N}]{1,100}(?![\p{L}\p{N}])/gu;
const words = (text: string): string[] => [...text.toLowerCase().matchAll(WORD)]
  .map((m) => m[0].replace(/s$/, ''));

export function holdStatedEventRisks<
  N extends { readonly id: string; readonly kind?: unknown; readonly label?: unknown },
  E extends { readonly from: string; readonly to: string },
>(nodes: readonly N[], edges: readonly E[], brief: string): {
  nodes: readonly (N & { event_risk?: EventRiskV1T })[];
  edges: readonly E[];
  held: Array<{ risk_id: string; quote: string }>;
  refused: Array<{ risk_id: string; reason: 'has_cause_link' }>;
} {
  const risks = nodes.filter((n) => n.kind === 'risk' && typeof n.label === 'string')
    .map((node) => ({ node, names: words(node.label as string) }));
  const claims = new Map<string, Array<NonNullable<ReturnType<typeof readStatedEventRisk>>>>();
  for (const sentence of brief.split(SENTENCE_END)) {
    const stated = readStatedEventRisk(sentence);
    if (stated === undefined) continue;
    const named = new Set(words(sentence));
    // Stricter than nearest-word binding: EVERY label word must be written in this
    // sentence, and exactly one risk may match. No figure/likelihood on a node is read.
    const matches = risks.filter((r) => r.names.length > 0 && r.names.every((w) => named.has(w)));
    if (matches.length !== 1) continue;
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
    nodes: nodes.map((node) => blocks.has(node.id) ? { ...node, event_risk: blocks.get(node.id)! } : node),
    // Science Q7: occurrence is the uncertainty; impact existence is 1. Its size,
    // defaulted marker and provenance remain Olumi's unsized placeholder.
    edges: edges.map((edge) => blocks.has(edge.from) ? { ...edge, exists_probability: 1 } : edge),
    held, refused,
  };
}

/** The shared occurrence words for draft disclosures and held approval cards. */
export function eventRiskLikelihoodWords(block: EventRiskV1T): string {
  const low = Number((block.occurrence.p_low * 100).toFixed(6));
  const high = Number((block.occurrence.p_high * 100).toFixed(6));
  const likelihood = low === high ? `${low}%` : `${low}–${high}%`;
  const months = block.horizon.months;
  const horizon = months === 1 ? 'a month' : `${months} months`;
  return `about ${likelihood} within ${horizon}`;
}

/** The approval card's likelihood line: one string for the card record AND the confirm chip the user sees. */
export function eventRiskCardLine(block: EventRiskV1T): string {
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
