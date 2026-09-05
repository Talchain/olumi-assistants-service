/**
 * ⭐ ACCEPTANCE — INFLUENCE MUST NOT REACH THE COACH AS AN INVESTIGATION
 * PRIORITY.
 *
 * ── THE OBSERVATION THIS EXISTS TO PIN ─────────────────────────────────────
 * Founder session, 3 Sep 2026, scenario `7826c742`, CEE `f4c8f501`
 * (`olumi-programme-docs` `artefacts/manual-test-2026-09-03/`). At 13:46:02Z
 * the product told the user that validating ICP clarity was
 *
 *     "the single highest-value check before acting on this result"
 *
 * The enrichment in the very same payload said otherwise, and the fixture
 * beside this file is that enrichment, verbatim:
 *
 *   · `factor_sensitivity[].value_of_information` — 0 on all six factors;
 *   · `factor_evppi` — one row, `status: "below_resolution"`, its estimate
 *     below its own permutation-noise floor;
 *   · `m1_coaching` — absent from the enrichment entirely, which is why the
 *     pack's own VOI section had nothing to say.
 *
 * ICP clarity is `influence_rank: 1`. The sentence is the INFLUENCE ranking
 * re-narrated in the vocabulary of INFORMATION VALUE.
 *
 * ── WHAT THIS TEST CAN AND CANNOT ASSERT ───────────────────────────────────
 * It CANNOT assert the model's prose. That is authored in a live call and
 * asserting on it would be a flaky gate people learn to ignore. What it CAN
 * assert is the half CEE owns and the half that made the wrong sentence
 * possible: WHAT THE PACK TOLD THE MODEL. On these exact bytes the pack
 * previously asserted "no value-of-information scores are available for this
 * analysis" — false — and offered exactly one ranking, `top_drivers`, which
 * ranks influence. A model given one ranking and no contrary fact will rank by
 * it; that is correct behaviour on the context it was handed.
 *
 * So the claim under test is: on this capture the model-facing analysis
 * section must carry the EVPPI verdict, must not carry the false absence
 * claim, and must forbid the substitution IN THE SAME PACK as the influence
 * ranking it would otherwise be made from.
 *
 * ── THE CORPUS IS A HISTORIC RECORD ────────────────────────────────────────
 * `fixtures/founder-session-2026-09-03-enrichment.json` holds bytes the
 * deployed product actually emitted. It is APPEND-ONLY: if a change makes this
 * test fail, that is a finding about the change, never a licence to edit the
 * capture (CLAUDE.md trap 14b).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  reconcileAnalysisSummaryWithEnrichment,
} from '../../src/orchestrator-v5/context/analysis-fallback.js';
import { projectAnalysis } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import {
  VOI_NOT_SCORED_NOTE,
  formatAnalysisForContext,
} from '../../src/orchestrator-v5/format/format-analysis-for-context.js';
import { INVESTIGATION_PRIORITY_BELOW_RESOLUTION_NOTE } from '../../src/orchestrator-v5/coaching/investigation-priority.js';
import type { AnalysisResponseSummary } from '../../src/orchestrator/context/analysis-compact.js';

const CAPTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/founder-session-2026-09-03-enrichment.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * The compact summary shape the assembler receives, populated from the same
 * capture. Deliberately MINIMAL and deliberately carrying `top_drivers`: the
 * influence ranking is the thing the pack must keep offering, because
 * suppressing it would be over-correction — the user is entitled to know what
 * moves the result.
 */
function summaryFromCapture(): AnalysisResponseSummary {
  const sensitivity = CAPTURE.factor_sensitivity as ReadonlyArray<Record<string, unknown>>;
  return {
    winner: {
      option_id: '94b13741',
      option_label: 'Continue With Founder-Led Sales',
      win_probability: 0.62,
    },
    options: [
      { option_id: '94b13741', option_label: 'Continue With Founder-Led Sales', win_probability: 0.62 },
      { option_id: '05f973ef', option_label: 'Hire a Dedicated Sales Team', win_probability: 0.38 },
    ],
    top_drivers: sensitivity.slice(0, 3).map((row) => ({
      factor_id: row.factor_id as string,
      factor_label: row.factor_label as string,
      sensitivity: row.sensitivity_score as number,
    })),
    robustness_level: 'fragile',
    fragile_edge_count: 2,
  } as unknown as AnalysisResponseSummary;
}

