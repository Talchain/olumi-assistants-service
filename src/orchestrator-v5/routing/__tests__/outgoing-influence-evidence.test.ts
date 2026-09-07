/**
 * ⭐⭐⭐ THE OUTGOING-INFLUENCE CARRIER, AND ITS OPPOSITE-DIRECTION TWIN ON EVERY
 * ASSERTION.
 *
 * "Why does X matter?" / "why is X important?" / "what does X drive?" asks about
 * OUTGOING influence. The V5 `dependencies` carrier answers INCOMING connectors
 * only, and its incoming-only reading is load-bearing (#1229: it is what makes an
 * invented option-to-factor dependency unrepresentable). Answering the incoming
 * question is therefore a TRUTHFUL ANSWER TO A DIFFERENT QUESTION — and that
 * inversion is the defect this whole lane exists to avoid, not to encode.
 *
 * ⚠⚠ NO TEST IN THIS FILE MAY ENCODE A DIRECTION INVERSION AS CORRECT. Every
 * positive control below asserts BOTH halves — the answer names the REQUESTED
 * SUBJECT *and* answers the REQUESTED PREDICATE — because a control that checks
 * only "a label appears" or "the answer is long" passes on a fluent answer to the
 * wrong question. That is measured, not asserted: PR #1310's mutant M1 emitted
 * *"Fit with target investor thesis and deal size has the strongest visible
 * direct influence…"*, which contains the subject label and is long, and two
 * reviewers approved a fix that did not work.
 *
 * The graph below is deliberately asymmetric — `focus` has ONE incoming
 * neighbour and ONE DIFFERENT outgoing neighbour — so every direction claim has
 * a discriminating witness: the wrong direction names the wrong label, always.
 */
import { describe, expect, it } from 'vitest';

import type { ContextPackGraph } from '../../context/context-pack-assembler.js';
import {
  buildSelectedDependenciesEvidence,
  buildSelectedOutgoingInfluenceEvidence,
} from '../structural-pair-evidence.js';
import {
  composeSelectedDependenciesEvidenceAnswer,
  composeSelectedOutgoingInfluenceEvidenceAnswer,
} from '../../tools/handlers/explanation-fallback.js';
import { StructureQuerySchema } from '../types.js';

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

const FOCUS = 'Investor thesis fit';
const UPSTREAM = 'Demonstrated revenue traction';
const DOWNSTREAM = 'Probability of closing the round';
const UNRELATED = 'Months of runway remaining';

const NODES: readonly Record<string, unknown>[] = [
  { id: 'focus', kind: 'factor', label: FOCUS },
  { id: 'upstream', kind: 'factor', label: UPSTREAM },
  { id: 'downstream', kind: 'outcome', label: DOWNSTREAM },
  { id: 'unrelated', kind: 'factor', label: UNRELATED },
  { id: 'goal', kind: 'goal', label: 'Close a Series A on acceptable terms' },
];

/**
 * ⭐ THE DISCRIMINATING SHAPE. `focus` has exactly one incoming neighbour and one
 * outgoing neighbour, and they are DIFFERENT elements. An answer that reads the
 * wrong direction therefore names a label the right answer never contains, so
 * every direction assertion below has a witness that could actually fail.
 */
const EDGES: readonly Record<string, unknown>[] = [
  { from: 'upstream', to: 'focus', strength: 0.5 },
  { from: 'focus', to: 'downstream', strength: 0.7 },
  { from: 'unrelated', to: 'goal', strength: 0.4 },
];

const GRAPH = graph(NODES, EDGES);
/** `focus` as a ROOT: outgoing only, no incoming at all. */
const ROOT_GRAPH = graph(NODES, EDGES.filter((edge) => edge.to !== 'focus'));
/** `focus` as a LEAF: incoming only, nothing driven. */
const LEAF_GRAPH = graph(NODES, EDGES.filter((edge) => edge.from !== 'focus'));

