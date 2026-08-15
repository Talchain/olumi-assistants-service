/**
 * RED-first spec for the GROUNDED counter-case (Lane C — the post-analysis
 * scientific reasoning loop).
 *
 * ── WHAT THIS PINS, AND WHY IT IS THE WHOLE POINT ────────────────────────────
 * `consider_opposite` currently ships FIXED copy — `phase3-blocks.ts`'s
 * `CONSIDER_OPPOSITE_COUNTER_CASE`, whose own comment says it carries "no
 * producer-content dependency". That is a TEMPLATE: it fires identically on
 * every decision, which is the defect this lane exists to close. So the
 * load-bearing test here is not "does it produce text" — it is
 * **ANTI-TEMPLATE**: two DIFFERENT live captures must produce two DIFFERENT
 * counter-cases, each naming ITS OWN run's mechanism.
 *
 * ── THE FIXTURES ARE PRODUCER DATA, NOT THE AUTHOR'S ─────────────────────────
 * Both enrichments are the committed LIVE captures already used by the
 * fragile-edge selector's own suite (`compose/__tests__/fixtures/dsk-walk/`).
 * A fixture the lane authored would encode the lane's model of the producer
 * rather than the producer (CLAUDE.md trap 16-inverse), and the labels are
 * exactly the field whose real-world shape the prose gate has to survive.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ExerciseBlockSchema } from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';
import { shouldSuppressEditDispatchForValueUpdate } from '../../../orchestrator/routing/value-update-gate.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import {
  buildLensCompanionBlocks,
  type BlockBuildCtx,
  type GraphNodeLookup,
} from '../../compose/phase3-blocks.js';
import { selectLens } from '../../compose/lens-selector.js';
import { isAnalyticalQuestion } from '../../routing/analytical-question-guard.js';
import { isStateQueryQuestionShape } from '../../routing/state-query-guard.js';
import {
  composeGroundedCounterCaseHandoffTurn,
  composeGroundedCounterCaseWithModelHandoff,
  selectGroundedCounterCase,
} from '../grounded-counter-case.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '..', '..', 'compose', '__tests__', 'fixtures', 'dsk-walk');

function liveEnrichment(name: 'session-a' | 'session-b2'): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.enrichment.json`), 'utf8'));
}

/** `route-v2`'s exact five-conjunct edit candidate, from its own authorities. */
function editVerbCandidate(message: string): boolean {
  return (
    EDIT_GRAPH_POSITIVE_REGEX.test(message) &&
    !EDIT_GRAPH_NEGATIVE_REGEX.test(message) &&
    !shouldSuppressEditDispatchForValueUpdate(message) &&
    !isAnalyticalQuestion(message) &&
    !isStateQueryQuestionShape(message)
  );
}

