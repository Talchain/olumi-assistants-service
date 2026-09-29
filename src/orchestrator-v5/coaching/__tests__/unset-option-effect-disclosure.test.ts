/**
 * The builder's own suite for the unset option-effect disclosure.
 *
 * Companion to `unset-option-effect-egress.test.ts`, which owns the RED-first
 * and runs entirely at pristine. This file necessarily arrives with the
 * implementation, so it makes no RED-first claim — its job is the three things
 * the egress suite cannot see: that the builder emits EXACTLY the pinned copy,
 * that the collector SELECTS the right blockers, and that the copy survives the
 * two egress layers that would silently delete it.
 */

import { describe, expect, it } from 'vitest';

import {
  buildUnsetOptionEffectDisclosure,
  collectUnsetOptionEffects,
  unsetOptionEffectFactorIds,
  UNSET_OPTION_EFFECT_DISCLOSURE_MAX_CHARS,
  UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC,
  UNSET_EFFECT_DISCLOSURE_SURVIVES_EGRESS,
  UNSET_EFFECT_LABEL_MAX_CHARS,
  type UnsetOptionEffect,
} from '../unset-option-effect-disclosure.js';
import { findStabilityAssertion } from '../../compose/defaulted-value-egress.js';
import { passesAssistantTextContentDefences } from '../assistant-text-defences.js';
import type { CanonicalReadinessIssue } from '../../../orchestrator/tools/analysis-ready-helper.js';

/**
 * THE COPY, pinned as a literal.
 *
 * ⚠ Written out rather than composed from the module's own constants. A test
 * that builds its expectation from the same constants the builder uses asserts
 * only that a function is deterministic; it cannot notice that the SENTENCE
 * changed. This literal is what a user reads, and it must not move silently.
 */
const EXPECTED_SINGULAR =
  ' This analysis ran without a value for how “Keep what we have” affects ' +
  '“Sales Rep Adoption Rate”, so that option was analysed as leaving it unchanged. ' +
  'Set that value and run the analysis again to see whether the comparison changes.';

const EXPECTED_PLURAL =
  ' This analysis ran without values for 3 option effects, including how ' +
  '“Keep what we have” affects “Sales Rep Adoption Rate”, so those options were ' +
  'analysed as leaving those factors unchanged. Set those values and run the ' +
  'analysis again to see whether the comparison changes.';

const EXPECTED_GENERIC_SINGULAR =
  ' This analysis ran without a value for one option effect, so that option was ' +
  'analysed as leaving that factor unchanged. Set that value and run the ' +
  'analysis again to see whether the comparison changes.';

const effect = (over: Partial<UnsetOptionEffect> = {}): UnsetOptionEffect => ({
  option_id: 'opt_hold',
  option_label: 'Keep what we have',
  factor_id: 'fac_adoption',
  factor_label: 'Sales Rep Adoption Rate',
  ...over,
});

const issue = (over: Partial<CanonicalReadinessIssue> = {}): CanonicalReadinessIssue =>
  ({
    issue_id: 'semantic_1',
    code: 'MISSING_OPTION_VALUE',
    category: 'option_values',
    message: 'Set a value for this option effect.',
    repairability: 'human_input_required',
    option_id: 'opt_hold',
    option_label: 'Keep what we have',
    factor_id: 'fac_adoption',
    factor_label: 'Sales Rep Adoption Rate',
    ...over,
  }) as CanonicalReadinessIssue;

