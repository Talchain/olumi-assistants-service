import { describe, expect, it } from 'vitest';

import type { ContextPackGraph } from '../../context/context-pack-assembler.js';
import {
  buildGraphNodeLookupFromGraph,
  buildLabelIndex,
  resolveTypedCanonicalProseEntityRefs,
} from '../../compose/phase3-blocks.js';
import { formatGraphForContext } from '../../format/format-graph-for-context.js';
import { buildStructuralPairEvidence } from '../structural-pair-evidence.js';
import type { StructureQuery } from '../types.js';

/**
 * #1187 review follow-up — ONE PREDICATE, TWO OPPOSITE HARMS.
 *
 * `#1187` opened a real dead end: a typed pair whose BOTH labels are generic
 * single words ("Cost", "Risk") could never resolve, because the shared prose
 * resolver blocks bare generic tokens to stop them over-matching ordinary
 * decision prose. Its fix was a single blanket window
 * (`allowGenericSingleWordLabels`) applied to the WHOLE label index.
 *
 * A blanket window guards one door. It opens the generic pair (the GAP the PR
 * set out to close) and simultaneously turns EVERY generic-labelled node in the
 * model into a landmine for ordinary prose: a model that merely CONTAINS a node
 * called "Time" or "Cost" starts refusing questions about a completely
 * different, distinctively-named pair, because the words "over time" and "at
 * any cost" inflate the resolved reference count past the exact-set check. It
 * lands in the same `ambiguous` dead end the PR exists to reduce.
 *
 * Measured on this branch, base `01931a03` vs head, on the corpora below:
 *   - generic pair (12 phrasings):   base  0/12 direct  ->  head 11/12 direct
 *   - ordinary prose (7 phrasings):  base  7/7  direct  ->  head  1/7  direct
 *
 * The window therefore needs the expected-id SET, not a boolean: a generic
 * needle is admitted only when its OWN node is one of the ids the frontier
 * router typed. That keeps 11/12 and restores 7/7.
 *
 * Both directions are pinned here, case for case. A corpus that tests one
 * direction is a guard watching one door: a false positive that DROPS a link is
 * a gap, a false positive that INVENTS one is a lie, and they cannot share a
 * window.
 */

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
  } as unknown as ContextPackGraph;
}

function build(
  currentGraph: ContextPackGraph,
  messageText: string,
  elementIds: readonly [string, string],
) {
  const structureQuery = {
    kind: 'direct_relationship',
    element_ids: [elementIds[0], elementIds[1]],
  } as unknown as StructureQuery;
  return buildStructuralPairEvidence(currentGraph, {
    messageText,
    structureQuery,
    graphContextStatus: 'canonical',
    graphAuthority: 'canonical_strict',
    graphWasTrimmed: false,
  });
}

function statusOf(
  currentGraph: ContextPackGraph,
  messageText: string,
  elementIds: readonly [string, string],
): string {
  const evidence = build(currentGraph, messageText, elementIds);
  return evidence === null ? 'null' : evidence.status;
}

// ---------------------------------------------------------------------------
// MODEL R — a DISTINCTIVELY-named subject pair, plus two INCIDENTAL generic
// nodes that the questions below never ask about. Both incidental labels are
// members of `GENERIC_LEVER_TOKENS` (read at the bytes: 'time', 'cost').
// ---------------------------------------------------------------------------
const MODEL_R = graph(
  [
    { id: 'capacity', kind: 'factor', label: 'Team Capacity Consumed' },
    { id: 'delivery', kind: 'outcome', label: 'Delivery Predictability' },
    { id: 'incidental_time', kind: 'factor', label: 'Time' },
    { id: 'incidental_cost', kind: 'factor', label: 'Cost' },
  ],
  [{ from: 'capacity', to: 'delivery', strength: -0.42, coefficient_confidence: 'high' }],
);
const R_PAIR: readonly [string, string] = ['capacity', 'delivery'];

