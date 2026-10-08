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
/** A shared four-letter stem between CONTENT words ("price"/"pricing", "slip"/"slips"); function words never count. */
const sameStem = (a: string, b: string): boolean => {
  const [x, y] = [Array.from(a), Array.from(b)];
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared += 1;
  return shared >= 4;
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

export interface ChatRiskPreconditionOffer {
  readonly option_id: string;
  readonly option_label: string;
}
export interface ChatRiskPreconditionTiming {
  readonly phrase: string;
  readonly source: 'brief' | 'decision';
}

type Rec = Record<string, unknown>;
const record = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Rec : undefined;
/** Keep every readable identity, including malformed siblings, so duplicate ids cannot acquire press authority. */
function offerGraphOf(raw: unknown): Graph {
  const graph = record(raw);
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.map(record).flatMap((node): Node[] =>
    node === undefined || typeof node.id !== 'string' ? [] : [{
      id: node.id, kind: typeof node.kind === 'string' ? node.kind : undefined,
      label: typeof node.label === 'string' ? node.label : '', is_baseline: node.is_baseline, data: node.data,
    }]) : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges.map(record).flatMap((edge): GraphEdgeLike[] =>
    edge === undefined || typeof edge.from !== 'string' || typeof edge.to !== 'string' ? [] : [{
      from: edge.from, to: edge.to, edge_type: edge.edge_type, origin: edge.origin,
    }]) : [];
  return { nodes, edges };
}

/** The same baseline screen on offer AND press: identity-bound, independent of factors, goals or comparison scope. */
export function chatRiskPreconditionOptionsFor(raw: unknown): ChatRiskPreconditionOffer[] {
  const graph = offerGraphOf(raw);
  const baseline = statusQuoOptionId(graph.nodes, graph.edges);
  const idCounts = new Map<string, number>();
  for (const node of graph.nodes) idCounts.set(node.id, (idCounts.get(node.id) ?? 0) + 1);
  return graph.nodes.filter((node) => node.kind === 'option' && node.id.trim() !== '' && node.label.trim() !== ''
    && idCounts.get(node.id) === 1 && readIsBaseline(node as BaselineFlagSurfaces) !== true && node.id !== baseline)
    .map((node) => ({ option_id: node.id, option_label: node.label }));
}

// Only the marker is searched globally. Each candidate reads at most SEVEN words: 1–6 pass, a seventh refuses it.
// Disjoint whitespace/token classes and a fixed read count keep long input linear; punctuation ends the clause.
const TIMING_START = /\b(?:with|at|after|alongside|once|when)[ \t]+(?:the[ \t]+)?(?:next|new|upcoming|coming)\b/giu;
const TIMING_WORD = /[ \t]+([^\s\p{P}]+)/uy;

/** Stored context only; a word elsewhere in the brief, a decision description or today's request never corroborates. */
export function chatRiskPreconditionTimingFor(riskLabel: string, raw: unknown, briefText?: string | null): ChatRiskPreconditionTiming | undefined {
  const riskWords = contentWordsOf(riskLabel);
  if (riskWords.length === 0) return undefined;
  const graph = offerGraphOf(raw);
  const sources = [
    { source: 'brief' as const, text: briefText ?? '' },
    ...graph.nodes.filter((node) => node.kind === 'decision').map((node) => ({ source: 'decision' as const, text: node.label })),
  ];
  for (const { source, text } of sources) {
    for (const start of text.matchAll(TIMING_START)) {
      let end = start.index + start[0].length;
      const words: string[] = [];
      for (let count = 0; count < 7; count += 1) {
        TIMING_WORD.lastIndex = end;
        const word = TIMING_WORD.exec(text);
        if (word === null) break;
        words.push(word[1]!);
        end = TIMING_WORD.lastIndex;
      }
      if (words.length === 0 || words.length > 6) continue;
      // Corroborate on the clause's content, never the generic timing marker ("upcoming", "alongside", etc.).
      const context = contentWordsOf(words.join(' '));
      if (riskWords.some((word) => context.some((other) => sameStem(word, other)))) {
        return { phrase: text.slice(start.index, end).replace(/[ \t]+/gu, ' '), source };
      }
    }
  }
  return undefined;
}

/** Detect ambiguity; offer ALL non-baseline identities, never infer which option depends on the timing clause. */
export function chatRiskPreconditionOffersFor(riskLabel: string, graph: unknown, briefText?: string | null): ChatRiskPreconditionOffer[] {
  return chatRiskPreconditionTimingFor(riskLabel, graph, briefText) === undefined ? [] : chatRiskPreconditionOptionsFor(graph);
}
