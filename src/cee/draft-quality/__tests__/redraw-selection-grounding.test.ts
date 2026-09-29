/**
 * ⭐⭐ [P1b] REDRAW SELECTION — a fabricated second draw may NOT win.
 *
 * ## The defect, stated precisely
 *
 * The redraw was selected on STRUCTURAL COVERAGE ONLY (`isMaterallyRicher`:
 * waist, then private factors, then depth). The judge reads draw ONE. Nothing
 * read draw TWO. So a second draw that invents off-brief factors and links
 * scores as richer on every one of those dimensions and REPLACES the first,
 * semantically reviewed graph.
 *
 * This is the enrichment risk returning through the SELECTION step. The earlier
 * review proved the verdict TYPE has no content channel — true, and it does not
 * cover this: the content does not arrive through the verdict, it arrives
 * through the DRAW, and the selection rule is what lets it in.
 *
 * ## Why the fix is "judge draw two", not a cheaper grounding check
 *
 * A cheap deterministic grounding check would have to decide whether node
 * labels are "about" the brief — a predicate over natural language. This estate
 * has measured what that costs: four consecutive rounds on one such predicate,
 * each fixing one direction and reopening the other, settling on two arbitrary
 * length constants with hard cliffs (trap 22f). Off-brief-ness is semantic by
 * definition; a token-overlap heuristic is precisely the shape that oscillates.
 *
 * So the rule is a POSITIVE ASSERTION, and it mirrors the asymmetry already in
 * `normaliseJudgeResult`: *a verdict that costs money has to be positively
 * asserted.* Here: **a draw that REPLACES a reviewed graph has to be positively
 * cleared.** The first draw was read against the brief; the second must be too,
 * or it does not win. Unavailable, timed out, unparseable, out of headroom —
 * all keep the first draw.
 *
 * Note this does NOT weaken the pass's fail-open contract. The user always
 * receives a valid model: the question here is only WHICH of two valid models
 * ships, and the answer defaults to the one that was reviewed.
 *
 * The cost is bounded by the judge's own headroom gate
 * (`remainingRequestBudgetMs < DRAFT_QUALITY_TIMEOUT_MS + 1s` →
 * `insufficient_headroom`, no call made), and it is reached only on the arm
 * where a redraw was already spent — which is already the rare, expensive arm.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setTestSink } from '../../../utils/telemetry.js';
import { applyDraftQualityPass } from '../pipeline-hook.js';
import { computeDraftCoverage } from '../coverage.js';
import type { UnifiedPipelineResult } from '../../unified-pipeline/types.js';

// The REAL telemetry sink, not a module mock. A mock has to restate the event
// NAMES, and a stubbed `TelemetryEvents` that returns its own key would make
// every `filter(name === ...)` read empty — a probe that silently matches
// nothing looks exactly like a code path that emitted nothing.
let emitted: Array<{ name: string; data: Record<string, unknown> }> = [];
beforeEach(() => {
  emitted = [];
  setTestSink((name, data) => emitted.push({ name, data }));
});
afterEach(() => setTestSink(null));

const BRIEF =
  'We need to raise a Series A. We care about dilution, speed to close, the strategic value of ' +
  'the investor, and how much control the board keeps.';

/** DRAW ONE — the motivating defect. Five options, ONE causal dimension. */
const THIN_FIRST = Object.freeze({
  nodes: [
    { id: 'opt_a', kind: 'option', label: 'Top-tier VC' },
    { id: 'opt_b', kind: 'option', label: 'Mid-tier VC' },
    { id: 'opt_c', kind: 'option', label: 'Strategic investor' },
    { id: 'opt_d', kind: 'option', label: 'Revenue-based financing' },
    { id: 'opt_e', kind: 'option', label: 'Bootstrap another year' },
    { id: 'fac_dilution', kind: 'factor', label: 'Equity dilution' },
    { id: 'out_own', kind: 'outcome', label: 'Founder ownership' },
    { id: 'goal_1', kind: 'goal', label: 'Fund on the best terms' },
  ],
  edges: [
    { from: 'opt_a', to: 'fac_dilution' },
    { from: 'opt_b', to: 'fac_dilution' },
    { from: 'opt_c', to: 'fac_dilution' },
    { from: 'opt_d', to: 'fac_dilution' },
    { from: 'opt_e', to: 'fac_dilution' },
    { from: 'fac_dilution', to: 'out_own' },
    { from: 'out_own', to: 'goal_1' },
  ],
});

/**
 * ⭐ DRAW TWO, OFF BRIEF — the fixture the lane did not have.
 *
 * Structurally RICHER than draw one on every dimension `isMaterallyRicher`
 * consults: causal_waist 3 vs 1, private_factor_count 3 vs 0, and a longer
 * chain. And every one of its three factors is INVENTED — none of "lunar
 * phase", "office feng shui" or "founder star sign" is anywhere in a brief
 * about dilution, speed, strategic value and board control.
 *
 * A structural selector cannot tell this from a genuine improvement. That is
 * the whole point of the fixture: it is the shape a fabricating drafter
 * produces, and the shape the old rule rewarded.
 */