/**
 * CORPUS A — GAP DIRECTION. Ordinary English that happens to contain a word
 * which is also an incidental node label. Every one of these must resolve; a
 * refusal here is a link silently DROPPED. Derived from the producer's
 * semantics, not from a symptom: `normaliseForPhraseMatch` folds punctuation to
 * spaces (so "Real-time" becomes the bounded whole word "time"), and
 * `firstBoundedPhraseAt` matches on both-ends word boundaries.
 */
const CORPUS_A: readonly { readonly id: string; readonly prose: string }[] = [
  { id: 'A1-control', prose: 'How does Team Capacity Consumed affect Delivery Predictability?' },
  { id: 'A2-trailing-over-time', prose: 'How does Team Capacity Consumed affect Delivery Predictability over time?' },
  { id: 'A3-at-any-cost', prose: 'Does Team Capacity Consumed drive Delivery Predictability at any cost?' },
  { id: 'A4-leading-over-time', prose: 'Over time, how does Team Capacity Consumed shape Delivery Predictability?' },
  { id: 'A5-the-cost-of', prose: 'What is the cost of Team Capacity Consumed for Delivery Predictability?' },
  { id: 'A6-both-generics', prose: 'Over time and at what cost does Team Capacity Consumed move Delivery Predictability?' },
  { id: 'A7-hyphenated', prose: 'Real-time reporting aside, how does Team Capacity Consumed affect Delivery Predictability?' },
];

// ---------------------------------------------------------------------------
// MODEL G — the dead end #1187 exists to open: BOTH typed elements carry a
// unique generic single-word label.
// ---------------------------------------------------------------------------
const MODEL_G = graph(
  [
    { id: 'cost', kind: 'factor', label: 'Cost' },
    { id: 'risk', kind: 'outcome', label: 'Risk' },
  ],
  [{ from: 'cost', to: 'risk', strength: 0.48, coefficient_confidence: 'moderate' }],
);
const G_PAIR: readonly [string, string] = ['cost', 'risk'];

/** CORPUS B — the capability direction. All 12 are `ambiguous` at base. */
const CORPUS_B: readonly { readonly id: string; readonly prose: string }[] = [
  { id: 'B01', prose: 'How does Cost affect Risk?' },
  { id: 'B02', prose: 'What is the relationship between Cost and Risk?' },
  { id: 'B03', prose: 'Does Cost drive Risk?' },
  { id: 'B04', prose: 'Explain the link between Risk and Cost.' },
  { id: 'B05', prose: 'Is Cost connected to Risk?' },
  { id: 'B06', prose: 'How are Cost and Risk related?' },
  { id: 'B07', prose: 'Describe how Cost influences Risk.' },
  { id: 'B08', prose: 'Cost and Risk - how do they connect?' },
  { id: 'B09', prose: 'Tell me about Cost vs Risk.' },
  { id: 'B10', prose: 'Does Risk depend on Cost?' },
  { id: 'B11', prose: 'What does Cost do to Risk?' },
  { id: 'B12-plural', prose: 'How do Costs affect Risk?' },
];

// ---------------------------------------------------------------------------
// MODEL D — a distinctive subject pair plus a DUPLICATED generic label, so
// `buildLabelIndex` flips 'cost' to AMBIGUOUS_LABEL. This probes the SECOND
// call site of the same window (the ambiguity scan), which iterates the index
// and therefore holds no node id to scope by.
// ---------------------------------------------------------------------------
const MODEL_D = graph(
  [
    { id: 'capacity', kind: 'factor', label: 'Team Capacity Consumed' },
    { id: 'delivery', kind: 'outcome', label: 'Delivery Predictability' },
    { id: 'cost_a', kind: 'factor', label: 'Cost' },
    { id: 'cost_b', kind: 'factor', label: 'cost' },
  ],
  [{ from: 'capacity', to: 'delivery', strength: -0.42, coefficient_confidence: 'high' }],
);
const CORPUS_D: readonly { readonly id: string; readonly prose: string }[] = [
  { id: 'D1-control', prose: 'How does Team Capacity Consumed affect Delivery Predictability?' },
  { id: 'D2-duplicate-generic', prose: 'What is the cost of Team Capacity Consumed for Delivery Predictability?' },
];

