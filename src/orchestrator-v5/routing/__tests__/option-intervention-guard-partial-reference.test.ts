/**
 * LIVE DATA-CORRUPTION REPRODUCTION (2026-07-25, deployed staging build
 * `a833276`, scenario `908dabc0-74c3-4e87-bda1-dac516b94ff1`).
 *
 * An option-scoped sentence silently mutated a GLOBAL factor.
 *
 *   R1  "Running the pop-up pilot reduces Capital Investment in Leeds Site
 *        to £20,000"
 *       → assistant: "Updated Capital Investment in Leeds Site from 0 to
 *         20,000 GBP."
 *       → persisted: `fac_capital.observed_state.value` 0 → 20000 — the
 *         SHARED factor every one of the four options reads — while
 *         `opt_popup.interventions.fac_capital` stayed 0.25, i.e. the
 *         option the user actually named was NOT changed.
 *       → `v5_handler_facts`: handler `set_factor_value`, noop=false,
 *         `{"before":{"value":0},"after":{"value":20000},"status":"applied",
 *           "target_id":"fac_capital"}`
 *
 *   R2  the SAME sentence plus the single word "option"
 *       → "That looks like a change to an option's intervention rather than
 *          the … factor's own value, so I haven't changed anything."
 *       → graph unchanged.
 *
 *   R3  the SAME shape naming the option by its FULL EXACT label, no
 *       "option" word ("Run Pop-Up Pilot First reduces …")
 *       → refused, graph unchanged. R3 proves option labels ARE available
 *         to the guard on the live wire, so R1's miss was the PREDICATE
 *         alone, not a starved label list (trap 16: the route-v2 sites are
 *         label-blind because the wire sends no `graph_state`; the
 *         turn-executor site reads the COMMITTED graph and is not).
 *
 * MECHANISM: the containment machinery is correct and already reaches the
 * right outcome — R2/R3 prove the clarify path works end to end. The defect
 * is entirely in `impliesOptionInterventionEdit`'s detection predicate,
 * which fired only on (1) the literal words "option(s)"/"intervention(s)"
 * or (2) the COMPLETE, EXACT option label. Anything in between — a
 * morphological variant ("Franchising" for "Franchise …"), or a partial
 * reference ("the pop-up pilot" for "Run Pop-Up Pilot First") — fell
 * through to a silent shared-state write. This was the guard's OWN
 * documented residual gap, recorded as an accepted limitation; live it is a
 * data-corruption path.
 *
 * These tests are RED before the distinctive-token rule and GREEN after.
 */
import { describe, it, expect } from 'vitest';

import type { QuantityExtractionResult } from '../../context/cqe/schema-types.js';
import type { GraphLookup } from '../validator.js';
import { impliesOptionInterventionEdit } from '../option-intervention-guard.js';
import { tryDeterministicValueUpdate } from '../deterministic-value-update.js';

/** The live graph's factor labels (scenario 908dabc0…, drafted on a833276). */
const LIVE_FACTORS = [
  { id: 'fac_capital', label: 'Capital Investment in Leeds Site' },
  { id: 'fac_launch_speed', label: 'Speed of Leeds Launch' },
  { id: 'fac_leeds_demand', label: 'Local Demand in Leeds' },
  { id: 'fac_ops_readiness', label: 'Operational Readiness to Scale' },
];

/** The live graph's option labels. */
const LIVE_OPTIONS = [
  { id: 'opt_delay', label: 'Delay Opening Six Months' },
  { id: 'opt_open_now', label: 'Open Leeds Location Next Quarter' },
  { id: 'opt_popup', label: 'Run Pop-Up Pilot First' },
  { id: 'opt_status_quo', label: 'Stay Single-Location (Status Quo)' },
];

const LIVE_FACTOR_LABELS = LIVE_FACTORS.map((f) => f.label);
const LIVE_OPTION_LABELS = LIVE_OPTIONS.map((o) => o.label);

