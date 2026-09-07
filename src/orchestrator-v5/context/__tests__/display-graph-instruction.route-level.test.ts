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
  FACTOR_VALUES_INSTRUCTION,
} from '../../routing/route-with-tool-use.js';
import {
  FORGEABLE_USER_AUTHORSHIP_LITERALS,
  valueSourceAuthorship,
} from '../../../cee/transforms/provenance-display.js';
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
  /**
   * The compactor's LINK-authorship projection — the SECOND of the three
   * authorship objects, and the one that keeps the key name `provenance` on the
   * display node. It answers *"who asserted this link?"*, not *"whose number is
   * this?"*, and the composition block at the end of this file puts it on the
   * same request as the other two.
   */
  readonly provenance?: string;
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

/**
 * The `factor_values` slice, shaped as `ContextPackFactorValuesSchema` requires.
 * `buildUserMessage` appends `FACTOR_VALUES_INSTRUCTION` on exactly the
 * condition `contextPack.factor_values !== undefined`, so passing one here is
 * what puts BOTH code-owned instruction blocks in a single rendered request.
 */
interface FactorValuesSlice {
  readonly factors: ReadonlyArray<{
    readonly label: string;
    readonly has_value: boolean;
    readonly provenance: 'user_stated' | 'ai_drafted' | 'system_repaired' | 'unattributed';
  }>;
  readonly without_value_count: number;
}

