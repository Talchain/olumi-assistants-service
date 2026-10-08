/** Chat's option-label lease: the host verifies it before minting the existing RC3 stamp. */
import { readIsBaseline, type BaselineFlagSurfaces } from '../../cee/baseline-identity.js';
import { statusQuoOptionId, type GraphEdgeLike, type StatusQuoNodeLike } from '../agent-lane/structural-facts.js';
import type { ReliesOnRisk } from './relies-on-risk.js';

type Node = StatusQuoNodeLike & { readonly label: string; readonly description?: string };
type Graph = { readonly nodes: readonly Node[]; readonly edges: readonly GraphEdgeLike[] };
const labelKey = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, ' ');
const FILLER_WORDS = new Set([
  'about', 'also', 'because', 'been', 'being', 'could', 'does', 'each', 'from', 'have', 'into',
  'just', 'might', 'next', 'only', 'other', 'risk', 'risks', 'should', 'some', 'that', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'when', 'where', 'which',
  'will', 'with', 'would', 'your', 'happen', 'happens', 'happened', 'happening',
]);
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}]+/gu) ?? [];

/**
 * A bounded sanity gate, not a causal inference: one content word of at least four letters shares its first
 * four letters with the option, decision or STORED brief. User approval of the disclosed card is the safeguard.
 * Neither the current risk request nor the model's rationale can provide this contextual corroboration.
 */
export function chatRiskPreconditionMatches(riskLabel: string, optionLabel: string, decisionText: string, briefText: string): boolean {
  const riskWords = wordsOf(riskLabel).filter((word) => word.length >= 4 && !FILLER_WORDS.has(word));
  const contextPrefixes = new Set(wordsOf(`${optionLabel}\n${decisionText}\n${briefText}`)
    .filter((word) => word.length >= 4).map((word) => word.slice(0, 4)));
  return riskWords.some((word) => contextPrefixes.has(word.slice(0, 4)));
}

/** No id, description, fuzzy or baseline lookup: an invalid lease simply leaves today's risk path available. */
export function chatRiskPreconditionFor(optionLabel: unknown, riskLabel: string, graph: Graph, briefText?: string | null): ReliesOnRisk | undefined {
  if (typeof optionLabel !== 'string' || optionLabel.trim() === '') return undefined;
  const matches = graph.nodes.filter((node) => labelKey(node.label) === labelKey(optionLabel));
  const option = matches[0];
  if (matches.length !== 1 || option?.kind !== 'option'
    || readIsBaseline(option as BaselineFlagSurfaces) === true
    || statusQuoOptionId(graph.nodes, graph.edges) === option.id) return undefined;
  const decisionText = graph.nodes.filter((node) => node.kind === 'decision')
    .map((node) => `${node.label}\n${node.description ?? ''}`).join('\n');
  if (!chatRiskPreconditionMatches(riskLabel, option.label, decisionText, briefText ?? '')) return undefined;
  return { option_id: option.id };
}
