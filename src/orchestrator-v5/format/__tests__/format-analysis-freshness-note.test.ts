/**
 * CONTEXT/MEMORY V5 — defect 2: STALE ANALYSIS IS INVISIBLE ON THE NUMBERS.
 *
 * WHY THIS EXISTS. `display_analysis` is the model-facing projection of the
 * analysis. Before this fix it rendered BYTE-IDENTICALLY whether the turn's
 * canonical freshness verdict was `'fresh'` or `'stale'`: `status`,
 * `leading_option`, `runner_up`, `margin`, `robustness_band`, `options[]` and
 * `top_drivers` were all present and unqualified either way. The ONLY thing
 * `analysisFreshness` gated was `flipLicenceOpen` — the tipping-point display
 * digits.
 *
 * That made freshness the ONE lossy/qualifying condition in this pack with no
 * in-band marker. Every other one has one, adjacent to the affected content:
 *   · `truncation_note`              — sections dropped by the budget guard
 *   · `value_of_information_note`    — a genuinely empty VOI list
 *   · `constraint_infeasible_note`   — the leading option breaks a constraint
 *   · `conversation.window.notice`   — turns outside the verbatim slice
 *   · `brief.truncated`              — the brief was sliced
 * The estate uses that idiom precisely BECAUSE a sibling field is not a
 * disclosure. Freshness lived only in the sibling `coaching_context.freshness`
 * enum plus soft prose in COACHING_CONTEXT_INSTRUCTION.
 *
 * CEE #978 sharpened this rather than closing it. It gated the per-element
 * `focus` analysis join on `usable_for_chips` and added a prompt instruction
 * telling the model not to "recover, infer or rejoin figures from the broader
 * `analysis` section by label" for an `analysis_not_current` element. So the
 * model is now told those broader figures are not licensed for the SELECTED
 * element — while the broader section itself still presents them, unqualified,
 * as though they were current. This test closes that gap at the source.
 *
 * WHAT WOULD HAVE TO BE TRUE for these to pass while the property is broken:
 * the note could exist but be droppable by the budget guard (covered), or be
 * emitted on fresh turns too so it carries no information (covered by the
 * byte-identity arm), or be attached without the digits it qualifies being
 * present (covered — the stale arm asserts the figures ARE still there, since
 * the fix is to QUALIFY them, not to withhold them).
 */

import { describe, expect, it } from 'vitest';

import type { ContextPackAnalysis } from '../../context/context-pack-assembler.js';
import {
  formatAnalysisForContext,
  DISPLAY_ANALYSIS_CHAR_BUDGET,
  ANALYSIS_NOT_CURRENT_NOTE,
} from '../format-analysis-for-context.js';

function rawAnalysis(overrides: Partial<ContextPackAnalysis> = {}): ContextPackAnalysis {
  return {
    status: 'complete',
    leading_option: { label: 'Option A', probability: 0.862 },
    runner_up: { label: 'Option B', probability: 0.791 },
    margin_pp: 7.1,
    robustness_band: 'moderate',
    top_drivers: [{ factor_label: 'Price', sensitivity_value: 1.0 }],
    fragile_edges: [],
    ...overrides,
  };
}

/**
 * The full set of freshness verdicts `deriveAnalysisFreshness` can produce
 * (`context/freshness.ts`). `'fresh'` is the ONLY licensing value; everything
 * else — including absence — must be qualified. Derived from the producer's
 * enum rather than from the failure mode in hand: writing this as "stale only"
 * would be the same asymmetry that has bitten this estate before.
 */
const NON_FRESH_VERDICTS = ['stale', 'unknown', 'none', undefined, null] as const;