describe('selectGroundedCounterCase — grounding', () => {
  it('names session-a\'s OWN head relationship, bound by producer identity', () => {
    const result = selectGroundedCounterCase(liveEnrichment('session-a'));

    expect(result.refusalReason).toBeNull();
    const grounded = result.grounded;
    expect(grounded).not.toBeNull();

    // IDENTITY binding (trap 19): the exact producer ids and labels of the
    // HEAD fragile edge — never "some edge whose probability is highest",
    // which another row could satisfy after a producer re-order.
    expect(grounded!.fromId).toBe('fac_partner_invest');
    expect(grounded!.toId).toBe('out_new_arr');
    expect(grounded!.fromLabel).toBe('Partner Channel Investment');
    expect(grounded!.toLabel).toBe('Net New ARR Generated');
    expect(grounded!.edgeIdentity).toBe('fac_partner_invest→out_new_arr');

    // The prose must actually CARRY the mechanism, not merely know it.
    expect(grounded!.counterCase).toContain('Partner Channel Investment');
    expect(grounded!.counterCase).toContain('Net New ARR Generated');
  });

  it('⭐ ANTI-TEMPLATE: a different live run yields a DIFFERENT counter-case', () => {
    const a = selectGroundedCounterCase(liveEnrichment('session-a')).grounded;
    const b = selectGroundedCounterCase(liveEnrichment('session-b2')).grounded;

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    // session-b2's own head relationship, by identity.
    expect(b!.fromLabel).toBe('Automated Packing Investment');
    expect(b!.toLabel).toBe('Flour Cost Margin Squeeze');

    // The discriminating assertion: the two runs do not share prose. A
    // template passes every other test in this file and fails THIS one.
    expect(b!.counterCase).not.toBe(a!.counterCase);
    expect(b!.counterCase).not.toContain('Partner Channel Investment');
    expect(a!.counterCase).not.toContain('Automated Packing Investment');
  });

  it('selects the producer MAXIMUM switch_probability, not merely the head', () => {
    // CEE #933 review: the "arrives sorted DESC" guarantee is absent — 3 of 28
    // committed arrays violate it. The copy claims a superlative, so the
    // superlative must be COMPUTED from the producer's own metric.
    const result = selectGroundedCounterCase({
      robustness: {
        fragile_edges: [
          { from_id: 'fac_a', to_id: 'out_a', from_label: 'Alpha', to_label: 'Alpha Out', switch_probability: 0.11 },
          { from_id: 'fac_b', to_id: 'out_b', from_label: 'Beta', to_label: 'Beta Out', switch_probability: 0.42 },
        ],
      },
    });
    expect(result.grounded).not.toBeNull();
    expect(result.grounded!.fromLabel).toBe('Beta');
    expect(result.grounded!.counterCase).toContain('Beta Out');
  });

  it('keeps producer order on ties, so a sorted array is unchanged', () => {
    // session-a's rows arrive sorted by switch_probability DESC. The selection
    // is the HEAD row, not a locally-recomputed maximum: re-ranking here would
    // be a second opinion about importance computed from a subset of the
    // producer's inputs (the "never manufacture importance" rule).
    const raw = liveEnrichment('session-a') as {
      robustness: { fragile_edges: readonly { from_id: string; to_id: string }[] };
    };
    const head = raw.robustness.fragile_edges[0]!;
    const grounded = selectGroundedCounterCase(raw).grounded;

    expect(grounded!.fromId).toBe(head.from_id);
    expect(grounded!.toId).toBe(head.to_id);
  });
});

describe('selectGroundedCounterCase — the honest empties', () => {
  it('refuses when there is no robustness object at all', () => {
    const result = selectGroundedCounterCase({});
    expect(result.grounded).toBeNull();
    expect(result.refusalReason).toBe('no_fragile_edges');
  });

  it('refuses when rows carry no endpoint identity', () => {
    const result = selectGroundedCounterCase({
      robustness: { fragile_edges: [{ switch_probability: 0.4 }] },
    });
    expect(result.grounded).toBeNull();
    expect(result.refusalReason).toBe('no_edge_identity');
  });

  it('refuses when the head row carries no human labels', () => {
    const result = selectGroundedCounterCase({
      robustness: { fragile_edges: [{ from_id: 'fac_a', to_id: 'out_b' }] },
    });
    expect(result.grounded).toBeNull();
    expect(result.refusalReason).toBe('no_endpoint_labels');
  });
});

describe('selectGroundedCounterCase — composability is asked EARLY', () => {
  /**
   * The lesson `fragile-edge-offer-text.ts` was created to encode: a label
   * that trips the prose gate must cost the GROUNDING, never the whole card.
   * The caller falls back to the fixed copy, so the user still gets an
   * exercise. A late drop is how a turn ships no intervention at all.
   */
  it('refuses a label carrying a forbidden phrase (caller falls back, card survives)', () => {
    const result = selectGroundedCounterCase({
      robustness: {
        fragile_edges: [
          {
            from_id: 'fac_a',
            to_id: 'out_b',
            from_label: 'The recommendation engine',
            to_label: 'Net New ARR Generated',
          },
        ],
      },
    });
    expect(result.grounded).toBeNull();
    expect(result.refusalReason).toBe('not_composable');
  });

  it('POSITIVE CONTROL: the gate this suite relies on genuinely fires', () => {
    // Without this, the refusal test above could pass because the gate is
    // inert rather than because it caught anything (trap 13: an absence
    // assertion needs a demonstrated presence).
    expect(findForbiddenPhraseHit('The recommendation engine')).not.toBeNull();
    expect(findForbiddenPhraseHit('Partner Channel Investment')).toBeNull();
  });

  it('refuses a label carrying a raw decimal', () => {
    const result = selectGroundedCounterCase({
      robustness: {
        fragile_edges: [
          {
            from_id: 'fac_a',
            to_id: 'out_b',
            from_label: 'Margin above 0.78 threshold',
            to_label: 'Net New ARR Generated',
          },
        ],
      },
    });
    expect(result.grounded).toBeNull();
    expect(result.refusalReason).toBe('not_composable');
  });

  it('refuses an over-long naming sentence rather than shipping a truncated relationship', () => {
    const result = selectGroundedCounterCase({
      robustness: {
        fragile_edges: [
          {
            from_id: 'fac_a',
            to_id: 'out_b',
            from_label: 'A'.repeat(400),
            to_label: 'B'.repeat(400),
          },
        ],
      },
    });
    expect(result.grounded).toBeNull();
    expect(result.refusalReason).toBe('not_composable');
  });
});

