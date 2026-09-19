/**
 * ⭐⭐ COACHING ON A NON-READY TURN IS GATED ON WHAT IT CLAIMS, NOT ON THE PHASE.
 *
 * THE DEFECT. `buildPostDraftNarrative` discarded every non-fixed assumption
 * source whenever `analysis_ready.status !== 'ready'`, and served a single
 * fixed generic line instead. The uncertainty driver is the user's OWN
 * factor-level annotation on their OWN graph; it says nothing about an
 * analysis, and it was dropped on exactly the turns where the model is least
 * settled and the coaching is worth most.
 *
 * WHY THE OLD GATE EXISTED, AND IT WAS A REAL REASON. The driver field is
 * model-authored, and `validateUncertaintyDriver` is a grammar/jargon guard
 * with nothing to say about copy that PRESUPPOSES a completed analysis
 * ("run the analysis before committing to a route"). With no content guard for
 * that class, readiness was the only available proxy. The fix is to supply the
 * missing precondition, not to remove the protection.
 *
 * ⛔ WHAT THIS SUITE MUST PROVE, AND THE ORDER MATTERS. It is not enough to
 * show that unsafe copy is still blocked — the OLD phase gate blocked that too,
 * so an assertion which passes under both designs discriminates nothing. Each
 * boundary case below is therefore paired with a PRECONDITION pin showing the
 * candidate was genuinely servable on that input, so the negative is about the
 * guard rather than about an empty pool.
 *
 * ⚠ THE POPULATION FIGURE THAT MOTIVATED THIS LANE IS NOT WITNESSED IN THIS
 * REPO. "9 of 13 live draft turns on build 3427aea were not ready" appears in
 * two source comments and in NO committed artefact; a sweep of every JSON,
 * JSONL, MD and TXT file for `3427aea` reads zero while the same sweep's
 * control (`analysis_ready` in JSON) reads 62 files. The 146-of-688 figure IS
 * substantiated and was recounted from the committed corpus for this change.
 * Nothing in this suite depends on either number.
 */
import { describe, it, expect } from 'vitest';
import { buildPostDraftNarrative, validateUncertaintyDriver } from '../post-draft-narrative.js';
import { assertsAnalysisOutcome } from '../copy-quality-gate.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

function makeGraph(nodes: unknown[]): GraphV3T {
  return { nodes, edges: [] } as unknown as GraphV3T;
}

const GOAL_NODE = {
  id: 'g1',
  kind: 'goal' as const,
  provenance: 'from_brief' as const,
  label: 'Deliver Successful Launch Within Three Months at Acceptable Quality',
};
const OPTION_A = { id: 'o1', kind: 'option' as const, label: 'Hire a tech lead' };
const OPTION_B = { id: 'o2', kind: 'option' as const, label: 'Hire two mid-weight developers' };
const FACTOR_CAPACITY = { id: 'f2', kind: 'factor' as const, label: 'Delivery capacity' };

/** A factor carrying `driver` as its single uncertainty driver. */
function factorWithDriver(driver: string) {
  return {
    id: 'f1',
    kind: 'factor' as const,
    label: 'Leadership quality',
    observed_state: { value: 0.5, uncertainty_drivers: [driver] },
  };
}

function graphWithDriver(driver: string): GraphV3T {
  return makeGraph([GOAL_NODE, OPTION_A, OPTION_B, factorWithDriver(driver), FACTOR_CAPACITY]);
}

/**
 * A `needs_user_input` readiness payload — the commonest non-ready class, and
 * the one the old gate silenced.
 */
const NON_READY = {
  status: 'needs_user_input',
  blockers: [{
    option_id: OPTION_A.id,
    option_label: OPTION_A.label,
    factor_id: 'f1',
    factor_label: 'Leadership quality',
    blocker_type: 'missing_value',
    suggested_action: 'add_value',
  }],
} as const;

const FIXED_GENERIC_FRAGMENT =
  "whether the model's key inputs reflect your real delivery constraints";

/**
 * A driver that is true regardless of phase: it describes what is UNCERTAIN,
 * makes no claim about any comparison, and names no option.
 */
const BENIGN_DRIVER =
  'extra developers may add coordination overhead rather than throughput';

