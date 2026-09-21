/**
 * ROADMAP 2.308 / S2 — the product must not suggest phrasings its own gate
 * rejects.
 *
 * Diagnosis `PHASE0-EVIDENCE-2026-07-28/diagnosis-2308-addoption-deadend.md`
 * §7 rows 1 and 3, at deployed CEE `a5a3e22`:
 *
 *   (a) The edit lane asked "what value?" and offered two formats —
 *       'Set Customer Retention Investment to £40,000' and
 *       'Set retention investment to 0.8'. BOTH are NO_MATCH against
 *       `detectConfigureOptionIntent` (§2c rows 2 and 2b). "The assistant
 *       suggests phrasings that cannot return to the lane that suggested
 *       them: a closed loop, minted by the product's own copy."
 *       Note WHY neither can simply be made to match: they name a FACTOR and
 *       carry no option reference at all, so matching them would reroute every
 *       plain "set X to N" off `set_factor_value` into the edit LLM — the
 *       blast radius the diagnosis explicitly refused (§9 S1, "Do NOT instead
 *       delete the `if (!anchored) return NO_MATCH` line"). The fix is to make
 *       the assistant advise the ANCHORED format instead — the shape that was
 *       live-proven end-to-end as probe P1 (§5).
 *
 *   (b) The product's own readiness chip `chip_prompt_set_option_values`
 *       ("Set values for options") carried the message
 *       'Help me set up the options for this decision so the analysis can run.'
 *       — which the configure gate cannot see. Measured in this lane, it was
 *       blocked TWICE over: NO_MATCH at `detectConfigureOptionIntent`, AND a
 *       hit on `EDIT_GRAPH_NEGATIVE_REGEX` via the phrasal verb "set up", so
 *       even a matching detector would not have dispatched it. This is the
 *       ROADMAP-2.11 defect surviving in the sibling chip the 2.11 fix missed.
 *
 * Both fixes DERIVE from `configure-option-chip-text.ts` — the module that
 * exists precisely so chip copy and route cannot drift apart (trap 12).
 */

import { describe, it, expect } from 'vitest';

import { detectConfigureOptionIntent } from '../configure-option-intent.js';
import {
  buildConfigureOptionAdvisedFormat,
  CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE,
  CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX,
  SET_OPTION_VALUES_CHIP,
} from '../../configure-option-chip-text.js';
import { generateChips, type ChipGeneratorInput } from '../../compose/chip-generator.js';
import { buildReadinessRecoveryChip } from '../../coaching/readiness-recovery.js';
import type { HandlerValidationRegistry } from '../validator.js';
import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';
import { EDIT_GRAPH_PROMPT_V6 } from '../../../prompts/edit-graph-v6.js';

// ---------------------------------------------------------------------------
// Historical pins — the pristine copy, kept permanently as the defect fixture.
//
// Trap 12b: a control pinned to "whatever ships now" decays into a tautology
// the first time "now" changes. These two literals are the a5a3e22a bytes and
// must never be re-derived from the shipped constants.
// ---------------------------------------------------------------------------

/** Diagnosis §7 row 1 — the edit lane's two suggested formats, verbatim. */
const PRISTINE_SUGGESTED_FORMATS = [
  'Set Customer Retention Investment to £40,000',
  'Set retention investment to 0.8',
] as const;

/** Diagnosis §7 row 3 — the readiness chip message at a5a3e22a, verbatim. */
const PRISTINE_SET_OPTION_VALUES_MESSAGE =
  'Help me set up the options for this decision so the analysis can run.';