/** The model-facing analysis section, built the way production builds it. */
function displayAnalysisFromCapture() {
  const { summary } = reconcileAnalysisSummaryWithEnrichment(
    summaryFromCapture(),
    CAPTURE,
  );
  const raw = projectAnalysis(summary, null);
  expect(raw, 'the projection must produce an analysis to assert on').not.toBeNull();
  return { raw: raw!, display: formatAnalysisForContext(raw, { analysisFreshness: 'fresh' })! };
}

describe('the 3 Sep capture — what the pack tells the coach', () => {
  it('PRECONDITION: this capture really is the case the defect needs', () => {
    // Pin the corpus's own properties IN-TEST. Without this the four
    // assertions below could all pass against a fixture that had quietly
    // stopped reproducing the condition — a discriminator whose precondition
    // nothing pins is a guard that can silently stop discriminating
    // (CLAUDE.md trap 13b).
    const evppi = CAPTURE.factor_evppi as ReadonlyArray<Record<string, unknown>>;
    expect(evppi.length).toBeGreaterThan(0);
    expect(evppi.every((r) => r.status === 'below_resolution')).toBe(true);
    expect('m1_coaching' in CAPTURE).toBe(false);
    const sensitivity = CAPTURE.factor_sensitivity as ReadonlyArray<Record<string, unknown>>;
    expect(sensitivity.length).toBe(6);
    expect(sensitivity.every((r) => r.value_of_information === 0)).toBe(true);
    // ...and the influence ranking IS differentiated, which is the whole
    // temptation: there is a perfectly good ranking sitting in the pack, and
    // it answers a different question.
    expect(new Set(sensitivity.map((r) => r.influence_rank)).size).toBe(6);
  });

  it('the EVPPI verdict now reaches the model-facing section', () => {
    const { display } = displayAnalysisFromCapture();
    expect(display.investigation_priority_note).toBe(
      INVESTIGATION_PRIORITY_BELOW_RESOLUTION_NOTE,
    );
  });

  it('the pack no longer claims no information-value scores exist', () => {
    // ⭐ THE FALSE SENTENCE. Before this change the capture produced exactly
    // this note, because the only channel the VOI section reads
    // (`m1_coaching.evidence_gaps`) was absent — while `factor_evppi` and
    // `decision_evpi` were both present in the same payload.
    const { display } = displayAnalysisFromCapture();
    expect(display.value_of_information_note).toBeUndefined();
    expect(JSON.stringify(display)).not.toContain(VOI_NOT_SCORED_NOTE);
  });

  it('the influence ranking is STILL offered — this is not over-suppression', () => {
    // The failure mode on the other side. A fix that hid `top_drivers` would
    // make the product less useful and would not be more honest: influence is
    // a real computed fact. One control cannot cover two opposite defects, so
    // both directions are asserted.
    const { display } = displayAnalysisFromCapture();
    expect(display.top_drivers?.length).toBeGreaterThan(0);
    expect(display.top_drivers?.[0]?.influence).toMatch(/influence$/);
  });

  it('the prohibition and the ranking it governs are in the SAME pack', () => {
    // The two must travel together. A prohibition delivered on a different
    // turn from the ranking it governs governs nothing.
    const { display } = displayAnalysisFromCapture();
    const serialised = JSON.stringify(display);
    expect(serialised).toContain('influence');
    expect(display.investigation_priority_note).toContain(
      'you may not turn that into an investigation ranking',
    );
    expect(display.investigation_priority_note).toContain('highest-value');
  });

  it('the raw handler-facing projection carries the verdict too', () => {
    // Deterministic composers read the raw projection, not the display one.
    // Carrying the verdict in one and not the other would be two views of one
    // analysis disagreeing — the contradiction class the programme measures.
    const { raw } = displayAnalysisFromCapture();
    expect(raw.investigation_priority).toEqual({ kind: 'below_resolution' });
  });
});