describe('non-ready coaching is gated on content, not on the analysis phase', () => {
  it('DELIVERY: a true, non-asserting uncertainty driver now reaches a non-ready turn', () => {
    // PRECONDITION — the same driver is a live, servable candidate on a READY
    // turn. Without this the non-ready assertion below could pass for the
    // trivial reason that nothing was available to serve.
    const ready = buildPostDraftNarrative({
      graph: graphWithDriver(BENIGN_DRIVER),
      analysisReady: { status: 'ready' },
    });
    expect(
      ready.telemetry.assumption_source,
      'PRECONDITION: the driver must be servable on this input, or the non-ready arm proves nothing',
    ).toBe('uncertainty_driver');

    const nonReady = buildPostDraftNarrative({
      graph: graphWithDriver(BENIGN_DRIVER),
      analysisReady: NON_READY,
    });

    // This is the capability the change exists to deliver.
    expect(
      nonReady.text,
      'the driver the user can act on must survive a non-ready turn',
    ).toContain(BENIGN_DRIVER);
    expect(nonReady.telemetry.assumption_source).toBe('uncertainty_driver');
    expect(nonReady.telemetry.fallback_reason).toBeNull();
    // And it must not have displaced the typed recovery step.
    expect(nonReady.text).toContain('Next,');
  });

  it('BOUNDARY: a driver that presupposes a completed analysis is still refused', () => {
    const asserting = 'run the analysis before committing to a route';

    // PRECONDITION — attribution, not availability. This string CLEARS the
    // pre-existing grammar guard, so the refusal below is attributable to the
    // new content guard alone and not to length, punctuation or jargon.
    //
    // ⚠ THE FIRST VERSION OF THIS PRECONDITION ASSERTED THE STRING WAS SERVABLE
    // ON A READY TURN, AND IT WAS WRONG — the content guard applies on the
    // ready path too, by design, so the driver is refused there as well. The
    // pin caught the confound. A precondition that cannot hold is not a weaker
    // test, it is a test measuring something other than its own claim.
    expect(
      validateUncertaintyDriver(asserting),
      'PRECONDITION: the grammar guard admits this string, so any refusal is the content guard',
    ).toBe(true);

    // And it is refused on BOTH phases, which is the point: the decision is
    // about what the sentence claims, not about the phase it arrives in.
    const ready = buildPostDraftNarrative({
      graph: graphWithDriver(asserting),
      analysisReady: { status: 'ready' },
    });
    expect(ready.text.toLowerCase()).not.toContain(asserting);

    const nonReady = buildPostDraftNarrative({
      graph: graphWithDriver(asserting),
      analysisReady: NON_READY,
    });
    expect(nonReady.text.toLowerCase()).not.toContain(asserting);
    expect(nonReady.text).toContain(FIXED_GENERIC_FRAGMENT);
    expect(nonReady.telemetry.assumption_source).toBe('deterministic_fallback');
    expect(nonReady.telemetry.fallback_reason).toBe('gate_rejected');
  });

  /**
   * ⚠ REGRESSION PIN, NOT A DISCRIMINATOR — measured, not assumed. This case
   * PASSES at pristine (verified by execution before the fix landed), because
   * the old phase gate refused every driver on a non-ready turn. It proves the
   * new design does not admit this class; it says nothing about which design is
   * in force. The discriminating cases are DELIVERY and the analysis-assertion
   * BOUNDARY above, both of which RED at pristine.
   */
  it('BOUNDARY: a driver stating a comparative outcome is refused', () => {
    const comparative = 'hiring a tech lead outperforms hiring two developers on quality';
    const nonReady = buildPostDraftNarrative({
      graph: graphWithDriver(comparative),
      analysisReady: NON_READY,
    });
    expect(nonReady.text.toLowerCase()).not.toContain('outperforms');
    expect(nonReady.telemetry.assumption_source).toBe('deterministic_fallback');
  });

  /** ⚠ REGRESSION PIN, NOT A DISCRIMINATOR — passes at pristine too. See above. */
  it('BOUNDARY: a driver naming a leading option is refused by the existing lexicon', () => {
    const leaderNaming = 'the strongest option depends on how fast new hires ramp up';
    const nonReady = buildPostDraftNarrative({
      graph: graphWithDriver(leaderNaming),
      analysisReady: NON_READY,
    });
    expect(nonReady.text.toLowerCase()).not.toContain('strongest option');
    expect(nonReady.telemetry.assumption_source).toBe('deterministic_fallback');
  });

  /**
   * ⚠ REGRESSION PIN, NOT A DISCRIMINATOR — passes at pristine too, because the
   * old gate excluded freeform as well. Its job is to fail loudly if a later
   * change opens the freeform channels on non-ready turns, which this change
   * deliberately did NOT do.
   */
  it('CONTRAST: freeform LLM coaching prose is still shut out on a non-ready turn', () => {
    const freeform = 'the team has not agreed who owns delivery after launch';
    const items = [{ id: 'freeform-1', label: 'Ownership', detail: freeform }];

    // PRECONDITION — freeform IS servable when ready, on a graph carrying no
    // driver, so the driver cannot be the reason it is absent below.
    const noDriverGraph = makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_CAPACITY]);
    const ready = buildPostDraftNarrative({
      graph: noDriverGraph,
      strengthenItems: items,
      analysisReady: { status: 'ready' },
    });
    expect(
      ready.telemetry.assumption_source,
      'PRECONDITION: the freeform item must be servable when ready',
    ).toBe('strengthen_item_detail');

    const nonReady = buildPostDraftNarrative({
      graph: noDriverGraph,
      strengthenItems: items,
      analysisReady: NON_READY,
    });
    expect(
      nonReady.telemetry.assumption_source,
      'freeform LLM prose remains excluded on a non-ready turn',
    ).not.toBe('strengthen_item_detail');
    expect(nonReady.text).not.toContain(freeform);
    expect(nonReady.telemetry.additional_checks_surfaced).toBe(0);
  });

  it('TELEMETRY HONESTY: suppressed freeform is reported as suppressed, not as absent', () => {
    const noDriverGraph = makeGraph([GOAL_NODE, OPTION_A, OPTION_B, FACTOR_CAPACITY]);

    const suppressed = buildPostDraftNarrative({
      graph: noDriverGraph,
      strengthenItems: [{ id: 's1', label: 'Ownership', detail: 'the team has not agreed who owns delivery' }],
      analysisReady: NON_READY,
    });
    expect(
      suppressed.telemetry.fallback_reason,
      'coaching existed and was withheld by phase; reporting no_candidate here is false',
    ).toBe('readiness_gated');

    // DISCRIMINATION — the genuinely empty case must still read no_candidate,
    // or the new value means nothing.
    const empty = buildPostDraftNarrative({
      graph: noDriverGraph,
      analysisReady: NON_READY,
    });
    expect(empty.telemetry.fallback_reason).toBe('no_candidate');
  });
});

