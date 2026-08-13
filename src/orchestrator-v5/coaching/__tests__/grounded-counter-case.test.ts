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

import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import {
  buildLensCompanionBlocks,
  type BlockBuildCtx,
  type GraphNodeLookup,
} from '../../compose/phase3-blocks.js';
import { selectLens } from '../../compose/lens-selector.js';
import { selectGroundedCounterCase } from '../grounded-counter-case.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, '..', '..', 'compose', '__tests__', 'fixtures', 'dsk-walk');

function liveEnrichment(name: 'session-a' | 'session-b2'): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.enrichment.json`), 'utf8'));
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

  it('consumes the producer\'s order and never re-ranks', () => {
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