describe('selectGroundedCounterCase — what it may not say', () => {
  it('carries no probability, no option name, and no entity id', () => {
    const grounded = selectGroundedCounterCase(liveEnrichment('session-a')).grounded;
    expect(grounded).not.toBeNull();
    const prose = grounded!.counterCase;

    // `switch_probability` is producer data this module reads as a STRUCTURED
    // gate only. Surfacing it would trip the raw-decimal gate and, worse,
    // assert a precision the run does not have.
    expect(prose).not.toMatch(/\d/);

    // No leading-option claim. The fixed copy says "the option in front"
    // deliberately: naming a leader needs the canonical
    // `readMayNameLeadingOptionVerdict` permission, which this pure module
    // does not hold and must not fake. `alternative_winner_label` is
    // therefore read for NOTHING here.
    expect(prose).not.toContain('Product-Led Growth Free Tier');

    // No slug-shaped ids in prose.
    expect(prose).not.toContain('fac_');
    expect(prose).not.toContain('out_');
  });
});

describe('complete disconfirmation handoff — exact copy, route and authorship', () => {
  const SESSION_A_COPY =
    'Argue the opposite: assume the option in front is wrong. The run’s most sensitive link is ' +
    'Partner Channel Investment → Net New ARR Generated. ' +
    'Make the strongest case it fails and name evidence that would settle it. ' +
    'If that reveals a missing driver, reply in your own words: “' +
    'Add [your driver] as a factor affecting Net New ARR Generated.” ' +
    'I’ll ask you to confirm before changing the model.';
  const SESSION_B2_COPY =
    'Argue the opposite: assume the option in front is wrong. The run’s most sensitive link is ' +
    'Automated Packing Investment → Flour Cost Margin Squeeze. ' +
    'Make the strongest case it fails and name evidence that would settle it. ' +
    'If that reveals a missing driver, reply in your own words: “' +
    'Add [your driver] as a factor affecting Flour Cost Margin Squeeze.” ' +
    'I’ll ask you to confirm before changing the model.';

  it('composes the exact approved copy for both live captures at 389/399 characters', () => {
    const a = selectGroundedCounterCase(liveEnrichment('session-a')).grounded!;
    const b = selectGroundedCounterCase(liveEnrichment('session-b2')).grounded!;
    const aCopy = composeGroundedCounterCaseWithModelHandoff(a.fromLabel, a.toLabel);
    const bCopy = composeGroundedCounterCaseWithModelHandoff(b.fromLabel, b.toLabel);

    expect(aCopy).toBe(SESSION_A_COPY);
    expect(aCopy).toHaveLength(389);
    expect(bCopy).toBe(SESSION_B2_COPY);
    expect(bCopy).toHaveLength(399);
  });

  it('routes both the displayed template and a human-authored reply through all five edit gates', () => {
    const template = composeGroundedCounterCaseHandoffTurn('Net New ARR Generated');
    const humanReply =
      'Add supplier concentration as a factor affecting Net New ARR Generated.';

    expect(template).toBe('Add [your driver] as a factor affecting Net New ARR Generated.');
    for (const message of [template, humanReply]) {
      expect(EDIT_GRAPH_POSITIVE_REGEX.test(message)).toBe(true);
      expect(EDIT_GRAPH_NEGATIVE_REGEX.test(message)).toBe(false);
      expect(shouldSuppressEditDispatchForValueUpdate(message)).toBe(false);
      expect(isAnalyticalQuestion(message)).toBe(false);
      expect(isStateQueryQuestionShape(message)).toBe(false);
      expect(editVerbCandidate(message)).toBe(true);
    }

    // The human supplies the causal concept in place of the placeholder. The
    // handoff does NOT ask them for a numeric or qualitative edge strength;
    // any edge semantics proposed later remain held until confirmation.
    expect(humanReply).not.toContain('[your driver]');
    expect(template).not.toMatch(/\d|\b(?:strength|stronger|weaker|positive|negative)\b/i);
  });

  it('kills route and length mutants before copy can ship', () => {
    // Negative-route vocabulary can arrive inside a canonical producer label.
    expect(
      composeGroundedCounterCaseWithModelHandoff(
        'Partner Channel Investment',
        'Why Customers Churn',
      ),
    ).toBeNull();
    // This real producer-label shape triggers the value-update conjunct.
    expect(
      composeGroundedCounterCaseWithModelHandoff(
        'Operating Profit Uplift',
        'Raise Group Operating Profit by 8% Within 18 Months',
      ),
    ).toBeNull();
    // An interrogative producer label can independently trip the analytical
    // route guard even though the fixed prefix starts with an edit verb.
    expect(
      composeGroundedCounterCaseWithModelHandoff(
        'Partner Channel Investment',
        'What Could Change the Outcome',
      ),
    ).toBeNull();
    // The prior grounded sentence is 366 chars; the handoff would be 401.
    expect(
      composeGroundedCounterCaseWithModelHandoff('A'.repeat(40), 'B'.repeat(20)),
    ).toBeNull();
  });
});

