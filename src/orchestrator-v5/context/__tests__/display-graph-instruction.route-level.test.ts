/**
 * System B B6 — display_graph structural-grounding contract.
 *
 * The display formatter owns safe projection; the code-owned instruction owns
 * how the routing model may interpret that projection. These tests exercise
 * both halves in the exact prompt bytes without adding a second topology or
 * scientific authority.
 */

import { describe, expect, it } from 'vitest';

import type {
  ContextPack,
  ContextPackGraph,
} from '../context-pack-assembler.js';
import { compactGraphForContextPack } from '../compact-graph-for-contextpack.js';
import { formatGraphForContext } from '../../format/format-graph-for-context.js';
import {
  buildUserMessage,
  DISPLAY_GRAPH_INSTRUCTION,
} from '../../routing/route-with-tool-use.js';
import { observeSerialisedPack } from './observe-serialised-pack.js';

interface RawNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly is_baseline?: boolean;
  readonly reaches?: readonly string[];
  /**
   * The COMPACTOR's authorship projection (`from_brief | ai_inferred |
   * user_set`) — the input side, still called `provenance` because that is what
   * `compactGraph` emits. Only `user_set` survives the display projection, and
   * it survives under the DIFFERENT key `value_authorship`. That rename is the
   * subject of the final describe block in this file.
   */
  readonly provenance?: string;
}

interface RawEdge {
  readonly from?: string;
  readonly to?: string;
  readonly strength?: number;
  readonly edge_type?: string;
}

const NODES: readonly RawNode[] = [
  { id: 'factor_demand', kind: 'factor', label: 'Customer demand' },
  { id: 'factor_cost', kind: 'factor', label: 'Delivery cost' },
  { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
  {
    id: 'option_current',
    kind: 'option',
    label: 'Continue current approach',
    is_baseline: true,
  },
];

function graphWith(
  edges: readonly RawEdge[],
  nodes: readonly RawNode[] = NODES,
): ContextPackGraph {
  return {
    nodes,
    edges,
    options: nodes
      .filter((node) => node.kind === 'option')
      .map((node) => ({
        id: node.id,
        label: node.label,
        // The duplicate display index is deliberately contradictory. Baseline
        // authority lives only on the option node and the formatter strips this.
        is_baseline: false,
      })),
    goals: nodes.filter((node) => node.kind === 'goal'),
    constraints: [],
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      options: nodes.filter((node) => node.kind === 'option').length,
      goals: nodes.filter((node) => node.kind === 'goal').length,
      constraints: 0,
    },
  } as unknown as ContextPackGraph;
}

function packWithGraph(rawGraph: ContextPackGraph): ContextPack {
  return {
    version: '2.0',
    scenario_id: 'scenario-display-graph-sanction',
    stage: 'reason',
    graph_context: { status: 'canonical' },
    graph: rawGraph,
    analysis: null,
    analysis_state: null,
    display_analysis: null,
    display_graph: formatGraphForContext(rawGraph),
    conversation: {
      recent_turns: [],
      turn_count: 0,
      last_tool_used: null,
      pending_confirmation: false,
    },
    recent_changes: [],
    recent_changes_status: 'complete',
    coaching: {
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    },
    compound_detected: false,
    compound_pattern_matched: null,
    parsed_quantities: [],
    system_event: null,
  } as ContextPack;
}

function render(rawGraph: ContextPackGraph): {
  readonly prompt: string;
  readonly graph: {
    readonly nodes: ReadonlyArray<Record<string, unknown>>;
    readonly edges: ReadonlyArray<Record<string, unknown>>;
    readonly options: ReadonlyArray<Record<string, unknown>>;
  };
} {
  const prompt = buildUserMessage(
    packWithGraph(rawGraph),
    'Explain the structure of the saved model.',
  );
  const serialised = observeSerialisedPack(prompt);
  return {
    prompt,
    graph: serialised.graph as {
      readonly nodes: ReadonlyArray<Record<string, unknown>>;
      readonly edges: ReadonlyArray<Record<string, unknown>>;
      readonly options: ReadonlyArray<Record<string, unknown>>;
    },
  };
}