const RICHER_BUT_OFF_BRIEF_SECOND = Object.freeze({
  nodes: [
    { id: 'opt_a', kind: 'option', label: 'Top-tier VC' },
    { id: 'opt_b', kind: 'option', label: 'Bootstrap another year' },
    { id: 'opt_c', kind: 'option', label: 'Strategic investor' },
    { id: 'fac_lunar', kind: 'factor', label: 'Lunar phase at signing' },
    { id: 'fac_fengshui', kind: 'factor', label: 'Office feng shui rating' },
    { id: 'fac_starsign', kind: 'factor', label: 'Founder star sign compatibility' },
    { id: 'out_vibes', kind: 'outcome', label: 'Team vibes' },
    { id: 'goal_1', kind: 'goal', label: 'Fund on the best terms' },
  ],
  edges: [
    { from: 'opt_a', to: 'fac_lunar' },
    { from: 'opt_b', to: 'fac_fengshui' },
    { from: 'opt_c', to: 'fac_starsign' },
    { from: 'fac_lunar', to: 'out_vibes' },
    { from: 'fac_fengshui', to: 'out_vibes' },
    { from: 'fac_starsign', to: 'out_vibes' },
    { from: 'out_vibes', to: 'goal_1' },
  ],
});

/**
 * ⭐ ITS OPPOSITE-DIRECTION TWIN — structurally IDENTICAL in every dimension the
 * selector reads, and ON brief. Same node kinds, same edge topology, same
 * counts; only the LABELS differ, and only the brief separates them.
 *
 * This is the guard against over-correcting P1b into "never ship a redraw":
 * a genuine improvement must still win. The two fixtures are indistinguishable
 * to `isMaterallyRicher` — asserted below — so a fix that blocked one by
 * structure would block both, and the twin would RED.
 */
const RICHER_AND_ON_BRIEF_SECOND = Object.freeze({
  nodes: [
    { id: 'opt_a', kind: 'option', label: 'Top-tier VC' },
    { id: 'opt_b', kind: 'option', label: 'Bootstrap another year' },
    { id: 'opt_c', kind: 'option', label: 'Strategic investor' },
    { id: 'fac_dilution', kind: 'factor', label: 'Equity dilution' },
    { id: 'fac_speed', kind: 'factor', label: 'Speed to close' },
    { id: 'fac_control', kind: 'factor', label: 'Board control retained' },
    { id: 'out_terms', kind: 'outcome', label: 'Quality of terms' },
    { id: 'goal_1', kind: 'goal', label: 'Fund on the best terms' },
  ],
  edges: [
    { from: 'opt_a', to: 'fac_dilution' },
    { from: 'opt_b', to: 'fac_speed' },
    { from: 'opt_c', to: 'fac_control' },
    { from: 'fac_dilution', to: 'out_terms' },
    { from: 'fac_speed', to: 'out_terms' },
    { from: 'fac_control', to: 'out_terms' },
    { from: 'out_terms', to: 'goal_1' },
  ],
});

const ok = (graph: unknown): UnifiedPipelineResult => ({ statusCode: 200, body: { graph } });

/**
 * A judge that READS THE MODEL AGAINST THE BRIEF, the way the real one is asked
 * to. It is deliberately not a constant: a judge returning the same answer for
 * every input cannot discriminate, and a suite built on one would agree with
 * itself (trap 20).
 *
 * · draw one (single waist, brief states four dimensions) → impoverished
 * · the off-brief draw (no node corresponds to anything the brief is about)
 *   → impoverished / off_brief
 * · the on-brief draw → adequate
 */
const briefAwareJudge = async ({ graph }: { graph: unknown; brief: string }) => {
  const s = JSON.stringify(graph);
  if (s.includes('fac_lunar')) {
    return { kind: 'impoverished', grounds: ['off_brief'] } as const;
  }
  if (s.includes('fac_speed')) return { kind: 'adequate' } as const;
  return { kind: 'impoverished', grounds: ['collapsed_dimensions'] } as const;
};

const AFFORDABLE_MS = 1_000;
const redrawEvents = () => emitted.filter((e) => e.name === 'cee.draft_graph.quality_redraw');

describe('[P1b] the two second-draw fixtures are INDISTINGUISHABLE to the structural selector', () => {
  it('both score strictly richer than draw one, on every dimension the selector reads', () => {
    const first = computeDraftCoverage(THIN_FIRST);
    const off = computeDraftCoverage(RICHER_BUT_OFF_BRIEF_SECOND);
    const on = computeDraftCoverage(RICHER_AND_ON_BRIEF_SECOND);

    expect(first?.causal_waist).toBe(1);
    expect(first?.private_factor_count).toBe(0);

    // Same numbers on both second draws — only the labels, and therefore only
    // the brief, separate them. This is the argument for why a structural rule
    // can never settle P1b, and it pins the fixtures so a later edit that made
    // them structurally different would RED here rather than silently turn the
    // twin below into a different test.
    expect(off?.causal_waist).toBe(3);
    expect(on?.causal_waist).toBe(3);
    expect(off?.private_factor_count).toBe(3);
    expect(on?.private_factor_count).toBe(3);
    expect(off?.max_causal_depth).toBe(on?.max_causal_depth);
    expect(off?.option_count).toBe(on?.option_count);
  });
});

