/**
 * P0 TRUST — the conversational recitation may not assert stability about
 * values the product itself computed from defaults.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEPLOYED WITNESS THIS PINS (13 Aug 2026, CEE `a3d74857`)
 *
 * On an ORDINARY CHAT TURN, while `analysis_ready.options[].status =
 * needs_encoding` for that option, the product emitted verbatim:
 *
 *   "'replace our current CRM with HubSpot next quarter' currently leads, with
 *    a probability of 96%. 'migrate to Salesforce instead' is the most likely
 *    contender to overtake it, with a probability of 2%. This result looks
 *    stable, so smaller changes are less likely to flip the outcome on their
 *    own."
 *
 * The ANALYSE turn discloses its placeholders correctly. The CONVERSATIONAL
 * recitation dropped the disclosure and then added a STABILITY ASSERTION on
 * top of the same numbers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CORPUS IS NOT FROM THE AUTHOR'S HEAD (CLAUDE.md trap 22)
 *
 * `DEPLOYED_STABILITY_LINE` is the exact sentence measured on the deployed
 * build.
 *
 * ⚠⚠ THE CLAIM THAT USED TO SIT HERE WAS FALSE, AND IT IS WHY F6 SHIPPED —
 * REPLACED RATHER THAN QUIETLY DELETED (CLAUDE.md trap 14). It read: "The
 * `defaulted_assumptions` fixture shape is copied from a REAL enrichment
 * capture ... not invented here, so the reader is tested against what the
 * producer actually emits."
 *
 * Half true, and the false half was load-bearing. The array ENTRY was copied
 * from `fixtures/dsk-walk/session-a.enrichment.json:949`. The ENVELOPE around
 * it was authored here as `enrichment: { defaulted_assumptions: … }` — top
 * level. Line 949 sits at four-space indentation INSIDE `decision_brief`, and
 * the nested path is the only one PLoT has ever emitted.
 *
 * So this suite passed while the reader it certified returned null on every
 * real payload, and the product disclosed nothing to anybody for the whole of
 * #940's life. Trap 16-inverse, verbatim: a fixture you wrote yourself is not
 * evidence about the wire.
 *
 * ⭐ AND IT HAD BECOME A TRIPWIRE. Once F6 fixed the reader, this suite was the
 * only thing in the repo still asserting the top-level shape — so it actively
 * DEFENDED the wrong path: anyone deleting the tolerated top-level read as dead
 * code would be stopped by a red test whose header told them top level was what
 * the producer emits. The envelope below is now the producer's real one; the
 * single remaining top-level case is labelled for what it actually is.
 *
 * ⚠ FIXTURES ARE NOT EDITED, ONLY READ. That capture is a record of what a
 * dated build received (trap 14b).
 */

import { describe, expect, it } from 'vitest';

import {
  composeExplainResultsFallback,
  composeRobustnessVerdict,
  composeWhatWouldFlipFallback,
  type RobustnessVerdictInput,
} from '../explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../../context/projection-summaries.js';
import {
  buildDefaultedAssumptionsDisclosure,
  pickLatestDefaultedAssumptions,
  readDefaultedAssumptions,
  MAX_NAMED_DEFAULTED_FACTORS,
} from '../../../coaching/pick-defaulted-assumptions.js';

/** The exact sentence measured on the deployed build. */
const DEPLOYED_STABILITY_LINE =
  'This result looks stable, so smaller changes are less likely to flip the outcome on their own.';

/**
 * Every stability assertion `composeRobustnessVerdict` can emit, in either
 * mode. Derived by reading the composer's stability arms rather than by
 * recalling them — a NEW arm added without extending this list would escape
 * the suppression check, so the `no arm escapes` test below pins the list
 * against the composer's own behaviour over the whole category matrix.
 */
const STABILITY_ASSERTION_MARKERS: readonly string[] = [
  'should hold under reasonable variation',
  'less likely to flip the outcome on their own',
  'worth checking the main assumptions',
  'genuine dead heat rather than noise',
  'appears fragile',
  'sensitive to small movements',
];

/**
 * A clear-margin, stable-band projection — the deployed witness's cell.
 *
 * Typed as the FULL `AnalysisProjectionSummary` (not the minimal
 * `RobustnessVerdictInput`) because the two fallbacks read drivers as well as
 * the verdict, and a fixture that satisfies only the narrow shape would prove
 * nothing about the composer the user actually reaches.
 */
function clearStableProjection(): AnalysisProjectionSummary {
  return {
    status: 'complete',
    leading_option: {
      label: "'replace our current CRM with HubSpot next quarter'",
      probability: 0.96,
    },
    runner_up: { label: "'migrate to Salesforce instead'", probability: 0.02 },
    margin_pp: 94,
    robustness_band: 'stable',
    top_drivers: [{ factor_label: 'Seat price', sensitivity_value: 0.42 }],
    fragile_edges: [],
  };
}