describe('display_graph structural grounding — exact prompt bytes', () => {
  it('emits the complete structural instruction exactly once when the projected graph exists', () => {
    const { prompt } = render(graphWith([]));

    expect(prompt.split(DISPLAY_GRAPH_INSTRUCTION)).toHaveLength(2);
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      'A direct relationship is usable only when it is explicitly listed in `graph.edges`',
    );
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      'An unlisted, malformed or dangling direct relationship is unknown or withheld',
    );
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      'Preserve that direction and any explicitly positive or negative `relationship` phrase exactly',
    );
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      '`negligible link` and `negligible co-movement` do not license a near-zero magnitude or sign',
    );
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      '`edge_type: bidirected` describes non-causal co-movement or an unmeasured common cause',
    );
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      'The sole additional multi-hop authority is `reaches` on an option node',
    );
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      'A listed target label must match exactly one node label; zero or multiple matches make that reachability claim ambiguous and unknown',
    );
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      'An absent or malformed list makes reachability unknown, and no other prose may fill it',
    );
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      'Node array order, labels, descriptions, conversation and other prose do not create topology',
    );
    expect(DISPLAY_GRAPH_INSTRUCTION).toContain(
      'The marker never identifies a winner, recommendation, preference or analysis result',
    );
  });

  it('keeps an empty edge list empty and forbids unlisted topology', () => {
    const { graph, prompt } = render(graphWith([]));

    expect(graph.nodes).toHaveLength(NODES.length);
    expect(graph.edges).toEqual([]);
    expect(prompt).toContain(
      'An unlisted, malformed or dangling direct relationship is unknown or withheld',
    );
  });

  it('preserves producer-derived multi-hop reachability without minting a direct edge or sign', () => {
    const nodes: readonly RawNode[] = [
      {
        id: 'option_current',
        kind: 'option',
        label: 'Continue current approach',
        reaches: ['goal_growth'],
      },
      { id: 'factor_demand', kind: 'factor', label: 'Customer demand' },
      { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    ];
    const { graph, prompt } = render(
      graphWith(
        [
          { from: 'option_current', to: 'factor_demand', strength: 0.65 },
          { from: 'factor_demand', to: 'goal_growth', strength: -0.4 },
        ],
        nodes,
      ),
    );

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: 'option_current',
        reaches: ['Sustainable growth'],
      }),
    );
    expect(graph.edges).not.toContainEqual(
      expect.objectContaining({ from: 'option_current', to: 'goal_growth' }),
    );
    expect(prompt).toContain(
      'it does not identify a direct edge, intermediate path, sign, strength, confidence or analysis consequence',
    );
    expect(prompt).toContain('never treat a bidirected edge as contributing to `reaches`');
  });

  it('does not license an unlisted multi-hop target even when edge order invites composition', () => {
    const nodes: readonly RawNode[] = [
      {
        id: 'option_current',
        kind: 'option',
        label: 'Continue current approach',
        reaches: ['factor_demand'],
      },
      { id: 'factor_demand', kind: 'factor', label: 'Customer demand' },
      { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    ];
    const { graph, prompt } = render(
      graphWith(
        [
          { from: 'option_current', to: 'factor_demand', strength: 0.65 },
          { from: 'factor_demand', to: 'goal_growth', strength: 0.65 },
        ],
        nodes,
      ),
    );

    const option = graph.nodes.find((node) => node.id === 'option_current');
    expect(option?.reaches).toEqual(['Customer demand']);
    expect(option?.reaches).not.toContain('Sustainable growth');
    expect(prompt).toContain('Do not compose a path from edges yourself');
  });

  it('preserves directed positive and negative relationship phrases with endpoint identities', () => {
    const { graph, prompt } = render(
      graphWith([
        { from: 'factor_demand', to: 'goal_growth', strength: 0.65 },
        { from: 'factor_cost', to: 'goal_growth', strength: -0.4 },
      ]),
    );

    expect(graph.edges).toEqual([
      {
        from: 'factor_demand',
        to: 'goal_growth',
        from_label: 'Customer demand',
        to_label: 'Sustainable growth',
        relationship: 'moderate positive link',
      },
      {
        from: 'factor_cost',
        to: 'goal_growth',
        from_label: 'Delivery cost',
        to_label: 'Sustainable growth',
        relationship: 'moderate negative link',
      },
    ]);
    expect(prompt).not.toContain('"strength"');
    expect(prompt).toContain('An edge with no `edge_type` is directed from `from` to `to`');
  });

  it.each([
    ['directed', undefined, 'negligible link'],
    [
      'bidirected',
      'bidirected',
      'negligible co-movement, unmeasured common cause (not a causal route)',
    ],
  ] as const)(
    'fails weak on the real structural-fallback %s zero phrase instead of claiming smallness',
    (_case, edgeType, expectedRelationship) => {
      const outcome = compactGraphForContextPack(
        {
          nodes: [
            { id: 'factor_demand', kind: 'factor', label: 'Customer demand' },
            { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
          ],
          edges: [
            {
              from: 'factor_demand',
              to: 'goal_growth',
              ...(edgeType === undefined ? {} : { edge_type: edgeType }),
            },
          ],
        } as never,
        { requestId: `req-display-graph-${_case}-fallback` },
      );
      expect(outcome.kind).toBe('compacted');
      if (outcome.kind !== 'compacted') throw new Error('expected compacted fallback');
      expect(outcome.via).toBe('structural_fallback');

      const { graph, prompt } = render(
        graphWith(outcome.compact.edges, outcome.compact.nodes),
      );
      expect(graph.edges[0]?.relationship).toBe(expectedRelationship);
      expect(prompt).toContain(
        'this prompt does not distinguish a strict coefficient from a structural-fallback default',
      );
      expect(prompt).toContain(
        'Describe strength as unavailable rather than small',
      );
    },
  );

  it('preserves bidirected type while forbidding a causal direction', () => {
    const { graph, prompt } = render(
      graphWith([
        {
          from: 'factor_demand',
          to: 'factor_cost',
          strength: -0.5,
          edge_type: 'bidirected',
        },
      ]),
    );

    expect(graph.edges).toEqual([
      {
        from: 'factor_demand',
        to: 'factor_cost',
        from_label: 'Customer demand',
        to_label: 'Delivery cost',
        relationship:
          'moderate negative co-movement, unmeasured common cause (not a causal route)',
        edge_type: 'bidirected',
      },
    ]);
    expect(prompt).toContain('It is not a causal route: never invent a direction');
  });

  it('makes a dangling endpoint visibly fail the exact identity precondition', () => {
    const { graph, prompt } = render(
      graphWith([
        { from: 'factor_demand', to: 'missing_goal', strength: 0.7 },
        { to: 'goal_growth', strength: 0.7 },
      ]),
    );

    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges).toEqual([
      {
        from: 'factor_demand',
        to: 'missing_goal',
        from_label: 'Customer demand',
        to_label: 'missing_goal',
        relationship: 'strong positive link',
      },
    ]);
    expect(nodeIds.has(String(graph.edges[0]!.from))).toBe(true);
    expect(nodeIds.has(String(graph.edges[0]!.to))).toBe(false);
    expect(prompt).toContain(
      'its exact `from` and `to` identities are both present in `graph.nodes`',
    );
    // Missing `from` is malformed and is withheld by the display formatter.
    expect(graph.edges).toHaveLength(1);
  });

  it('marks duplicate node identities as ambiguous instead of joining by order or label', () => {
    const duplicatedNodes: readonly RawNode[] = [
      { id: 'factor_demand', kind: 'factor', label: 'First demand label' },
      { id: 'factor_demand', kind: 'factor', label: 'Conflicting demand label' },
      { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    ];
    const { graph, prompt } = render(
      graphWith(
        [{ from: 'factor_demand', to: 'goal_growth', strength: 0.65 }],
        duplicatedNodes,
      ),
    );

    expect(graph.nodes.filter((node) => node.id === 'factor_demand')).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(prompt).toContain(
      'If an id appears on more than one node, every edge or `reaches` join involving that id is ambiguous and unknown',
    );
    expect(prompt).toContain('node order or the last matching label must never resolve it');
  });

  it('marks label-based reachability ambiguous when the target label is not unique', () => {
    const duplicateLabelNodes: readonly RawNode[] = [
      {
        id: 'option_current',
        kind: 'option',
        label: 'Continue current approach',
        reaches: ['goal_growth_primary'],
      },
      { id: 'goal_growth_primary', kind: 'goal', label: 'Sustainable growth' },
      { id: 'goal_growth_secondary', kind: 'goal', label: 'Sustainable growth' },
    ];
    const { graph, prompt } = render(graphWith([], duplicateLabelNodes));

    expect(graph.nodes.filter((node) => node.label === 'Sustainable growth')).toHaveLength(2);
    expect(graph.nodes.find((node) => node.id === 'option_current')?.reaches).toEqual([
      'Sustainable growth',
    ]);
    expect(prompt).toContain(
      'A listed target label must match exactly one node label; zero or multiple matches make that reachability claim ambiguous and unknown',
    );
    expect(prompt).toContain(
      'node order, kind or identifiers must not select a target',
    );
  });

  it('marks conflicting repeated edge signs unknown instead of choosing by array order', () => {
    const { graph, prompt } = render(
      graphWith([
        { from: 'factor_demand', to: 'goal_growth', strength: 0.65 },
        { from: 'factor_demand', to: 'goal_growth', strength: -0.65 },
      ]),
    );

    expect(graph.edges.map((edge) => edge.relationship)).toEqual([
      'moderate positive link',
      'moderate negative link',
    ]);
    expect(prompt).toContain(
      'the relationship and its sign are conflicting and unknown',
    );
    expect(prompt).toContain('Never choose one by array order');
  });

  it('carries baseline identity only on the option node and never licences a recommendation', () => {
    const { graph, prompt } = render(graphWith([]));

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: 'option_current',
        kind: 'option',
        is_baseline: true,
      }),
    );
    expect(graph.options).toEqual([
      { id: 'option_current', label: 'Continue current approach' },
    ]);
    expect(prompt).toContain(
      'Only `graph_context.status: canonical` licenses describing the single marked option as the saved baseline',
    );
    expect(prompt).toContain(
      'The marker never identifies a winner, recommendation, preference or analysis result',
    );
  });

  it('makes multiple producer baseline markers conflicting instead of selecting by order', () => {
    const conflictingBaselineNodes: readonly RawNode[] = [
      {
        id: 'option_current',
        kind: 'option',
        label: 'Continue current approach',
        is_baseline: true,
      },
      {
        id: 'option_alternative',
        kind: 'option',
        label: 'Alternative approach',
        is_baseline: true,
      },
    ];
    const { graph, prompt } = render(graphWith([], conflictingBaselineNodes));

    expect(graph.nodes.filter((node) => node.is_baseline === true)).toHaveLength(2);
    expect(prompt).toContain(
      'multiple markers are conflicting and make the baseline unknown',
    );
    expect(prompt).toContain(
      'Never select one by array order, label, kind or conversation',
    );
  });

  it('does not emit a structural licence when a legacy/direct pack has no display graph', () => {
    const pack = packWithGraph(graphWith([]));
    const withoutDisplayGraph = {
      ...pack,
      display_graph: undefined,
    } as unknown as ContextPack;

    const prompt = buildUserMessage(withoutDisplayGraph, 'What is connected?');
    const serialised = observeSerialisedPack(prompt);
    expect(serialised.graph).toBeUndefined();
    expect(prompt).not.toContain(DISPLAY_GRAPH_INSTRUCTION);
  });
});

