/**
 * `opportunity_cost` ExerciseBlock — ROADMAP 2.1299.
 *
 * WHAT THIS SUITE IS FOR, and what it deliberately does not try to be.
 *
 * Every expectation about the SCIENCE is DERIVED from `data/dsk/v1.json` at run
 * time, never restated here (trap 12 — a hand-copied protocol title is a mirror
 * that drifts silently, and the badge's entire claim is that its text is the
 * published record's). Every expectation about an OPTION binds to the graph node
 * by `id`, never by a label or a value predicate another node could satisfy
 * (trap 19).
 *
 * The gates are DSK-TR-004's, so the suppression cases below are assertions
 * about the BUNDLE's selection rule, not about a threshold this lane chose. Each
 * of the seven prior-discussion markers is driven individually: a silent
 * truncation of that array is exactly the hand-maintained-mirror failure that an
 * aggregate "some marker suppresses" test could not see.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sanitiseOlumiResponseForEgress } from '../../compose/output-safety.js';

import {
  deriveIntakeOptionReconciliation,
  readGraphOptionLabels,
} from '../../../orchestrator/context/intake-option-reconciliation.js';
import type { GraphV3T } from '../../../orchestrator/types.js';
import {
  OPPORTUNITY_COST_DSK_PROTOCOL_ID,
  OPPORTUNITY_COST_INSTRUCTION,
  OPPORTUNITY_COST_LABEL_BUDGET,
  OPPORTUNITY_COST_OPTION_FLOOR,
  OPPORTUNITY_COST_PRIOR_DISCUSSION_MARKERS,
  OPPORTUNITY_COST_SOURCE_HANDLER,
  buildDraftOpportunityCostBlocks,
  composeOpportunityCostCounterCase,
  readGraphOptionNodes,
} from '../draft-opportunity-cost-block.js';

const CREATED_AT = '2026-08-17T12:00:00.000Z';

/** The bundle, read fresh — the single source of truth for every DSK expectation. */
function dskObject(id: string): Record<string, unknown> {
  const bundlePath = resolve(process.cwd(), 'data/dsk/v1.json');
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as {
    objects: readonly Record<string, unknown>[];
  };
  const found = bundle.objects.find((o) => o.id === id);
  if (found === undefined) throw new Error(`DSK object ${id} absent from bundle`);
  return found;
}

function optionNode(id: string, label: string): Record<string, unknown> {
  return { id, kind: 'option', label };
}

function graphWith(nodes: readonly Record<string, unknown>[]): GraphV3T {
  return { nodes, edges: [] } as unknown as GraphV3T;
}

/** Three distinct options, no trade-off language anywhere. The firing fixture. */
const THREE_OPTIONS = graphWith([
  optionNode('opt_build', 'Build in-house'),
  optionNode('opt_buy', 'Buy the vendor platform'),
  optionNode('opt_partner', 'Partner with an integrator'),
  { id: 'fac_cost', kind: 'factor', label: 'Total cost' },
  { id: 'goal_ship', kind: 'goal', label: 'Ship by Q1' },
]);

const NEUTRAL_BRIEF =
  'We need to decide how to deliver the payments platform this year. Build in-house, buy the vendor platform, or partner with an integrator.';

function build(overrides: Partial<Parameters<typeof buildDraftOpportunityCostBlocks>[0]> = {}) {
  return buildDraftOpportunityCostBlocks({
    analysisReady: { status: 'ready' },
    graph: THREE_OPTIONS,
    briefText: NEUTRAL_BRIEF,
    createdAt: CREATED_AT,
    ...overrides,
  });
}

