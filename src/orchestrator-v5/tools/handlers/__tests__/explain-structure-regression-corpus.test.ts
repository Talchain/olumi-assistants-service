/**
 * Regression corpus for the three defects that landed with #1184.
 *
 * ⭐ WHY THIS FILE EXISTS SEPARATELY FROM THE THREE SUITES IT OVERLAPS.
 * Every label in `structural-pair-evidence.test.ts` (16 cases) and in the
 * structural half of `explanation-fallback.test.ts` is a MULTI-WORD,
 * non-generic phrase (`Pilot Scope and Commitment`, `Brand Sentiment`,
 * `Enterprise Integration Investment`, …). The resolver those suites exercise
 * has two rails keyed on exactly that property — `LEVER_LABEL_MIN_LEN` and
 * `GENERIC_LEVER_TOKENS` (phase3-blocks.ts) — so a corpus made only of
 * multi-word distinctive labels shares the code's blind spot and a green run
 * over it carries no information about single-word labels, plurals, or a
 * message naming two factors. That is why #1184's suites were green while all
 * three defects below were live.
 *
 * This corpus therefore deliberately uses SINGLE-WORD labels
 * (`Headcount`, `Attrition`, `Throughput`, `Latency`), one single-word
 * GENERIC label (`Cost`) that the rails must keep refusing, and plural
 * prose against a singular label.
 *
 * ⭐ TWO OPPOSITE HARMS, AND THEY DO NOT SHARE A WINDOW. Every case below is
 * written as a pair:
 *   · GAP  — refusing to say something true (the #1184 regressions);
 *   · LIE  — stating a strength, magnitude, confidence, ranking, absence, or
 *            the wrong factor that the turn does not license.
 * A fix that closes a GAP by opening a LIE is strictly worse than the
 * regression, so the LIE twins must pass BEFORE and AFTER.
 */

import { describe, expect, it } from 'vitest';

import type { ContextPackGraph } from '../../../context/context-pack-assembler.js';
import {
  buildStructureProjectionSummary,
  type StructureProjectionSummary,
} from '../../../context/projection-summaries.js';
import { buildStructuralPairEvidence } from '../../../routing/structural-pair-evidence.js';
import {
  composeExplainFromStructureFallback,
  composeStructuralPairEvidenceAnswer,
} from '../explanation-fallback.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function graph(
  nodes: readonly Record<string, unknown>[],
  edges: readonly Record<string, unknown>[],
): ContextPackGraph {
  const options = nodes.filter((node) => node.kind === 'option');
  const goals = nodes.filter((node) => node.kind === 'goal');
  return {
    nodes,
    edges,
    options,
    goals,
    constraints: [],
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      options: options.length,
      goals: goals.length,
      constraints: 0,
    },
  };
}

/**
 * Single-word, non-generic labels — the class every pre-existing suite omits.
 * `Cost` is single-word AND in `GENERIC_LEVER_TOKENS`: it must stay
 * unresolvable, and it is the contrast control proving the rails still hold.
 */
const SINGLE_WORD_GRAPH = graph(
  [
    { id: 'g1', kind: 'goal', label: 'Throughput' },
    { id: 'f1', kind: 'factor', label: 'Headcount' },
    { id: 'f2', kind: 'factor', label: 'Attrition' },
    { id: 'f3', kind: 'factor', label: 'Cost' },
  ],
  [
    { from: 'f1', to: 'g1', strength: 0.61 },
    { from: 'f2', to: 'g1', strength: -0.44 },
    { from: 'f3', to: 'g1', strength: 0.2 },
  ],
);

/** The exact two-factor graph from the measured regression report. */
const MEASURED_GRAPH = graph(
  [
    { id: 'g1', kind: 'goal', label: 'Q3 Throughput' },
    { id: 'f1', kind: 'factor', label: 'Engineering Capacity' },
    { id: 'f2', kind: 'factor', label: 'Hiring Cost' },
  ],
  [
    { from: 'f1', to: 'g1', strength: 0.65 },
    { from: 'f2', to: 'g1', strength: -0.42 },
    { from: 'f1', to: 'f2', strength: 0.3 },
  ],
);