/**
 * ⭐⭐ THE FIELD AND ITS LICENCE, PINNED TOGETHER SO THEY CANNOT DRIFT APART.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────
 * An independent review of this PR's first two commits measured, at the
 * adapter boundary, that node authorship reached the model with NO LICENSING
 * TEXT while every sibling fact in `DISPLAY_GRAPH_INSTRUCTION` (`reaches`,
 * `is_baseline`, `edge_type`, `relationship`) had one — and that the SAME
 * request carried `FACTOR_VALUES_INSTRUCTION`, whose only rule about a field
 * called `provenance` says *"never say the user entered, confirmed or approved
 * a particular figure on the strength of this field alone"*. A third field of
 * that name would have arrived unlicensed AND name-colliding with a rule
 * pointing the other way.
 *
 * ── WHY THIS FILE, AND WHY BOTH HALVES IN ONE ASSERTION ───────────────────
 * The estate's prompt↔pack sanction gate CANNOT catch this class here, and the
 * reason is worth recording because it is not the one first proposed. Its
 * `proseLeaves` >= 4-word threshold is real, but it is NOT what makes the gate
 * blind: `findUnsanctionedFields` iterates `Object.keys(serialised)` — the
 * TOP-LEVEL pack keys — and `graph` is prose-bearing and IS named in the
 * corpus, so the gate is green whatever leaf keys `graph` gains. Lowering the
 * word threshold would not change that verdict by one field. The right-sized
 * instrument is this one: bind the leaf to the sentence that licenses it, in
 * the real serialised prompt bytes, so deleting either half REDs.
 */