describe('opportunity_cost exercise — emission', () => {
  it('emits exactly one exercise block with exercise_kind opportunity_cost', () => {
    const blocks = build();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('exercise');
    expect(blocks[0]?.exercise_kind).toBe('opportunity_cost');
    expect(blocks[0]?.source_handler).toBe(OPPORTUNITY_COST_SOURCE_HANDLER);
    expect(blocks[0]?.freshness).toBe('fresh');
    expect(blocks[0]?.created_at).toBe(CREATED_AT);
  });

  it('binds target_refs to the persisted option nodes BY ID, in graph order, with the user own labels', () => {
    const refs = build()[0]?.target_refs ?? [];
    // Identity, not count: the exact ids the graph carries as options, and
    // nothing else. `fac_cost` / `goal_ship` must NOT appear.
    expect(refs.map((r) => r.id)).toEqual(['opt_build', 'opt_buy', 'opt_partner']);
    expect(refs.map((r) => r.label)).toEqual([
      'Build in-house',
      'Buy the vendor platform',
      'Partner with an integrator',
    ]);
    expect(refs.every((r) => r.kind === 'option')).toBe(true);
  });

  it('names no option the persisted graph does not carry, and quotes the user own labels verbatim', () => {
    const counterCase = build()[0]?.counter_case ?? '';
    for (const label of ['Build in-house', 'Buy the vendor platform', 'Partner with an integrator']) {
      expect(counterCase).toContain(`"${label}"`);
    }
    // The non-option nodes' labels are not the subject of this card.
    expect(counterCase).not.toContain('Total cost');
    expect(counterCase).not.toContain('Ship by Q1');
  });

  it('never leaks a node id into the user-facing prose', () => {
    const block = build()[0];
    const prose = [
      block?.counter_case,
      block?.failure_scenario,
      block?.mitigation,
      block?.reference_class,
      block?.review_trigger,
      ...(block?.warning_signs ?? []),
    ]
      .filter((s): s is string => typeof s === 'string')
      .join(' ');
    for (const id of ['opt_build', 'opt_buy', 'opt_partner', 'fac_cost', 'goal_ship']) {
      expect(prose).not.toContain(id);
    }
  });

  it('populates counter_case, the field the deployed renderer needs to show anything at all', () => {
    // The UI adapter fails closed when none of the six optional prose fields is
    // present (`malformed_phase3_block_suppressed`). This asserts the card can
    // never be built into that invisible state.
    const block = build()[0];
    expect(typeof block?.counter_case).toBe('string');
    expect((block?.counter_case ?? '').length).toBeGreaterThan(0);
    expect(block?.counter_case).toContain(OPPORTUNITY_COST_INSTRUCTION.trim());
  });

  it('emits a deterministic block_id keyed on the option SET identity', () => {
    const first = build()[0];
    const second = build()[0];
    expect(first?.block_id).toBe(second?.block_id);
    // A different option set is a different card.
    const other = build({
      graph: graphWith([
        optionNode('opt_build', 'Build in-house'),
        optionNode('opt_buy', 'Buy the vendor platform'),
        optionNode('opt_licence', 'Licence from Acme'),
      ]),
    })[0];
    expect(other?.block_id).not.toBe(first?.block_id);
  });
});

