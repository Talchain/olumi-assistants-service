/**
 * ROADMAP 2.267 (defect D-2), part 1 — the decision_review prompt must be TOLD
 * which option takes over.
 *
 * THE DEFECT THESE TESTS PIN, byte-verified at staging tip `76e6bc78`:
 * `readFlipThresholdData`'s `project()` is a field-by-field rebuild whose
 * `Pick<>` omits `alternative_winner_id` / `alternative_winner_label`
 * (`decision-review-enricher.ts:1412-1424`). So the model is asked to write a
 * sentence about which option takes over and handed no field that says which —
 * while the SAME prompt receives 15 `fragile_edges` rows that all name a
 * different option. On the live run A it filled the gap from that other channel
 * and named `the Status Quo`, an option whose slope in the flipping factor is
 * zero. See `PHASE0-EVIDENCE-2026-07-28/witness-2265-targeted-flip.md` §4.
 *
 * RED-FIRST: every assertion on `alternative_winner_*` below fails against the
 * pre-fix enricher — the keys are simply absent from the projected row.
 *
 * FIXTURE PROVENANCE: `tests/fixtures/cross-service/witness-2265-runA.flip-threshold-winner.json`
 * carries the flip rows BYTE-VERBATIM from the live wire capture (run A, HTTP
 * 200, 39,103 B, 2026-08-01T14:29:35Z, CEE build 76e6bc7). Nothing here is
 * hand-assembled, so a producer shape change cannot leave these tests passing
 * against a shape nobody emits.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildInvokeInputForTests } from '../decision-review-enricher.js';
import { buildDecisionReviewUserMessage } from '../../../cee/decision-review/invoke.js';
import { buildSlices } from '../../../cee/decision-review/decompose.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface WitnessFixture {
  readonly leading_option_id: string;
  readonly flip_thresholds: readonly Record<string, unknown>[];
  readonly options: readonly {
    readonly option_id: string;
    readonly option_label: string;
    readonly win_probability: number;
  }[];
}

const WITNESS: WitnessFixture = JSON.parse(
  readFileSync(
    join(REPO_ROOT, 'tests/fixtures/cross-service/witness-2265-runA.flip-threshold-winner.json'),
    'utf8',
  ),
) as WitnessFixture;

const BRIEF = 'Do we open a second warehouse in Leeds or expand the existing Bristol site?';

/** The one row on run A that carries a real flip. */
const FLIP_ROW = WITNESS.flip_thresholds.find((r) => r.flip_value !== null)!;

function enrichmentFromWitness(
  flipThresholds: readonly unknown[] = WITNESS.flip_thresholds,
): Record<string, unknown> {
  return {
    graph: {
      nodes: [
        ...WITNESS.options.map((o) => ({ id: o.option_id, kind: 'option', label: o.option_label })),
        ...WITNESS.flip_thresholds.map((r) => ({
          id: r.factor_id,
          kind: 'factor',
          label: r.factor_label,
        })),
      ],
      edges: [],
    },
    results: WITNESS.options.map((o) => ({
      option_id: o.option_id,
      option_label: o.option_label,
      win_probability: o.win_probability,
    })),
    flip_thresholds: flipThresholds,
  };
}

function project(flipThresholds?: readonly unknown[]) {
  const input = buildInvokeInputForTests(
    BRIEF,
    enrichmentFromWitness(flipThresholds),
    WITNESS.leading_option_id,
  );
  expect(input).not.toBeNull();
  return input!;
}