describe('display_analysis — freshness disclosure on the figures themselves', () => {
  /**
   * VACUITY GUARD, and it caught a real defect in this file's first draft.
   * `ANALYSIS_NOT_CURRENT_NOTE` is imported from the module under test. Before
   * the fix it resolves to `undefined`, so every
   * `expect(out?.analysis_not_current_note).toBe(ANALYSIS_NOT_CURRENT_NOTE)`
   * became `expect(undefined).toBe(undefined)` and PASSED — four of the six
   * tests below were green against the defect they exist to catch. Asserting
   * the constant is a non-empty string first makes the whole file fail loudly
   * at pristine instead of certifying the absence it is hunting.
   */
  it('the disclosure constant exists (vacuity guard for every test below)', () => {
    expect(typeof ANALYSIS_NOT_CURRENT_NOTE).toBe('string');
    expect((ANALYSIS_NOT_CURRENT_NOTE ?? '').length).toBeGreaterThan(0);
  });

  it('attaches the note for EVERY non-fresh verdict, not just "stale"', () => {
    for (const verdict of NON_FRESH_VERDICTS) {
      const out = formatAnalysisForContext(rawAnalysis(), { analysisFreshness: verdict });
      expect(out, `verdict=${String(verdict)}`).not.toBeNull();
      expect(
        typeof out?.analysis_not_current_note,
        `verdict=${String(verdict)} must be qualified with a string note`,
      ).toBe('string');
      expect(
        out?.analysis_not_current_note,
        `verdict=${String(verdict)} must carry the canonical note`,
      ).toBe(ANALYSIS_NOT_CURRENT_NOTE);
    }
  });

  it('emits NOTHING on a fresh verdict — byte-identical to the pre-fix projection', () => {
    const fresh = formatAnalysisForContext(rawAnalysis(), { analysisFreshness: 'fresh' });
    expect(fresh?.analysis_not_current_note).toBeUndefined();
    // The discriminating half: fresh and stale must differ by EXACTLY this key.
    const stale = formatAnalysisForContext(rawAnalysis(), { analysisFreshness: 'stale' });
    const freshKeys = Object.keys(fresh ?? {}).sort();
    const staleKeys = Object.keys(stale ?? {}).sort();
    expect(staleKeys.filter((k) => !freshKeys.includes(k))).toEqual([
      'analysis_not_current_note',
    ]);
    expect(freshKeys.filter((k) => !staleKeys.includes(k))).toEqual([]);
  });

  it('QUALIFIES the figures rather than withholding them', () => {
    // The fix must not silently strip the analysis — a missing block would be a
    // different (and worse) change, and the coach still needs the prior run to
    // explain what re-running would update.
    const stale = formatAnalysisForContext(rawAnalysis(), { analysisFreshness: 'stale' });
    expect(stale?.leading_option).toBeDefined();
    expect(stale?.margin).toBeDefined();
    expect(stale?.robustness_band).toBe('moderate');
  });

  it('is NEVER dropped by the char-budget guard', () => {
    // Pathological labels force every droppable section out. The note must
    // survive alongside the other never-dropped disclosures: a truncated
    // projection that loses its staleness marker would present stale figures
    // as current precisely when the pack is most crowded.
    const huge = 'X'.repeat(3000);
    const out = formatAnalysisForContext(
      rawAnalysis({
        leading_option: { label: huge, probability: 0.862 },
        top_drivers: Array.from({ length: 40 }, (_, i) => ({
          factor_label: `${huge}-${i}`,
          sensitivity_value: 0.5,
        })),
      }),
      { analysisFreshness: 'stale' },
    );
    expect(out?.truncation_note, 'precondition: the guard must actually fire').toBeDefined();
    expect(typeof out?.analysis_not_current_note).toBe('string');
    expect(out?.analysis_not_current_note).toBe(ANALYSIS_NOT_CURRENT_NOTE);
  });

  it('the note itself is inside the char budget arithmetic', () => {
    // Adding a never-dropped string must not push a previously-compliant
    // projection over the budget without the guard noticing.
    const out = formatAnalysisForContext(rawAnalysis(), { analysisFreshness: 'stale' });
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(DISPLAY_ANALYSIS_CHAR_BUDGET);
  });

  it('the note names the remedy and claims nothing about WHY it is not current', () => {
    // Truth bound: the formatter receives a verdict token, not a reason. It may
    // say the figures are not licensed as current and that re-running updates
    // them; it may NOT assert the model changed (`unknown`/`none` are also
    // non-fresh, and neither implies an edit).
    expect(ANALYSIS_NOT_CURRENT_NOTE).toMatch(/re-?run/i);
    expect(ANALYSIS_NOT_CURRENT_NOTE).not.toMatch(/you (edited|changed)|since you/i);
  });
});