/** The producer shape, copied from the real capture named in the header. */
const REAL_DEFAULTED_ENTRY = {
  factor_label: 'Market Conditions',
  note:
    'No starting value was provided for "Market Conditions" — the analysis used a default. '
    + 'Setting a real value or range would make this result more trustworthy.',
  source: 'value_defaulted',
  doctrine: 'provisional_doctrine_v0',
};

function factWithDefaulted(defaulted: unknown): any {
  return [
    {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 's1',
        leading_option_id: 'opt_a',
        computed_at: '2026-08-13T19:30:00.000Z',
        // THE PRODUCER'S REAL PATH. See the header: this was top-level, and
        // that single wrong key is the entire F6 defect.
        enrichment: { decision_brief: { defaulted_assumptions: defaulted } },
      },
    },
  ];
}

describe('conversational recitation — defaulted values', () => {
  describe('FALSEHOOD 1 — the stability assertion', () => {
    it('POSITIVE CONTROL: without a defaulted signal the deployed line is still produced', () => {
      // Proves the instrument can SEE the defect. Without this, a suppression
      // test passes on a composer that never emitted the line at all
      // (CLAUDE.md trap 13 — an absence assertion needs a presence first).
      const verdict = composeRobustnessVerdict(clearStableProjection(), null, 'flip', null);
      expect(verdict.stability_clause).toBe(DEPLOYED_STABILITY_LINE);
      expect(verdict.defaulted_disclosure).toBeNull();
    });

    it('suppresses the stability clause when the engine reports defaulted values', () => {
      const verdict = composeRobustnessVerdict(clearStableProjection(), null, 'flip', {
        count: 1,
        named: ['Market Conditions'],
      });
      expect(verdict.stability_clause).toBeNull();
      expect(verdict.defaulted_disclosure).not.toBeNull();
    });

    it('suppresses stability_implies_flippability with the clause it describes', () => {
      // The flag is the clause's own summary for downstream callers. A `true`
      // surviving a suppressed sentence lets a caller re-assert the finding the
      // suppression just withdrew — trap 21, one concept two readers.
      const fragile: RobustnessVerdictInput = {
        ...clearStableProjection(),
        robustness_band: 'fragile',
      };
      const before = composeRobustnessVerdict(fragile, null, 'flip', null);
      expect(before.stability_implies_flippability).toBe(true);

      const after = composeRobustnessVerdict(fragile, null, 'flip', {
        count: 1,
        named: ['Market Conditions'],
      });
      expect(after.stability_implies_flippability).toBe(false);
      expect(after.stability_clause).toBeNull();
    });

    it('NO ARM ESCAPES: no stability assertion survives in any mode or category cell', () => {
      // Sweeps the WHOLE matrix rather than the arm the defect was found in.
      // This is what catches a stability arm added later (trap 12: a
      // hand-maintained list of arms would drift; this derives from behaviour).
      const bands = ['stable', 'highly_stable', 'moderate', 'fragile', 'unknown', null];
      const margins = [94, 0.2, null];
      const modes = ['explain', 'flip'] as const;
      let sawAssertionWithoutSignal = 0;

      for (const band of bands) {
        for (const margin of margins) {
          for (const mode of modes) {
            const projection: RobustnessVerdictInput = {
              ...clearStableProjection(),
              margin_pp: margin,
              robustness_band: band,
            };
            const bare = composeRobustnessVerdict(projection, null, mode, null);
            if (
              bare.stability_clause !== null
              && STABILITY_ASSERTION_MARKERS.some((m) => bare.stability_clause!.includes(m))
            ) {
              sawAssertionWithoutSignal += 1;
            }
            const withDefaults = composeRobustnessVerdict(projection, null, mode, {
              count: 2,
              named: ['Market Conditions', 'Churn Rate'],
            });
            expect(withDefaults.stability_clause).toBeNull();
            expect(withDefaults.stability_implies_flippability).toBe(false);
          }
        }
      }
      // The sweep must actually have exercised the assertion-bearing cells.
      expect(sawAssertionWithoutSignal).toBeGreaterThan(0);
    });
  });

  describe('EVERY READER — the suppression lands on the CATEGORY', () => {
    // ⭐ THE LOAD-BEARING TEST OF THIS LANE. `stability_clause` is only ONE
    // reader of this verdict. The free-text advice gate
    // (`routing/post-analysis-advice-gate.ts`) branches on `stability_category`
    // at five call sites and writes its OWN sentences. A fix that nulled the
    // clause would have left the gate asserting the same thing in its own
    // words — updating two readers of three and reproducing the defect.
    it('collapses stability_category to unknown for EVERY band', () => {
      for (const band of ['stable', 'highly_stable', 'moderate', 'fragile', 'unknown', null]) {
        for (const mode of ['explain', 'flip'] as const) {
          const projection: RobustnessVerdictInput = {
            ...clearStableProjection(),
            robustness_band: band,
          };
          const verdict = composeRobustnessVerdict(projection, null, mode, {
            count: 1,
            named: ['Market Conditions'],
          });
          expect(verdict.stability_category).toBe('unknown');
          expect(verdict.headline.endsWith(':unknown')).toBe(true);
        }
      }
    });

    it('CONTRAST CONTROL: the measured band survives when nothing is defaulted', () => {
      // Without this the test above would pass on a composer that always
      // returned `unknown` — a guard agreeing with itself (trap 13b).
      const stable = composeRobustnessVerdict(clearStableProjection(), null, 'flip', null);
      expect(stable.stability_category).toBe('stable');
      const fragile = composeRobustnessVerdict(
        { ...clearStableProjection(), robustness_band: 'fragile' },
        null,
        'flip',
        null,
      );
      expect(fragile.stability_category).toBe('fragile');
    });

    it('leaves the MARGIN axis untouched — the recitation is qualified, not withheld', () => {
      const withDefaults = composeRobustnessVerdict(clearStableProjection(), null, 'flip', {
        count: 1,
        named: ['Market Conditions'],
      });
      const without = composeRobustnessVerdict(clearStableProjection(), null, 'flip', null);
      expect(withDefaults.margin_category).toBe(without.margin_category);
      expect(withDefaults.margin_clause).toBe(without.margin_clause);
      expect(withDefaults.margin_clause).not.toBeNull();
    });
  });

  describe('FALSEHOOD 1 — the disclosure the analyse turn already makes', () => {
    it('the flip fallback carries the disclosure and drops the stability line', () => {
      const before = composeWhatWouldFlipFallback(clearStableProjection(), null, null, null);
      expect(before).toContain(DEPLOYED_STABILITY_LINE);

      const after = composeWhatWouldFlipFallback(clearStableProjection(), null, null, {
        count: 1,
        named: ['Market Conditions'],
      });
      expect(after).not.toContain(DEPLOYED_STABILITY_LINE);
      expect(after).toContain("The analysis used a default value for 'Market Conditions'");
      expect(after).toContain('the comparison is illustrative until those values are set');
      // The recitation itself SURVIVES — qualified, not withheld.
      expect(after).toContain('currently leads, with a probability of');
    });

    it('the explain fallback carries the same disclosure, from the same source', () => {
      const after = composeExplainResultsFallback(clearStableProjection(), null, null, {
        count: 1,
        named: ['Market Conditions'],
      });
      expect(after).toContain("The analysis used a default value for 'Market Conditions'");
      expect(after).not.toContain('should hold under reasonable variation');
    });

    it('BYTE-IDENTICAL when there is no signal (fail-safe direction)', () => {
      // The pre-existing copy is reproduced exactly when nothing is defaulted,
      // so this change cannot alter an honest turn.
      expect(composeWhatWouldFlipFallback(clearStableProjection(), null, null, null)).toBe(
        composeWhatWouldFlipFallback(clearStableProjection(), null, null),
      );
      expect(composeExplainResultsFallback(clearStableProjection(), null, null, null)).toBe(
        composeExplainResultsFallback(clearStableProjection(), null, null),
      );
    });
  });

  describe('the reader — over the shapes the untyped enrichment seam admits', () => {
    it('reads the REAL producer shape from the captured enrichment', () => {
      const signal = readDefaultedAssumptions([REAL_DEFAULTED_ENTRY]);
      expect(signal).toEqual({ count: 1, named: ['Market Conditions'] });
    });

    it('COUNTS an entry it cannot NAME', () => {
      // An unnameable label must not silently restore a stability assertion.
      const signal = readDefaultedAssumptions([{ source: 'value_defaulted' }]);
      expect(signal).not.toBeNull();
      expect(signal!.count).toBe(1);
      expect(signal!.named).toEqual([]);
      expect(buildDefaultedAssumptionsDisclosure(signal!)).toContain(
        'one of the factors in your model',
      );
    });

    it('does not present a capped list as exhaustive', () => {
      const many = Array.from({ length: MAX_NAMED_DEFAULTED_FACTORS + 2 }, (_, i) => ({
        factor_label: `Factor ${i}`,
      }));
      const signal = readDefaultedAssumptions(many)!;
      expect(signal.count).toBe(MAX_NAMED_DEFAULTED_FACTORS + 2);
      expect(signal.named).toHaveLength(MAX_NAMED_DEFAULTED_FACTORS);
      const text = buildDefaultedAssumptionsDisclosure(signal);
      expect(text).toContain(`${MAX_NAMED_DEFAULTED_FACTORS + 2} of the factors in your model`);
      expect(text).not.toContain('Factor 0');
    });

    it('returns null for absent / empty / non-array values', () => {
      expect(readDefaultedAssumptions(undefined)).toBeNull();
      expect(readDefaultedAssumptions([])).toBeNull();
      expect(readDefaultedAssumptions({})).toBeNull();
      expect(readDefaultedAssumptions([null, 'x', 3])).toBeNull();
    });

    it('never states a causal or user-blaming claim', () => {
      // The standing ruling: the product may describe what IT did; it may not
      // tell the user what THEY said or did.
      for (const signal of [
        { count: 1, named: ['Market Conditions'] },
        { count: 2, named: ['Market Conditions', 'Churn Rate'] },
        { count: 5, named: [] },
      ]) {
        const text = buildDefaultedAssumptionsDisclosure(signal);
        expect(text).toMatch(/^The analysis used a default value for /);
        expect(text.toLowerCase()).not.toContain('you ');
        expect(text.toLowerCase()).not.toContain('your fault');
        expect(text.toLowerCase()).not.toContain('because');
      }
    });
  });

  describe('the selector — same fact as every other grounding layer', () => {
    it('reads defaulted_assumptions off the selected run_analysis fact', () => {
      expect(pickLatestDefaultedAssumptions(factWithDefaulted([REAL_DEFAULTED_ENTRY]))).toEqual({
        count: 1,
        named: ['Market Conditions'],
      });
    });

    it('CONTRAST CONTROL: an analysis with no defaulted assumptions yields null', () => {
      // Proves the selector discriminates rather than returning a constant.
      expect(pickLatestDefaultedAssumptions(factWithDefaulted([]))).toBeNull();
      expect(pickLatestDefaultedAssumptions([])).toBeNull();
    });

    /**
     * ⚠ THIS IS A TOLERANCE, NOT A CONTRACT — and the label matters more than
     * the assertion.
     *
     * The top-level path is NOT what PLoT emits and never has been. It is read
     * only so that (a) if the key is ever hoisted into
     * `ISL_TOPLEVEL_ENRICHMENT_KEYS`, the reader keeps working across the
     * deploy skew instead of going dark for a window, and (b) any facts written
     * during such a hoist stay readable.
     *
     * It is exactly ONE test on purpose. The previous version of this suite
     * asserted the top-level shape THROUGHOUT while its header called that
     * shape the producer's — which is how a green suite certified a reader that
     * never fired, and then defended the wrong path against cleanup.
     *
     * ⭐ RE-SURFACE TRIGGER: delete this test and the tolerated branch in
     * `readDefaultedAssumptionsFromEnrichment` together, the first time either
     * is true —
     *   · PLoT's `assembly/decision-brief.ts` still emits ONLY the nested path
     *     at the next contract bump (check it; if so the tolerance never had a
     *     job and should go), OR
     *   · a hoist has landed AND every service has been on the hoisted schema
     *     version for one full deploy cycle (then the tolerance is the real
     *     path and the nested read becomes the legacy one).
     * Do not leave this dangling: an unexplained second path is how a reader
     * becomes unfalsifiable.
     */
    it('TOLERATED (not the producer shape): a top-level array is still read', () => {
      const topLevel: any = [
        {
          fact_type: 'run_analysis',
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: 's1',
            leading_option_id: 'opt_a',
            computed_at: '2026-08-13T19:30:00.000Z',
            enrichment: { defaulted_assumptions: [REAL_DEFAULTED_ENTRY] },
          },
        },
      ];
      expect(pickLatestDefaultedAssumptions(topLevel)).toEqual({
        count: 1,
        named: ['Market Conditions'],
      });
    });

    /**
     * The nested path WINS when both are present. Pins the precedence so a
     * future edit cannot quietly make the tolerated path authoritative.
     */
    it('prefers the producer’s nested path when both are present', () => {
      const both: any = [
        {
          fact_type: 'run_analysis',
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: 's1',
            leading_option_id: 'opt_a',
            computed_at: '2026-08-13T19:30:00.000Z',
            enrichment: {
              defaulted_assumptions: [{ ...REAL_DEFAULTED_ENTRY, factor_label: 'WRONG — top level' }],
              decision_brief: { defaulted_assumptions: [REAL_DEFAULTED_ENTRY] },
            },
          },
        },
      ];
      expect(pickLatestDefaultedAssumptions(both)).toEqual({
        count: 1,
        named: ['Market Conditions'],
      });
    });
  });
});