/**
 * Anything that would state a quantity, a rank, or a total absence. A
 * non-strict turn may state PRESENCE and DIRECTION of a saved connector; it
 * may not state how strong it is, which is strongest, or that nothing else
 * exists.
 */
//
// ⚠ THIS PATTERN IS DELIBERATELY NOT `/\brank\b/`. The licensed prose REFUSES
// to rank ("I will not rank them"), so a token-level ban would red the very
// sentence that makes the refusal — a guard too wide to distinguish the claim
// from its denial. The bands below are the exact vocabulary
// `formatEdgeStrengthMagnitude` emits (`weak | moderate | strong | very
// strong`), plus the ranking and absence phrasings the strict branch owns.
const UNLICENSED_ON_A_NON_STRICT_TURN =
  /\bstrongest\b|\bvery strong\b|\bstrong\b|\bmoderate\b|\bweak\b|\bnegligible\b|most structural effect|secondary lever|contributes meaningfully|\bno causal links\b|\bno direct connector\b/i;

function expectNoUnlicensedQuantity(text: string): void {
  expect(text).not.toMatch(UNLICENSED_ON_A_NON_STRICT_TURN);
}

// ===========================================================================
// R1 — the generic structural explanation must keep its middle rung
// ===========================================================================

describe('R1 · non-strict relationship detail keeps structure, drops quantity', () => {
  it('GAP · projects directed links without strength when detail is non-strict (single-word labels)', () => {
    const summary = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'What shapes this decision?',
      relationshipDetailStatus: 'unavailable',
    });

    expect(summary.relationship_detail_status).toBe('unavailable');
    // Bind by identity: the exact endpoint labels, not "some link exists".
    expect(
      summary.top_causal_links.map((link) => `${link.label_from}->${link.label_to}`).sort(),
    ).toEqual(['Attrition->Throughput', 'Cost->Throughput', 'Headcount->Throughput']);
  });

  it('LIE TWIN · those projected links carry no strength and no interpretation', () => {
    const summary = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'What shapes this decision?',
      relationshipDetailStatus: 'unavailable',
    });

    for (const link of summary.top_causal_links) {
      expect('strength' in link).toBe(false);
      expect('plain_interpretation' in link).toBe(false);
      expect(link.edge_type).toBe('directed');
    }
  });

  it('LIE TWIN · a bidirected connector is still never projected as a causal link', () => {
    const bidirectedOnly = graph(
      [
        { id: 'f1', kind: 'factor', label: 'Latency' },
        { id: 'g1', kind: 'goal', label: 'Throughput' },
      ],
      [{ from: 'f1', to: 'g1', strength: 0.5, edge_type: 'bidirected' }],
    );
    const summary = buildStructureProjectionSummary(bidirectedOnly, {
      relationshipDetailStatus: 'unavailable',
    });
    expect(summary.top_causal_links).toEqual([]);
  });

  it('GAP · the generic prose names both endpoints instead of collapsing to one sentence', () => {
    const projection: StructureProjectionSummary = {
      relationship_detail_status: 'unavailable',
      goal_label: 'Throughput',
      top_causal_links: [
        { label_from: 'Headcount', label_to: 'Throughput', edge_type: 'directed' },
        { label_from: 'Attrition', label_to: 'Throughput', edge_type: 'directed' },
      ],
      named_factor_pathways: [],
      factor_count: 3,
      option_count: 2,
    };
    const text = composeExplainFromStructureFallback(projection);

    expect(text).toContain('Headcount');
    expect(text).toContain('Throughput');
    expect(text).toContain('Attrition');
    // The #1184 collapse: the whole answer became this one sentence.
    expect(text).not.toBe(
      'The available Living Model structure does not carry licensed relationship detail in this turn. ' +
        'I will not infer causal direction, sign, strength or a pathway from incomplete structural data.',
    );
  });

  it('LIE TWIN · that same prose states no magnitude, no ranking and no absence', () => {
    const projection: StructureProjectionSummary = {
      relationship_detail_status: 'unavailable',
      goal_label: 'Throughput',
      top_causal_links: [
        { label_from: 'Headcount', label_to: 'Throughput', edge_type: 'directed' },
        { label_from: 'Attrition', label_to: 'Throughput', edge_type: 'directed' },
      ],
      named_factor_pathways: [],
      factor_count: 3,
      option_count: 2,
    };
    const text = composeExplainFromStructureFallback(projection);

    expectNoUnlicensedQuantity(text);
    expect(text).toContain('unavailable in this turn');
  });

  it('LIE TWIN · a hand-built non-strict link carrying a stray strength still yields no magnitude', () => {
    // Defence in depth: the composer must be structurally unable to read
    // `strength` on the non-strict branch, so a drifting producer cannot
    // leak a quantity through it.
    const projection: StructureProjectionSummary = {
      relationship_detail_status: 'unavailable',
      goal_label: 'Throughput',
      top_causal_links: [
        {
          label_from: 'Headcount',
          label_to: 'Throughput',
          edge_type: 'directed',
          strength: 0.93,
        },
      ],
      named_factor_pathways: [],
      factor_count: 1,
      option_count: 1,
    };
    const text = composeExplainFromStructureFallback(projection);

    expectNoUnlicensedQuantity(text);
    expect(text).not.toContain('0.93');
  });

  it('LIE TWIN · with nothing directed to report the honest refusal is preserved', () => {
    const text = composeExplainFromStructureFallback({
      relationship_detail_status: 'unavailable',
      goal_label: 'Throughput',
      top_causal_links: [],
      named_factor_pathways: [],
      factor_count: 6,
      option_count: 2,
    });
    expect(text).toContain('does not carry licensed relationship detail');
    expectNoUnlicensedQuantity(text);
  });

  it('LIE TWIN · the strict branch still states its licensed magnitudes', () => {
    const text = composeExplainFromStructureFallback({
      relationship_detail_status: 'canonical_strict',
      goal_label: 'Throughput',
      top_causal_links: [
        {
          label_from: 'Headcount',
          label_to: 'Throughput',
          edge_type: 'directed',
          strength: 0.61,
        },
      ],
      named_factor_pathways: [],
      factor_count: 3,
      option_count: 2,
    });
    expect(text).toContain('strongest visible direct influence');
  });
});