const SELECTION_WARRANT = {
  requestedSelection: { node_ids: ['focus'], edge_ids: [] },
  focus: {
    elements: [{
      id: 'focus', kind: 'factor' as const, label: FOCUS,
      analysis_link: 'no_analysis' as const,
    }],
    unresolved: 'none' as const,
    requested_count: 1,
    unresolved_count: 0,
  },
  groundedSelection: { element_ids: ['focus'], unresolved: 'none' as const },
  proposalEntity: { id: 'focus', label: FOCUS, resolution_status: 'resolved' },
  graphContextStatus: 'canonical' as const,
  graphAuthority: 'canonical_strict' as const,
  graphWasTrimmed: false,
};

function outgoing(
  overrides: Record<string, unknown> = {},
  currentGraph: ContextPackGraph = GRAPH,
) {
  return buildSelectedOutgoingInfluenceEvidence(currentGraph, {
    ...SELECTION_WARRANT,
    structureQuery: { kind: 'outgoing_influence', element_id: 'focus' },
    ...overrides,
  } as Parameters<typeof buildSelectedOutgoingInfluenceEvidence>[1]);
}

function incoming(
  overrides: Record<string, unknown> = {},
  currentGraph: ContextPackGraph = GRAPH,
) {
  return buildSelectedDependenciesEvidence(currentGraph, {
    ...SELECTION_WARRANT,
    structureQuery: { kind: 'dependencies', element_id: 'focus' },
    ...overrides,
  } as Parameters<typeof buildSelectedDependenciesEvidence>[1]);
}

