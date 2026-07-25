/**
 * D-ask-1 (ROADMAP 2.11 P0-1) — scaffold disclosure copy ↔ egress-allowlist
 * contract.
 *
 * The disclosure is claim-safety-critical: if the registry-side allowlist
 * (`isAllowedRunAnalysisAssistantText`) rejects a disclosure-bearing
 * summary, the validation-registry forwarder silently substitutes the bland
 * locked template — the user is then shown a scaffolded option's numbers
 * with NO disclosure. These tests pin BOTH directions:
 *   - every string the builder can produce passes the allowlist when
 *     appended to a locked template or a grammar-valid headline;
 *   - the allowlist extension does not open a hole for improvised prose.
 *
 * RED-first: this file fails collection against pristine `4d79746a7` (the
 * scaffold-disclosure module does not exist there).
 */

import { describe, it, expect } from 'vitest';

import {
  buildScaffoldDisclosureSuffix,
  buildScaffoldOmittedSuffix,
  buildScaffoldDisclosureForPartition,
  partitionScaffoldedByAnalysisPresence,
  buildScaffoldConfigureChip,
  safeScaffoldOptionLabel,
  SCAFFOLD_DISCLOSURE_MAX_CHARS,
  type ScaffoldedOptionRecord,
} from '../scaffold-disclosure.js';
import {
  isAllowedRunAnalysisAssistantText,
  RUN_ANALYSIS_LOCKED_TEMPLATES,
  REDUCED_SAMPLES_SUFFIX,
} from '../analysis-result-headline.js';
import {
  buildConfigureOptionChipMessage,
  CONFIGURE_OPTION_GENERIC_CHIP,
} from '../../configure-option-chip-text.js';
import { detectConfigureOptionIntent } from '../../routing/configure-option-intent.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';

function record(option_id: string, label: string | null): ScaffoldedOptionRecord {
  return { option_id, label, factor_ids: ['fac_x'], value_defaulted: true };
}

describe('buildScaffoldDisclosureSuffix — copy contract', () => {
  it('single safe label: names the option, says the values are placeholders, advises the deterministic configure phrasing', () => {
    const suffix = buildScaffoldDisclosureSuffix([record('opt_1', 'Acquisition')]);
    expect(suffix).toContain("Placeholder values were used for 'Acquisition'");
    expect(suffix).toContain('until you configure it');
    // Configure-route pointer DERIVED from #487's single chip-copy source.
    expect(suffix).toContain(`say '${buildConfigureOptionChipMessage('Acquisition')}'`);
  });

  it('multiple scaffolded options: plural copy + the generic configure phrasing', () => {
    const suffix = buildScaffoldDisclosureSuffix([
      record('opt_1', 'Acquisition'),
      record('opt_2', 'Partnership'),
    ]);
    expect(suffix).toContain('2 of your options');
    expect(suffix).toContain('until you configure them');
    expect(suffix).toContain(`say '${CONFIGURE_OPTION_GENERIC_CHIP.message}'`);
  });

  it('unsafe label (raw decimal would trip the egress decimal defence) falls back to the generic form', () => {
    const suffix = buildScaffoldDisclosureSuffix([record('opt_1', 'Plan 1.5x')]);
    expect(suffix).not.toContain('1.5');
    expect(suffix).toContain('one of your options');
    expect(suffix).toContain(`say '${CONFIGURE_OPTION_GENERIC_CHIP.message}'`);
  });

  it('id-shaped and quote-bearing labels fall back to the generic form', () => {
    for (const bad of ['opt_new', "O'Brien's Plan", 'x'.repeat(80)]) {
      const suffix = buildScaffoldDisclosureSuffix([record('opt_1', bad)]);
      expect(suffix).toContain('one of your options');
    }
    expect(safeScaffoldOptionLabel('opt_new')).toBeNull();
    expect(safeScaffoldOptionLabel('Acquisition')).toBe('Acquisition');
  });

  it('every advised exemplar routes DETERMINISTICALLY through the shipped configure-option detector (empty label registry — no anchor needed)', () => {
    // #487 P1-3 contract class: copy that advises a phrasing the detector
    // does not match recreates the lying loop. Extract the say-quoted
    // exemplars from the LIVE copy and run the real detector.
    const suffixes = [
      buildScaffoldDisclosureSuffix([record('opt_1', 'Acquisition')]),
      buildScaffoldDisclosureSuffix([record('opt_1', null)]),
      buildScaffoldDisclosureSuffix([record('opt_1', 'A'), record('opt_2', 'B')]),
    ];
    let exemplarCount = 0;
    for (const copy of suffixes) {
      for (const m of copy.matchAll(/\bsay\b[,:]?\s+'([^']+)'/gi)) {
        exemplarCount += 1;
        expect(detectConfigureOptionIntent(m[1], []).matched).toBe(true);
      }
    }
    // Positive control: an absence of failures must not be vacuous.
    expect(exemplarCount).toBeGreaterThanOrEqual(3);
  });

  it('never exceeds the budget the egress cap was extended by', () => {
    const worst = [
      buildScaffoldDisclosureSuffix([record('opt_1', 'x'.repeat(40))]),
      buildScaffoldDisclosureSuffix(
        Array.from({ length: 99 }, (_, i) => record(`opt_${i}`, null)),
      ),
    ];
    for (const suffix of worst) {
      expect(suffix.length).toBeLessThanOrEqual(SCAFFOLD_DISCLOSURE_MAX_CHARS);
    }
  });
});