describe('buildUnsetOptionEffectDisclosure — the copy', () => {
  it('names the option and the factor for a single unset effect', () => {
    expect(buildUnsetOptionEffectDisclosure([effect()])).toBe(EXPECTED_SINGULAR);
  });

  it('counts, and names the first pair, for several', () => {
    expect(
      buildUnsetOptionEffectDisclosure([
        effect(),
        effect({ option_id: 'opt_switch', factor_id: 'fac_cost' }),
        effect({ option_id: 'opt_build', factor_id: 'fac_time' }),
      ]),
    ).toBe(EXPECTED_PLURAL);
  });

  it('degrades to the count-only form when a label is unusable', () => {
    expect(buildUnsetOptionEffectDisclosure([effect({ factor_label: undefined })])).toBe(
      EXPECTED_GENERIC_SINGULAR,
    );
  });

  it('degrades rather than losing the sentence when a label would trip the content defences', () => {
    // An internal id smuggled into a label is the exact case that silently
    // swallowed the scaffold disclosure for "Plan E_2". The user must still get
    // the disclosure, just without the name.
    const out = buildUnsetOptionEffectDisclosure([effect({ factor_label: 'fac_adoption' })]);
    expect(out).toBe(EXPECTED_GENERIC_SINGULAR);
    expect(passesAssistantTextContentDefences(out)).toBe(true);
  });

  it('drops a label longer than the cap rather than blowing the egress budget', () => {
    const out = buildUnsetOptionEffectDisclosure([
      effect({ factor_label: 'x'.repeat(UNSET_EFFECT_LABEL_MAX_CHARS + 1) }),
    ]);
    expect(out).toBe(EXPECTED_GENERIC_SINGULAR);
  });

  // ⭐ THE OVER-DISCLOSURE CONTROL, at the builder. NO UNSET EFFECTS ⇒ NOT ONE
  // BYTE. Inventing a caveat about a run that left nothing unset is the
  // mirror-image dishonesty of the defect this closes.
  it('⭐ CONTROL — returns the empty string when nothing is unset', () => {
    expect(buildUnsetOptionEffectDisclosure([])).toBe('');
  });
});

describe('the copy survives every layer that could delete it', () => {
  const shapes = [EXPECTED_SINGULAR, EXPECTED_PLURAL, EXPECTED_GENERIC_SINGULAR];

  it('the build-time probe ran and passed at import', () => {
    expect(UNSET_EFFECT_DISCLOSURE_SURVIVES_EGRESS).toBe(true);
  });

  it('matches its own published grammar exactly', () => {
    const exact = new RegExp(`^(?:${UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC})$`);
    for (const shape of shapes) expect(exact.test(shape)).toBe(true);
  });

  it('the grammar cannot match the empty string (the anchored template branch depends on it)', () => {
    expect(new RegExp(`^(?:${UNSET_OPTION_EFFECT_DISCLOSURE_RE_SRC})$`).test('')).toBe(false);
  });

  it('stays inside its own derived budget', () => {
    for (const shape of shapes) {
      expect(shape.length).toBeLessThanOrEqual(UNSET_OPTION_EFFECT_DISCLOSURE_MAX_CHARS);
    }
  });

  it('⭐ does not trip the STABILITY suppressor in defaulted-value-egress', () => {
    // This disclosure ships on runs that defaulted values — precisely the runs
    // `applyDefaultedValueEgress` is scanning. A sentence reaching for
    // "stable"/"robust"/"little sensitivity" would be SUPPRESSED on exactly the
    // turns it exists to serve, and nothing would report it.
    for (const shape of shapes) expect(findStabilityAssertion(shape)).toBeNull();
  });

  it('⭐ makes no LEADER claim, so it is honest on a withheld turn', () => {
    // Mirrors the leading-option egress guard's vocabulary. A disclosure that
    // said "leads"/"ahead"/"best" would be replaced wholesale on the withheld
    // turns where it is most needed.
    for (const shape of shapes) {
      expect(shape).not.toMatch(/\b(?:leads|leading|ahead|best|winner|recommend)/i);
    }
  });

  it('carries no magnitude — the only number is an integer count', () => {
    for (const shape of shapes) {
      expect(shape).not.toMatch(/\d+\.\d+/);
      expect(shape).not.toMatch(/%/);
    }
  });
});

