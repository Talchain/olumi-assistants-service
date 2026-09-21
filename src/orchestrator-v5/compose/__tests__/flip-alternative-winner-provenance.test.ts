/**
 * Contract step-2 slice 1 — flip return-path PROVENANCE repair.
 *
 * PLoT computes WHICH option would lead once a factor crosses its tipping
 * point and ships it on every flip row as
 * `DenormalisedFlipThreshold.alternative_winner_id` (+ `_label`), verified at
 * PLoT staging `c79c63c1`, `src/lib/flip-threshold-denormaliser.ts:35-37`.
 * CEE's `readFlipEntries` read eight fields and discarded both, so the
 * identity never reached any CEE consumer.
 *
 * SCOPE LIMIT (Codex F10, stated here so no reader over-reads these tests):
 * `what-would-flip.ts:130-138` uses a VALID Sonnet `answer_text` VERBATIM and
 * only calls `composeWhatWouldFlipFallback` when that answer is invalid. These
 * tests therefore prove the DETERMINISTIC FALLBACK carries the identity. They
 * do NOT show that a live Sonnet-authored flip answer changed, and must never
 * be cited for "all live flip answers are now identity-correct".
 *
 * WHY THE ID, NOT THE LABEL — the two discriminating cases below:
 *  1. PLoT's `resolveLabel` returns `option?.label ?? optionId`, so an
 *     unresolvable id comes back AS ITS OWN LABEL. A label-only reader cannot
 *     tell that from a real display name and would print an internal token.
 *  2. Two options may share a display label. A label-only reader folds two
 *     distinct ids into one target and names a winner the analysis never
 *     attested. (This is the collision case UI #492's resolver handled.)
 * Each case is a fixture where a label-derived answer and the id-derived
 * answer genuinely DISAGREE.
 */

import { describe, expect, it } from 'vitest';

import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import type { RawRobustnessSignals } from '../../coaching/pick-raw-robustness.js';
import { composeWhatWouldFlipFallback } from '../../tools/handlers/explanation-fallback.js';
import {
  readFlipEntries,
  resolveAgreedAlternativeWinner,
  resolveAlternativeWinner,
  summariseFlipEntries,
  type FlipEntry,
  type FlipSummary,
} from '../flip-proposal.js';

const PROJECTION: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Hire Senior Engineer', probability: 0.62 },
  runner_up: { label: 'Hire Two Mid-Level', probability: 0.27 },
  margin_pp: 35,
  robustness_band: 'stable',
  top_drivers: [{ factor_label: 'Engineering Capacity', sensitivity_value: 0.65 }],
};

const RAW: RawRobustnessSignals = { level: 'fragile', near_tie_is_tie: false };

/** The naming clause this slice adds. */
const NAMES_ALTERNATIVE = /would lead instead/i;
/** The pre-repair concrete sentence — must survive every withholding case. */
const CONCRETE_SENTENCE = /is the most likely single factor to change which option leads/i;

function concreteSummary(entries: readonly FlipEntry[]): FlipSummary {
  const summary = summariseFlipEntries(entries);
  // Guard the fixture itself: these tests are meaningless unless the composer
  // actually reaches the `concrete` branch (TESTING-DISCIPLINE 1 — name the
  // branch each fixture must reach).
  expect(summary.overall_status).toBe('concrete');
  return summary;
}

function entry(over: Partial<FlipEntry> = {}): FlipEntry {
  return {
    factor_id: 'fac_capacity',
    factor_label: 'Engineering Capacity',
    flip_value: 0.42,
    flip_reason: 'found',
    margin_supports_flip: true,
    ...over,
  };
}