/**
 * ⛔⛔ A PRE-EXISTING DEFECT ON THE **READY** PATH, FOUND BY OPENING THE
 * NON-READY ONE.
 *
 * Priority 4 of the assumption chain guarded the uncertainty driver with
 * `validateUncertaintyDriver` ALONE — a grammar and jargon check that never
 * consulted `checkShared`'s premature-recommendation lexicon. So the driver was
 * the one assumption source that could name a leading option and be served.
 *
 * MEASURED AT PRISTINE before the fix: a driver reading "the strongest option
 * depends on how fast new hires ramp up" was served on a `ready` turn with
 * `assumption_source: 'uncertainty_driver'`. The phrase is an alternate of
 * `PREMATURE_RECOMMENDATION_REGEX`; that regex was simply never reached on this
 * path. The old phase gate hid it on non-ready turns, which is why removing
 * that gate is what made it visible.
 */
describe('the uncertainty driver clears the premature-recommendation lexicon', () => {
  it('READY PATH: a driver naming a leading option is not served', () => {
    const leaderNaming = 'the strongest option depends on how fast new hires ramp up';

    // PRECONDITION — a benign driver on the same shape of input IS served, so
    // the refusal below is the lexicon's doing and not an empty pool.
    const benign = buildPostDraftNarrative({
      graph: graphWithDriver(BENIGN_DRIVER),
      analysisReady: { status: 'ready' },
    });
    expect(
      benign.telemetry.assumption_source,
      'PRECONDITION: drivers are servable on ready turns',
    ).toBe('uncertainty_driver');

    const leaking = buildPostDraftNarrative({
      graph: graphWithDriver(leaderNaming),
      analysisReady: { status: 'ready' },
    });
    expect(
      leaking.text.toLowerCase(),
      'the product must not name a leading option',
    ).not.toContain('strongest option');
    expect(leaking.telemetry.assumption_source).not.toBe('uncertainty_driver');
  });
});

describe('assertsAnalysisOutcome', () => {
  it.each([
    'run the analysis before committing to a route',
    'once you analyse the options this will matter',
    'the results show capacity is the constraint',
    'the model shows quality slipping',
    'hiring a lead outperforms hiring two developers',
    'this option scores higher on delivery',
    'a monte carlo sweep would settle it',
  ])('refuses copy that presupposes an analysis outcome: %s', (text) => {
    expect(assertsAnalysisOutcome(text)).toBe(true);
  });

  it.each([
    'extra developers may add coordination overhead rather than throughput',
    'the ramp-up time for a new tech lead is not yet known',
    'demand in the second quarter is hard to forecast',
    'nobody has confirmed the launch date with the client',
  ])('admits copy that claims nothing about an analysis: %s', (text) => {
    expect(assertsAnalysisOutcome(text)).toBe(false);
  });

  it('fails closed on a non-string', () => {
    expect(assertsAnalysisOutcome(undefined as unknown as string)).toBe(true);
  });
});