describe('2.308 S2 — the pristine copy is pinned as the defect', () => {
  for (const format of PRISTINE_SUGGESTED_FORMATS) {
    it(`the assistant's pristine suggested format is NO_MATCH: '${format}'`, () => {
      expect(detectConfigureOptionIntent(format, []).matched).toBe(false);
    });
  }

  it('the pristine readiness-chip message is NO_MATCH against the configure gate', () => {
    expect(detectConfigureOptionIntent(PRISTINE_SET_OPTION_VALUES_MESSAGE, []).matched).toBe(false);
  });

  it('the pristine readiness-chip message is ALSO blocked by EDIT_GRAPH_NEGATIVE_REGEX ("set up")', () => {
    expect(EDIT_GRAPH_NEGATIVE_REGEX.test(PRISTINE_SET_OPTION_VALUES_MESSAGE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (a) The advised format the assistant is now told to suggest.
// ---------------------------------------------------------------------------

describe('2.308 S2(a) — the advised configure format routes deterministically', () => {
  it('the instantiated advised format matches the gate with EMPTY labels', () => {
    // Verbatim probe P1 (§5), which succeeded live end-to-end: the analysis
    // ran one turn later (§6c).
    const advised = buildConfigureOptionAdvisedFormat(
      'Launch Customer Retention Programme',
      'Customer Retention Investment',
      '1',
    );
    expect(advised).toBe(
      "Set the Launch Customer Retention Programme option's effect on Customer Retention Investment to 1",
    );
    expect(detectConfigureOptionIntent(advised, [])).toEqual({
      matched: true,
      trigger: 'effect_vocab',
    });
  });

  it('the advised format survives the route-level negative gates', () => {
    const advised = buildConfigureOptionAdvisedFormat('Option A', 'Factor B', '0.7');
    expect(EDIT_GRAPH_NEGATIVE_REGEX.test(advised)).toBe(false);
    // Not required for dispatch (the configure gate is sufficient), but a
    // positive-verb hit means the turn reaches the edit lane on BOTH doors.
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(advised)).toBe(true);
  });

  it('a qualitative (no-digit) advised value still routes via effect_vocab', () => {
    const advised = buildConfigureOptionAdvisedFormat('Option A', 'Factor B', 'high');
    expect(detectConfigureOptionIntent(advised, [])).toEqual({
      matched: true,
      trigger: 'effect_vocab',
    });
  });

  it('the edit_graph prompt ADVISES that exact template (positive control)', () => {
    // Derived, not mirrored: if the constant changes, the prompt must carry
    // the new text or this fails loudly. If the prompt stops advising a
    // format at all, this fails too.
    expect(EDIT_GRAPH_PROMPT_V6).toContain(CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE);
  });
});

// ---------------------------------------------------------------------------
// (b) The readiness chip.
// ---------------------------------------------------------------------------

describe('2.308 S2(b) — the "Set values for options" chip routes to its own write path', () => {
  it('matches the configure gate via the shared chip prefix', () => {
    expect(detectConfigureOptionIntent(SET_OPTION_VALUES_CHIP.message, [])).toEqual({
      matched: true,
      trigger: 'chip_prefix',
    });
  });

  it('is not blocked by EDIT_GRAPH_NEGATIVE_REGEX', () => {
    expect(EDIT_GRAPH_NEGATIVE_REGEX.test(SET_OPTION_VALUES_CHIP.message)).toBe(false);
  });

  it('keeps its shipped id and label (the chip surface is unchanged)', () => {
    expect(SET_OPTION_VALUES_CHIP.id).toBe('chip_prompt_set_option_values');
    expect(SET_OPTION_VALUES_CHIP.label).toBe('Set values for options');
  });

  it('the message is DERIVED from the shared prefix, not re-typed', () => {
    // Mutation surface: retyping the prefix in draft-graph-dispatch would
    // pass the two assertions above today and drift silently tomorrow.
    expect(SET_OPTION_VALUES_CHIP.message).not.toBe(PRISTINE_SET_OPTION_VALUES_MESSAGE);
    expect(SET_OPTION_VALUES_CHIP.message.startsWith('Help me configure ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b, continued) — the OUTPUT of the real chip producer, not the constant.
//
// Review correction (#796): the first cut of 2.308 converted only
// `handlers/draft-graph-dispatch.ts` and asserted the shared CONSTANT. Four
// hand-typed copies survived in `compose/chip-generator.ts`, one of them the
// readiness FLOOR that fires on exactly `needs_encoding` — the 2.308 blocked
// state — and `generateChips` is what the turn-executor calls on ordinary
// turns. So the first affordance a blocked tester saw was still the
// doubly-blocked literal, and "cannot drift back" was false while any
// hand-typed copy remained. Asserting a constant cannot catch that; asserting
// the PRODUCER'S OUTPUT can.
// ---------------------------------------------------------------------------

const CHIP_REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'ok',
  },
};

function chipInput(overrides: Partial<ChipGeneratorInput>): ChipGeneratorInput {
  return {
    stage: 'analyse',
    validationRegistry: CHIP_REGISTRY,
    ...overrides,
  } as ChipGeneratorInput;
}

/** `analysis_ready` shaped as `computeStructuralReadiness` emits it. */
function readiness(status: string): ChipGeneratorInput['analysisReady'] {
  return {
    options: [
      {
        option_id: 'opt_retention',
        label: 'Launch Customer Retention Programme',
        status: 'needs_encoding',
        interventions: {},
      },
    ],
    goal_node_id: 'goal_arr',
    status,
  } as unknown as ChipGeneratorInput['analysisReady'];
}

describe('2.308 S2(b) — every "Set values for options" chip generateChips MINTS routes', () => {
  /**
 * A no-op `explain_results` fact — the handler that emits
 * `buildAnalysisAbsentTemplate` (S3). Its `facts_absent` branch is one of the
 * four chip-generator sites, and the M8 sweep proved the other four inputs do
 * NOT reach it: an unREDed mutant is an incomplete sweep, not a safe site.
 */
function noopExplainResultsFact(): NonNullable<ChipGeneratorInput['handlerFacts']>[number] {
  return {
    fact_type: 'explain_results',
    fact_version: 1,
    noop: true,
    result: { precondition_unmet: true, option_count: 2 },
  } as NonNullable<ChipGeneratorInput['handlerFacts']>[number];
}

const cases: readonly (readonly [string, ChipGeneratorInput])[] = [
    // The readiness floor — the 2.308 blocked state itself.
    ['analyse stage, needs_encoding', chipInput({ analysisReady: readiness('needs_encoding'), graphOptionCount: 1 })],
    ['analyse stage, needs_user_mapping', chipInput({ analysisReady: readiness('needs_user_mapping'), graphOptionCount: 1 })],
    ['analyse stage, needs_user_input', chipInput({ analysisReady: readiness('needs_user_input'), graphOptionCount: 1 })],
    ['analyse stage, no options at all', chipInput({ analysisReady: readiness('needs_user_input'), graphOptionCount: 0 })],
    ['decide stage, readiness not ready', chipInput({ stage: 'decide', analysisReady: readiness('needs_encoding'), graphOptionCount: 1 })],
    // The facts_absent branch — the chip paired with the S3 copy, i.e. the
    // "no analysis has been run" turn on a blocked graph.
    [
      'facts_absent after a no-op explain_results, readiness not ready',
      chipInput({
        stage: 'analyse',
        handlerFacts: [noopExplainResultsFact()],
        analysis: null,
        analysisReady: readiness('needs_encoding'),
        graphOptionCount: 1,
      }),
    ],
    [
      'facts_absent at decide stage, readiness unknown',
      chipInput({
        stage: 'decide',
        handlerFacts: [noopExplainResultsFact()],
        analysis: null,
        graphOptionCount: 1,
      }),
    ],
  ];

  /**
   * Positive control (trap 13): the sweep below asserts an ABSENCE (no chip
   * carries a blocked message). It is vacuous unless the inputs provably
   * PRODUCE the chip under test. At least one case must mint it.
   */
  it('positive control — at least one input actually mints a configure-option chip', () => {
    const minted = cases.filter(([, input]) =>
      generateChips(input).some((chip) =>
        chip.message.startsWith(CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX),
      ),
    );
    expect(minted.length, 'no input minted the chip — the sweep below would test nothing').toBeGreaterThan(0);
  });

  for (const [name, input] of cases) {
    it(`${name}: no minted chip carries the doubly-blocked message`, () => {
      for (const chip of generateChips(input)) {
        expect(chip.message, `chip ${chip.id} still carries the pristine literal`).not.toBe(
          PRISTINE_SET_OPTION_VALUES_MESSAGE,
        );
      }
    });

    it(`${name}: every minted configure-option chip routes AND survives the negative gate`, () => {
      const setValueChips = generateChips(input).filter(
        (chip) => chip.message.startsWith(CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX),
      );
      for (const chip of setValueChips) {
        expect(
          detectConfigureOptionIntent(chip.message, []),
          `chip ${chip.id} does not route deterministically: '${chip.message}'`,
        ).toEqual({ matched: true, trigger: 'chip_prefix' });
        expect(
          EDIT_GRAPH_NEGATIVE_REGEX.test(chip.message),
          `chip ${chip.id} is blocked by EDIT_GRAPH_NEGATIVE_REGEX: '${chip.message}'`,
        ).toBe(false);
      }
    });
  }

  it('the floor chip specifically — the first affordance a blocked tester sees', () => {
    const chips = generateChips(
      chipInput({ analysisReady: readiness('needs_encoding'), graphOptionCount: 1 }),
    );
    const floor = chips.find((chip) =>
      chip.message.startsWith(CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX),
    );
    expect(floor, 'no configure-option chip on the needs_encoding turn').toBeDefined();
    expect(floor).toEqual(buildReadinessRecoveryChip(readiness('needs_encoding')));
  });
});