describe('flip return-path provenance — reader preserves BOTH id and label', () => {
  it('readFlipEntries carries alternative_winner_id AND alternative_winner_label off the PLoT wire shape', () => {
    // Byte-shaped after PLoT's DenormalisedFlipThreshold (staging c79c63c1).
    const entries = readFlipEntries({
      flip_thresholds: [
        {
          factor_id: 'fac_capacity',
          factor_label: 'Engineering Capacity',
          current_value: 12,
          flip_value: 18,
          direction: 'increase',
          unit: 'engineers',
          alternative_winner_id: 'opt_two_mid',
          alternative_winner_label: 'Hire Two Mid-Level',
          flip_reason: 'found',
          iterations_used: 7,
          probes_used: 10,
        },
      ],
    });

    expect(entries).toHaveLength(1);
    // The IDENTITY is what makes this a provenance repair.
    expect(entries[0]!.alternative_winner_id).toBe('opt_two_mid');
    // The label is PRESERVED alongside it, never instead of it (Codex F10).
    expect(entries[0]!.alternative_winner_label).toBe('Hire Two Mid-Level');
  });

  it('POSITIVE CONTROL — PLoT emits the key as null (not absent) when no flip was found; both null shapes read as null, and the row is still kept', () => {
    const entries = readFlipEntries({
      flip_thresholds: [
        // PLoT's actual no-flip shape: key present, value null.
        {
          factor_id: 'fac_a',
          factor_label: 'Factor A',
          flip_value: null,
          alternative_winner_id: null,
          alternative_winner_label: null,
          flip_reason: 'no_effect_within_bounds',
        },
        // Pre-contract producer: key absent entirely.
        { factor_id: 'fac_b', factor_label: 'Factor B', flip_value: null, flip_reason: 'timeout' },
      ],
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]!.alternative_winner_id).toBeNull();
    expect(entries[0]!.alternative_winner_label).toBeNull();
    expect(entries[1]!.alternative_winner_id).toBeNull();
    expect(entries[1]!.alternative_winner_label).toBeNull();
  });
});

describe('resolveAlternativeWinner — id is the identity, label is only a display candidate', () => {
  it('returns id + display when PLoT resolved a genuine label', () => {
    expect(resolveAlternativeWinner(entry({
      alternative_winner_id: 'opt_two_mid',
      alternative_winner_label: 'Hire Two Mid-Level',
    }))).toEqual({ id: 'opt_two_mid', display: 'Hire Two Mid-Level' });
  });

  it('DISAGREEMENT 1 — PLoT echoed the raw id as the label (its documented resolveLabel fallback): identity is kept, display is WITHHELD', () => {
    // A label-only reader sees the string 'opt_7f3a91' and calls it a name.
    const resolved = resolveAlternativeWinner(entry({
      alternative_winner_id: 'opt_7f3a91',
      alternative_winner_label: 'opt_7f3a91',
    }));
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe('opt_7f3a91'); // identity survives
    expect(resolved!.display).toBeNull(); // but nothing is safe to print
  });

  it('a label WITHOUT an id establishes nothing — no identity, so no winner', () => {
    expect(resolveAlternativeWinner(entry({
      alternative_winner_id: null,
      alternative_winner_label: 'Hire Two Mid-Level',
    }))).toBeNull();
  });
});

describe('resolveAgreedAlternativeWinner — agreement is decided on the ID', () => {
  it('DISAGREEMENT 2 (label collision) — two rows share a label but carry DIFFERENT ids: no single target, so nothing is named', () => {
    // A label-only reader sees 'Expand the team' twice and concludes one agreed
    // winner. The ids say these are two DIFFERENT options.
    const agreed = resolveAgreedAlternativeWinner([
      entry({
        factor_id: 'fac_a',
        alternative_winner_id: 'opt_expand_london',
        alternative_winner_label: 'Expand the team',
      }),
      entry({
        factor_id: 'fac_b',
        alternative_winner_id: 'opt_expand_leeds',
        alternative_winner_label: 'Expand the team',
      }),
    ]);
    expect(agreed).toBeNull();
  });

  it('CONTROL for DISAGREEMENT 2 — the SAME two labels with the SAME id DO agree (proves the id, not the label, is what withheld it)', () => {
    const agreed = resolveAgreedAlternativeWinner([
      entry({
        factor_id: 'fac_a',
        alternative_winner_id: 'opt_expand_london',
        alternative_winner_label: 'Expand the team',
      }),
      entry({
        factor_id: 'fac_b',
        alternative_winner_id: 'opt_expand_london',
        alternative_winner_label: 'Expand the team',
      }),
    ]);
    expect(agreed).toEqual({ id: 'opt_expand_london', display: 'Expand the team' });
  });
});