function packWithGraph(
  rawGraph: ContextPackGraph,
  factorValues?: FactorValuesSlice,
): ContextPack {
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
    ...(factorValues === undefined ? {} : { factor_values: factorValues }),
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

function render(
  rawGraph: ContextPackGraph,
  factorValues?: FactorValuesSlice,
): {
  readonly prompt: string;
  readonly pack: Record<string, unknown>;
  readonly graph: {
    readonly nodes: ReadonlyArray<Record<string, unknown>>;
    readonly edges: ReadonlyArray<Record<string, unknown>>;
    readonly options: ReadonlyArray<Record<string, unknown>>;
  };
} {
  const prompt = buildUserMessage(
    packWithGraph(rawGraph, factorValues),
    'Explain the structure of the saved model.',
  );
  const serialised = observeSerialisedPack(prompt);
  return {
    prompt,
    pack: serialised,
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
      '`value_authorship: user_set` on a node marks that node’s value as one that is already SET in this projection',
    );
    expect(prompt).toContain(
      'never describe that value as your estimate, your assumption, your inference or a placeholder',
    );
  });

  it('⭐ the licence is PURELY NEGATIVE — it forbids, and claims nothing about who supplied the number', () => {
    const { prompt } = render(graphWith([], STAMPED_NODES));

    // `user_set` covers `panel_elicited` (a colleague's verified answer), the
    // five UNVERIFIED literals, AND the forgeable stamp a MODEL-AUTHORED
    // `update_node` write receives. No positive authorship claim is true on all
    // of those arms, so the block must make none.
    expect(prompt).toContain(
      'never say the value was supplied, entered, typed, confirmed or approved by the user, by a colleague or by anyone',
    );
    expect(prompt).toContain('never attribute it to a named individual');
    // The one clause that has ALREADY regressed once inside this PR, pinned by
    // its exact negative form. The enumeration below is the general guard; this
    // is the specific sentence that got through, and it is cheap to name.
    expect(prompt).toContain('never say it was supplied rather than estimated');
    // Absence is not a claim (the shared contract's own instruction on this axis).
    expect(prompt).toContain(
      'Its ABSENCE is not the opposite claim',
    );
  });

  /**
   * ⭐⭐ "PURELY" IS ENUMERATED HERE, NOT ASSERTED ABOVE.
   *
   * ⚠ THE DEFECT THIS CLOSES, MEASURED BY AN INDEPENDENT REVIEW AT THIS PR'S
   * OWN HEAD. The guard above is three `toContain` assertions on three
   * prohibition sentences: it asserts the PRESENCE of negatives and the ABSENCE
   * of nothing. A reviewer reinstated the withdrawn positive licence
   * — `you may say it was supplied rather than estimated` — into the shipped
   * array, between two of the very sentences asserted above, verified it landed
   * in the assembled constant at runtime (`contains POSITIVE: true /
   * NEGATIVE: false`), and **125 tests across 8 spec files stayed GREEN**. A
   * genuine survivor: applied-check 1 file, trailing control 63/63.
   *
   * A test whose NAME asserts a property its BODY does not test is the
   * honest-label defect (CLAUDE.md trap 14) — and it is the same defect class
   * this PR exists to close, one level up. Trap 11 is binding: never merge a fix
   * until reverting it turns something RED.
   *
   * ── WHY ENUMERATION RATHER THAN ONE MORE BANNED SENTENCE ──────────────
   * Asserting `toContain('never say it was supplied rather than estimated')`
   * would have RED'd that exact mutant and nothing else: a guard that bans one
   * sentence is defeated by rephrasing it. This guard instead DERIVES the set of
   * occurrences from the licence bytes and requires each one to sit under a
   * negation, so a newly worded positive licence REDs too.
   *
   * ── WHAT IT COVERS, AND WHAT IT DOES NOT ─────────────────────────
   * COVERS (all four measured RED against this guard): the reviewer's verbatim
   * clause; a rephrasing that keeps the authorship vocabulary; a rephrasing that
   * drops that vocabulary but keeps a permission modal; and a BARE IMPERATIVE
   * rephrasing that drops both (`report that this figure came from the people
   * using the model...`) — caught because the trigger vocabulary includes
   * SPEECH-ACT VERBS, not only authorship words.
   * DOES NOT COVER: a positive licence phrased with neither an authorship word,
   * nor a speech-act verb, nor a permission modal. That is a natural-language
   * predicate, and CLAUDE.md trap 22f is explicit that chasing it with one more
   * rule oscillates. The residual gap is stated here rather than hidden.
   *
   * ── ⚠ HOW TO MUTATION-CHECK THIS GUARD (it is not the obvious way) ────
   * REPLACING the negative clause — which is what the review's own mutant did
   * — REDs on the NON-VACUITY precondition below before the enumeration ever
   * runs, because that precondition names the replaced sentence. That is a real
   * RED and it blocks, but it does not exercise the enumeration.
   * To exercise the enumeration, INSERT a positive clause as an additional
   * array element and leave every prohibition intact. Measured this way:
   *   insert a positive licence on a `value_authorship` line  -> enumeration REDs
   *   insert a bare-imperative positive, no authorship words   -> enumeration REDs
   *   insert an authorship word on a NON-licence line          -> scope pin REDs
   *   insert a permission modal anywhere in the block          -> permission REDs
   *   insert a correctly NEGATED new prohibition               -> stays GREEN
   * The last one is the other half of the pair: it proves the guard binds to a
   * POSITIVE LICENCE specifically, not to change in the block generally.
   *
   * ── THE TWO UNNEGATED CLAUSES ARE PINNED AS AN EXACT SET ─────────────
   * Neither is a positive authorship claim — one DEFERS ("you would have to
   * check"), the other COMMANDS SILENCE ("Say nothing about where such a value
   * came from"), and both negate AFTER their verb rather than before it. They
   * are allowlisted BY EXACT STRING and asserted as a SET, so the suite REDs if
   * that set grows OR shrinks (trap 22f's known-gap pattern) rather than
   * carrying a window that quietly widens.
   */
  it('⭐⭐ the licence is purely negative BY ENUMERATION — every authorship and speech-act occurrence sits under a negation', () => {
    const { prompt } = render(graphWith([], STAMPED_NODES));

    // PRECONDITION 1 — the block really is in the rendered prompt, so this is a
    // claim about prompt BYTES and not about an unemitted constant.
    expect(
      prompt.indexOf(DISPLAY_GRAPH_INSTRUCTION),
      'the display-graph instruction is not in the rendered prompt',
    ).toBeGreaterThanOrEqual(0);

    const blockLines = DISPLAY_GRAPH_INSTRUCTION.split('\n');
    const licenceLines = blockLines.filter((line) => line.includes('value_authorship'));
    expect(licenceLines.length, 'no `value_authorship` licence clause found').toBeGreaterThan(0);

    // PRECONDITION 2 — SCOPE PIN. Every authorship-word occurrence in the WHOLE
    // instruction block sits on a licence line, so selecting the licence by
    // `value_authorship` cannot hide a positive claim in a sibling bullet. If a
    // future clause puts one elsewhere in the block, this REDs rather than
    // silently narrowing what gets checked.
    const AUTHORSHIP_WORD_SOURCE =
      '\\b(?:suppl\\w*|estimat\\w*|entered|typed|confirmed|approved)\\b';
    const countAuthorshipWords = (lines: readonly string[]): number =>
      lines.reduce(
        (total, line) =>
          total + (line.match(new RegExp(AUTHORSHIP_WORD_SOURCE, 'gi')) ?? []).length,
        0,
      );
    expect(
      countAuthorshipWords(licenceLines),
      'an authorship word sits outside the `value_authorship` licence clauses',
    ).toBe(countAuthorshipWords(blockLines));

    // The trigger vocabulary is DELIBERATELY WIDER than `supplied`/`estimated`:
    // the speech-act verbs are what catch a bare-imperative rephrasing that uses
    // none of the authorship words.
    const TRIGGER_SOURCE =
      '\\b(?:suppl\\w*|estimat\\w*|entered|typed|confirmed|approved' +
      '|say|says|saying|tell|telling|describe|describing|report|reporting' +
      '|state|stating|attribute|attributing|offer|offering)\\b';
    // The negator must govern the occurrence, i.e. stand BEFORE it in the same
    // clause. "anywhere in the clause" is too weak: it passes
    // `...was supplied by a person and not estimated by you`, which is a
    // positive licence carrying a negation of something else.
    const NEGATOR = /\b(?:never|not|no|none|nothing|nor|cannot|without)\b/i;
    const CLAUSE_SPLIT = /(?<=[.;:])\s+|\s+—\s+/;

    const unnegated: string[] = [];
    let occurrences = 0;
    for (const line of licenceLines) {
      for (const rawClause of line.split(CLAUSE_SPLIT)) {
        const clause = rawClause.trim();
        const scanner = new RegExp(TRIGGER_SOURCE, 'gi');
        let hit = scanner.exec(clause);
        while (hit !== null) {
          occurrences += 1;
          if (!NEGATOR.test(clause.slice(0, hit.index))) {
            unnegated.push(clause);
          }
          hit = scanner.exec(clause);
        }
      }
    }

    // PRECONDITION 3 — NON-VACUITY. An enumeration that matched nothing would
    // pass every assertion below while testing nothing at all (trap 13).
    expect(occurrences, 'the enumeration matched nothing — a vacuous pass').toBeGreaterThan(0);
    expect(
      licenceLines.join('\n'),
      'the enumeration did not scan the clause that has already regressed once',
    ).toContain('never say it was supplied rather than estimated');

    // THE ASSERTION THE NAME PROMISES: the only unnegated clauses in the licence
    // are these two, EXACTLY. Grows or shrinks -> RED.
    const DEFERS_TO_A_CHECK =
      'If who supplied a number matters, say you would have to check and offer to.';
    const COMMANDS_SILENCE =
      'Say nothing about where such a value came from rather than filling the gap.';
    expect(
      [...new Set(unnegated)].sort(),
      'an unnegated authorship or speech-act clause entered the licence',
    ).toEqual([DEFERS_TO_A_CHECK, COMMANDS_SILENCE].sort());

    // SECOND CONJUNCT — nothing in this block may GRANT. Scoped to the WHOLE
    // instruction block, not just the licence lines: a positive clause that
    // avoids the authorship vocabulary AND is placed in a bullet that never
    // names `value_authorship` would otherwise fall outside every check above.
    // Measured at this tip: zero permission phrasings across all block lines.
    const PERMISSION =
      /\byou may\b|\byou can\b|\byou are (?:entitled|free|allowed|permitted)\b|\bit is safe to\b|\bfeel free\b/i;
    expect(
      blockLines.filter((line) => PERMISSION.test(line)),
      'the instruction grants a permission — this block may only constrain',
    ).toEqual([]);
  });

  it('⭐ the collision is named apart, not reconciled — and the sibling authority is NOT revoked', () => {
    const { prompt } = render(graphWith([], STAMPED_NODES));

    expect(prompt).toContain(
      'This field is deliberately named apart from every other authorship field in this request because they are about DIFFERENT OBJECTS',
    );
    // Each sibling is named BY ITS OBJECT and keeps its own rule. The first
    // draft instead told the model a `provenance` field elsewhere "grants
    // nothing about who supplied a value", which nullifies
    // `FACTOR_VALUES_INSTRUCTION` in the same request — see the composition
    // block at the end of this file.
    expect(prompt).toContain(
      '`factor_values[].provenance` is about a FACTOR’s recorded authorship and keeps its own rule, given with that block',
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

/**
 * ⭐⭐⭐ THE COMPOSITION WITNESS — ALL THREE AUTHORSHIP OBJECTS AND BOTH
 * CODE-OWNED INSTRUCTION BLOCKS IN ONE ADAPTER-BOUND REQUEST.
 *
 * ── THE DEFECT THIS CLOSES, AND WHY NO EXISTING TEST COULD SEE IT ─────────
 * The first draft of the `value_authorship` clauses told the model that this
 * field is *"the ONLY field that licenses saying a number was supplied rather
 * than estimated"* and that a `provenance` field anywhere else *"grants nothing
 * about who supplied a value"*. `FACTOR_VALUES_INSTRUCTION` — still live, and
 * appended by `buildUserMessage` on the SAME request whenever the pack carries
 * a `factor_values` slice — says the opposite in as many words: `provenance`
 * *"says who authored the value that is there"*, *"Report it as where the value
 * came from"*.
 *
 * That is not a hypothetical composition. On an ordinary canonical factor turn
 * both slices are projected from the same persisted graph and both blocks are
 * appended to the same message. Naming a field apart is right; NULLIFYING a
 * sibling field's established authority is not naming apart — it hands the
 * model two deterministic instructions with incompatible answers (CLAUDE.md
 * trap 21: *write down the question each authority answers*, then name them
 * apart; do not align or revoke).
 *
 * ⚠⚠ AND NO TEST IN THIS REPO COULD OBSERVE IT. Every existing witness renders
 * ONE object at a time: this file's other blocks build a pack with no
 * `factor_values` slice; `request-authorship.test.ts` assembles a pack with a
 * `compactedGraph` and no `factorValues`; `factor-values-instruction.route-
 * level.test.ts` drives the executor with factor values and no stamped node.
 * Each is green and each is silent about the pair. A conflict that lives in the
 * COMPOSITION is invisible to a suite that only ever renders the parts.
 *
 * ── WHAT THIS BLOCK ASSERTS, AND ON WHAT ─────────────────────────────────
 * The serialised pack BYTES (not the constants) for all three objects, both
 * instruction blocks present exactly once in the rendered prompt, and a pinned
 * WITHDRAWN-CLAUSE corpus asserted ABSENT with a retained-clause contrast
 * control non-zero in the same sweep — because an absence assertion with no
 * positive control is vacuous (CLAUDE.md trap 13).
 */
describe('three authorship objects, two instruction blocks, ONE request', () => {
  const AUTHORED = 'factor_demand';
  const UNSTAMPED = 'factor_cost';

  /** Node authorship — *whose NUMBER is this?* */
  const STAMPED_NODES: readonly RawNode[] = NODES.map((node) =>
    node.id === AUTHORED ? { ...node, provenance: 'user_set' } : node,
  );

  /** Link authorship — *who asserted this LINK?* Same vocabulary, other question. */
  const EDGES: readonly RawEdge[] = [
    { from: AUTHORED, to: 'goal_growth', strength: 0.65, provenance: 'user_set' },
  ];

  /** Factor authorship — *is this factor's value attributable to a person at all?* */
  const FACTOR_VALUES: FactorValuesSlice = {
    factors: [
      { label: 'Customer demand', has_value: true, provenance: 'user_stated' },
      { label: 'Delivery cost', has_value: false, provenance: 'ai_drafted' },
    ],
    without_value_count: 1,
  };

  function renderComposed() {
    return render(graphWith(EDGES, STAMPED_NODES), FACTOR_VALUES);
  }

  it('⭐ the request really carries all three objects at once — asserted on the serialised bytes', () => {
    const { graph, pack } = renderComposed();

    // OBJECT 1 — the node's number. Bound BY ID, never by a value predicate
    // (trap 19): `factor_cost` is otherwise interchangeable with it.
    const authored = graph.nodes.find((n) => n.id === AUTHORED);
    expect(authored, 'fixture node missing from the projection').toBeDefined();
    expect(authored!['value_authorship']).toBe('user_set');

    // OBJECT 2 — the link. Still called `provenance`, deliberately.
    const edge = graph.edges.find((e) => e.from === AUTHORED && e.to === 'goal_growth');
    expect(edge, 'fixture edge missing from the projection').toBeDefined();
    expect(edge!['provenance']).toBe('user_set');

    // OBJECT 3 — the factor slice, with its own four-member vocabulary.
    const factorValues = pack['factor_values'] as
      | { readonly factors: ReadonlyArray<Record<string, unknown>> }
      | undefined;
    expect(factorValues, '`factor_values` did not reach the serialised pack').toBeDefined();
    expect(factorValues!.factors.map((f) => f['provenance'])).toEqual([
      'user_stated',
      'ai_drafted',
    ]);

    // CONTRAST CONTROL on the same objects: the unstamped node carries neither
    // key, so the three positives above are real reads and not a blind probe.
    const unstamped = graph.nodes.find((n) => n.id === UNSTAMPED);
    expect(unstamped, 'fixture node missing from the projection').toBeDefined();
    expect(unstamped!['value_authorship']).toBeUndefined();
    expect(unstamped!['provenance']).toBeUndefined();
  });

  it('⭐ BOTH code-owned instruction blocks ride that same request, each exactly once', () => {
    const { prompt } = renderComposed();

    expect(prompt.split(DISPLAY_GRAPH_INSTRUCTION)).toHaveLength(2);
    expect(prompt.split(FACTOR_VALUES_INSTRUCTION)).toHaveLength(2);
  });

  /**
   * ⭐⭐ THE LOAD-BEARING ASSERTION. The two blocks must not contradict each
   * other in the bytes the adapter receives.
   *
   * WITHDRAWN corpus asserted absent + RETAINED corpus asserted present, in the
   * SAME sweep. A bare `not.toContain` sweep proves nothing about an instrument
   * that may simply be looking at an empty string (trap 13); the retained half
   * is the positive control that proves this probe can see the prose at all.
   */
  it('⭐ neither block revokes the other — withdrawn clauses absent, sibling authority intact', () => {
    const { prompt } = renderComposed();

    const WITHDRAWN: readonly string[] = [
      // The positive supply claim, false on the model-authored `update_node` arm.
      'supplied to the model by the people using it, not drafted or estimated by you',
      'Say the value was supplied rather than estimated, and offer to check who if it matters',
      // The revocation of the sibling field's authority.
      'is the ONLY field that licenses saying a number was supplied rather than estimated',
      'grants nothing about who supplied a value',
    ];
    for (const clause of WITHDRAWN) {
      expect(
        prompt.includes(clause),
        `the request still carries a WITHDRAWN clause: "${clause}"`,
      ).toBe(false);
    }

    const RETAINED: readonly string[] = [
      // The node licence survives — as a prohibition.
      'never describe that value as your estimate, your assumption, your inference or a placeholder',
      'never say the value was supplied, entered, typed, confirmed or approved by the user, by a colleague or by anyone',
      // `FACTOR_VALUES_INSTRUCTION`'s own authority survives, unrevoked.
      '`provenance` says who authored the value that is there',
      'Report it as where the value came from',
      // ...including its own weakening, which was already correct.
      'never say the user entered, confirmed or approved a particular figure on the strength of this field alone',
    ];
    expect(RETAINED.length, 'the positive control is empty — the sweep proves nothing').toBeGreaterThan(0);
    for (const clause of RETAINED) {
      expect(
        prompt.includes(clause),
        `the request has LOST a retained clause: "${clause}"`,
      ).toBe(true);
    }
  });

  /**
   * ⭐⭐ THE FORGED/UNVERIFIED COUNTERPART, AND THE REASON THE LICENCE HAD TO
   * BE NARROWED.
   *
   * `user_set` is reachable through a stamp the estate pins as FORGEABLE — a
   * MODEL-AUTHORED `update_node` write receives the identical literal to a
   * genuine user edit. This test proves the consequence for the prompt: the two
   * arms produce a BYTE-IDENTICAL node in the request, so nothing downstream
   * can tell them apart, so every sentence in the licence must be true of the
   * model-authored one.
   *
   * DERIVED FROM THE EXPORTED GAP SET, never restated (trap 12): the literals
   * are not spelled here, so a stamp split moves this test rather than leaving
   * it asserting a string nothing writes.
   */
  it('⭐ the forgeable arm is INDISTINGUISHABLE in the request — which is why no positive claim is licensed', () => {
    const forgeable = [...FORGEABLE_USER_AUTHORSHIP_LITERALS];
    expect(forgeable.length, 'the forgeable gap set is empty — this test is vacuous').toBeGreaterThan(0);

    for (const literal of forgeable) {
      // The compactor projection a model-authored write ends up with.
      const projected = valueSourceAuthorship(literal)?.provenance;
      expect(projected, `${literal} is pinned as forgeable but projects to nothing`).toBe('user_set');

      const forgedNodes: readonly RawNode[] = NODES.map((node) =>
        node.id === AUTHORED ? { ...node, provenance: projected } : node,
      );
      const forged = render(graphWith(EDGES, forgedNodes), FACTOR_VALUES);
      const genuine = renderComposed();

      // Byte-identical requests. The licence cannot discriminate what the
      // projection does not carry.
      expect(forged.prompt).toBe(genuine.prompt);
    }

    // CONTRAST CONTROL (trap 13e): the sweep discriminates. A literal OUTSIDE
    // the `user_set` family must NOT reach the model on this key at all, so the
    // byte-equality above is a real finding rather than a probe that agrees
    // with everything.
    //
    // ⚠ THE KEY-LEVEL ASSERTION IS THE LOAD-BEARING HALF, AND IT WAS ADDED
    // AFTER A SURVIVING MUTANT SAID SO. Widening `asNodeAuthorship` to carry
    // ANY string left this whole file GREEN when the control only checked that
    // the two prompts DIFFERED — they still differ, because the mutant carries
    // `ai_inferred` through instead of dropping it. A control that cannot tell
    // "dropped" from "carried under a different value" is not controlling the
    // narrowing. (The estate does catch it, in `request-authorship.test.ts`;
    // this block should not have needed to borrow that.)
    const aiNodes: readonly RawNode[] = NODES.map((node) =>
      node.id === AUTHORED ? { ...node, provenance: 'ai_inferred' } : node,
    );
    const ai = render(graphWith(EDGES, aiNodes), FACTOR_VALUES);
    const aiNode = ai.graph.nodes.find((n) => n.id === AUTHORED);
    expect(aiNode, 'fixture node missing from the projection').toBeDefined();
    expect(
      aiNode!['value_authorship'],
      'the compactor’s ai_inferred DEFAULT reached the model on the authorship key — ' +
        'that is the same false-authorship claim this change closes, with the roles swapped',
    ).toBeUndefined();
    expect(ai.prompt).not.toBe(renderComposed().prompt);
  });
});