// ============================================================================
// ⭐ THE WIRING PROOF — without this, the module above is unit-tested and
// UNREACHED.
//
// Every pre-existing DSK-exercise test passed unchanged after the wiring
// landed, and one of them pins the FIXED copy byte-for-byte. That is not
// evidence the wiring works — it is evidence their fixture carries no fragile
// edges, so the grounded arm refuses and falls back. A green suite that cannot
// reach the new branch says nothing about it (CLAUDE.md trap 3b: a test bound
// to a surface the run does not exercise).
//
// So both arms are proven here as a DISCRIMINATING PAIR: the same builder, two
// enrichments, two different outcomes. Neither assertion alone shows binding.
// ============================================================================

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
const CTX: BlockBuildCtx = {
  created_at: '2026-08-05T00:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};
const LOOKUP: GraphNodeLookup = new Map([
  ['opt_a', { id: 'opt_a', label: 'Option A', kind: 'option' as const }],
]);
const CANONICAL_OUTCOME_LOOKUP: GraphNodeLookup = new Map([
  ...LOOKUP,
  [
    'fac_partner_invest',
    {
      id: 'fac_partner_invest',
      label: 'Partner Channel Investment',
      kind: 'factor' as const,
    },
  ],
  [
    'out_new_arr',
    { id: 'out_new_arr', label: 'Net New ARR Generated', kind: 'outcome' as const },
  ],
]);

/** The fixed copy this lane replaces — inlined so the test fails if it moves. */
const FIXED_COPY =
  'Take the opposite view for a moment: assume the option in front turns out to be the wrong choice. ' +
  'What would have to be true for that to happen? Write down the strongest argument against it, and ' +
  'note what evidence would confirm or rule out that argument.';

/**
 * Fires `consider_opposite` (decisive, attested-stable leader), with the
 * fragile-edge rows optionally attached.
 */
function considerOppositeFact(fragileEdges?: readonly unknown[]): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        confidence_tier: 'strong',
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.75 }, { win_probability: 0.25 }],
        robustness: {
          level: 'high',
          ...(fragileEdges !== undefined ? { fragile_edges: fragileEdges } : {}),
        },
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