describe('2.267 D-2 part 1 — the flip winner reaches the decision_review prompt input', () => {
  it('the witness fixture really does carry the winner PLoT attested (fixture integrity)', () => {
    expect(FLIP_ROW.factor_id).toBe('fac_leeds_site');
    expect(FLIP_ROW.flip_value).toBe(0.663645);
    expect(FLIP_ROW.alternative_winner_id).toBe('opt_bristol');
    expect(FLIP_ROW.alternative_winner_label).toBe('Expand Existing Bristol Site');
  });

  it('RED-FIRST: the projected row carries alternative_winner_id + _label', () => {
    const input = project();
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input.flip_threshold_data![0]).toMatchObject({
      factor_id: 'fac_leeds_site',
      alternative_winner_id: 'opt_bristol',
      alternative_winner_label: 'Expand Existing Bristol Site',
    });
  });

  it('the winner keys are OMITTED, not nulled, when the producer names none', () => {
    const input = project([{ ...FLIP_ROW, alternative_winner_id: null, alternative_winner_label: null }]);
    const row = input.flip_threshold_data![0] as Record<string, unknown>;
    expect('alternative_winner_id' in row).toBe(false);
    expect('alternative_winner_label' in row).toBe(false);
    // The rest of the projection is untouched by 2.267.
    expect(row).toMatchObject({ factor_id: 'fac_leeds_site', flip_value: 0.663645 });
  });

  it('a label with NO id is never projected — a label alone does not identify an option', () => {
    const input = project([
      { ...FLIP_ROW, alternative_winner_id: null, alternative_winner_label: 'Expand Existing Bristol Site' },
    ]);
    const row = input.flip_threshold_data![0] as Record<string, unknown>;
    expect('alternative_winner_id' in row).toBe(false);
    expect('alternative_winner_label' in row).toBe(false);
  });

  it("PLoT's id-echo fallback is withheld as a NAME while the identity survives", () => {
    // `resolveLabel` returns `option?.label ?? optionId`, so label === id is the
    // producer saying "I could not resolve this". Printing it leaks a token.
    const input = project([
      { ...FLIP_ROW, alternative_winner_id: 'opt_bristol', alternative_winner_label: 'opt_bristol' },
    ]);
    const row = input.flip_threshold_data![0] as Record<string, unknown>;
    expect(row.alternative_winner_id).toBe('opt_bristol');
    expect('alternative_winner_label' in row).toBe(false);
  });

  it('the winner reaches the PROMPT BYTES, on both the monolith and the decomposed path', () => {
    // The projection is only the first hop. Two further rebuilds sit between it
    // and the model — `buildDecisionReviewUserMessage`'s FLIP_THRESHOLD_DATA
    // section and `buildSlices`' R3 FRAGILITY slice — and BOTH are spreads
    // today. Assert the bytes, not the object: the whole defect was a rebuild
    // that dropped a key, and a third one would reproduce D-2 with this test
    // file still green.
    const input = project();
    const userMessage = buildDecisionReviewUserMessage(input, null);
    expect(userMessage).toContain('<FLIP_THRESHOLD_DATA>');
    expect(userMessage).toContain('"alternative_winner_id": "opt_bristol"');
    expect(userMessage).toContain('"alternative_winner_label": "Expand Existing Bristol Site"');

    // ⚠ THE DECOMPOSED PATH'S PROMPT IS `slices.r3`, AND NOTHING ELSE.
    // `block('FLIP_THRESHOLD_DATA', flipData)` (decompose.ts:263) lands in R3
    // FRAGILITY, which is what `invokeOneSlice(DECOMPOSE_R3_FRAGILITY_PROMPT,
    // slices.r3, …)` (:887) sends to the model.
    //
    // The first cut of this test asserted `ctx.reviewInput` instead. That object
    // is typed `ReviewInputForGrounding` (:166) and has exactly one consumer —
    // `performShapeCheck(out, ctx.reviewInput)` (:781), the grounding VALIDATOR.
    // It never reaches a model. So the "both paths" guarantee this test claims
    // did not exist for the decomposed path at all: adversarial review's mutant
    // that field-listed the R3 block left the whole suite green. Caught in
    // review; recorded here because the wrong object read exactly like the right
    // one, which is how the original D-2 rebuild survived too.
    const { slices, ctx } = buildSlices(input);
    expect(slices.r3).toContain('<FLIP_THRESHOLD_DATA>');
    expect(slices.r3).toContain('"alternative_winner_id": "opt_bristol"');
    expect(slices.r3).toContain('"alternative_winner_label": "Expand Existing Bristol Site"');
    // The grounding validator's copy too — a weaker claim, kept because a
    // number the validator cannot see becomes an UNGROUNDED_NUMBER fatal.
    expect(JSON.stringify(ctx.reviewInput.flip_threshold_data)).toContain(
      '"alternative_winner_label":"Expand Existing Bristol Site"',
    );
  });

  it('attested no-flip rows are still filtered out, winner fields or not (2.228 F1 unchanged)', () => {
    const input = project(WITNESS.flip_thresholds.filter((r) => r.flip_value === null));
    expect(input.flip_threshold_data).toBeUndefined();
  });
});