describe('egress allowlist × scaffold disclosure', () => {
  const LABELLED = buildScaffoldDisclosureSuffix([record('opt_1', 'New Option')]);
  const GENERIC = buildScaffoldDisclosureSuffix([record('opt_1', null)]);
  const PLURAL = buildScaffoldDisclosureSuffix([record('opt_1', 'A'), record('opt_2', 'B')]);

  it('locked template + disclosure suffix is ACCEPTED (all templates × all suffix shapes)', () => {
    for (const template of RUN_ANALYSIS_LOCKED_TEMPLATES) {
      for (const suffix of [LABELLED, GENERIC, PLURAL]) {
        expect(isAllowedRunAnalysisAssistantText(`${template}${suffix}`)).toBe(true);
      }
    }
  });

  it('deterministic headline (+ existing tails) + disclosure suffix is ACCEPTED', () => {
    const headline = 'Option A currently leads by 24 percentage points because Price is the strongest driver.';
    expect(isAllowedRunAnalysisAssistantText(`${headline}${LABELLED}`)).toBe(true);
    expect(
      isAllowedRunAnalysisAssistantText(`${headline}${REDUCED_SAMPLES_SUFFIX}${LABELLED}`),
    ).toBe(true);
  });

  it('the extension opens NO hole: improvised prose with the suffix, the bare suffix, and doctored suffixes stay REJECTED', () => {
    expect(
      isAllowedRunAnalysisAssistantText(`Buy the startup immediately.${LABELLED}`),
    ).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(LABELLED.trim())).toBe(false);
    // A suffix whose label slot smuggles an internal id or a raw decimal is
    // rejected by the defence-in-depth rules even though the grammar matches.
    const template = 'Ran analysis on your current scenario.';
    const idSmuggle = LABELLED.replace("'New Option'", "'opt_b2'");
    const decimalSmuggle = LABELLED.replace("'New Option'", "'Plan 0.5'");
    expect(isAllowedRunAnalysisAssistantText(`${template}${idSmuggle}`)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(`${template}${decimalSmuggle}`)).toBe(false);
  });

  it('suffix mid-string (not terminal) is REJECTED — the disclosure is a suffix, not an infix licence', () => {
    const template = 'Ran analysis on your current scenario.';
    expect(
      isAllowedRunAnalysisAssistantText(`${template}${LABELLED} Extra improvised sentence.`),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P1-3 — the builder validates the COMPOSED suffix against the REAL egress
// defence functions at build time (derive, don't mirror). The pre-fix builder
// mirrored the decimal + vocabulary defences locally but NOT the internal-ID
// token defence (ASSISTANT_TEXT_ID_REGEX applies to the WHOLE text) — so a
// label like "Plan E_2" passed the builder, and the egress allowlist then
// silently REPLACED the entire disclosure-bearing summary with the bland
// locked template: the user saw scaffolded numbers with NO disclosure.
// ---------------------------------------------------------------------------

describe('P1-3 — composed suffix validated against the real egress defences', () => {
  // Each probe label smuggles a token the ID defence rejects ("E_2", "N_1",
  // "E_visa") while passing every mirror the pre-fix builder had.
  const PROBE_LABELS = ['Plan E_2', 'Option N_1 pilot', 'Fast-track E_visa'];
  const TEMPLATE = 'Ran analysis on your current scenario.';
  const HEADLINE =
    'Option A currently leads by 24 percentage points because Price is the strongest driver.';

  it('every probe label yields a SURVIVING disclosure (specific or generic) on both the template and headline egress shapes', () => {
    for (const label of PROBE_LABELS) {
      const suffix = buildScaffoldDisclosureSuffix([record('opt_1', label)]);
      expect(suffix.length).toBeGreaterThan(0);
      expect(suffix).toContain('Placeholder values');
      // The whole disclosure-bearing text must survive the REAL egress
      // predicate — the same function the validation-registry forwarder
      // gates the wire with. A false here means the forwarder replaces the
      // text with the locked template and the disclosure is silently lost.
      expect(isAllowedRunAnalysisAssistantText(`${TEMPLATE}${suffix}`)).toBe(true);
      expect(isAllowedRunAnalysisAssistantText(`${HEADLINE}${suffix}`)).toBe(true);
    }
  });

  it('an egress-unsafe label also gets the GENERIC configure chip (chip and disclosure stay coherent)', () => {
    for (const label of PROBE_LABELS) {
      expect(buildScaffoldConfigureChip([record('opt_1', label)])).toEqual(
        CONFIGURE_OPTION_GENERIC_CHIP,
      );
    }
  });

  it('positive control: a safe label still yields the SPECIFIC disclosure and chip', () => {
    const suffix = buildScaffoldDisclosureSuffix([record('opt_1', 'Acquisition')]);
    expect(suffix).toContain("'Acquisition'");
    expect(isAllowedRunAnalysisAssistantText(`${TEMPLATE}${suffix}`)).toBe(true);
    expect(buildScaffoldConfigureChip([record('opt_1', 'Acquisition')]).label).toBe(
      'Configure Acquisition',
    );
  });
});


// ---------------------------------------------------------------------------
// ⭐ 2026-07-25 — the OMITTED form. A scaffolded option can be scaffolded and
// still not reach the comparison (live on staging: the scaffold's neutral
// values coincide with the drafter's baseline option, so the engine removes
// the arm as a duplicate — IDENTICAL_OPTIONS_DEDUPED). The claim shipped must
// be DERIVED from the returned result, never from the scaffold's intent.
// ---------------------------------------------------------------------------

describe('partitionScaffoldedByAnalysisPresence — derived, not predicted', () => {
  const A = record('opt_a', 'Alpha');
  const B = record('opt_b', 'Beta');

  it('splits on what the RESULT contained and stamps every record', () => {
    const p = partitionScaffoldedByAnalysisPresence([A, B], new Set(['opt_a', 'opt_other']));
    expect(p.analysed.map((r) => r.option_id)).toEqual(['opt_a']);
    expect(p.omitted.map((r) => r.option_id)).toEqual(['opt_b']);
    expect(p.stamped.map((r) => [r.option_id, r.in_comparison])).toEqual([
      ['opt_a', true],
      ['opt_b', false],
    ]);
  });

  it('trap-13 positive control: an EMPTY id set asserts no absence (nothing was seen, so nothing can be missing)', () => {
    const p = partitionScaffoldedByAnalysisPresence([A, B], new Set());
    expect(p.omitted).toEqual([]);
    expect(p.analysed).toHaveLength(2);
    expect(p.stamped.every((r) => r.in_comparison === undefined)).toBe(true);
    // …and the composed disclosure is byte-identical to the pre-change copy.
    expect(buildScaffoldDisclosureForPartition(p)).toBe(buildScaffoldDisclosureSuffix([A, B]));
  });

  it('all present → byte-identical to the pre-change disclosure (no copy churn on the true-claim path)', () => {
    const p = partitionScaffoldedByAnalysisPresence([A], new Set(['opt_a']));
    expect(buildScaffoldDisclosureForPartition(p)).toBe(buildScaffoldDisclosureSuffix([A]));
  });

  it('all absent → the placeholder claim is GONE and the omission claim ships', () => {
    const p = partitionScaffoldedByAnalysisPresence([A], new Set(['opt_z']));
    const text = buildScaffoldDisclosureForPartition(p);
    expect(text).not.toMatch(/Placeholder values were used/);
    expect(text).toContain("'Alpha' was left out of this comparison because it has no values set.");
    expect(text).toContain(`say '${buildConfigureOptionChipMessage('Alpha')}'`);
  });

  it('MIXED: both sentences ship, and the combined tail still passes the egress allowlist', () => {
    const p = partitionScaffoldedByAnalysisPresence([A, B], new Set(['opt_a']));
    const text = buildScaffoldDisclosureForPartition(p);
    expect(text).toContain("Placeholder values were used for 'Alpha'");
    expect(text).toContain("'Beta' was left out of this comparison");
    for (const template of RUN_ANALYSIS_LOCKED_TEMPLATES) {
      expect(isAllowedRunAnalysisAssistantText(`${template}${text}`)).toBe(true);
    }
  });
});

describe('buildScaffoldOmittedSuffix — copy contract + egress', () => {
  const LABELLED_OUT = buildScaffoldOmittedSuffix([record('opt_1', 'New Option')]);
  const GENERIC_OUT = buildScaffoldOmittedSuffix([record('opt_1', null)]);
  const PLURAL_OUT = buildScaffoldOmittedSuffix([record('opt_1', 'A'), record('opt_2', 'B')]);

  it('empty list yields no claim at all', () => {
    expect(buildScaffoldOmittedSuffix([])).toBe('');
  });

  it('every shape is ACCEPTED on every locked template and on a deterministic headline', () => {
    const headline =
      'Option A currently leads by 24 percentage points because Price is the strongest driver.';
    for (const suffix of [LABELLED_OUT, GENERIC_OUT, PLURAL_OUT]) {
      for (const template of RUN_ANALYSIS_LOCKED_TEMPLATES) {
        expect(isAllowedRunAnalysisAssistantText(`${template}${suffix}`)).toBe(true);
      }
      expect(isAllowedRunAnalysisAssistantText(`${headline}${suffix}`)).toBe(true);
      expect(isAllowedRunAnalysisAssistantText(`${headline}${REDUCED_SAMPLES_SUFFIX}${suffix}`)).toBe(true);
    }
  });

  it('every advised exemplar routes DETERMINISTICALLY through the shipped configure-option detector', () => {
    for (const suffix of [LABELLED_OUT, GENERIC_OUT, PLURAL_OUT]) {
      const quoted = suffix.match(/say '([^']+)'/);
      expect(quoted).not.toBeNull();
      expect(detectConfigureOptionIntent(quoted![1]!, []).matched).toBe(true);
    }
  });

  it('opens NO hole: improvised prose, the bare suffix, and doctored slots stay REJECTED', () => {
    const template = 'Ran analysis on your current scenario.';
    expect(isAllowedRunAnalysisAssistantText(`Buy the startup immediately.${LABELLED_OUT}`)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(LABELLED_OUT.trim())).toBe(false);
    expect(
      isAllowedRunAnalysisAssistantText(`${template}${LABELLED_OUT} Extra improvised sentence.`),
    ).toBe(false);
    expect(
      isAllowedRunAnalysisAssistantText(`${template}${LABELLED_OUT.replace("'New Option'", "'opt_b2'")}`),
    ).toBe(false);
    expect(
      isAllowedRunAnalysisAssistantText(`${template}${LABELLED_OUT.replace("'New Option'", "'Plan 0.5'")}`),
    ).toBe(false);
  });

  it('an egress-unsafe label falls back to the GENERIC omission form rather than being swallowed whole', () => {
    const template = 'Ran analysis on your current scenario.';
    for (const label of ['opt_b2', 'Plan 0.5', "It's a 'quoted' plan", 'x'.repeat(200)]) {
      const suffix = buildScaffoldOmittedSuffix([record('opt_1', label)]);
      expect(isAllowedRunAnalysisAssistantText(`${template}${suffix}`)).toBe(true);
    }
  });

  it('never exceeds the budget the egress cap was extended by — including the MIXED worst case', () => {
    const worstMixed =
      buildScaffoldDisclosureSuffix([record('opt_1', 'x'.repeat(40))]) +
      buildScaffoldOmittedSuffix([record('opt_2', 'y'.repeat(40))]);
    expect(worstMixed.length).toBeLessThanOrEqual(SCAFFOLD_DISCLOSURE_MAX_CHARS);
    const worstPlural =
      buildScaffoldDisclosureSuffix(Array.from({ length: 99 }, (_, i) => record(`opt_a${i}`, null))) +
      buildScaffoldOmittedSuffix(Array.from({ length: 99 }, (_, i) => record(`opt_b${i}`, null)));
    expect(worstPlural.length).toBeLessThanOrEqual(SCAFFOLD_DISCLOSURE_MAX_CHARS);
  });
});

describe('validation-registry honesty floor × the omission disclosure', () => {
  const forwarder = HANDLER_VALIDATION_REGISTRY.run_analysis!.confirmation_template as (
    outcome: unknown,
  ) => string;

  it('a REJECTED summary carrying only the omission sentence still ships that sentence (not a bare fallback)', () => {
    const suffix = buildScaffoldOmittedSuffix([record('opt_1', 'New Option')]);
    // Positive control: the poisoned text really is rejected by the allowlist,
    // so the salvage branch — and only the salvage branch — is what runs.
    const poisoned = `Improvised prose the allowlist must never accept.${suffix}`;
    expect(isAllowedRunAnalysisAssistantText(poisoned)).toBe(false);

    const forwarded = forwarder({ assistant_text: poisoned });
    expect(forwarded).not.toBe(poisoned);
    expect(forwarded).toContain('was left out of this comparison');
    expect(isAllowedRunAnalysisAssistantText(forwarded)).toBe(true);
  });

  it('the same floor holds for the MIXED tail', () => {
    const mixed =
      buildScaffoldDisclosureSuffix([record('opt_1', 'Alpha')]) +
      buildScaffoldOmittedSuffix([record('opt_2', 'Beta')]);
    const poisoned = `Improvised prose the allowlist must never accept.${mixed}`;
    expect(isAllowedRunAnalysisAssistantText(poisoned)).toBe(false);
    const forwarded = forwarder({ assistant_text: poisoned });
    expect(forwarded).toContain("Placeholder values were used for 'Alpha'");
    expect(forwarded).toContain("'Beta' was left out of this comparison");
    expect(isAllowedRunAnalysisAssistantText(forwarded)).toBe(true);
  });
});