describe('#1187 generic-label window — GAP direction (a DROPPED link)', () => {
  it.each(CORPUS_A.map((c) => [c.id, c.prose] as const))(
    'ordinary prose keeps its link: %s',
    (_id, prose) => {
      expect(statusOf(MODEL_R, prose, R_PAIR)).toBe('direct');
    },
  );

  it('the whole ordinary-prose corpus resolves — no case silently drops', () => {
    const dropped = CORPUS_A.filter((c) => statusOf(MODEL_R, c.prose, R_PAIR) !== 'direct')
      .map((c) => c.id);
    expect(dropped).toEqual([]);
  });

  it('the generic-labelled pair the PR set out to open now answers', () => {
    const answered = CORPUS_B.filter((c) => statusOf(MODEL_G, c.prose, G_PAIR) === 'direct')
      .map((c) => c.id);
    // Exactly 11 of 12: the plural is pinned as KNOWN-DROPPED below.
    expect(answered).toEqual([
      'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11',
    ]);
  });
});

describe('#1187 generic-label window — LIE direction (an INVENTED link)', () => {
  /**
   * The opposite-direction twin of every CORPUS_A case. Same model, same
   * sentence — but the frontier router typed a pair whose subject is the
   * INCIDENTAL generic node. The generic word in the prose must not stand in
   * for a named element, so every twin must refuse.
   */
  it.each(CORPUS_A.map((c) => [c.id, c.prose] as const))(
    'a generic word never substitutes for a named element: twin of %s',
    (_id, prose) => {
      expect(statusOf(MODEL_R, prose, ['incidental_time', 'delivery'])).toBe('ambiguous');
      expect(statusOf(MODEL_R, prose, ['incidental_cost', 'delivery'])).toBe('ambiguous');
    },
  );

  it('twins as a set: no CORPUS_A sentence answers a question about the incidental node', () => {
    const leaked = CORPUS_A.filter(
      (c) =>
        statusOf(MODEL_R, c.prose, ['incidental_time', 'delivery']) !== 'ambiguous' ||
        statusOf(MODEL_R, c.prose, ['incidental_cost', 'delivery']) !== 'ambiguous',
    ).map((c) => c.id);
    expect(leaked).toEqual([]);
  });

  it('a forged, absent or duplicated typed id fails weak', () => {
    expect(statusOf(MODEL_R, 'How does Team Capacity Consumed affect Delivery Predictability?', ['capacity', 'no_such_node'])).toBe('ambiguous');
    expect(statusOf(MODEL_R, 'How does Team Capacity Consumed affect Delivery Predictability?', ['capacity', 'capacity'])).toBe('ambiguous');
    expect(statusOf(MODEL_R, 'What is the cost of Team Capacity Consumed for Delivery Predictability?', ['incidental_cost', 'no_such_node'])).toBe('ambiguous');
  });

  it('naming only one of the two typed elements refuses rather than half-answering', () => {
    // "cost" resolves nothing here: `incidental_cost` is not one of the typed
    // ids, so the scoped window leaves the generic token blocked.
    expect(statusOf(MODEL_R, 'What is the cost of Team Capacity Consumed?', R_PAIR)).toBe('ambiguous');
    // And with the generic node IN the typed pair, the sentence still names
    // `capacity` — an extra reference — so the exact-set check refuses.
    expect(statusOf(MODEL_R, 'What is the cost of Team Capacity Consumed?', ['incidental_cost', 'delivery'])).toBe('ambiguous');
  });

  it('extra and duplicate model references still refuse on the generic pair', () => {
    const withThird = graph(
      [
        { id: 'cost', kind: 'factor', label: 'Cost' },
        { id: 'risk', kind: 'outcome', label: 'Risk' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      [{ from: 'cost', to: 'risk', strength: 0.5 }],
    );
    expect(statusOf(withThird, 'How do Cost and Risk affect Goal?', G_PAIR)).toBe('ambiguous');

    const duplicateGeneric = graph(
      [
        { id: 'cost_a', kind: 'factor', label: 'Cost' },
        { id: 'cost_b', kind: 'factor', label: 'cost' },
        { id: 'risk', kind: 'outcome', label: 'Risk' },
      ],
      [{ from: 'cost_a', to: 'risk', strength: 0.5 }],
    );
    expect(statusOf(duplicateGeneric, 'How does Cost affect Risk?', ['cost_a', 'risk'])).toBe('ambiguous');
  });

  /**
   * IDENTITY BINDING (trap 19). The window must open for THE TYPED NODE, not
   * for "a generic node". Proven by a discriminating pair rather than by one
   * biting mutant: widening the window to every id must RED the GAP corpus,
   * while widening it to a DIFFERENT id must leave everything green.
   */
  it('the window is bound to the typed ids by identity, not to genericness', () => {
    // The SAME sentence, the SAME model: it answers for the typed pair...
    expect(statusOf(MODEL_R, 'What is the cost of Team Capacity Consumed for Delivery Predictability?', R_PAIR)).toBe('direct');
    // ...and refuses for a pair the sentence does not name, even though the
    // generic word "cost" is present in both runs.
    expect(statusOf(MODEL_R, 'What is the cost of Team Capacity Consumed for Delivery Predictability?', ['incidental_cost', 'capacity'])).toBe('ambiguous');
  });
});

describe('#1187 generic-label window — KNOWN-DROPPED, exactly this set', () => {
  /**
   * The honest way to ship a known gap: pin it EXACTLY, so the suite REDs if
   * the set GROWS (a new regression) or SHRINKS (a fix landed and this pin went
   * stale). Two members, both measured on this branch:
   *
   *   1. `B12-plural` — the author's explicit pin. `firstBoundedPhraseAt`
   *      requires both-ends word boundaries, so the needle "cost" does not
   *      match inside "costs". Typed ids do not loosen matching.
   *   2. `D2-duplicate-generic` — NOT named in the review. The window has TWO
   *      call sites; the second is the ambiguity scan, which iterates the label
   *      index and reaches `AMBIGUOUS_LABEL`, holding NO node id. It therefore
   *      cannot be scoped by the expected-id set the way the resolver can. A
   *      model carrying a DUPLICATED generic label refuses ordinary prose that
   *      merely contains that word. Measured: base `direct`, head `ambiguous`,
   *      head+scoped-fix `ambiguous` — a narrow live regression that the scoped
   *      fix does NOT close.
   *
   *      It is left open deliberately. Scoping the ambiguity scan would flip
   *      the author's own pinned refusal in
   *      `structural-pair-evidence.test.ts` ("does not ignore an additional
   *      ambiguous generic reference"), because at that call site an incidental
   *      generic word and a deliberate third model reference are the SAME
   *      bytes. That is a second predicate question, not a wider window, and it
   *      is not settled by another token rule.
   */
  const UNION: readonly { readonly id: string; readonly prose: string; readonly model: ContextPackGraph; readonly pair: readonly [string, string] }[] = [
    ...CORPUS_A.map((c) => ({ ...c, model: MODEL_R, pair: R_PAIR })),
    ...CORPUS_B.map((c) => ({ ...c, model: MODEL_G, pair: G_PAIR })),
    ...CORPUS_D.map((c) => ({ ...c, model: MODEL_D, pair: R_PAIR })),
  ];

  it('the union corpus is the size it declares (a shrunk corpus cannot certify a set)', () => {
    expect(UNION).toHaveLength(21);
    expect(new Set(UNION.map((c) => c.id)).size).toBe(21);
  });

  it('exactly these cases are refused — REDs if the set grows OR shrinks', () => {
    const refused = UNION.filter((c) => statusOf(c.model, c.prose, c.pair) !== 'direct')
      .map((c) => c.id)
      .sort();
    expect(refused).toEqual(['B12-plural', 'D2-duplicate-generic']);
  });

  it('`ambiguous` is a DEAD END, not a degraded answer', () => {
    // The turn-executor calls `buildStructuralPairEvidence(...) ?? undefined`.
    // `{ status: 'ambiguous' }` is not `null`, so the `??` does not fire, the
    // handler's `structuralPairEvidence !== undefined` is TRUE, and the refusal
    // short-circuits BOTH the authored answer and the deterministic fallback.
    // #1187 narrows WHEN a user lands here; it does not change what happens
    // when they do.
    const evidence = build(MODEL_G, 'How do Costs affect Risk?', G_PAIR);
    expect(evidence).toEqual({ status: 'ambiguous' });
    expect(evidence).not.toBeNull();
    expect(evidence ?? undefined).not.toBeUndefined();
  });

  it('a typed pair that resolves but has no edge still reaches a real answer', () => {
    // Contrast control for the dead-end pin above: refusal is `ambiguous`, and
    // it is distinct from the genuine no-edge answer. Without this, the pin
    // could pass on a resolver that refused everything.
    expect(statusOf(MODEL_R, 'Over time, will Delivery Predictability hold?', ['incidental_time', 'delivery'])).toBe('no_direct');
  });
});

describe('#1187 generic-label window — the RESOLVER\'s own contract', () => {
  /**
   * `resolveTypedCanonicalProseEntityRefs` is exported, and its docstring
   * promises it "returns `null` unless the message resolves to precisely that
   * id set". Today it has exactly ONE product caller
   * (`structural-pair-evidence.ts`), and that caller re-checks `refs.length !==
   * 2` itself — so a mutant deleting the resolver's OWN length check survives
   * every test that reaches it through the caller (measured: 88/88 green).
   *
   * That is caller-level equivalence, not a correct function. These bind the
   * resolver directly, so the promise stays true for the second caller.
   */
  function resolverFor(currentGraph: ContextPackGraph) {
    const display = formatGraphForContext(currentGraph);
    const lookup = buildGraphNodeLookupFromGraph(display);
    return { lookup, index: buildLabelIndex(lookup) };
  }

  it('refuses when only ONE of the two typed elements is named', () => {
    const { lookup, index } = resolverFor(MODEL_G);
    // Positive control: both named resolves to exactly the typed set.
    expect(
      resolveTypedCanonicalProseEntityRefs(lookup, index, 'How does Cost affect Risk?', ['cost', 'risk'])
        ?.map((ref) => ref.id),
    ).toEqual(['cost', 'risk']);
    // Twin: one named must be `null`, never a partial answer. Without the
    // resolver's own length check this returns a one-element array.
    expect(
      resolveTypedCanonicalProseEntityRefs(lookup, index, 'How much does Cost matter here?', ['cost', 'risk']),
    ).toBeNull();
  });

  it('refuses when NEITHER typed element is named', () => {
    const { lookup, index } = resolverFor(MODEL_G);
    expect(
      resolveTypedCanonicalProseEntityRefs(lookup, index, 'Tell me about the market outlook.', ['cost', 'risk']),
    ).toBeNull();
  });

  it('refuses a typed set carrying the same id twice', () => {
    const { lookup, index } = resolverFor(MODEL_G);
    expect(
      resolveTypedCanonicalProseEntityRefs(lookup, index, 'How does Cost affect Risk?', ['cost', 'cost']),
    ).toBeNull();
  });
});
