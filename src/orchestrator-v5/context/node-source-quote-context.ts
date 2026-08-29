/**
 * Final model-facing binding for canonical node source wording.
 *
 * Ordinary ContextPack assembly and every existing budget/compaction pass run
 * first. This module then admits one bounded, additive overlay onto the exact
 * finished feature-off pack. It never edits GraphV3Compact, ContextPack.graph,
 * conversation, analysis, or canonical state.
 */

import type { GraphV3Compact } from '../../orchestrator/context/graph-compact.js';
import type {
  DisplaySafeGraph,
  DisplaySafeNode,
} from '../format/format-graph-for-context.js';
import { buildUserMessage } from '../routing/route-with-tool-use.js';
import type { ContextPack } from './context-pack-assembler.js';
import {
  getCanonicalStrictNodeSourceEvidence,
  type CanonicalStrictNodeSourceEvidenceNode,
} from './compact-graph-for-contextpack.js';
import { CONTEXT_POLICY } from './context-policy.js';
import {
  SOURCE_QUOTE_CANDIDATE_NODE_LIMIT,
  SOURCE_QUOTE_DISCLOSURE_UTF16_LIMIT,
  SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT,
  SOURCE_QUOTE_POLICY,
  SOURCE_QUOTE_POLICY_VERSION,
  SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT,
  type SourceQuotesContextBudgetDisclosure,
} from './node-source-quote-contract.js';

export {
  SOURCE_QUOTE_CANDIDATE_NODE_LIMIT,
  SOURCE_QUOTE_DISCLOSURE_UTF16_LIMIT,
  SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT,
  SOURCE_QUOTE_POLICY,
  SOURCE_QUOTE_POLICY_VERSION,
  SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT,
};
export type { SourceQuotesContextBudgetDisclosure };

export class NodeSourceQuotePackingError extends Error {
  override readonly name = 'NodeSourceQuotePackingError';

  constructor() {
    super('Canonical node source evidence could not fit its bounded disclosure');
  }
}

export interface BindCanonicalNodeSourceEvidenceArgs {
  /** Finished, already ceiling-enforced pack with no source-evidence feature. */
  readonly basePack: ContextPack;
  /** Exact compact object returned by compactSelectedGraphForContextPack. */
  readonly compactedGraph: GraphV3Compact | null;
  /** Exact current message used by the eventual routing call. */
  readonly message: string;
}

type QuoteState = 'absent' | 'empty' | 'oversized' | 'eligible';

interface ClassifiedEvidence {
  readonly index: number;
  readonly id: string;
  readonly kind: string;
  readonly candidate: boolean;
  readonly quoteState: QuoteState;
  readonly quote?: string;
  readonly labelAuthored: boolean;
}

interface DisclosureCounts {
  readonly candidateCount: number;
  readonly retainedCount: number;
  readonly emptyQuoteWithheldCount: number;
  readonly perQuoteWithheldCount: number;
  readonly nodeLimitWithheldCount: number;
  readonly aggregateWithheldCount: number;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isCandidateEvidence(
  node: CanonicalStrictNodeSourceEvidenceNode,
): boolean {
  return (
    (hasOwn(node, 'source_quote') && typeof node.source_quote === 'string') ||
    node.label_authored === true
  );
}

function quoteExceedsCodePointLimit(value: string): boolean {
  // ECMAScript's string iterator combines valid surrogate pairs while leaving
  // lone surrogates as one code point. Stop at the first disqualifying unit:
  // persisted input is unbounded, so measuring a multi-MB quote in full would
  // be an avoidable allocation/latency denial. Retained strings are untouched.
  let codePoints = 0;
  for (const _codePoint of value) {
    codePoints += 1;
    if (codePoints > SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT) return true;
  }
  return false;
}

function classifyEvidence(
  evidence: readonly CanonicalStrictNodeSourceEvidenceNode[],
): readonly ClassifiedEvidence[] {
  return evidence.map((node, index) => {
    const ownsQuote = hasOwn(node, 'source_quote') && typeof node.source_quote === 'string';
    const quote = ownsQuote ? node.source_quote : undefined;
    const quoteState: QuoteState =
      quote === undefined
        ? 'absent'
        : quote.length === 0
          ? 'empty'
          : quoteExceedsCodePointLimit(quote)
            ? 'oversized'
            : 'eligible';
    const labelAuthored = node.label_authored === true;
    return {
      index,
      id: node.id,
      kind: node.kind,
      candidate: ownsQuote || labelAuthored,
      quoteState,
      ...(quoteState === 'eligible' ? { quote } : {}),
      labelAuthored,
    };
  });
}

function displayTopologyMatches(
  graph: DisplaySafeGraph,
  evidence: readonly CanonicalStrictNodeSourceEvidenceNode[],
  compact: GraphV3Compact,
): boolean {
  if (
    graph.nodes.length !== evidence.length ||
    graph.nodes.length !== compact.nodes.length
  ) return false;
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const node = graph.nodes[index];
    const source = evidence[index];
    const compactNode = compact.nodes[index];
    if (
      node === undefined ||
      source === undefined ||
      compactNode === undefined ||
      node.id !== source.id ||
      node.kind !== source.kind ||
      node.id !== compactNode.id ||
      node.kind !== compactNode.kind ||
      node.label !== compactNode.label ||
      hasOwn(node, 'source_quote') ||
      hasOwn(node, 'label_authored')
    ) {
      return false;
    }
  }

