/**
 * ⭐⭐ THE EDIT SEAM MAY NOT MANUFACTURE THE STATE THE ANALYSIS GATE REFUSES.
 *
 * ── THE DECISION THIS SUITE PINS ────────────────────────────────────────────
 * A user takes the product's own advice — "setting a real value would make this
 * result more trustworthy" — types a magnitude into the editor, reruns, and is
 * REFUSED (`baseline_scale_unresolved`, wire-witnessed 3/3 on staging). The same
 * magnitude stated in the BRIEF is framed by records pass 3d and analyses fine.
 * Same number, same factor, two doors, two outcomes.
 *
 * ── THE INVARIANT, WRITTEN AGAINST THE SPEC AND NOT THE SYMPTOM (trap 13d) ──
 *   "A value the drafting path would have framed is framed IDENTICALLY at the
 *    edit seam."
 * Not "600000 becomes 0.6" — that is the case I came in through. The spec is
 * the equality of the two seams, and it is asserted by running BOTH.
 *
 * ── TWO DOORS ARE WATCHED, NOT ONE (trap 22b) ───────────────────────────────
 * One predicate guards two OPPOSITE harms and therefore needs two parameters:
 *   · GAP — not framing a magnitude that needs it leaves the refusal standing.
 *   · LIE — framing one that does not silently rescales the user's number.
 *           NRR 1.10 on `nextNiceNumberAbove(1.10) = 2` is 0.55, a 2×
 *           distortion; on other magnitudes the same mistake is 100×.
 * Every danger case below is therefore shown in BOTH directions: what the
 * product does now, AND what the harm would have looked like had the guard been
 * keyed loosely. A suite that only watches the money door is how this estate
 * has traded one silent failure for its inverse four times on one predicate.
 */

import { describe, expect, it } from 'vitest';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { findScaleIncoherentBaselineFactorIds } from '../../plot-intervention-scale.js';
import {
  deriveFactorScaleFrame,
  nextNiceNumberAbove,
} from '../d1-shared/scale-frame.js';
import {
  factorCarriesNormalisedInterventions,
  magnitudeIsUnambiguouslyScaleBearing,
} from '../d1-shared/frame-edited-baseline.js';
import { projectRecordsToGraph } from '../../../../cee/draft/records/projector.js';
import type { DraftRecordSet } from '../../../../cee/draft/records/grammar.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';

// ── Harness ────────────────────────────────────────────────────────────────

function buildInvocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-1',
      stage: 'frame',
      request_id: 'req-1',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-1',
      turn_id: 'turn-1',
      stage: 'frame',
      message: 'set the value',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function makeProposal(entityId: string, value: unknown): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: entityId,
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'value', value, operator: 'set', source: 'user_explicit' },
    ],
    cited_context_fields: [],
  };
}

/**
 * The one edge shape `GraphV3` actually validates (mirrors `buildD1Fixture`).
 * Options reach factors through `interventions`, never through edges.
 */
