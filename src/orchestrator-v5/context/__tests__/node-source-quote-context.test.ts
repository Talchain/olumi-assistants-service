import { describe, expect, it } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import type { GraphV3Compact } from '../../../orchestrator/context/graph-compact.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import {
  SOURCE_QUOTES_INSTRUCTION,
  buildUserMessage,
} from '../../routing/route-with-tool-use.js';
import type { DisplaySafeNode } from '../../format/format-graph-for-context.js';
import {
  assembleContextPack,
  type ContextPack,
} from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';
import { compactSelectedGraphForContextPack } from '../compact-graph-for-contextpack.js';
import { selectContextGraphSnapshot } from '../context-graph-snapshot.js';
import {
  NodeSourceQuotePackingError,
  SOURCE_QUOTE_CANDIDATE_NODE_LIMIT,
  SOURCE_QUOTE_DISCLOSURE_UTF16_LIMIT,
  SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT,
  SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT,
  bindCanonicalNodeSourceEvidence,
} from '../node-source-quote-context.js';
import { CONTEXT_POLICY } from '../context-policy.js';

const MESSAGE = 'What does the current Living Model say?';
const PAYLOAD = {
  kind: 'message',
  source: 'composer',
  turn_id: '71111111-1111-4111-8111-111111111111',
  scenario_id: '72222222-2222-4222-8222-222222222222',
  message: MESSAGE,
  turn_class: 'review',
  stage: 'frame',
} satisfies MessageTurnPayload;

interface SourceNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly source_quote?: string;
  readonly label_authored?: boolean;
}

function graph(nodes: readonly SourceNode[]): GraphStateIngress {
  return { nodes: [...nodes], edges: [] } as GraphStateIngress;
}

function canonicalArtifacts(nodes: readonly SourceNode[]): {
  readonly compact: GraphV3Compact;
  readonly basePack: ContextPack;
} {
  const selected = selectContextGraphSnapshot({
    canonicalRead: { status: 'ok_present', graph: graph(nodes) },
    requestGraph: null,
  });
  expect(selected.status).toBe('canonical');
  const outcome = compactSelectedGraphForContextPack(selected, {
    requestId: 'req-node-source-evidence',
  });
  expect(outcome.kind).toBe('compacted');
  if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
  expect(outcome.via).toBe('strict_parse');
  const basePack = assembleContextPack({
    payload: PAYLOAD,
    priorTurns: [],
    graphContext: { status: 'canonical' },
    compactedGraph: outcome.compact,
  });
  return { compact: outcome.compact, basePack };
}

function bind(
  nodes: readonly SourceNode[],
  baseTransform: (pack: ContextPack) => ContextPack = (pack) => pack,
): { readonly compact: GraphV3Compact; readonly basePack: ContextPack; readonly pack: ContextPack } {
  const artifacts = canonicalArtifacts(nodes);
  const basePack = baseTransform(artifacts.basePack);
  return {
    compact: artifacts.compact,
    basePack,
    pack: bindCanonicalNodeSourceEvidence({
      basePack,
      compactedGraph: artifacts.compact,
      message: MESSAGE,
    }),
  };
}

function manualFeaturePack(
  basePack: ContextPack,
  quotes: readonly string[] | null,
  authorship: boolean,
): ContextPack {
  const nodes = basePack.display_graph.nodes.map((node, index): DisplaySafeNode => ({
    ...node,
    ...(quotes?.[index] !== undefined ? { source_quote: quotes[index] } : {}),
    ...(authorship ? { label_authored: true as const } : {}),
  }));
  return {
    ...basePack,
    display_graph: {
      ...basePack.display_graph,
      nodes,
      goals: nodes.filter((node) => node.kind === 'goal'),
    },
  };
}

function promptDelta(candidate: ContextPack, basePack: ContextPack): number {
  return (
    buildUserMessage(candidate, MESSAGE).length -
    buildUserMessage(basePack, MESSAGE).length
  );
}

function packFromPrompt(prompt: string): Record<string, unknown> {
  const prefix = '## ContextPack\n';
  expect(prompt.startsWith(prefix)).toBe(true);
  const end = prompt.indexOf('\n\n', prefix.length);
  expect(end).toBeGreaterThan(prefix.length);
  return JSON.parse(prompt.slice(prefix.length, end)) as Record<string, unknown>;
}

function allocateAsciiCodePoints(total: number, count: number): number[] {
  const out = Array.from({ length: count }, () => 1);
  let remaining = total - count;
  for (let index = 0; index < out.length && remaining > 0; index += 1) {
    const add = Math.min(SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT - 1, remaining);
    out[index] = (out[index] ?? 1) + add;
    remaining -= add;
  }
  expect(remaining).toBe(0);
  return out;
}