describe('the outgoing-influence carrier is a separate question from dependencies', () => {
  /**
   * ⭐⭐ THE TWIN PAIR, ON ONE GRAPH, IN ONE TEST. Each direction must name its
   * OWN neighbour and must NOT name the other's. Written as a pair on purpose:
   * asserting only "outgoing names DOWNSTREAM" would still pass on a builder
   * that returns every neighbour in both directions.
   */
  it('reads OUTGOING for the influence question and INCOMING for the dependency question, on the same graph', () => {
    const out = outgoing();
    expect(out?.status).toBe('resolved');
    if (out?.status !== 'resolved') return;
    expect(out.selected_label).toBe(FOCUS);
    // Requested subject AND requested predicate, bound by identity:
    expect(out.influences.map((r) => [r.from_label, r.to_label])).toEqual([[FOCUS, DOWNSTREAM]]);
    // DIRECTION-INVERSION GUARD: the incoming neighbour is real and must not appear.
    expect(JSON.stringify(out)).not.toContain(UPSTREAM);

    const inc = incoming();
    expect(inc?.status).toBe('resolved');
    if (inc?.status !== 'resolved') return;
    expect(inc.selected_label).toBe(FOCUS);
    expect(inc.dependencies.map((r) => [r.from_label, r.to_label])).toEqual([[UPSTREAM, FOCUS]]);
    // DIRECTION-INVERSION GUARD, the other way.
    expect(JSON.stringify(inc)).not.toContain(DOWNSTREAM);

    // Neither ever reaches an unrelated element.
    expect(JSON.stringify([out, inc])).not.toContain(UNRELATED);
  });

  /**
   * The empty case is where an inversion is most tempting, because the honest
   * answer looks unhelpful: a ROOT factor has nothing feeding it, and a LEAF
   * factor drives nothing. Substituting the other direction "to be useful" is
   * exactly the defect. Both twins pinned.
   */
  it('reports an EMPTY outgoing set for a leaf, and an EMPTY incoming set for a root — never the other direction', () => {
    const leafOut = outgoing({}, LEAF_GRAPH);
    expect(leafOut?.status).toBe('resolved');
    if (leafOut?.status !== 'resolved') return;
    expect(leafOut.influences).toEqual([]);
    expect(JSON.stringify(leafOut)).not.toContain(UPSTREAM);

    const rootIn = incoming({}, ROOT_GRAPH);
    expect(rootIn?.status).toBe('resolved');
    if (rootIn?.status !== 'resolved') return;
    expect(rootIn.dependencies).toEqual([]);
    expect(JSON.stringify(rootIn)).not.toContain(DOWNSTREAM);

    // ...and each still answers its OWN question on the graph that has it.
    const rootOut = outgoing({}, ROOT_GRAPH);
    expect(rootOut?.status === 'resolved' && rootOut.influences.length).toBe(1);
    const leafIn = incoming({}, LEAF_GRAPH);
    expect(leafIn?.status === 'resolved' && leafIn.dependencies.length).toBe(1);
  });

  it('claims nothing for the other kind — each builder is keyed to its own typed question', () => {
    expect(buildSelectedOutgoingInfluenceEvidence(GRAPH, {
      ...SELECTION_WARRANT,
      structureQuery: { kind: 'dependencies', element_id: 'focus' },
    } as Parameters<typeof buildSelectedOutgoingInfluenceEvidence>[1])).toBeNull();
    expect(buildSelectedDependenciesEvidence(GRAPH, {
      ...SELECTION_WARRANT,
      structureQuery: { kind: 'outgoing_influence', element_id: 'focus' },
    } as Parameters<typeof buildSelectedDependenciesEvidence>[1])).toBeNull();
    // CONTRAST CONTROL in the same run: each DOES answer its own kind, so the
    // nulls above are the keying and not two dead builders.
    expect(outgoing()).toMatchObject({ status: 'resolved' });
    expect(incoming()).toMatchObject({ status: 'resolved' });
  });

  /**
   * ⚠ THE `ambiguous` SAFETY VERDICT IS NOT DISCARDED — it is the thing PR #1310
   * was rejected for weakening. The new carrier inherits every identity gate the
   * dependencies carrier enforces, and inherits it by SHARING the code rather
   * than by a second copy that can drift.
   */
  it('keeps every ambiguity and coverage verdict the dependencies carrier enforces', () => {
    const cases: readonly (readonly [string, Record<string, unknown>, unknown])[] = [
      ['unresolved proposal entity',
        { proposalEntity: { id: 'focus', label: FOCUS, resolution_status: 'ambiguous' } },
        { status: 'ambiguous', subject_selection: 'single_resolved' }],
      ['proposal entity naming a different element',
        { proposalEntity: { id: 'goal', label: 'Close a Series A on acceptable terms', resolution_status: 'resolved' } },
        { status: 'ambiguous', subject_selection: 'single_resolved' }],
      ['two selected nodes',
        { requestedSelection: { node_ids: ['focus', 'upstream'], edge_ids: [] } },
        { status: 'ambiguous', subject_selection: 'single_resolved' }],
      ['a mixed node/edge gesture',
        { requestedSelection: { node_ids: ['focus'], edge_ids: ['upstream→focus'] } },
        { status: 'ambiguous', subject_selection: 'single_resolved' }],
      ['a provisional graph',
        { graphContextStatus: 'provisional' },
        { status: 'coverage_unavailable', reason: 'graph_coverage_unavailable' }],
      ['a structural-fallback authority',
        { graphAuthority: 'canonical_structural_fallback' },
        { status: 'coverage_unavailable', reason: 'graph_coverage_unavailable' }],
      ['a trimmed graph',
        { graphWasTrimmed: true },
        { status: 'coverage_unavailable', reason: 'graph_coverage_unavailable' }],
    ];
    for (const [name, override, expected] of cases) {
      expect(outgoing(override), name).toEqual(expected);
      // TWIN: the same input produces the same verdict on the incoming carrier,
      // so the two can never drift apart on safety.
      expect(incoming(override), `${name} (dependencies twin)`).toEqual(expected);
    }
  });

  it('refuses an option→factor structural connector in EITHER direction rather than calling it influence', () => {
    const structural = graph(
      [
        { id: 'pilot', kind: 'option', label: 'Phased pilot' },
        { id: 'focus', kind: 'factor', label: FOCUS },
        { id: 'downstream', kind: 'outcome', label: DOWNSTREAM },
      ],
      [
        { from: 'pilot', to: 'focus', strength: 0.8 },
        { from: 'focus', to: 'downstream', strength: 0.7 },
      ],
    );
    // The incoming read sees the option→factor connector directly.
    expect(incoming({}, structural)).toEqual({
      status: 'coverage_unavailable', reason: 'structural_semantics_unlicensed',
    });
    // The outgoing read of the SAME element sees only factor→outcome, which is a
    // legitimate causal connector — so it answers, and answers its own question.
    expect(outgoing({}, structural)).toMatchObject({
      status: 'resolved',
      influences: [{ from_label: FOCUS, to_label: DOWNSTREAM }],
    });
    // ...and the option is never named by the outgoing answer.
    expect(JSON.stringify(outgoing({}, structural))).not.toContain('Phased pilot');
  });

  it('accepts the new kind at the enforcing schema, and rejects a malformed one', () => {
    expect(StructureQuerySchema.safeParse({ kind: 'outgoing_influence', element_id: 'focus' }).success)
      .toBe(true);
    expect(StructureQuerySchema.safeParse({ kind: 'outgoing_influence' }).success).toBe(false);
    expect(StructureQuerySchema.safeParse({ kind: 'outgoing_influence', element_id: '' }).success)
      .toBe(false);
    // A stray identity field must not be smuggled through a `.strict()` arm.
    expect(StructureQuerySchema.safeParse({
      kind: 'outgoing_influence', element_id: 'focus', element_ids: ['a', 'b'],
    }).success).toBe(false);
  });
});