  // A feature-on graph derives goals from enriched nodes. Require the existing
  // feature-off goal index to be byte-equivalent first so the candidate is a
  // pure superset, not an unrelated goal-projection rewrite.
  const goalNodes = graph.nodes.filter((node) => node.kind === 'goal');
  return (
    goalNodes.length === graph.goals.length &&
    goalNodes.every(
      (node, index) => JSON.stringify(node) === JSON.stringify(graph.goals[index]),
    )
  );
}

function makeDisclosure(
  counts: DisclosureCounts,
): SourceQuotesContextBudgetDisclosure | undefined {
  const withheld =
    counts.emptyQuoteWithheldCount +
    counts.perQuoteWithheldCount +
    counts.nodeLimitWithheldCount +
    counts.aggregateWithheldCount;
  if (withheld === 0) return undefined;
  return {
    policy: SOURCE_QUOTE_POLICY,
    version: SOURCE_QUOTE_POLICY_VERSION,
    per_quote_code_point_limit: SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT,
    candidate_node_limit: SOURCE_QUOTE_CANDIDATE_NODE_LIMIT,
    prompt_delta_utf16_limit: SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT,
    candidate_count: counts.candidateCount,
    retained_count: counts.retainedCount,
    empty_quote_withheld_count: counts.emptyQuoteWithheldCount,
    per_quote_withheld_count: counts.perQuoteWithheldCount,
    node_limit_withheld_count: counts.nodeLimitWithheldCount,
    aggregate_withheld_count: counts.aggregateWithheldCount,
  };
}

function enrichDisplayGraph(
  base: DisplaySafeGraph,
  evidence: readonly ClassifiedEvidence[],
  includeQuotes: boolean,
  includeAuthorship: boolean,
): DisplaySafeGraph {
  let changed = false;
  const nodes = base.nodes.map((node, index): DisplaySafeNode => {
    const source = evidence[index];
    if (source === undefined) return node;
    const quote = includeQuotes && source.quoteState === 'eligible'
      ? source.quote
      : undefined;
    const authored = includeAuthorship && source.labelAuthored;
    if (quote === undefined && !authored) return node;
    changed = true;
    return {
      ...node,
      ...(quote !== undefined ? { source_quote: quote } : {}),
      ...(authored ? { label_authored: true as const } : {}),
    };
  });
  if (!changed) return base;
  return {
    ...base,
    nodes,
    // Same enriched objects, same order. No ID join and no second projection.
    goals: nodes.filter((node) => node.kind === 'goal'),
  };
}

function withFeature(
  basePack: ContextPack,
  displayGraph: DisplaySafeGraph,
  disclosure: SourceQuotesContextBudgetDisclosure | undefined,
): ContextPack {
  return {
    ...basePack,
    ...(displayGraph === basePack.display_graph ? {} : { display_graph: displayGraph }),
    ...(disclosure === undefined
      ? {}
      : {
          context_budget:
            basePack.context_budget === undefined
              ? { source_quotes: disclosure }
              : { ...basePack.context_budget, source_quotes: disclosure },
        }),
  };
}

function retainedNodeCount(
  evidence: readonly ClassifiedEvidence[],
  includeQuotes: boolean,
  includeAuthorship: boolean,
): number {
  return evidence.filter(
    (node) =>
      node.candidate &&
      ((includeQuotes && node.quoteState === 'eligible') ||
        (includeAuthorship && node.labelAuthored)),
  ).length;
}

function aggregateWithheldNodeCount(
  evidence: readonly ClassifiedEvidence[],
  withholdQuotes: boolean,
  withholdAuthorship: boolean,
): number {
  return evidence.filter(
    (node) =>
      node.candidate &&
      ((withholdQuotes && node.quoteState === 'eligible') ||
        (withholdAuthorship && node.labelAuthored)),
  ).length;
}