describe('opportunity_cost exercise — DSK grounding is the bundle record, not our prose', () => {
  it('carries the DSK-P-004 protocol triple exactly as the bundle states it', () => {
    const record = dskObject(OPPORTUNITY_COST_DSK_PROTOCOL_ID);
    const provenance = build()[0]?.dsk_provenance;
    expect(provenance).toBeDefined();
    expect(provenance?.protocol_id).toBe('DSK-P-004');
    expect(provenance?.protocol_title).toBe(record.title);
    expect(provenance?.evidence_strength).toBe(record.evidence_strength);
  });

  it('cites a protocol whose linked claim is DSK-T-004, the opportunity-cost-neglect claim', () => {
    // Guards against the badge naming a protocol that has nothing to do with
    // this card's subject — "the id exists" is not the question (#830).
    const protocol = dskObject(OPPORTUNITY_COST_DSK_PROTOCOL_ID);
    expect(protocol.linked_claim_id).toBe('DSK-T-004');
    expect(dskObject('DSK-T-004').title).toBe('Opportunity cost neglect');
  });

  it('promises the user no improvement in decision quality, which the evidence pack does not support', () => {
    // DSK-T-004's own evidence_pack records the meta-analytic effect as far
    // smaller than the original and calls the original a likely outlier. The
    // copy must therefore make no efficacy claim at all.
    const counterCase = build()[0]?.counter_case ?? '';
    for (const forbidden of [
      'better decision',
      'improve',
      'improves',
      'research shows',
      'studies show',
      'proven',
    ]) {
      expect(counterCase.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('opportunity_cost exercise — DSK-TR-004 suppression rules', () => {
  it('stays silent below the bundle option floor, including a binary go/no-go set', () => {
    expect(OPPORTUNITY_COST_OPTION_FLOOR).toBe(3);
    const twoOptions = graphWith([
      optionNode('opt_go', 'Go ahead now'),
      optionNode('opt_wait', 'Wait a quarter'),
    ]);
    expect(build({ graph: twoOptions })).toEqual([]);
    expect(build({ graph: graphWith([optionNode('opt_go', 'Go ahead now')]) })).toEqual([]);
    expect(build({ graph: graphWith([]) })).toEqual([]);
    expect(build({ graph: null })).toEqual([]);
    expect(build({ graph: undefined })).toEqual([]);
  });

  it.each(OPPORTUNITY_COST_PRIOR_DISCUSSION_MARKERS)(
    'stays silent when the brief already raises %s',
    (marker) => {
      const brief = `${NEUTRAL_BRIEF} We have discussed ${marker} at length already.`;
      expect(build({ briefText: brief })).toEqual([]);
    },
  );

  it('drives every marker the bundle heuristic lists, so a truncated array cannot pass', () => {
    // The it.each above is only as strong as the array it iterates. This pins
    // the array against DSK-TR-004's observable_signal, which spells the seven
    // markers out verbatim.
    const signal = String(dskObject('DSK-TR-004').observable_signal).toLowerCase();
    expect(OPPORTUNITY_COST_PRIOR_DISCUSSION_MARKERS).toHaveLength(7);
    for (const marker of OPPORTUNITY_COST_PRIOR_DISCUSSION_MARKERS) {
      expect(signal).toContain(marker);
    }
  });

  it('is case-insensitive about prior discussion', () => {
    expect(build({ briefText: `${NEUTRAL_BRIEF} The TRADE-OFF is understood.` })).toEqual([]);
  });

  it('stays silent unless analysisReady is ready', () => {
    for (const analysisReady of [
      undefined,
      null,
      {},
      { status: undefined },
      { status: 'stale' },
      { status: 'unknown' },
      { status: 'none' },
      { status: 'pending' },
    ]) {
      expect(build({ analysisReady })).toEqual([]);
    }
  });
});

describe('opportunity_cost exercise — trap-21 anti-collision (the repair state)', () => {
  /**
   * A brief that names options the graph does not carry. Two are missing, which
   * is what the reconciler needs to reach `options_missing` — one missing option
   * returns `not_applicable`, measured.
   */
  const BRIEF_OPTIONS_MISSING =
    'Options: build in-house, buy the vendor platform, partner with an integrator, licence the engine from Acme Corp, or acquire Bettersoft outright.';

  it('PRECONDITION PINNED: the fixture really drives the reconciler to options_missing on THIS graph shape', () => {
    // Without this, the suppression assertion below could pass for any other
    // reason and the gate's discrimination would be unguarded at rest (13b).
    const labels = readGraphOptionNodes(THREE_OPTIONS).map((o) => o.label);
    expect(labels).toHaveLength(3);
    expect(deriveIntakeOptionReconciliation(BRIEF_OPTIONS_MISSING, labels).state).toBe(
      'options_missing',
    );
  });

  it('PRECONDITION PINNED: the firing fixture does NOT drive it to options_missing', () => {
    const labels = readGraphOptionNodes(THREE_OPTIONS).map((o) => o.label);
    expect(deriveIntakeOptionReconciliation(NEUTRAL_BRIEF, labels).state).not.toBe(
      'options_missing',
    );
  });

  it('stays silent when the product lost an option the user named', () => {
    // The product is in a REPAIR state. A card telling the user what the
    // remaining options cost, on a turn where one of their own options went
    // missing, would be the product changing the subject away from its error —
    // and this card's whole claim is that the set it names is the set the model
    // holds.
    expect(build({ briefText: BRIEF_OPTIONS_MISSING })).toEqual([]);
  });

  it('does not route the reconciler through readGraphOptionLabels, which is blind to this graph shape', () => {
    // Pins the reason gate 4 can fire at all. `readGraphOptionLabels` reads
    // `source.options`; a `{nodes, edges}` graph has none, so it returns [] —
    // and the reconciler on [] cannot reach `options_missing`. A refactor that
    // "tidied" gate 4 to use that helper would silently make the gate a no-op,
    // and this assertion is what would go red.
    expect(readGraphOptionLabels(THREE_OPTIONS)).toEqual([]);
    expect(deriveIntakeOptionReconciliation(BRIEF_OPTIONS_MISSING, []).state).not.toBe(
      'options_missing',
    );
  });
});

describe('opportunity_cost exercise — composition rules', () => {
  it('falls back to the count-only sentence when the label clause exceeds its budget', () => {
    const long = Array.from({ length: 6 }, (_, i) =>
      optionNode(`opt_${i}`, `A deliberately verbose option label number ${i} for budget testing`),
    );
    const counterCase = composeOpportunityCostCounterCase(readGraphOptionNodes(graphWith(long)));
    expect(counterCase).toContain('You have 6 options in this model.');
    expect(counterCase).not.toContain('"A deliberately verbose option label number 0');
    // Truth is preserved even when specificity is not.
    expect(counterCase).toContain(OPPORTUNITY_COST_INSTRUCTION.trim());
    // And the identity channel still carries every option.
    const blocks = build({ graph: graphWith(long) });
    expect(blocks[0]?.target_refs.map((r) => r.id)).toEqual([
      'opt_0',
      'opt_1',
      'opt_2',
      'opt_3',
      'opt_4',
      'opt_5',
    ]);
  });

  it('keeps the named form when the label clause fits its budget', () => {
    const counterCase = composeOpportunityCostCounterCase(readGraphOptionNodes(THREE_OPTIONS));
    expect(counterCase).toContain('You have 3 options in this model: "Build in-house"');
    const quoted = readGraphOptionNodes(THREE_OPTIONS)
      .map((o) => `"${o.label}"`)
      .join(', ');
    expect(quoted.length).toBeLessThanOrEqual(OPPORTUNITY_COST_LABEL_BUDGET);
  });

  it('reads only option-kind nodes, and skips nodes missing an id or a label', () => {
    const messy = graphWith([
      optionNode('opt_ok', 'Fine option'),
      { id: '', kind: 'option', label: 'No id' },
      { id: 'opt_nolabel', kind: 'option', label: '' },
      { id: 'opt_nonstring', kind: 'option', label: 42 },
      { kind: 'option', label: 'Missing id entirely' },
      { id: 'fac_x', kind: 'factor', label: 'A factor' },
    ]);
    expect(readGraphOptionNodes(messy).map((o) => o.id)).toEqual(['opt_ok']);
  });
});

describe('opportunity_cost exercise — P1: one seam BEYOND the builder (the egress chokepoint)', () => {
  /**
   * The builder's own gates are correct at the builder. The seam past them is
   * `sanitiseOlumiResponseForEgress` — the single function every outgoing
   * `blocks[]` payload passes through, and the one that decides whether this
   * card reaches a user at all. These drive the REAL chain
   * (builder → egress) rather than asserting on the builder's return.
   */
  function throughEgress(blocks: readonly unknown[], graph: GraphV3T | null) {
    return sanitiseOlumiResponseForEgress(
      {
        response_version: 2,
        assistant_text: 'Here is the model I drafted from your brief.',
        blocks: blocks as never,
        suggested_actions: [],
        insights: [],
      } as unknown as Parameters<typeof sanitiseOlumiResponseForEgress>[0],
      { graph, requestId: 'test', exitPath: 'test', userMessage: null } as never,
    );
  }

  it('survives egress with the block, its kind and its identity refs intact', () => {
    const built = build();
    expect(built).toHaveLength(1);
    const out = throughEgress(built, THREE_OPTIONS);
    const exercise = (out.blocks ?? []).find(
      (b) => (b as { type?: string }).type === 'exercise',
    ) as Record<string, unknown> | undefined;
    expect(exercise).toBeDefined();
    expect(exercise?.exercise_kind).toBe('opportunity_cost');
    // The identity channel is not collateral of the prose scrub.
    expect((exercise?.target_refs as { id: string }[]).map((r) => r.id)).toEqual([
      'opt_build',
      'opt_buy',
      'opt_partner',
    ]);
    // The badge survives, so the grounding reaches the user.
    expect((exercise?.dsk_provenance as Record<string, unknown>)?.protocol_id).toBe('DSK-P-004');
  });

  it('does not have its option labels erased by the entity-id scrub', () => {
    // The scrub replaces leaked ids in prose. The labels are the USER's words
    // and must come through verbatim — if they did not, the card would render a
    // sentence with holes in it and still look structurally valid.
    const out = throughEgress(build(), THREE_OPTIONS);
    const exercise = (out.blocks ?? []).find(
      (b) => (b as { type?: string }).type === 'exercise',
    ) as Record<string, unknown> | undefined;
    const counterCase = String(exercise?.counter_case ?? '');
    for (const label of ['Build in-house', 'Buy the vendor platform', 'Partner with an integrator']) {
      expect(counterCase).toContain(`"${label}"`);
    }
  });

  it('leaves the surrounding response content intact when the card is present', () => {
    const out = throughEgress(build(), THREE_OPTIONS);
    expect(out.assistant_text).toBe('Here is the model I drafted from your brief.');
  });

  it('leaves the surrounding response content intact when the card is SUPPRESSED', () => {
    // The absence path is the common one (this card is rare). A suppression must
    // cost the card and nothing else.
    const suppressed = build({ analysisReady: { status: 'stale' } });
    expect(suppressed).toEqual([]);
    const out = throughEgress(suppressed, THREE_OPTIONS);
    expect(out.assistant_text).toBe('Here is the model I drafted from your brief.');
    expect(out.blocks ?? []).toHaveLength(0);
  });
});

describe('opportunity_cost exercise — P8: it asks for nothing it cannot accept', () => {
  it('carries no chip, no action ref and no add-to-model promise', () => {
    const block = build()[0] as unknown as Record<string, unknown>;
    // ExerciseBlock is `.strict()` and declares no action field at all, so the
    // guarantee is structural. This pins it against a future widening of the
    // block shape that would let one in silently.
    for (const key of [
      'suggested_actions',
      'action_label',
      'action_id',
      'confirm_action_id',
      'chip',
      'chips',
    ]) {
      expect(block).not.toHaveProperty(key);
    }
    const counterCase = String(block.counter_case ?? '').toLowerCase();
    // DSK-P-004 step 3's promise is deliberately absent: adding an option is a
    // structural mutation, which graph management holds.
    for (const promise of [
      'we can include them in the model',
      'add them to the model',
      'i can add',
      "i'll add",
      'added to your model',
    ]) {
      expect(counterCase).not.toContain(promise);
    }
  });
});