describe('node value_authorship — the field and the sentence that licenses it', () => {
  const AUTHORED = 'factor_demand';
  const UNSTAMPED = 'factor_cost';

  /**
   * Bound BY IDENTITY, never by a value predicate (CLAUDE.md trap 19): the two
   * factors are otherwise interchangeable, and every assertion resolves its
   * node by id.
   */
  const STAMPED_NODES: readonly RawNode[] = NODES.map((node) =>
    node.id === AUTHORED ? { ...node, provenance: 'user_set' } : node,
  );

  it('⭐ the licence names the exact key the request carries — neither half can move alone', () => {
    const { graph, prompt } = render(graphWith([], STAMPED_NODES));

    const authored = graph.nodes.find((n) => n.id === AUTHORED);
    expect(authored, 'fixture node missing from the projection').toBeDefined();

    // HALF ONE: the request really carries the field, under this exact key.
    expect(authored!['value_authorship']).toBe('user_set');

    // HALF TWO: the prompt really licenses that exact key. `toContain` on the
    // rendered PROMPT, not on the constant, so a block that stops being emitted
    // REDs here too.
    expect(prompt).toContain(
      '`value_authorship: user_set` on a node is the only fact in this block about WHERE A NUMBER CAME FROM',
    );
    expect(prompt).toContain(
      'never describe that value as your estimate, your assumption, your inference or a placeholder',
    );
  });

  it('⭐ the licence is WEAK in both the directions it has to be', () => {
    const { prompt } = render(graphWith([], STAMPED_NODES));

    // `user_set` also covers `panel_elicited` — a colleague's verified answer —
    // and `user_override`, which this repo pins as forgeable. Neither licenses
    // "you typed this", so the block must forbid it explicitly.
    expect(prompt).toContain(
      'Never say the user entered, typed, confirmed or approved a particular number on the strength of this field',
    );
    // Absence is not a claim (the shared contract's own instruction on this axis).
    expect(prompt).toContain(
      'Its ABSENCE is not the opposite claim',
    );
  });

  it('⭐ the collision is named apart, not reconciled', () => {
    const { prompt } = render(graphWith([], STAMPED_NODES));

    expect(prompt).toContain(
      'This field is deliberately named apart from every other authorship field in this request',
    );
    expect(prompt).toContain(
      'A `provenance` field anywhere else — on a `graph.edges` entry, or under `factor_values` — is a different fact about a different object',
    );
  });

  it('contrast control: the unstamped twin carries no authorship key at all', () => {
    const { graph } = render(graphWith([], STAMPED_NODES));

    const unstamped = graph.nodes.find((n) => n.id === UNSTAMPED);
    expect(unstamped, 'fixture node missing from the projection').toBeDefined();
    expect(unstamped!['value_authorship']).toBeUndefined();
    // ...and the compactor's other members never reach the model under EITHER
    // key, so the sweep above is not merely finding a renamed default.
    expect(unstamped!['provenance']).toBeUndefined();
  });

  it('contrast control: the old key is gone from the node projection', () => {
    const { graph } = render(graphWith([], STAMPED_NODES));

    const authored = graph.nodes.find((n) => n.id === AUTHORED);
    expect(authored!['provenance']).toBeUndefined();
    // Positive control on the same object — the fixture DID reach the
    // projection with content, so the absence above is a real absence and not a
    // blind probe.
    expect(authored!['label']).toBe('Customer demand');
  });
});
