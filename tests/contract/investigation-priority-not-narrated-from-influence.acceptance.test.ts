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
import { z } from 'zod';

import {
  reconcileAnalysisSummaryWithEnrichment,
} from '../../src/orchestrator-v5/context/analysis-fallback.js';
import { assembleContextPack, projectAnalysis } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';
import { buildUserMessage } from '../../src/orchestrator-v5/routing/route-with-tool-use.js';
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

// Existing mechanical projection of the SAME captured scenario. Validate only
// the assembler's structural input contract, without inventing missing data.
const CAPTURE_GRAPH = z.object({
  nodes: z.array(z.object({ id: z.string(), kind: z.unknown().optional(), label: z.unknown().optional() }).passthrough()),
  edges: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()),
}).parse(JSON.parse(readFileSync(fileURLToPath(new URL(
  '../../src/cee/graph-readiness/__tests__/fixtures/founder-2026-09-03.graph.json', import.meta.url,
)), 'utf8')));

const RESOLVED_CONTROL = {
  ...CAPTURE,
  factor_evppi: [{ factor_id: '16ec3d64', evppi: 0.04, status: 'resolved' }],
};

function assembledCapture(
  enrichment: Record<string, unknown>,
  graph = CAPTURE_GRAPH,
  controlled: ReadonlySet<string> | null = new Set<string>(),
  status: 'canonical' | 'provisional' = 'canonical',
) {
  const { summary } = reconcileAnalysisSummaryWithEnrichment(summaryFromCapture(), enrichment);
  return assembleContextPack({
    payload: makeMessagePayload({ scenario_id: '7826c742-2939-4584-917c-f1286a663ae4' }),
    priorTurns: [], graph, graphContext: { status }, analysis: summary,
    interventionControlledFactorIds: controlled ?? undefined,
  });
}