describe('the two composers render opposite predicates and never each other', () => {
  /**
   * ⭐⭐ THE ASSERTION THAT WOULD HAVE CAUGHT MUTANT M1. Each composer's answer
   * must name the requested SUBJECT and answer the requested PREDICATE — asserted
   * as ONE bound phrase (`from <subject> to <driven>`), which a fluent answer to
   * the other question cannot satisfy. It is not "a label appears", and it is not
   * "the answer is long".
   */
  it('names the requested subject AND answers the requested predicate, in both directions', () => {
    const out = outgoing();
    if (out?.status !== 'resolved') throw new Error('fixture precondition failed');
    const outText = composeSelectedOutgoingInfluenceEvidenceAnswer(out);
    expect(outText).toContain(`from ${FOCUS} to ${DOWNSTREAM}`);
    expect(outText).toContain('complete direct outgoing influences');
    // DIRECTION-INVERSION GUARDS on the rendered string.
    expect(outText).not.toContain(UPSTREAM);
    expect(outText).not.toMatch(/incoming/i);
    // It must not rank, and must not extend the path.
    expect(outText).not.toMatch(/strongest|most important|matters most/i);

    const inc = incoming();
    if (inc?.status !== 'resolved') throw new Error('fixture precondition failed');
    const incText = composeSelectedDependenciesEvidenceAnswer(inc);
    expect(incText).toContain(`from ${UPSTREAM} to ${FOCUS}`);
    expect(incText).toContain('complete direct incoming dependencies');
    expect(incText).not.toContain(DOWNSTREAM);
    expect(incText).not.toMatch(/outgoing/i);

    // ⭐ AND THE PAIR ITSELF: the two answers must not be the same sentence.
    expect(outText).not.toBe(incText);
  });

  it('states an empty set in its own direction, and never borrows the other', () => {
    const leafOut = outgoing({}, LEAF_GRAPH);
    if (leafOut?.status !== 'resolved') throw new Error('fixture precondition failed');
    const text = composeSelectedOutgoingInfluenceEvidenceAnswer(leafOut);
    expect(text).toContain(`no direct outgoing influence from ${FOCUS}`);
    expect(text).not.toContain(UPSTREAM);

    const rootIn = incoming({}, ROOT_GRAPH);
    if (rootIn?.status !== 'resolved') throw new Error('fixture precondition failed');
    const incText = composeSelectedDependenciesEvidenceAnswer(rootIn);
    expect(incText).toContain(`no direct incoming dependency for ${FOCUS}`);
    expect(incText).not.toContain(DOWNSTREAM);
  });

  it('refuses without naming any element when identity is not established, in both directions', () => {
    for (const evidence of [
      { status: 'ambiguous' } as const,
      { status: 'ambiguous', subject_selection: 'single_resolved' } as const,
    ]) {
      const text = composeSelectedOutgoingInfluenceEvidenceAnswer(evidence);
      expect(text).toMatch(/I will not guess at what it affects/);
      for (const label of [FOCUS, UPSTREAM, DOWNSTREAM, UNRELATED]) {
        expect(text, 'a refusal must name no canonical element').not.toContain(label);
      }
      // No schema vocabulary reaches the user (the 1 Sep copy defect, #1308).
      expect(text).not.toMatch(/dependency question|Living Model element/i);
    }
  });
});