function makeGraph(
  factors: ReadonlyArray<{ id: string; label: string | null }>,
  options: ReadonlyArray<{ id: string; label: string | null }>,
): GraphLookup {
  const factorById = new Map(factors.map((f) => [f.id, f]));
  const optionById = new Map(options.map((o) => [o.id, o]));
  return {
    findEntityById: (id) => {
      const f = factorById.get(id);
      if (f) return { id: f.id, kind: 'node', label: f.label };
      const o = optionById.get(id);
      if (o) return { id: o.id, kind: 'option', label: o.label };
      return null;
    },
    listEntitiesByKind: (kind) => {
      if (kind === 'node') return factors.map((f) => ({ id: f.id, label: f.label }));
      if (kind === 'option') return options.map((o) => ({ id: o.id, label: o.label }));
      return [];
    },
  };
}

function quantity(value: number, raw_text: string): QuantityExtractionResult {
  return {
    raw_text,
    value,
    unit: null,
    direction: null,
    multiplier: null,
    operator: null,
    comparator: null,
    range_min: null,
    range_max: null,
    approximate: false,
    source: 'cqe',
  };
}

const LIVE_GRAPH = makeGraph(LIVE_FACTORS, LIVE_OPTIONS);
const PARSED_20K: QuantityExtractionResult[] = [quantity(20000, '£20,000')];
const LIVE_FACTOR_IDS = new Set(LIVE_FACTORS.map((f) => f.id));

/** The exact sentence that corrupted the live graph. */
const R1_MESSAGE = 'Running the pop-up pilot reduces Capital Investment in Leeds Site to £20,000';

describe('DEFECT 1 — a partial option reference must not write the shared factor', () => {
  it('R1 (LIVE): "Running the pop-up pilot reduces …" is recognised as an option-scoped edit', () => {
    expect(
      impliesOptionInterventionEdit(R1_MESSAGE, LIVE_OPTION_LABELS, LIVE_FACTOR_LABELS),
    ).toBe(true);
  });

  /**
   * NOTE on which producer actually fired live. R1 itself does NOT reach the
   * deterministic pre-route's option gate: "reduces" is not a deterministic
   * edit verb, so the pre-route exits earlier with `no_edit_verb` (verified
   * by running this file before the fix). The live R1 proposal came from the
   * LLM router and was caught — or in R1's case NOT caught — at the
   * turn-executor execute chokepoint; that path is covered end-to-end in
   * `option-intervention-guard-partial-reference.integration.test.ts`.
   *
   * The pre-route gate still matters: it is what stops the clarify-loop
   * (#Tier-A-1) by keeping option-framed edits away from the factor-only
   * matcher. So it is exercised here with an EDIT-VERB phrasing that does
   * reach the gate, carrying the same partial option reference.
   */
  it('the deterministic pre-route SKIPS an edit-verb partial reference instead of dispatching', () => {
    const result = tryDeterministicValueUpdate(
      'Set Capital Investment in Leeds Site to £20,000 for the pop-up pilot',
      PARSED_20K,
      LIVE_GRAPH,
      [],
      LIVE_FACTOR_IDS,
    );
    expect(result.matched).toBe(false);
    if (result.matched) throw new Error('expected matched: false');
    expect(result.skip_reason).toBe('option_intervention_edit');
  });

  it('A7 (LIVE, add-option lane): "Franchising reduces …" — a MORPHOLOGICAL variant of the option label', () => {
    // Live on 74c785f: mutated fac_launch_investment 0 → 20000,
    // provenance 'user_set', while the option stayed unconfigured.
    expect(
      impliesOptionInterventionEdit(
        'Franchising reduces Leeds Launch Investment to £20,000 and sets Operational Readiness to 60%',
        ['Franchise the Leeds Location', 'Stay at Current Location (Status Quo)'],
        ['Leeds Launch Investment', 'Operational Readiness'],
      ),
    ).toBe(true);
  });

  it('catches a bare distinctive token with no option vocabulary at all', () => {
    expect(
      impliesOptionInterventionEdit(
        'Franchise reduces Leeds Launch Investment to £20,000',
        ['Franchise the Leeds Location'],
        ['Leeds Launch Investment'],
      ),
    ).toBe(true);
  });
});