// ===========================================================================
// R2 — "two phrases, two ids" is not "one phrase, two ids"
// ===========================================================================

describe('R2 · naming two factors is not an ambiguous reference', () => {
  it('GAP · the measured comparison question resolves to the first-mentioned factor', () => {
    const summary = buildStructureProjectionSummary(MEASURED_GRAPH, {
      messageText: 'How do Engineering Capacity and Hiring Cost compare?',
      relationshipDetailStatus: 'canonical_strict',
    });

    expect(summary.named_factor_ambiguous).toBeUndefined();
    expect(summary.named_factor_label).toBe('Engineering Capacity');
    expect(summary.named_factor_pathways.length).toBeGreaterThan(0);
  });

  it('GAP · the measured three-element question also resolves rather than refusing', () => {
    const summary = buildStructureProjectionSummary(MEASURED_GRAPH, {
      messageText:
        'Explain how Engineering Capacity drives Q3 Throughput given Hiring Cost.',
      relationshipDetailStatus: 'canonical_strict',
    });

    expect(summary.named_factor_ambiguous).toBeUndefined();
    expect(summary.named_factor_label).toBe('Engineering Capacity');
  });

  it('GAP · two single-word factors in one message resolve to the first-mentioned', () => {
    const summary = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'Compare Headcount and Attrition for me.',
      relationshipDetailStatus: 'canonical_strict',
    });

    expect(summary.named_factor_ambiguous).toBeUndefined();
    expect(summary.named_factor_label).toBe('Headcount');
  });

  it('DISCRIMINATION · the focus follows prose order, not graph order', () => {
    // Reversing only the sentence must move the focus. This is what binds the
    // choice to the user's wording rather than to the node list, and it is the
    // pair that a "just take nodes[0]" implementation would fail.
    const first = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'Compare Headcount and Attrition for me.',
      relationshipDetailStatus: 'canonical_strict',
    });
    const reversed = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'Compare Attrition and Headcount for me.',
      relationshipDetailStatus: 'canonical_strict',
    });

    expect(first.named_factor_label).toBe('Headcount');
    expect(reversed.named_factor_label).toBe('Attrition');
  });

  it('GAP · the prose for a two-factor question no longer refuses', () => {
    const summary = buildStructureProjectionSummary(MEASURED_GRAPH, {
      messageText: 'How do Engineering Capacity and Hiring Cost compare?',
      relationshipDetailStatus: 'canonical_strict',
    });
    const text = composeExplainFromStructureFallback(summary);

    expect(text).not.toContain('cannot establish one unique Living Model factor');
    expect(text).toContain('Engineering Capacity');
  });

  it('LIE TWIN · one phrase owned by two nodes is still refused', () => {
    const duplicateLabel = graph(
      [
        { id: 'f1', kind: 'factor', label: 'Headcount' },
        { id: 'f2', kind: 'factor', label: 'headcount' },
        { id: 'g1', kind: 'goal', label: 'Throughput' },
      ],
      [
        { from: 'f1', to: 'g1', strength: 0.7 },
        { from: 'f2', to: 'g1', strength: -0.7 },
      ],
    );
    const summary = buildStructureProjectionSummary(duplicateLabel, {
      messageText: 'How does Headcount affect Throughput?',
      relationshipDetailStatus: 'canonical_strict',
    });

    expect(summary.named_factor_ambiguous).toBe(true);
    expect(summary.named_factor_label).toBeUndefined();
    expect(summary.named_factor_pathways).toEqual([]);
  });

  it('LIE TWIN · a duplicate node id is still refused', () => {
    const duplicateId = graph(
      [
        { id: 'f1', kind: 'factor', label: 'Headcount' },
        { id: 'f1', kind: 'factor', label: 'Attrition' },
        { id: 'g1', kind: 'goal', label: 'Throughput' },
      ],
      [{ from: 'f1', to: 'g1', strength: 0.7 }],
    );
    const summary = buildStructureProjectionSummary(duplicateId, {
      messageText: 'How does Headcount affect Throughput?',
      relationshipDetailStatus: 'canonical_strict',
    });

    expect(summary.named_factor_ambiguous).toBe(true);
    expect(summary.named_factor_label).toBeUndefined();
  });

  it('LIE TWIN · a bare generic single-word label never resolves (contrast: Headcount does)', () => {
    // `Cost` is in GENERIC_LEVER_TOKENS; `Headcount` is not. Same graph, same
    // sweep — a contrast control, so a flat "did not resolve" cannot be the
    // instrument going blind.
    const generic = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'How does Cost affect this decision?',
      relationshipDetailStatus: 'canonical_strict',
    });
    const contrast = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'How does Headcount affect this decision?',
      relationshipDetailStatus: 'canonical_strict',
    });

    expect(generic.named_factor_label).toBeUndefined();
    expect(generic.named_factor_ambiguous).toBeUndefined();
    expect(contrast.named_factor_label).toBe('Headcount');
  });

  it('LIE TWIN · a plural in prose does not resolve a singular label', () => {
    const plural = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'How do Headcounts affect this decision?',
      relationshipDetailStatus: 'canonical_strict',
    });
    const contrast = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'How does Headcount affect this decision?',
      relationshipDetailStatus: 'canonical_strict',
    });

    expect(plural.named_factor_label).toBeUndefined();
    expect(contrast.named_factor_label).toBe('Headcount');
  });

  it('LIE TWIN · naming no factor still names no factor', () => {
    const summary = buildStructureProjectionSummary(SINGLE_WORD_GRAPH, {
      messageText: 'Give me a summary of the model.',
      relationshipDetailStatus: 'canonical_strict',
    });
    expect(summary.named_factor_label).toBeUndefined();
    expect(summary.named_factor_pathways).toEqual([]);
  });
});