describe('current-model eligibility and independent scoring channels', () => {
  it('retains an earned captured-factor priority in the actual routing message', () => {
    const pack = assembledCapture(RESOLVED_CONTROL);
    expect(pack.display_analysis?.investigation_priority_note).toContain('"ICP Clarity"');
    const sent = buildUserMessage(pack, 'What should we investigate next?');
    expect(sent).toContain(JSON.stringify(pack.display_analysis!.investigation_priority_note));
    expect(sent).not.toContain('"factorId"');
  });

  it('carries only the existing producer action joined to the selected eligible factor', () => {
    const review = z.object({ evidence_enhancements: z.record(z.unknown()) }).parse(CAPTURE.decision_review);
    const { specific_action: action } = z.object({ specific_action: z.string() }).parse(review.evidence_enhancements['16ec3d64']);
    const pack = assembledCapture({ ...RESOLVED_CONTROL, decision_review: {
      evidence_enhancements: {
        '16ec3d64': { specific_action: action },
        'unselected': { specific_action: 'This unrelated action must not be substituted.' },
      },
    } });
    const sent = buildUserMessage(pack, 'What evidence should we collect next?');
    expect(sent).toContain(action);
    expect(sent).not.toContain('This unrelated action');
    expect(assembledCapture({ ...RESOLVED_CONTROL, decision_review: {} }).display_analysis?.investigation_priority_note)
      .not.toContain('Suggested evidence action');
  });

  it('omits an oversized optional action without losing the earned priority', () => {
    const action = 'Read the documented evidence carefully. '.repeat(80);
    const pack = assembledCapture({ ...RESOLVED_CONTROL, decision_review: {
      evidence_enhancements: { '16ec3d64': { specific_action: action } },
    } });
    expect(pack.display_analysis?.investigation_priority_note).toContain('"ICP Clarity"');
    expect(pack.display_analysis?.investigation_priority_note).not.toContain(action.trim());
  });

  it('does not name a resolved option-controlled factor', () => {
    const pack = assembledCapture(RESOLVED_CONTROL, CAPTURE_GRAPH, new Set(['16ec3d64']));
    expect(pack.analysis?.investigation_priority).toEqual({ kind: 'incomplete' });
    expect(pack.display_analysis?.investigation_priority_note).not.toContain('"ICP Clarity"');
  });

  it('does not name a factor absent from the current canonical graph', () => {
    const graph = { ...CAPTURE_GRAPH, nodes: CAPTURE_GRAPH.nodes.filter(n => n.id !== '16ec3d64') };
    expect(assembledCapture(RESOLVED_CONTROL, graph).analysis?.investigation_priority)
      .toEqual({ kind: 'incomplete' });
  });

  it('does not treat a provisional graph as current eligibility authority', () => {
    expect(assembledCapture(RESOLVED_CONTROL, CAPTURE_GRAPH, new Set(), 'provisional').analysis?.investigation_priority)
      .toEqual({ kind: 'incomplete' });
  });

  it('does not interpret missing lever authority as an empty controlled set', () => {
    expect(assembledCapture(RESOLVED_CONTROL, CAPTURE_GRAPH, null).analysis?.investigation_priority)
      .toEqual({ kind: 'incomplete' });
  });

  it('keeps useful evidence-gap guidance while limiting a below-resolution verdict to assessed EVPPI rows', () => {
    const pack = assembledCapture({ ...CAPTURE, m1_coaching: { evidence_gaps: [
      { factor_id: '16ec3d64', factor_label: 'ICP Clarity', voi_score: 0.4 },
    ] } });
    expect(pack.display_analysis?.value_of_information?.length).toBe(1);
    expect(pack.display_analysis?.investigation_priority_note).toContain('assessed factors');
    expect(pack.display_analysis?.investigation_priority_note).not.toContain('no highest-value factor');
    expect(pack.display_analysis?.investigation_priority_note).not.toContain('each factor');
  });

  it('a zero evidence-gap score does not globally deny a resolved EVPPI priority', () => {
    const pack = assembledCapture({ ...RESOLVED_CONTROL, m1_coaching: { evidence_gaps: [
      { factor_id: '16ec3d64', factor_label: 'ICP Clarity', voi_score: 0 },
    ] } });
    expect(pack.display_analysis?.investigation_priority_note).toContain('"ICP Clarity"');
    expect(pack.display_analysis?.value_of_information_note).toContain('evidence-gap');
    expect(pack.display_analysis?.value_of_information_note).not.toContain('every factor available');
  });

  it('preserves merged #1345 guidance without claiming all channels are unscored', () => {
    const { factor_evppi: _omitted, ...withoutEvppi } = CAPTURE;
    const sensitivity = z.array(z.record(z.unknown())).parse(CAPTURE.factor_sensitivity);
    const pack = assembledCapture({ ...withoutEvppi,
      factor_sensitivity: sensitivity.map(row => row.factor_id === '16ec3d64'
        ? { ...row, value_of_information: 0.4 } : row),
    });
    expect(pack.analysis?.top_drivers.find(d => d.factor_label === 'ICP Clarity')?.investigation_verdict)
      .toBe('informative');
    expect(pack.display_analysis?.top_drivers?.find(d => d.label === 'ICP Clarity')?.investigation)
      .toBeDefined();
    expect(pack.display_analysis?.value_of_information_note).toContain('evidence-gap');
    expect(pack.display_analysis?.value_of_information_note).not.toContain('for this analysis');
  });
});

/**
 * Existing minimal compact-summary harness: driver rows come from the capture;
 * its legacy option scaffold is not evidence of the captured option outcomes.
 * The tests below assert investigation guidance, never those probabilities.
 * Deliberately carrying `top_drivers`: the
 * influence ranking is the thing the pack must keep offering, because
 * suppressing it would be over-correction — the user is entitled to know what
 * moves the result.
 */
function summaryFromCapture(): AnalysisResponseSummary {
  const sensitivity = z.array(z.object({
    factor_id: z.string(), factor_label: z.string(), sensitivity_score: z.number(),
  })).parse(CAPTURE.factor_sensitivity);
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
      factor_id: row.factor_id,
      factor_label: row.factor_label,
      sensitivity: row.sensitivity_score,
    })),
    robustness_level: 'fragile',
    fragile_edge_count: 2,
    analysis_status: 'complete',
    margin: null,
    margin_pp: null,
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
    // No evidence-gap score arrived. This does not speak for every other
    // information-value channel (merged #1345 remains present).
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
    const display = formatAnalysisForContext(projectAnalysis(summary, null, new Set(), new Set(['16ec3d64'])), {
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