function withPackPadding(basePack: ContextPack, targetChars: number): ContextPack {
  const conversation = {
    recent_turns: [
      {
        turn_id: '73333333-3333-4333-8333-333333333333',
        turn_class: 'converse',
        handler_id: null,
        created_at: '2026-08-27T00:00:00.000Z',
        user_message: 'CONVERSATION-CANARY: retain this exact earlier reasoning.',
        assistant_message: 'CANARY-ANSWER: this remains in the prompt.',
      },
    ],
    turn_count: 1,
    last_tool_used: null,
    pending_confirmation: false,
  } as const;
  const empty = { ...basePack, conversation, older_relevant_facts: '' };
  const fixedChars = JSON.stringify(empty).length;
  expect(fixedChars).toBeLessThanOrEqual(targetChars);
  const padded = {
    ...empty,
    older_relevant_facts: 'p'.repeat(targetChars - fixedChars),
  };
  expect(JSON.stringify(padded).length).toBe(targetChars);
  return padded;
}

describe('canonical source wording final-egress policy', () => {
  it('retains 512 Unicode code points exactly and withholds 513 whole', () => {
    const retained = '🧠'.repeat(SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT);
    const withheld = '🌱'.repeat(SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT + 1);
    expect(Array.from(retained)).toHaveLength(512);
    expect(retained.length).toBe(1_024);

    const { pack } = bind([
      {
        id: 'retained',
        kind: 'factor',
        label: 'Retained',
        source_quote: retained,
      },
      {
        id: 'withheld',
        kind: 'factor',
        label: 'Withheld',
        source_quote: withheld,
        label_authored: true,
      },
    ]);

    expect(pack.display_graph.nodes[0]?.source_quote).toBe(retained);
    expect(pack.display_graph.nodes[1]).toMatchObject({ label_authored: true });
    expect(pack.display_graph.nodes[1]).not.toHaveProperty('source_quote');
    expect(buildUserMessage(pack, MESSAGE)).not.toContain(withheld);
    expect(pack.context_budget?.source_quotes).toMatchObject({
      candidate_count: 2,
      retained_count: 2,
      empty_quote_withheld_count: 0,
      per_quote_withheld_count: 1,
      node_limit_withheld_count: 0,
      aggregate_withheld_count: 0,
    });
  });

  it('withholds empty quotes, preserves escaped/astral/lone-surrogate bytes, and never infers authorship', () => {
    const exact = 'line\n\u0000"quoted"\\slash-🧠-\ud800';
    const { pack } = bind([
      { id: 'empty', kind: 'factor', label: 'Empty', source_quote: '' },
      { id: 'exact', kind: 'factor', label: 'Exact', source_quote: exact },
      {
        id: 'false',
        kind: 'factor',
        label: 'False',
        source_quote: 'recorded but not authorship proof',
        label_authored: false,
      },
    ]);
    expect(pack.display_graph.nodes[0]).not.toHaveProperty('source_quote');
    expect(pack.display_graph.nodes[1]?.source_quote).toBe(exact);
    expect(
      (JSON.parse(JSON.stringify(pack)) as ContextPack).display_graph.nodes[1]
        ?.source_quote,
    ).toBe(exact);
    const promptPack = packFromPrompt(buildUserMessage(pack, MESSAGE)) as {
      graph: { nodes: Array<{ source_quote?: string }> };
    };
    expect(promptPack.graph.nodes[1]?.source_quote).toBe(exact);
    expect(pack.display_graph.nodes[2]).not.toHaveProperty('label_authored');
    expect(pack.context_budget?.source_quotes?.empty_quote_withheld_count).toBe(1);
  });

  it('uses the final prompt boundary exactly: 4096 retains all, 4097 retains no quote prefix', () => {
    const count = 10;
    const bareNodes = Array.from({ length: count }, (_, index) => ({
      id: `factor-${index}`,
      kind: 'factor',
      label: `Factor ${index}`,
    }));
    const { basePack } = canonicalArtifacts(bareNodes);
    const unitQuotes = Array.from({ length: count }, () => 'x');
    const fixed = promptDelta(manualFeaturePack(basePack, unitQuotes, false), basePack) - count;
    const targetQuoteChars = SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT - fixed;
    expect(targetQuoteChars).toBeGreaterThanOrEqual(count);
    expect(targetQuoteChars).toBeLessThan(count * SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT);
    const lengths = allocateAsciiCodePoints(targetQuoteChars, count);
    const exactQuotes = lengths.map((length) => 'q'.repeat(length));
    const plusOneLengths = [...lengths];
    const incrementAt = plusOneLengths.findIndex(
      (length) => length < SOURCE_QUOTE_PER_NODE_CODE_POINT_LIMIT,
    );
    expect(incrementAt).toBeGreaterThanOrEqual(0);
    plusOneLengths[incrementAt] = (plusOneLengths[incrementAt] ?? 0) + 1;
    const plusOneQuotes = plusOneLengths.map((length) => 'q'.repeat(length));

    const exactNodes = bareNodes.map((node, index) => ({
      ...node,
      source_quote: exactQuotes[index]!,
    }));
    const exact = bind(exactNodes);
    expect(promptDelta(manualFeaturePack(exact.basePack, exactQuotes, false), exact.basePack)).toBe(
      SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT,
    );
    expect(promptDelta(exact.pack, exact.basePack)).toBe(
      SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT,
    );
    expect(exact.pack.display_graph.nodes.every((node) => node.source_quote !== undefined)).toBe(
      true,
    );
    expect(exact.pack.context_budget?.source_quotes).toBeUndefined();

    const plusOneNodes = bareNodes.map((node, index) => ({
      ...node,
      source_quote: plusOneQuotes[index]!,
    }));
    const over = bind(plusOneNodes);
    expect(promptDelta(manualFeaturePack(over.basePack, plusOneQuotes, false), over.basePack)).toBe(
      SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT + 1,
    );
    expect(over.pack.display_graph.nodes.every((node) => node.source_quote === undefined)).toBe(
      true,
    );
    expect(over.pack.context_budget?.source_quotes).toMatchObject({
      candidate_count: count,
      retained_count: 0,
      aggregate_withheld_count: count,
    });
    expect(promptDelta(over.pack, over.basePack)).toBeLessThanOrEqual(
      SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT,
    );
    expect(JSON.stringify(over.pack).length).toBeLessThanOrEqual(
      CONTEXT_POLICY.coach_converse.total_char_budget!,
    );
  });

  it('counts candidate nodes rather than graph nodes at the 50/51 wall', () => {
    const make = (candidateCount: number) => [
      ...Array.from({ length: candidateCount }, (_, index) => ({
        id: `candidate-${index}`,
        kind: 'factor',
        label: `Candidate ${index}`,
        label_authored: true,
      })),
      ...Array.from({ length: 60 - candidateCount }, (_, index) => ({
        id: `plain-${index}`,
        kind: 'factor',
        label: `Plain ${index}`,
      })),
    ];
    const atWall = bind(make(SOURCE_QUOTE_CANDIDATE_NODE_LIMIT));
    expect(
      atWall.pack.display_graph.nodes.filter((node) => node.label_authored === true),
    ).toHaveLength(50);

    const overWall = bind(make(SOURCE_QUOTE_CANDIDATE_NODE_LIMIT + 1));
    expect(overWall.pack.display_graph.nodes.some((node) => node.label_authored === true)).toBe(
      false,
    );
    expect(overWall.pack.context_budget?.source_quotes).toMatchObject({
      candidate_count: 51,
      retained_count: 0,
      empty_quote_withheld_count: 0,
      per_quote_withheld_count: 0,
      node_limit_withheld_count: 51,
      aggregate_withheld_count: 0,
    });
  });

  it('charges 50 goal authorship markers twice and refuses the whole set when final delta exceeds 4096', () => {
    const nodes = Array.from({ length: 50 }, (_, index) => ({
      id: `goal-${index}`,
      kind: 'goal',
      label: `Goal ${index}`,
      label_authored: true,
    }));
    const { basePack, pack } = bind(nodes);
    const manual = manualFeaturePack(basePack, null, true);
    const instructionDelta = SOURCE_QUOTES_INSTRUCTION.length + 2;
    expect(promptDelta(manual, basePack) - instructionDelta).toBe(3_200);
    expect(promptDelta(manual, basePack)).toBeGreaterThan(
      SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT,
    );
    expect(pack.display_graph.nodes.some((node) => node.label_authored === true)).toBe(false);
    expect(pack.context_budget?.source_quotes).toMatchObject({
      candidate_count: 50,
      retained_count: 0,
      aggregate_withheld_count: 50,
    });
  });

  it('charges repeated identical goal quotes at both serialised positions without deduplication', () => {
    const repeated = 'identical recorded wording';
    const nodes = Array.from({ length: 3 }, (_, index) => ({
      id: `goal-${index}`,
      kind: 'goal',
      label: `Goal ${index}`,
      source_quote: repeated,
    }));
    const { basePack, pack } = bind(nodes);
    const prompt = buildUserMessage(pack, MESSAGE);
    expect(pack.display_graph.nodes.every((node) => node.source_quote === repeated)).toBe(true);
    expect(pack.display_graph.goals.every((node) => node.source_quote === repeated)).toBe(true);
    expect(prompt.split(JSON.stringify(repeated)).length - 1).toBe(nodes.length * 2);
    expect(promptDelta(pack, basePack)).toBe(
      promptDelta(manualFeaturePack(basePack, nodes.map(() => repeated), false), basePack),
    );
  });

  it('falls back atomically to all authorship markers when the complete quote set is too large', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `factor-${index}`,
      kind: 'factor',
      label: `Factor ${index}`,
      source_quote: 'x'.repeat(400),
      label_authored: true,
    }));
    const { basePack, pack } = bind(nodes);
    expect(pack.display_graph.nodes.every((node) => node.source_quote === undefined)).toBe(true);
    expect(pack.display_graph.nodes.every((node) => node.label_authored === true)).toBe(true);
    expect(pack.context_budget?.source_quotes).toMatchObject({
      candidate_count: 12,
      retained_count: 12,
      aggregate_withheld_count: 12,
    });
    expect(promptDelta(pack, basePack)).toBeLessThanOrEqual(
      SOURCE_QUOTE_PROMPT_DELTA_UTF16_LIMIT,
    );
    expect(JSON.stringify(pack).length).toBeLessThanOrEqual(
      CONTEXT_POLICY.coach_converse.total_char_budget!,
    );
  });

  it('never selects a subset under aggregate pressure, regardless of order/id/kind/label', () => {
    const source = Array.from({ length: 12 }, (_, index) => ({
      id: `id-${index}`,
      kind: 'factor',
      label: `Label ${index}`,
      source_quote: 'x'.repeat(400),
    }));
    const variants = [
      source,
      [...source].reverse(),
      source.map((node, index) => ({
        ...node,
        id: `different-${11 - index}`,
        kind: index % 2 === 0 ? 'factor' : 'risk',
        label: `Different ${index}`,
      })),
    ];
    for (const variant of variants) {
      const { pack } = bind(variant);
      expect(pack.display_graph.nodes.some((node) => node.source_quote !== undefined)).toBe(
        false,
      );
      expect(pack.context_budget?.source_quotes?.aggregate_withheld_count).toBe(12);
    }
  });

  it('bounds 400×206 candidates and one 100k quote without leaking content', () => {
    const manyNodes = Array.from({ length: 400 }, (_, index) => ({
        id: `node-${index}`,
        kind: 'factor',
        label: `Node ${index}`,
        source_quote: `CANARY-${index}-` + 'x'.repeat(195),
      }));
    const many = canonicalArtifacts(manyNodes);
    // The pre-existing raw+display 400-node base itself exceeds the enforced
    // pack ceiling and cannot fit even the mandatory node-wall disclosure.
    // The corrected contract therefore terminates before a model call rather
    // than silently dropping the marker or evicting unrelated context.
    expect(JSON.stringify(many.basePack).length).toBeGreaterThan(55_000);
    expect(() =>
      bindCanonicalNodeSourceEvidence({
        basePack: many.basePack,
        compactedGraph: many.compact,
        message: MESSAGE,
      }),
    ).toThrow(NodeSourceQuotePackingError);

    const huge = 'HUGE-CANARY-'.repeat(8_334);
    const one = bind([
      { id: 'huge', kind: 'factor', label: 'Huge', source_quote: huge },
    ]);
    expect(one.pack.context_budget?.source_quotes?.per_quote_withheld_count).toBe(1);
    expect(buildUserMessage(one.pack, MESSAGE)).not.toContain('HUGE-CANARY');
  });

  it('uses a positional join so duplicate IDs cannot cross-license evidence', () => {
    const { pack } = bind([
      { id: 'duplicate', kind: 'factor', label: 'First', source_quote: 'FIRST' },
      { id: 'duplicate', kind: 'factor', label: 'Second', source_quote: 'SECOND' },
    ]);
    expect(pack.display_graph.nodes.map((node) => [node.label, node.source_quote])).toEqual([
      ['First', 'FIRST'],
      ['Second', 'SECOND'],
    ]);
  });

  it('does not let quote bytes displace conversation near the 55k pack ceiling', () => {
    const budget = CONTEXT_POLICY.coach_converse.total_char_budget;
    expect(budget).toBe(55_000);
    const nodes = [
      {
        id: 'factor',
        kind: 'factor',
        label: 'Factor',
        source_quote: '"'.repeat(512),
      },
    ];
    const artifacts = canonicalArtifacts(nodes);
    const basePack = withPackPadding(artifacts.basePack, budget! - 600);
    const full = manualFeaturePack(basePack, ['"'.repeat(512)], false);
    expect(JSON.stringify(basePack).length).toBeLessThanOrEqual(budget!);
    expect(JSON.stringify(full).length).toBeGreaterThan(budget!);

    const pack = bindCanonicalNodeSourceEvidence({
      basePack,
      compactedGraph: artifacts.compact,
      message: MESSAGE,
    });
    expect(pack.display_graph.nodes[0]).not.toHaveProperty('source_quote');
    expect(pack.context_budget?.source_quotes?.aggregate_withheld_count).toBe(1);
    expect(JSON.stringify(pack).length).toBeLessThanOrEqual(budget!);
    expect(pack.conversation).toBe(basePack.conversation);
    expect(JSON.stringify(pack.conversation)).toContain('CONVERSATION-CANARY');
  });

  it('fails terminally when even disclosure cannot fit the remaining pack headroom', () => {
    const budget = CONTEXT_POLICY.coach_converse.total_char_budget;
    expect(budget).toBe(55_000);
    const artifacts = canonicalArtifacts([
      { id: 'factor', kind: 'factor', label: 'Factor', source_quote: 'exact' },
    ]);
    const basePack = withPackPadding(artifacts.basePack, budget!);
    expect(() =>
      bindCanonicalNodeSourceEvidence({
        basePack,
        compactedGraph: artifacts.compact,
        message: MESSAGE,
      }),
    ).toThrow(NodeSourceQuotePackingError);
  });

  it('keeps disclosure compact and content-free', () => {
    const canary = 'PRIVATE-QUOTE-'.repeat(50);
    const { pack } = bind([
      { id: 'private-node-id', kind: 'factor', label: 'Private', source_quote: canary },
    ]);
    const marker = pack.context_budget?.source_quotes;
    expect(marker).toBeDefined();
    expect(JSON.stringify(marker).length).toBeLessThanOrEqual(
      SOURCE_QUOTE_DISCLOSURE_UTF16_LIMIT,
    );
    expect(JSON.stringify(marker)).not.toContain('PRIVATE');
    expect(JSON.stringify(marker)).not.toContain('private-node-id');
  });
});