// ===========================================================================
// R4 — the refusal must not promise a route that does not exist
// ===========================================================================

describe('R4 · refusal copy promises only what the guard can honour', () => {
  it('GAP · the two-element refusal does not offer selection', () => {
    // Driven through the real guard rather than a hand-built literal, on
    // single-word labels, so the copy is bound to a reachable state.
    const evidence = buildStructuralPairEvidence(SINGLE_WORD_GRAPH, {
      messageText: 'How do these two things relate?',
      structureQuery: { kind: 'direct_relationship', element_ids: ['f1', 'g1'] },
      graphContextStatus: 'canonical',
      graphAuthority: 'canonical_strict',
      graphWasTrimmed: false,
    });
    expect(evidence).toEqual({ status: 'ambiguous' });

    const text = composeStructuralPairEvidenceAnswer(evidence!);
    expect(text).not.toContain('or select');
    expect(text).toContain('Name the two elements more precisely');
  });

  it('LIE TWIN · that refusal still refuses', () => {
    const text = composeStructuralPairEvidenceAnswer({ status: 'ambiguous' });
    expect(text).toContain('cannot establish two unique Living Model elements');
    expect(text).not.toMatch(/\bdirect\b.*\bconnector\b/i);
  });

  it('GAP · the named-factor refusal does not offer selection either', () => {
    const duplicateLabel = graph(
      [
        { id: 'f1', kind: 'factor', label: 'Headcount' },
        { id: 'f2', kind: 'factor', label: 'headcount' },
        { id: 'g1', kind: 'goal', label: 'Throughput' },
      ],
      [
        { from: 'f1', to: 'g1', strength: 0.7 },
        { from: 'f2', to: 'g1', strength: -0.7 },
      ],
    );
    const summary = buildStructureProjectionSummary(duplicateLabel, {
      messageText: 'How does Headcount affect Throughput?',
      relationshipDetailStatus: 'canonical_strict',
    });
    const text = composeExplainFromStructureFallback(summary);

    expect(text).not.toContain('or select');
    expect(text).toContain('Name the intended factor more precisely');
  });

  it('LIE TWIN · that refusal still refuses', () => {
    const text = composeExplainFromStructureFallback({
      relationship_detail_status: 'canonical_strict',
      goal_label: 'Throughput',
      top_causal_links: [],
      named_factor_ambiguous: true,
      named_factor_pathways: [],
      factor_count: 2,
      option_count: 1,
    });
    expect(text).toContain('cannot establish one unique Living Model factor');
    expect(text).not.toContain('strongest visible direct influence');
  });

  it('CONTRAST CONTROL · no user-facing refusal in this module still says "or select"', () => {
    // Same-sweep contrast: `Name` must still appear (the sentences exist and
    // still invite the user to act), while `or select` must not.
    const refusals = [
      composeStructuralPairEvidenceAnswer({ status: 'ambiguous' }),
      composeExplainFromStructureFallback({
        relationship_detail_status: 'canonical_strict',
        goal_label: null,
        top_causal_links: [],
        named_factor_ambiguous: true,
        named_factor_pathways: [],
        factor_count: 0,
        option_count: 0,
      }),
    ];
    expect(refusals).toHaveLength(2);
    for (const text of refusals) {
      expect(text).not.toMatch(/\bor select\b/i);
      expect(text).toMatch(/\bName\b/);
    }
  });
});