const TARGET_EDGE = {
  from: 'f-target',
  to: 'g-goal',
  strength: { mean: 0.4, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive',
} as const;

interface ObservedPair {
  readonly value?: number;
  readonly raw_value?: number;
  readonly unit?: string;
  readonly cap?: number;
}

/**
 * One factor, one goal, two options. The options' interventions sit INSIDE
 * [0,1] deliberately: an out-of-unit user-authored intervention would make the
 * factor SELF-FRAMED, which the analysis gate exempts — that exemption is
 * itself pinned below, so it must not be smuggled in as a background condition
 * of every other case.
 */
function graphWithFactor(observed: ObservedPair | undefined): GraphV3T {
  return {
    nodes: [
      { id: 'g-goal', kind: 'goal', label: 'Goal' },
      {
        id: 'f-target',
        kind: 'factor',
        label: 'Annual Licence Cost',
        ...(observed !== undefined ? { observed_state: observed } : {}),
      },
      { id: 'opt-a', kind: 'option', label: 'Committed', interventions: { 'f-target': { value: 0.6 } } },
      { id: 'opt-b', kind: 'option', label: 'Status quo', interventions: { 'f-target': { value: 0.3 } } },
    ],
    edges: [TARGET_EDGE],
  } as unknown as GraphV3T;
}

/** Drive the real handler and return the target factor's persisted pair. */
async function editFactor(
  graph: GraphV3T,
  value: unknown,
): Promise<{ readonly pair: ObservedPair; readonly mutated: GraphV3T }> {
  const outcome = await createSetFactorValueHandler()(
    buildInvocation(graph, makeProposal('f-target', value)),
  );
  const mutated = outcome.mutated_graph as GraphV3T;
  const node = mutated.nodes.find((n) => n.id === 'f-target');
  expect(node, 'the target factor must survive the mutation — bind by id, never by value').toBeDefined();
  return { pair: node!.observed_state as ObservedPair, mutated };
}

/**
 * THE ANALYSIS GATE'S OWN VERDICT on a post-edit graph, asked by calling the
 * gate. Membership is asserted by factor ID — never by a value predicate
 * another node could satisfy (trap 19).
 */
function analysisRefusesTarget(graph: GraphV3T): boolean {
  const perOption = graph.nodes
    .filter((n) => (n as { interventions?: unknown }).interventions !== undefined)
    .map((n) => (n as unknown as { interventions: Record<string, unknown> }).interventions);
  return findScaleIncoherentBaselineFactorIds(graph.nodes, perOption).includes('f-target');
}

// ── 1. THE MONEY CASE — the journey the probe is about ──────────────────────

describe('EDIT SEAM · money magnitude · the refusal the product advised the user into', () => {
  it('RED-FIRST: £600,000 typed into a "Not set" factor is FRAMED to level 0.6 and the analysis gate ADMITS it', async () => {
    const { pair, mutated } = await editFactor(graphWithFactor(undefined), {
      value: 600000,
      unit: '£',
    });

    // The level the analysis computes on.
    expect(pair.value, 'the persisted level must be the framed 0.6, not the raw 600000').toBe(0.6);
    // ⭐ THE USER'S OWN NUMBER STAYS ON SCREEN — `raw_value` is what the display
    // chain and the delta operators read.
    expect(pair.raw_value, "the user's magnitude must survive verbatim in raw_value").toBe(600000);
    expect(pair.unit).toBe('£');
    // No cap is invented: a stored cap would flip every later edit to
    // cap-normalised writes and break the user-scale round-trip.
    expect(pair.cap, 'framing must NOT persist a cap — pass 3d deliberately does not').toBeUndefined();

    // The decision this probe changes, asked of the gate itself.
    expect(
      analysisRefusesTarget(mutated),
      'the analysis gate must no longer refuse the factor the user just set',
    ).toBe(false);
  });

  it('the estate\'s own pinned fixture, reproduced by EXECUTION rather than by hand: 600000 lands on exactly the level opt_a already carries', () => {
    // `run-analysis-money-brief-scaffold-raw-value.test.ts` pins a graph whose
    // f_raw baseline is {value: 600000, unit: '£'} beside an opt_a intervention
    // of 0.6. If the frame is right, the baseline must land ON that level.
    expect(nextNiceNumberAbove(600000)).toBe(1_000_000);
    expect(deriveFactorScaleFrame([600000], '£')).toBe(1_000_000);
    expect(600000 / 1_000_000).toBe(0.6);
  });

  it('a stored raw baseline is rescued too, not just a first-time set', async () => {
    const { pair, mutated } = await editFactor(
      graphWithFactor({ value: 600000, raw_value: 600000, unit: '£' }),
      750000,
    );
    expect(pair.value).toBe(0.75);
    expect(pair.raw_value).toBe(750000);
    expect(analysisRefusesTarget(mutated)).toBe(false);
  });
});

// ── 2. THE SPEC INVARIANT — the two seams must agree ────────────────────────

describe('SPEC · a value the DRAFTING path would have framed is framed IDENTICALLY at the edit seam', () => {
  const GOLDEN: DraftRecordSet = {
    stated_items: [
      { kind: 'goal', source_quote: 'higher sales productivity without blowing the budget' },
      { kind: 'option', source_quote: 'replace our current CRM with HubSpot next quarter' },
      { kind: 'option', source_quote: 'keep what we have' },
    ],
    claims: [
      { claim_kind: 'factor', label: 'Annual CRM Licence Cost', value: 600000 },
      { claim_kind: 'causal_link', label: 'switching changes licence cost', from_stated: 1, to_claim: 0, effect: 'negative', sets_to: 600000 },
      { claim_kind: 'causal_link', label: 'staying holds licence cost', from_stated: 2, to_claim: 0, effect: 'positive', sets_to: 300000 },
      { claim_kind: 'causal_link', label: 'licence cost bears on the goal', from_claim: 0, to_stated: 0, effect: 'negative' },
    ],
  };

  it('both seams place £600,000 on the SAME level — run against each other, not against a remembered number', async () => {
    // Door 1: the DRAFTING path.
    const { graph: drafted } = projectRecordsToGraph(GOLDEN);
    const draftedFactor = drafted.nodes.find((n) => n.label === 'Annual CRM Licence Cost');
    expect(draftedFactor, 'drafting-path precondition: the factor must exist').toBeDefined();
    const draftedPair = draftedFactor!.observed_state as ObservedPair;

    // PIN THE PRECONDITION IN-TEST (trap 13b): this comparison is only
    // meaningful if the drafting path actually FRAMED — an unframed draft would
    // make the two sides agree for the wrong reason.
    expect(
      draftedPair.raw_value,
      'precondition: the drafting path must have framed this magnitude',
    ).toBe(600000);
    expect(draftedPair.value).not.toBe(600000);

    // Door 2: the EDIT seam, same magnitude, no cap, same unit class.
    const { pair: editedPair } = await editFactor(graphWithFactor(undefined), {
      value: 600000,
      unit: '£',
    });

    expect(
      editedPair.value,
      'THE INVARIANT: the edit seam must land on the level the drafting path chose',
    ).toBe(draftedPair.value);
    expect(editedPair.raw_value).toBe(draftedPair.raw_value);
  });
});

// ── 3. ⚠ THE DANGER CASES — each shown in BOTH directions ──────────────────

describe('DANGER · a ratio that can exceed 100% must NOT be framed (this passes BEFORE and AFTER the fix)', () => {
  it('NRR 1.10 typed into a capless frameless factor is preserved EXACTLY — no frame, no rescale', async () => {
    const { pair } = await editFactor(graphWithFactor(undefined), 1.1);
    expect(pair.value, 'NRR 1.10 must survive as 1.10 — framing it would be a 2× lie').toBe(1.1);
    expect(pair.raw_value).toBe(1.1);
  });

  it('THE OTHER DIRECTION: this is exactly the 2× distortion a loosely-keyed guard would have shipped', () => {
    // The harm, made visible rather than asserted away. `deriveFactorScaleFrame`
    // WILL frame 1.10 if asked — it is the SAFETY conjunct, not the derivation,
    // that keeps this off the wire.
    expect(nextNiceNumberAbove(1.1)).toBe(2);
    expect(deriveFactorScaleFrame([1.1], undefined)).toBe(2);
    expect(1.1 / 2).toBe(0.55); // ← what the user would have silently received
    // And the guard that refuses it:
    expect(magnitudeIsUnambiguouslyScaleBearing(1.1, undefined)).toBe(false);
  });

  it('NRR stated as 110 PERCENTAGE POINTS is refused too — above its own percent convention', async () => {
    // `deriveFactorScaleFrame`'s percent branch is bounded at max <= 100. A '%'
    // magnitude ABOVE that bound falls onto the generic ladder (frame 200 →
    // 0.55), which is the unbounded-ratio class the prompt names.
    expect(deriveFactorScaleFrame([110], '%')).toBe(200);
    expect(magnitudeIsUnambiguouslyScaleBearing(110, '%')).toBe(false);
    const { pair } = await editFactor(graphWithFactor(undefined), { value: 110, unit: '%' });
    expect(pair.value, '110% must not be silently halved').toBe(110);
    expect(pair.raw_value).toBe(110);
  });

  it('a BOUNDED percentage stays inside the declared convention and IS framed on 100', async () => {
    // The contrast control for the two cases above: the percent branch is not
    // dead, it is bounded. Without this, "percent is never framed" would pass
    // for the wrong reason.
    expect(deriveFactorScaleFrame([50], '%')).toBe(100);
    expect(magnitudeIsUnambiguouslyScaleBearing(50, '%')).toBe(true);
    const { pair, mutated } = await editFactor(graphWithFactor(undefined), { value: 50, unit: '%' });
    expect(pair.value).toBe(0.5);
    expect(pair.raw_value).toBe(50);
    expect(analysisRefusesTarget(mutated)).toBe(false);
  });
});

describe('DANGER · a small unitless count must NOT be framed (this passes BEFORE and AFTER the fix)', () => {
  it('a headcount of 5 is preserved EXACTLY — "small unitless counts (0-10) may remain raw"', async () => {
    const { pair } = await editFactor(graphWithFactor(undefined), 5);
    expect(pair.value).toBe(5);
    expect(pair.raw_value).toBe(5);
  });

  it('THE OTHER DIRECTION: the derivation would have framed it; the guard is what declines', () => {
    expect(deriveFactorScaleFrame([5], undefined)).toBe(10); // the harm available
    expect(magnitudeIsUnambiguouslyScaleBearing(5, undefined)).toBe(false); // the guard
  });

  it('the ceiling is a boundary, not a cliff nobody pinned: 10 stays raw, 11 is framed', async () => {
    expect(magnitudeIsUnambiguouslyScaleBearing(10, undefined)).toBe(false);
    expect(magnitudeIsUnambiguouslyScaleBearing(11, undefined)).toBe(true);
    const at = await editFactor(graphWithFactor(undefined), 10);
    expect(at.pair.value).toBe(10);
    const above = await editFactor(graphWithFactor(undefined), 11);
    expect(above.pair.raw_value).toBe(11);
    expect(above.pair.value).toBe(11 / 20);
  });
});

describe('DANGER · an ALREADY-FRAMED factor is untouched — the existing framed branch still owns it', () => {
  it('a second edit on a {0.5, 50000} factor takes normalise-factor-value.ts:159-163, not the new path', async () => {
    const { pair, mutated } = await editFactor(
      graphWithFactor({ value: 0.5, raw_value: 50000, unit: '£' }),
      74000,
    );
    // The RECOVERED frame is 100000 (50000 / 0.5) — NOT the DERIVED frame the
    // new path would have chosen for 74000 (which is 100000 too by coincidence
    // of the ladder, so the discriminating case is below).
    expect(pair.value).toBe(0.74);
    expect(pair.raw_value).toBe(74000);
    expect(analysisRefusesTarget(mutated)).toBe(false);
  });

  it('DISCRIMINATING: a frame the ladder would NOT have chosen is PRESERVED, proving the old branch ran', async () => {
    // frame = 30000 / 0.5 = 60000, which is not a {1,2,5}·10^k number, so the
    // derivation could never produce it. If the new path had taken over, 45000
    // would land on 45000/50000 = 0.9. The recovered frame gives 0.75.
    const { pair } = await editFactor(
      graphWithFactor({ value: 0.5, raw_value: 30000, unit: '£' }),
      45000,
    );
    expect(deriveFactorScaleFrame([45000], '£'), 'the ladder would have chosen 50000').toBe(50000);
    expect(pair.value, 'the RECOVERED frame 60000 must win, not the derived 50000').toBe(0.75);
    expect(pair.raw_value).toBe(45000);
  });

  it('an OVER-frame edit still yields an honest level > 1 and is still admitted', async () => {
    const { pair, mutated } = await editFactor(
      graphWithFactor({ value: 0.5, raw_value: 50000, unit: '£' }),
      500000,
    );
    expect(pair.value).toBe(5); // honest: 5× the frame, deliberately not re-framed
    expect(pair.raw_value).toBe(500000);
    expect(analysisRefusesTarget(mutated)).toBe(false);
  });
});

describe('DANGER · the SCOPE guard — a factor the analysis gate already admits is never touched', () => {
  it('a CAPPED factor keeps cap-normalised semantics exactly', async () => {
    const { pair } = await editFactor(
      graphWithFactor({ value: 0.4, raw_value: 40000, unit: '£', cap: 100000 }),
      50000,
    );
    expect(pair.value).toBe(0.5); // 50000 / cap, unchanged by this PR
    expect(pair.raw_value).toBe(50000);
    expect(pair.cap).toBe(100000);
  });

  it('a SELF-FRAMED factor is exempt — a user-authored out-of-unit intervention establishes its scale', async () => {
    // The gate exempts this factor, so the scope guard must decline even though
    // the magnitude is large and unitless. PIN THE PRECONDITION: the gate must
    // genuinely be exempting it, or this test proves nothing (trap 13b).
    const selfFramed = {
      nodes: [
        { id: 'g-goal', kind: 'goal', label: 'Goal' },
        { id: 'f-target', kind: 'factor', label: 'Headcount', observed_state: { value: 500, raw_value: 500 } },
        { id: 'opt-a', kind: 'option', label: 'Grow', interventions: { 'f-target': { value: 800 } } },
      ],
      edges: [TARGET_EDGE],
    } as unknown as GraphV3T;
    expect(
      analysisRefusesTarget(selfFramed),
      'precondition: the gate must already EXEMPT this factor, or the case is vacuous',
    ).toBe(false);

    const { pair } = await editFactor(selfFramed, 900);
    expect(pair.value, 'a self-framed factor must keep its raw convention').toBe(900);
    expect(pair.raw_value).toBe(900);
  });

  it('a baseline already inside [0,1] is never reframed', async () => {
    const { pair } = await editFactor(graphWithFactor({ value: 0.7 }), 0.8);
    expect(pair.value).toBe(0.8);
    expect(pair.raw_value).toBe(0.8);
  });

  it('a NEGATIVE magnitude is left alone — no truthful frame exists (sign-symmetric)', async () => {
    expect(deriveFactorScaleFrame([-5000], '£')).toBeUndefined();
    expect(magnitudeIsUnambiguouslyScaleBearing(-5000, '£')).toBe(false);
    const { pair } = await editFactor(graphWithFactor(undefined), { value: -5000, unit: '£' });
    expect(pair.value).toBe(-5000);
    expect(pair.raw_value).toBe(-5000);
  });
});

describe('DANGER · the EVIDENCE guard — no normalised siblings means nothing to be incoherent WITH', () => {
  /** The same graph, minus every option intervention. */
  function graphWithoutInterventions(observed: ObservedPair | undefined): GraphV3T {
    return {
      nodes: [
        { id: 'g-goal', kind: 'goal', label: 'Goal' },
        {
          id: 'f-target',
          kind: 'factor',
          label: 'Headcount',
          ...(observed !== undefined ? { observed_state: observed } : {}),
        },
        { id: 'opt-a', kind: 'option', label: 'Launch now' },
      ],
      edges: [TARGET_EDGE],
    } as unknown as GraphV3T;
  }

  it('⚠ THE REGRESSION THE ESTATE\'S OWN CORPUS CAUGHT: a unit-bearing COUNT factor stays raw at 20', async () => {
    // `set-factor-value-scale-redeclaration.test.ts:123` pins exactly this —
    // "ACCEPTS a legitimate small-COUNT edit on a unit-bearing count factor".
    // A magnitude-only guard framed it 20 → 0.4 under a green suite of my own.
    const { pair } = await editFactor(
      graphWithoutInterventions({ value: 12, raw_value: 12, unit: 'people' }),
      { value: 20, unit: 'people' },
    );
    expect(pair.value, 'a headcount with no normalised siblings must stay 20').toBe(20);
    expect(pair.raw_value).toBe(20);
    expect(pair.unit).toBe('people');
  });

  it('THE OTHER DIRECTION: the very same magnitude and unit IS framed once normalised siblings exist', async () => {
    // The discrimination is the SIBLINGS, not the magnitude and not the unit —
    // both are held constant across this pair, so only the evidence differs.
    const withSiblings = {
      nodes: [
        { id: 'g-goal', kind: 'goal', label: 'Goal' },
        { id: 'f-target', kind: 'factor', label: 'Headcount', observed_state: { value: 12, raw_value: 12, unit: 'people' } },
        { id: 'opt-a', kind: 'option', label: 'Launch now', interventions: { 'f-target': { value: 0.6 } } },
      ],
      edges: [TARGET_EDGE],
    } as unknown as GraphV3T;
    const { pair } = await editFactor(withSiblings, { value: 20, unit: 'people' });
    expect(pair.value, 'beside a normalised sibling, 20 IS the odd one out').toBe(20 / 50);
    expect(pair.raw_value).toBe(20);
  });

  it('even a MONEY magnitude is left alone when the factor has no normalised siblings', async () => {
    const { pair } = await editFactor(graphWithoutInterventions(undefined), {
      value: 600000,
      unit: '£',
    });
    expect(pair.value, 'no convention to be coherent with — leave the number alone').toBe(600000);
    expect(pair.raw_value).toBe(600000);
  });

  it('the predicate itself, both directions, on the gate\'s own extraction', () => {
    expect(factorCarriesNormalisedInterventions([], 'f')).toBe(false);
    expect(factorCarriesNormalisedInterventions([{}], 'f')).toBe(false);
    expect(factorCarriesNormalisedInterventions([{ other: { value: 0.5 } }], 'f')).toBe(false);
    expect(factorCarriesNormalisedInterventions([{ f: { value: 0.5 } }], 'f')).toBe(true);
    expect(factorCarriesNormalisedInterventions([{ f: 0.5 }], 'f')).toBe(true); // bare scalar spelling
    // An out-of-unit sibling is NOT a normalised convention.
    expect(factorCarriesNormalisedInterventions([{ f: { value: 800 } }], 'f')).toBe(false);
    expect(factorCarriesNormalisedInterventions([{ f: { value: 0.5 } }, { f: { value: 800 } }], 'f')).toBe(false);
  });
});

// ── 4. The predicate's own domain, stated against the spec ─────────────────

describe('magnitudeIsUnambiguouslyScaleBearing · the producer doctrine it encodes', () => {
  it('refuses everything at or below the prompt\'s raw-permitted ceiling', () => {
    for (const m of [0, 0.5, 1, 1.1, 2, 3, 5, 9.99, 10]) {
      expect(magnitudeIsUnambiguouslyScaleBearing(m, undefined), `magnitude ${m}`).toBe(false);
      expect(magnitudeIsUnambiguouslyScaleBearing(m, '£'), `magnitude ${m} with unit`).toBe(false);
    }
  });

  it('admits real-world magnitudes above it', () => {
    for (const m of [11, 18, 100, 40000, 600000, 1e9]) {
      expect(magnitudeIsUnambiguouslyScaleBearing(m, '£'), `magnitude ${m}`).toBe(true);
    }
  });

  it('bounds the percent and basis-point conventions at their OWN declared limits', () => {
    expect(magnitudeIsUnambiguouslyScaleBearing(100, '%')).toBe(true);
    expect(magnitudeIsUnambiguouslyScaleBearing(100.5, '%')).toBe(false);
    expect(magnitudeIsUnambiguouslyScaleBearing(100, 'per cent')).toBe(true); // British spelling
    expect(magnitudeIsUnambiguouslyScaleBearing(101, 'pct')).toBe(false);
    expect(magnitudeIsUnambiguouslyScaleBearing(10000, 'bps')).toBe(true);
    expect(magnitudeIsUnambiguouslyScaleBearing(10001, 'bps')).toBe(false);
    // bps is NOT lumped in with percent — that would be a 100× error.
    expect(deriveFactorScaleFrame([30], 'bps')).toBe(10000);
  });

  it('refuses non-finite input rather than handing NaN to the ladder', () => {
    expect(magnitudeIsUnambiguouslyScaleBearing(Number.NaN, '£')).toBe(false);
    expect(magnitudeIsUnambiguouslyScaleBearing(Number.POSITIVE_INFINITY, '£')).toBe(false);
  });
});