describe('DEFECT 1 — the negative control: genuine factor edits must still apply', () => {
  /**
   * The discriminating pair. Same graph, same factor, same value; the ONLY
   * difference is whether the sentence references an option. If this test
   * ever goes red the guard has stopped being a guard and become a block on
   * all factor editing.
   */
  it('a plain factor edit on the SAME live graph still dispatches', () => {
    const result = tryDeterministicValueUpdate(
      'Set Capital Investment in Leeds Site to £20,000',
      PARSED_20K,
      LIVE_GRAPH,
      [],
      LIVE_FACTOR_IDS,
    );
    expect(result.matched).toBe(true);
  });

  it('a factor label token shared with an option label does NOT trigger the guard', () => {
    // "Leeds" appears in BOTH the option label "Open Leeds Location Next
    // Quarter" and three factor labels, so it must never count as an
    // option-distinctive token — otherwise every Leeds factor edit is
    // refused. This is why distinctiveness is DERIVED by subtracting the
    // non-option label vocabulary rather than hand-listed.
    expect(
      impliesOptionInterventionEdit(
        'Set Speed of Leeds Launch to 0.8',
        LIVE_OPTION_LABELS,
        LIVE_FACTOR_LABELS,
      ),
    ).toBe(false);
  });

  /**
   * REGRESSION, caught by the EXP-01 fixture in
   * `turn-executor-structural-success-claim.test.ts` when the inflection
   * rule was first added. Subtracting the non-option vocabulary only from
   * the OPTION side is not enough: the option "Hire Two Senior Engineers
   * Locally" keeps "locally" as a cue (the factor says "Local", a different
   * token), and "local" in the user's message then matched it by stem — so
   * "Set the Local Senior Hire Indicator factor to 1.0." was refused. Eight
   * existing tests went red on exactly this. The subtraction must apply to
   * BOTH sides of the comparison.
   */
  it('a word naming a FACTOR is never an option cue, even when it stems into one', () => {
    expect(
      impliesOptionInterventionEdit(
        'Set the Local Senior Hire Indicator factor to 1.0.',
        ['Hire Two Senior Engineers Locally', 'Engage Offshore Partner'],
        [
          'Local Senior Hire Indicator',
          'Headcount Investment Level',
          'Offshore Partnership Indicator',
          'Engineering Team Scaling Strategy',
        ],
      ),
    ).toBe(false);
  });

  /**
   * The OPTION-side half of the subtraction, isolated.
   *
   * Written because a mutation check found it unpinned: deleting the
   * option-side filter left all other tests green, because for an EXACT
   * token collision the message-side filter catches the same case. The two
   * filters only diverge when the colliding word reaches the message in an
   * INFLECTED form — "pilot" is claimed by a factor so it must never become
   * a cue, and if it wrongly does, "piloting" (which no factor claims) slips
   * past the message-side filter and matches it by stem.
   */
  it('a cue claimed by a factor is dropped at source, so no inflection of it can match', () => {
    expect(
      impliesOptionInterventionEdit(
        'Increase piloting capacity to 5',
        ['Run Pop-Up Pilot First'],
        ['Pilot Programme Budget'],
      ),
    ).toBe(false);
  });

  it('a near-miss stem does not match ("investigate" is not "investment")', () => {
    expect(
      impliesOptionInterventionEdit(
        'Investigate the cost and set it to 5',
        ['Investment Round A'],
        [],
      ),
    ).toBe(false);
  });
});

describe('DEFECT 1 — degradation must fail SAFE (trap 13 positive control)', () => {
  /**
   * The non-option label list is a SUBTRACTIVE input: every label in it
   * REMOVES candidate tokens. So a starved list can only make the guard
   * fire MORE, never less — the safe direction. This pins that direction so
   * a future refactor cannot quietly invert it into an assume-good gate.
   */
  it('an EMPTY non-option label list still catches the live message (fires more, not less)', () => {
    expect(impliesOptionInterventionEdit(R1_MESSAGE, LIVE_OPTION_LABELS, [])).toBe(true);
  });

  it('POSITIVE CONTROL: with no options at all there is nothing to misroute to → false', () => {
    // Proves the true-cases above are discriminating, not vacuous.
    expect(impliesOptionInterventionEdit(R1_MESSAGE, [], LIVE_FACTOR_LABELS)).toBe(false);
  });
});
