/** Chat's option-label lease: the host verifies it before minting the existing RC3 stamp. */
import { readIsBaseline, type BaselineFlagSurfaces } from '../../cee/baseline-identity.js';
import { statusQuoOptionId, type GraphEdgeLike, type StatusQuoNodeLike } from '../agent-lane/structural-facts.js';
import type { ReliesOnRisk } from './relies-on-risk.js';

type Node = StatusQuoNodeLike & { readonly label: string; readonly description?: string };
type Graph = { readonly nodes: readonly Node[]; readonly edges: readonly GraphEdgeLike[] };
const labelKey = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, ' ');
// Function words never corroborate, on EITHER side (Codex #2823 r1: "while" in the brief, "should" in the decision).
const FILLER_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'although', 'among', 'another', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'could', 'does', 'doing', 'down', 'during', 'each', 'either', 'else', 'even',
  'ever', 'every', 'from', 'further', 'have', 'having', 'here', 'however', 'into', 'just', 'least', 'less', 'like',
  'made', 'make', 'many', 'might', 'more', 'most', 'much', 'must', 'near', 'need', 'neither', 'never', 'next', 'none',
  'only', 'other', 'otherwise', 'over', 'perhaps', 'quite', 'rather', 'really', 'same', 'shall', 'should', 'since',
  'some', 'such', 'than', 'that', 'their', 'theirs', 'them', 'then', 'there', 'therefore', 'these', 'they', 'this',
  'those', 'though', 'through', 'thus', 'till', 'under', 'unless', 'until', 'upon', 'very', 'what', 'whatever',
  'when', 'whenever', 'where', 'whether', 'which', 'while', 'whilst', 'whom', 'whose', 'will', 'with', 'within',
  'without', 'would', 'your', 'yours', 'risk', 'risks', 'happen', 'happens', 'happened', 'happening',
]);
const letters = (word: string): number => Array.from(word).length;
const contentWordsOf = (text: string): string[] => (text.toLowerCase().match(/[\p{L}]+/gu) ?? [])
  .filter((word) => letters(word) >= 4 && !FILLER_WORDS.has(word));
/** Same word, one an inflection of the other ("slip"/"slips"), or a shared stem of at least five letters. */
const sameStem = (a: string, b: string): boolean => {
  const [x, y] = [Array.from(a), Array.from(b)];
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared += 1;
  return shared === Math.min(x.length, y.length) || shared >= 5;
};

/**
 * A bounded sanity gate, not a causal inference: one content word of the risk label shares a stem with a content
 * word of the option, decision or STORED brief. User approval of the disclosed card is the safeguard.
 * Neither the current risk request nor the model's rationale can provide this contextual corroboration.
 */
export function chatRiskPreconditionMatches(riskLabel: string, optionLabel: string, decisionText: string, briefText: string): boolean {
  const context = contentWordsOf(`${optionLabel}\n${decisionText}\n${briefText}`);
  return contentWordsOf(riskLabel).some((word) => context.some((other) => sameStem(word, other)));
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