describe('collectUnsetOptionEffects — which blockers the sentence speaks for', () => {
  const analysed = new Set(['opt_hold', 'opt_switch']);

  it('selects MISSING_OPTION_VALUE on an analysed option', () => {
    expect(collectUnsetOptionEffects([issue()], analysed)).toEqual([
      {
        option_id: 'opt_hold',
        option_label: 'Keep what we have',
        factor_id: 'fac_adoption',
        factor_label: 'Sales Rep Adoption Rate',
      },
    ]);
  });

  it('⭐ ignores blockers of every OTHER code', () => {
    // A sentence claiming "no value was set" about a value that IS set and
    // merely unreadable would be a falsehood about the user's own input — the
    // exact error `analysis-ready-core.ts` documents at WAIVABLE_BY_EXCLUSION.
    for (const code of [
      'OPTION_NEEDS_ENCODING',
      'OPTION_NEEDS_MAPPING',
      'NO_CAP_UNRECOVERABLE',
      'UNIT_MISMATCH',
      'AMBIGUOUS_OPTION_VALUE',
    ]) {
      expect(
        collectUnsetOptionEffects(
          [issue({ code } as Partial<CanonicalReadinessIssue>)],
          analysed,
        ),
      ).toEqual([]);
    }
  });

  it('⭐ ignores a blocker already spoken for by the exclusion disclosure', () => {
    // `scaffold-disclosure.ts` already tells the user that option was left out.
    // Two true sentences about one option on one turn is a worse turn.
    expect(collectUnsetOptionEffects([issue({ waived_by_exclusion: true })], analysed)).toEqual(
      [],
    );
  });

  it('⭐ ignores an option that never reached the comparison', () => {
    expect(collectUnsetOptionEffects([issue({ option_id: 'opt_ghost' })], analysed)).toEqual([]);
  });

  it('⭐ FAIL-SAFE — does NOT filter when no option identity came back', () => {
    // Same positive-control shape as partitionScaffoldedByAnalysisPresence: an
    // absence is only asserted when a presence was seen. Disclosing is the
    // fail-safe direction here, because the sentence makes no claim about the
    // result — only about what the user did not set.
    expect(collectUnsetOptionEffects([issue()], new Set())).toHaveLength(1);
    expect(collectUnsetOptionEffects([issue()], undefined)).toHaveLength(1);
  });

  it('dedupes two issues over one (option, factor) pair', () => {
    expect(
      collectUnsetOptionEffects([issue(), issue({ issue_id: 'semantic_2' })], analysed),
    ).toHaveLength(1);
  });

  it('keeps two DIFFERENT factors on one option', () => {
    expect(
      collectUnsetOptionEffects(
        [issue(), issue({ issue_id: 'semantic_2', factor_id: 'fac_cost' })],
        analysed,
      ),
    ).toHaveLength(2);
  });

  it('is total over a missing or malformed blocker list', () => {
    expect(collectUnsetOptionEffects(undefined, analysed)).toEqual([]);
    expect(collectUnsetOptionEffects([issue({ option_id: undefined })], analysed)).toEqual([]);
  });
});

describe('unsetOptionEffectFactorIds — the driver cross-reference key', () => {
  it('collects the factor ids it holds', () => {
    expect([...unsetOptionEffectFactorIds([effect()])]).toEqual(['fac_adoption']);
  });

  it('⭐ omits a pair with no factor_id rather than inventing a key', () => {
    // `factor_id` is optional on the blocker type. A pair without one simply
    // cannot join against the driver — it is still NAMED in the sentence, so
    // the user is not left uninformed, and no false suppression is bought.
    expect([...unsetOptionEffectFactorIds([effect({ factor_id: undefined })])]).toEqual([]);
  });

  it('is derived from the same records the sentence is built from', () => {
    // The two surfaces cannot disagree about which factors are unset, because
    // there is one list and both read it.
    const effects = [effect(), effect({ option_id: 'opt_switch', factor_id: 'fac_cost' })];
    expect([...unsetOptionEffectFactorIds(effects)].sort()).toEqual([
      'fac_adoption',
      'fac_cost',
    ]);
    expect(buildUnsetOptionEffectDisclosure(effects)).toContain('2 option effects');
  });
});