describe('deterministic what_would_flip answer — carries the attested alternative winner', () => {
  it('names the option PLoT attested, sourced from the id', () => {
    const text = composeWhatWouldFlipFallback(
      PROJECTION,
      RAW,
      concreteSummary([
        entry({ alternative_winner_id: 'opt_two_mid', alternative_winner_label: 'Hire Two Mid-Level' }),
      ]),
    );
    expect(text).toMatch(CONCRETE_SENTENCE);
    expect(text).toMatch(NAMES_ALTERNATIVE);
    expect(text).toContain('Hire Two Mid-Level would lead instead.');
  });

  it('DISAGREEMENT 1, past the composer — an id-echoed label is NEVER printed as a name, and no internal token reaches the answer', () => {
    const text = composeWhatWouldFlipFallback(
      PROJECTION,
      RAW,
      concreteSummary([
        entry({ alternative_winner_id: 'opt_7f3a91', alternative_winner_label: 'opt_7f3a91' }),
      ]),
    );
    // A label-only reader would have emitted "opt_7f3a91 would lead instead."
    expect(text).not.toContain('opt_7f3a91');
    expect(text).not.toMatch(NAMES_ALTERNATIVE);
    // …and the pre-repair prose is intact — withholding costs nothing.
    expect(text).toMatch(CONCRETE_SENTENCE);
  });

  it('DISAGREEMENT 2, past the composer — colliding labels on different ids name NO winner', () => {
    const text = composeWhatWouldFlipFallback(
      PROJECTION,
      RAW,
      concreteSummary([
        entry({
          factor_id: 'fac_a',
          factor_label: 'Factor A',
          alternative_winner_id: 'opt_expand_london',
          alternative_winner_label: 'Expand the team',
        }),
        entry({
          factor_id: 'fac_b',
          factor_label: 'Factor B',
          alternative_winner_id: 'opt_expand_leeds',
          alternative_winner_label: 'Expand the team',
        }),
      ]),
    );
    expect(text).not.toMatch(NAMES_ALTERNATIVE);
    expect(text).not.toContain('Expand the team would lead instead');
    expect(text).toMatch(/are the most likely single factors/i);
  });

  it('POSITIVE CONTROL — an entry with NO alternative_winner_id still resolves via the existing path, byte-identical to the pre-repair answer', () => {
    const withoutId = composeWhatWouldFlipFallback(PROJECTION, RAW, concreteSummary([entry()]));
    expect(withoutId).toMatch(CONCRETE_SENTENCE);
    expect(withoutId).not.toMatch(NAMES_ALTERNATIVE);

    // The repair is PURELY ADDITIVE: the same fixture plus a resolvable winner
    // yields the same answer with exactly one sentence appended.
    const withId = composeWhatWouldFlipFallback(
      PROJECTION,
      RAW,
      concreteSummary([
        entry({ alternative_winner_id: 'opt_two_mid', alternative_winner_label: 'Hire Two Mid-Level' }),
      ]),
    );
    expect(withId.startsWith(withoutId.replace(/ Which of those would you like to explore changing\?$/, ''))).toBe(true);
  });

  it('POSITIVE CONTROL — the id-carrying entry changes NOTHING outside the concrete branch (no_practical_flip is unaffected)', () => {
    const text = composeWhatWouldFlipFallback(PROJECTION, RAW, {
      overall_status: 'no_practical_flip',
      margin_supports_flip: false,
      entries: [
        entry({
          flip_value: null,
          flip_reason: 'no_effect_within_bounds',
          margin_supports_flip: false,
          alternative_winner_id: 'opt_two_mid',
          alternative_winner_label: 'Hire Two Mid-Level',
        }),
      ],
    });
    expect(text).not.toMatch(NAMES_ALTERNATIVE);
    expect(text).toMatch(/no single factor on its own reached a tipping point/i);
  });
});