describe('[P1b] a structurally richer but OFF-BRIEF second draw must NOT be selected', () => {
  it('⭐ the fabricated draw does not replace the reviewed first graph', async () => {
    const first = ok(THIN_FIRST);
    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'p1b-off',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICHER_BUT_OFF_BRIEF_SECOND),
      judge: briefAwareJudge as never,
    });

    const shipped = (result.body as { graph: unknown }).graph;
    // Bound by IDENTITY, not by a value predicate another graph could satisfy.
    expect(shipped).toBe(THIN_FIRST);
    expect(shipped).not.toBe(RICHER_BUT_OFF_BRIEF_SECOND);
    expect(JSON.stringify(shipped)).not.toContain('fac_lunar');
  });

  it('⭐ the rejection is MEASURABLE — richer-but-uncleared is its own coded outcome', async () => {
    await applyDraftQualityPass({
      first: ok(THIN_FIRST),
      brief: BRIEF,
      requestId: 'p1b-off-2',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICHER_BUT_OFF_BRIEF_SECOND),
      judge: briefAwareJudge as never,
    });

    const ev = redrawEvents();
    expect(ev).toHaveLength(1);
    // Not `not_richer` — that would be a lie about a structurally richer draw,
    // and would make the telemetry unable to tell "the drafter cannot improve"
    // from "the drafter is fabricating". Those are opposite diagnoses.
    expect(ev[0]?.data.second_outcome).toBe('richer_but_not_cleared');
    expect(ev[0]?.data.shipped).toBe('first');
    expect(ev[0]?.data.improved).toBe(false);
  });

  it('the user is told the model is thin rather than handed a fabricated one silently', async () => {
    const result = await applyDraftQualityPass({
      first: ok(THIN_FIRST),
      brief: BRIEF,
      requestId: 'p1b-off-3',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICHER_BUT_OFF_BRIEF_SECOND),
      judge: briefAwareJudge as never,
    });
    const warnings = (result.body as { draft_warnings?: Array<{ id: string }> }).draft_warnings;
    expect(warnings?.some((w) => w.id === 'draft_quality_thin_model')).toBe(true);
  });
});

describe('[P1b] OPPOSITE-DIRECTION TWIN — a richer, ON-BRIEF second draw still wins', () => {
  it('⭐ the genuine improvement is selected', async () => {
    const result = await applyDraftQualityPass({
      first: ok(THIN_FIRST),
      brief: BRIEF,
      requestId: 'p1b-on',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICHER_AND_ON_BRIEF_SECOND),
      judge: briefAwareJudge as never,
    });

    const shipped = (result.body as { graph: unknown }).graph;
    expect(shipped).toBe(RICHER_AND_ON_BRIEF_SECOND);
    const ev = redrawEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]?.data.second_outcome).toBe('richer');
    expect(ev[0]?.data.shipped).toBe('second');
    expect(ev[0]?.data.improved).toBe(true);
  });

  it('and no thin-model disclosure is appended to a model that was improved', async () => {
    const result = await applyDraftQualityPass({
      first: ok(THIN_FIRST),
      brief: BRIEF,
      requestId: 'p1b-on-2',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICHER_AND_ON_BRIEF_SECOND),
      judge: briefAwareJudge as never,
    });
    const warnings = (result.body as { draft_warnings?: Array<{ id: string }> }).draft_warnings;
    expect(warnings ?? []).toHaveLength(0);
  });
});

describe('[P1b] selection FAILS CLOSED when draw two cannot be cleared', () => {
  it.each([
    ['the judge is unavailable on draw two', { kind: 'unavailable', reason: 'timeout' }],
    ['the judge returns garbage on draw two', { kind: 'nonsense' }],
  ])('%s → the reviewed first graph ships', async (_label, secondVerdict) => {
    let call = 0;
    const judge = async () => {
      call += 1;
      // Draw one: impoverished, so a redraw is funded. Draw two: cannot be
      // cleared. A draw nobody could vouch for must not replace a reviewed one.
      return call === 1
        ? ({ kind: 'impoverished', grounds: ['collapsed_dimensions'] } as const)
        : (secondVerdict as never);
    };

    const result = await applyDraftQualityPass({
      first: ok(THIN_FIRST),
      brief: BRIEF,
      requestId: 'p1b-closed',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICHER_AND_ON_BRIEF_SECOND),
      judge: judge as never,
    });

    expect((result.body as { graph: unknown }).graph).toBe(THIN_FIRST);
    expect(redrawEvents()[0]?.data.second_outcome).toBe('richer_but_not_cleared');
  });
});