describe('source wording disclosure schema', () => {
  it('accepts quote-only, legacy-only, both and neither disclosure shapes', () => {
    const { basePack, pack } = bind([
      { id: 'oversize', kind: 'factor', label: 'Oversize', source_quote: 'x'.repeat(513) },
    ]);
    const sourceQuotes = pack.context_budget?.source_quotes;
    expect(sourceQuotes).toBeDefined();
    const truncations = [
      { section: 'graph' as const, original_chars: 9_000, kept_chars: 7_500 },
    ];

    expect(ContextPackSchema.safeParse(basePack).success).toBe(true);
    expect(ContextPackSchema.safeParse(pack).success).toBe(true);
    expect(
      ContextPackSchema.safeParse({ ...basePack, context_budget: { truncations } }).success,
    ).toBe(true);
    expect(
      ContextPackSchema.safeParse({
        ...basePack,
        context_budget: { truncations, source_quotes: sourceQuotes },
      }).success,
    ).toBe(true);
  });

  it('rejects empty, zero-withheld, inconsistent node-wall and content-bearing markers', () => {
    const { basePack, pack } = bind([
      { id: 'oversize', kind: 'factor', label: 'Oversize', source_quote: 'x'.repeat(513) },
    ]);
    const valid = pack.context_budget?.source_quotes;
    expect(valid).toBeDefined();
    expect(
      ContextPackSchema.safeParse({ ...basePack, context_budget: {} }).success,
    ).toBe(false);
    expect(
      ContextPackSchema.safeParse({
        ...basePack,
        context_budget: {
          source_quotes: {
            ...valid,
            empty_quote_withheld_count: 0,
            per_quote_withheld_count: 0,
            node_limit_withheld_count: 0,
            aggregate_withheld_count: 0,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      ContextPackSchema.safeParse({
        ...basePack,
        context_budget: {
          source_quotes: {
            ...valid,
            candidate_count: 51,
            node_limit_withheld_count: 1,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      ContextPackSchema.safeParse({
        ...basePack,
        context_budget: {
          source_quotes: { ...valid, quote_text: 'must never be telemetry' },
        },
      }).success,
    ).toBe(false);
  });
});