describe('CONTRAST CONTROL — an enrichment with no EVPPI channel is unchanged', () => {
  /**
   * The discriminating half. Without this, every assertion above is consistent
   * with a change that stamps the note on EVERY analysis, which would be a
   * different and worse defect: a product that says "no factor is worth
   * investigating first" on runs where one genuinely is.
   */
  const NO_EVPPI = {
    factor_sensitivity: CAPTURE.factor_sensitivity,
    inference_warnings: CAPTURE.inference_warnings,
  } as Record<string, unknown>;

  it('no note, and the historical VOI-absence disclosure still fires', () => {
    const { summary } = reconcileAnalysisSummaryWithEnrichment(summaryFromCapture(), NO_EVPPI);
    const raw = projectAnalysis(summary, null);
    const display = formatAnalysisForContext(raw, { analysisFreshness: 'fresh' })!;
    expect(display.investigation_priority_note).toBeUndefined();
    expect(raw?.investigation_priority).toBeUndefined();
    // Unchanged from before this lane: the state really is "nothing assessed",
    // and the existing note says so and carries its own prohibition.
    expect(display.value_of_information_note).toBe(VOI_NOT_SCORED_NOTE);
  });

  it('a RESOLVED EVPPI row names the factor rather than refusing', () => {
    // The third arm, so the projection is proven to DISCRIMINATE rather than
    // to answer one thing always (trap 20: a per-item probe returning the same
    // answer for every item is reporting on itself).
    const RESOLVED = {
      ...NO_EVPPI,
      factor_evppi: [{ factor_id: '16ec3d64', evppi: 0.04, status: 'resolved' }],
    };
    const { summary } = reconcileAnalysisSummaryWithEnrichment(summaryFromCapture(), RESOLVED);
    const display = formatAnalysisForContext(projectAnalysis(summary, null), {
      analysisFreshness: 'fresh',
    })!;
    expect(display.investigation_priority_note).toContain('"ICP Clarity"');
    expect(display.investigation_priority_note).toContain('name that factor and no other');
    expect(display.value_of_information_note).toBeUndefined();
  });
});

describe('the note survives the char budget — it is not in the truncation order', () => {
  it('a pathologically large analysis keeps the verdict and drops breadth instead', () => {
    // The failure this prevents: the pack is most crowded exactly when it
    // carries the most rankings, so a note droppable under pressure would
    // vanish precisely when `top_drivers` is at its most tempting.
    const { summary } = reconcileAnalysisSummaryWithEnrichment(
      {
        ...summaryFromCapture(),
        // Long LABELS rather than many entries: the projection caps the
        // driver list, so a count-based attempt would not reach the budget at
        // all — and a budget test that never blows the budget asserts nothing.
        top_drivers: Array.from({ length: 3 }, (_unused, i) => ({
          factor_id: `f${i}`,
          factor_label: `${'a deliberately very long factor label '.repeat(60)}${i}`,
          sensitivity: 0.5,
        })),
      } as unknown as AnalysisResponseSummary,
      CAPTURE,
    );
    const display = formatAnalysisForContext(projectAnalysis(summary, null), {
      analysisFreshness: 'fresh',
    })!;
    // Non-vacuity: the budget guard must actually have fired, or this asserts
    // nothing about truncation at all.
    expect(display.truncation_note, 'the budget guard must have fired').toBeDefined();
    expect(display.investigation_priority_note).toBe(
      INVESTIGATION_PRIORITY_BELOW_RESOLUTION_NOTE,
    );
  });
});