function candidateFits(args: {
  readonly candidate: ContextPack;
  readonly disclosure: SourceQuotesContextBudgetDisclosure | undefined;
  readonly basePromptChars: number;
  readonly message: string;
}): boolean {
  if (
    args.disclosure !== undefined &&
    JSON.stringify(args.disclosure).length > SOURCE_QUOTE_DISCLOSURE_UTF16_LIMIT
  ) {
    return false;
  }
  const packBudget = CONTEXT_POLICY.coach_converse.total_char_budget;
  if (packBudget === null || JSON.stringify(args.candidate).length > packBudget) {
    return false;
  }
  const delta =
    buildUserMessage(args.candidate, args.message).length - args.basePromptChars;
  return delta >= 0 && delta <= SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT;
}

/**
 * Bind exact producer evidence onto one finished feature-off pack.
 *
 * Unlicensed or mismatched inputs return the original reference. Once a
 * licensed candidate exists, failure to fit even its content-free disclosure
 * is terminal; silently erasing that loss would be a false prompt.
 */
export function bindCanonicalNodeSourceEvidence(
  args: BindCanonicalNodeSourceEvidenceArgs,
): ContextPack {
  const { basePack, compactedGraph, message } = args;
  if (
    basePack.graph_context?.status !== 'canonical' ||
    basePack.context_budget?.source_quotes !== undefined
  ) {
    return basePack;
  }
  const sourceEvidence = getCanonicalStrictNodeSourceEvidence(compactedGraph);
  if (
    sourceEvidence === undefined ||
    compactedGraph === null ||
    !displayTopologyMatches(
      basePack.display_graph,
      sourceEvidence.nodes,
      compactedGraph,
    )
  ) {
    return basePack;
  }

  const candidateCount = sourceEvidence.nodes.filter(isCandidateEvidence).length;
  if (candidateCount === 0) return basePack;

  // The exact feature-off prompt is rendered ONCE. Every attempted candidate
  // below is an additive projection of this same finished base pack.
  const basePromptChars = buildUserMessage(basePack, message).length;
  const common = { basePromptChars, message };

  if (candidateCount > SOURCE_QUOTE_CANDIDATE_NODE_LIMIT) {
    const marker = makeDisclosure({
      candidateCount,
      retainedCount: 0,
      emptyQuoteWithheldCount: 0,
      perQuoteWithheldCount: 0,
      nodeLimitWithheldCount: candidateCount,
      aggregateWithheldCount: 0,
    });
    const candidate = withFeature(basePack, basePack.display_graph, marker);
    if (candidateFits({ candidate, disclosure: marker, ...common })) return candidate;
    throw new NodeSourceQuotePackingError();
  }

  // Only graphs at or below the candidate wall inspect quote contents. Each
  // individual scan itself stops at code point 513.
  const evidence = classifyEvidence(sourceEvidence.nodes);
  const candidates = evidence.filter((node) => node.candidate);

  const emptyQuoteWithheldCount = candidates.filter(
    (node) => node.quoteState === 'empty',
  ).length;
  const perQuoteWithheldCount = candidates.filter(
    (node) => node.quoteState === 'oversized',
  ).length;

  const fullGraph = enrichDisplayGraph(basePack.display_graph, evidence, true, true);
  const fullMarker = makeDisclosure({
    candidateCount,
    retainedCount: retainedNodeCount(candidates, true, true),
    emptyQuoteWithheldCount,
    perQuoteWithheldCount,
    nodeLimitWithheldCount: 0,
    aggregateWithheldCount: 0,
  });
  const fullCandidate = withFeature(basePack, fullGraph, fullMarker);
  if (candidateFits({ candidate: fullCandidate, disclosure: fullMarker, ...common })) {
    return fullCandidate;
  }

  const authorshipGraph = enrichDisplayGraph(
    basePack.display_graph,
    evidence,
    false,
    true,
  );
  const authorshipMarker = makeDisclosure({
    candidateCount,
    retainedCount: retainedNodeCount(candidates, false, true),
    emptyQuoteWithheldCount,
    perQuoteWithheldCount,
    nodeLimitWithheldCount: 0,
    aggregateWithheldCount: aggregateWithheldNodeCount(candidates, true, false),
  });
  const authorshipCandidate = withFeature(
    basePack,
    authorshipGraph,
    authorshipMarker,
  );
  if (
    candidateFits({
      candidate: authorshipCandidate,
      disclosure: authorshipMarker,
      ...common,
    })
  ) {
    return authorshipCandidate;
  }

  const disclosureOnly = makeDisclosure({
    candidateCount,
    retainedCount: 0,
    emptyQuoteWithheldCount,
    perQuoteWithheldCount,
    nodeLimitWithheldCount: 0,
    aggregateWithheldCount: aggregateWithheldNodeCount(candidates, true, true),
  });
  const disclosureCandidate = withFeature(
    basePack,
    basePack.display_graph,
    disclosureOnly,
  );
  if (
    candidateFits({
      candidate: disclosureCandidate,
      disclosure: disclosureOnly,
      ...common,
    })
  ) {
    return disclosureCandidate;
  }
  throw new NodeSourceQuotePackingError();
}