describe('wiring — the emitted exercise carries the GROUNDED counter-case', () => {
  /**
   * ⭐ THE TRAP-21 CASE, MADE CONCRETE. These rows carry endpoint identity and
   * labels but NO `edge_e_values`, so `selectFragileEdge` refuses them
   * (`no_e_value_join`) and the `fragile_edge_resolution` lens is not eligible
   * — the edge is real but not mechanically ADJUSTABLE.
   *
   * That is exactly the run where reusing the action-gated selector would have
   * silently withheld the exercise's grounding for a reason that bears only on
   * a mutation nobody is performing. Here the disconfirmation exercise grounds
   * anyway, which is the whole argument for keeping the two questions apart.
   */
  const FRAGILE_ROWS = [
    {
      edge_id: 'fac_partner_invest->out_new_arr',
      from_id: 'fac_partner_invest',
      to_id: 'out_new_arr',
      from_label: 'Partner Channel Investment',
      to_label: 'Net New ARR Generated',
      switch_probability: 0.19,
      severity: 'warning',
    },
  ];

  it('ARM 1 — with fragile edges, the block names the relationship', () => {
    const fact = considerOppositeFact(FRAGILE_ROWS);
    const selection = selectLens(fact, { previousAnalysisLens: null });
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('consider_opposite');

    const blocks = buildLensCompanionBlocks(fact, CTX, selection!, [], LOOKUP);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;

    // Still a valid, shippable exercise block.
    expect(ExerciseBlockSchema.safeParse(block).success).toBe(true);
    expect(block.exercise_kind).toBe('consider_opposite');

    // The load-bearing assertion: the run's OWN mechanism reached the wire.
    expect(block.counter_case).toContain('Partner Channel Investment');
    expect(block.counter_case).toContain('Net New ARR Generated');
    // …and it is NOT the template.
    expect(block.counter_case).not.toBe(FIXED_COPY);
  });

  it('ARM 1B — canonical outcome identity emits the complete loop with no chip or auto-send', () => {
    const fact = considerOppositeFact(FRAGILE_ROWS);
    const selection = selectLens(fact, { previousAnalysisLens: null })!;
    const block = buildLensCompanionBlocks(
      fact,
      CTX,
      selection,
      [],
      CANONICAL_OUTCOME_LOOKUP,
    )[0]!;

    expect(block.counter_case).toContain(
      'reply in your own words: “Add [your driver] as a factor affecting Net New ARR Generated.”',
    );
    expect(block.counter_case).toContain('I’ll ask you to confirm before changing the model.');
    expect(block.counter_case).toHaveLength(389);
    // ExerciseBlock has no action fields: the user must author and send the
    // sentence; merely rendering this card cannot write to the model.
    expect(block).not.toHaveProperty('action_label');
    expect(block).not.toHaveProperty('action_prompt');
    expect(block).not.toHaveProperty('suggested_actions');
  });

  it('ARM 1C — a canonical risk target is also an eligible causal consequence', () => {
    const riskRows = [
      {
        from_id: 'fac_vendor_health',
        to_id: 'risk_supply_failure',
        from_label: 'Vendor Financial Health',
        to_label: 'Supply Failure',
        switch_probability: 0.19,
      },
    ];
    const lookup: GraphNodeLookup = new Map([
      ...LOOKUP,
      [
        'fac_vendor_health',
        { id: 'fac_vendor_health', label: 'Vendor Financial Health', kind: 'factor' as const },
      ],
      [
        'risk_supply_failure',
        { id: 'risk_supply_failure', label: 'Supply Failure', kind: 'risk' as const },
      ],
    ]);
    const fact = considerOppositeFact(riskRows);
    const selection = selectLens(fact, { previousAnalysisLens: null })!;
    const block = buildLensCompanionBlocks(fact, CTX, selection, [], lookup)[0]!;

    expect(block.counter_case).toContain(
      'Add [your driver] as a factor affecting Supply Failure.',
    );
  });

  it.each(['option', 'goal', 'factor', 'decision'] as const)(
    'ARM 1D — target kind %s cannot receive the model-action handoff',
    (kind) => {
      const fact = considerOppositeFact(FRAGILE_ROWS);
      const selection = selectLens(fact, { previousAnalysisLens: null })!;
      const priorGroundedCopy = selectGroundedCounterCase(fact.result.enrichment).grounded!
        .counterCase;
      const lookup = new Map(CANONICAL_OUTCOME_LOOKUP) as Map<
        string,
        { id: string; label: string; kind: string }
      >;
      lookup.set('out_new_arr', {
        id: 'out_new_arr',
        label: 'Net New ARR Generated',
        kind,
      });

      const block = buildLensCompanionBlocks(
        fact,
        CTX,
        selection,
        [],
        lookup as unknown as GraphNodeLookup,
      )[0]!;
      expect(block.counter_case).toBe(priorGroundedCopy);
      expect(block.counter_case).not.toContain('[your driver]');
    },
  );

  it.each([
    ['missing source identity', new Map([...CANONICAL_OUTCOME_LOOKUP].filter(([id]) => id !== 'fac_partner_invest'))],
    ['missing target identity', new Map([...CANONICAL_OUTCOME_LOOKUP].filter(([id]) => id !== 'out_new_arr'))],
    [
      'source label drift',
      new Map([
        ...CANONICAL_OUTCOME_LOOKUP,
        ['fac_partner_invest', { id: 'fac_partner_invest', label: 'Different source', kind: 'factor' as const }],
      ]),
    ],
    [
      'target label drift',
      new Map([
        ...CANONICAL_OUTCOME_LOOKUP,
        ['out_new_arr', { id: 'out_new_arr', label: 'Different outcome', kind: 'outcome' as const }],
      ]),
    ],
  ] as const)(
    'ARM 1E — %s preserves the current grounded card byte-for-byte',
    (_case, lookup) => {
      const fact = considerOppositeFact(FRAGILE_ROWS);
      const selection = selectLens(fact, { previousAnalysisLens: null })!;
      const priorGroundedCopy = selectGroundedCounterCase(fact.result.enrichment).grounded!
        .counterCase;
      const block = buildLensCompanionBlocks(
        fact,
        CTX,
        selection,
        [],
        lookup as GraphNodeLookup,
      )[0]!;

      expect(block.counter_case).toBe(priorGroundedCopy);
    },
  );

  it.each([
    ['route veto', 'Partner Channel Investment', 'Why Customers Churn'],
    ['value-route veto', 'Operating Profit Uplift', 'Raise Group Operating Profit by 8% Within 18 Months'],
    ['analytical-route veto', 'Partner Channel Investment', 'What Could Change the Outcome'],
    ['length overflow', 'A'.repeat(40), 'B'.repeat(20)],
  ])('ARM 1F — %s preserves the current grounded card byte-for-byte', (_case, from, to) => {
    const rows = [
      {
        from_id: 'fac_source',
        to_id: 'out_target',
        from_label: from,
        to_label: to,
        switch_probability: 0.19,
      },
    ];
    const fact = considerOppositeFact(rows);
    const selection = selectLens(fact, { previousAnalysisLens: null })!;
    const priorGroundedCopy = selectGroundedCounterCase(fact.result.enrichment).grounded!
      .counterCase;
    const lookup: GraphNodeLookup = new Map([
      ...LOOKUP,
      ['fac_source', { id: 'fac_source', label: from, kind: 'factor' as const }],
      ['out_target', { id: 'out_target', label: to, kind: 'outcome' as const }],
    ]);
    const block = buildLensCompanionBlocks(fact, CTX, selection, [], lookup)[0]!;

    expect(block.counter_case).toBe(priorGroundedCopy);
    expect(block.counter_case).not.toContain('[your driver]');
  });

  it('ARM 2 — with no fragile edges, the block falls back and still ships', () => {
    const fact = considerOppositeFact(undefined);
    const selection = selectLens(fact, { previousAnalysisLens: null });
    expect(selection!.lens).toBe('consider_opposite');

    const blocks = buildLensCompanionBlocks(fact, CTX, selection!, [], LOOKUP);

    // The intervention MUST NOT vanish when grounding is unavailable.
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.counter_case).toBe(FIXED_COPY);
  });

  it('ARM 3 — an ungroundable label costs the grounding, never the card', () => {
    // A producer label carrying a raw decimal trips the prose gate. Before this
    // lane's early-ask, that would have dropped the entire exercise block at
    // `validateProseAndSchemaOrDrop` and shipped no intervention at all.
    const fact = considerOppositeFact([
      {
        from_id: 'fac_x',
        to_id: 'out_y',
        from_label: 'Margin above 0.78 threshold',
        to_label: 'Net New ARR Generated',
      },
    ]);
    const selection = selectLens(fact, { previousAnalysisLens: null });
    const blocks = buildLensCompanionBlocks(fact, CTX, selection!, [], LOOKUP);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.counter_case).toBe(FIXED_COPY);
  });
});
