/**
 * ⭐⭐ [P1c] THE CONTINUOUS METRIC MUST NOT BE ABSENT OR FALSE.
 *
 * The metric is the reason this whole pass is allowed to exist: a repair pass
 * whose fail-open is silent converts a measurable problem into an unmeasurable
 * one. Three defects made it lie, and any ONE of them makes it unusable — so
 * they are pinned separately here rather than folded into one assertion.
 *
 *  1. **ABSENT.** The enforcement auto-retry arm returned its successful second
 *     attempt without ever reaching the quality pass, so an entire population of
 *     shipped drafts — precisely the ones that had already gone wrong once —
 *     emitted NOTHING. A metric blind to the hardest turns is worse than no
 *     metric, because its numbers look complete.
 *
 *  2. **FALSE.** Three arms that never called the judge recorded
 *     `verdict: "adequate"`: not-nominated, redraw-already-spent and
 *     budget-unaffordable. So "assessed against the brief and found fine" and
 *     "never assessed at all" were the same wire byte, and the impoverished RATE
 *     — the headline number — was silently diluted by an unjudged population it
 *     could not exclude. **A draw that was never assessed must be
 *     distinguishable from one assessed and passed.**
 *
 *  3. **FALSE.** The second draw's record copied `nominated` from the FIRST
 *     draw's coverage instead of deriving it from its own, so the one field that
 *     reports what the redraw changed structurally reported the input.
 *
 * The fix for (2) is a fourth verdict kind, `not_assessed`, carrying a coded
 * reason. It keeps the reject-only property intact — no string field, no content
 * channel — and it is a state the JUDGE can never claim: `coerceVerdict` refuses
 * it on the way in, so the only authority that can say "not assessed" is the
 * code that did not ask.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTestSink } from '../../../utils/telemetry.js';
import { applyDraftQualityPass } from '../pipeline-hook.js';
import { assessDraftQuality } from '../index.js';
import type { UnifiedPipelineResult } from '../../unified-pipeline/types.js';

// The REAL telemetry sink — see the note in `redraw-selection-grounding.test.ts`.
let emitted: Array<{ name: string; data: Record<string, unknown> }> = [];
beforeEach(() => {
  emitted = [];
  setTestSink((name, data) => emitted.push({ name, data }));
});
afterEach(() => setTestSink(null));

const BRIEF = 'Four things matter here: dilution, speed, strategic value and board control.';
const AFFORDABLE_MS = 1_000;
/** Past the retry-affordability floor — the budget gate refuses before the
 *  judge is ever called. */
const UNAFFORDABLE_MS = 118_000;

const THIN = Object.freeze({
  nodes: [
    { id: 'opt_a', kind: 'option' },
    { id: 'opt_b', kind: 'option' },
    { id: 'fac_1', kind: 'factor' },
    { id: 'out_1', kind: 'outcome' },
    { id: 'goal_1', kind: 'goal' },
  ],
  edges: [
    { from: 'opt_a', to: 'fac_1' },
    { from: 'opt_b', to: 'fac_1' },
    { from: 'fac_1', to: 'out_1' },
    { from: 'out_1', to: 'goal_1' },
  ],
});

const RICH = Object.freeze({
  nodes: [
    { id: 'opt_a', kind: 'option' },
    { id: 'opt_b', kind: 'option' },
    { id: 'fac_cost', kind: 'factor' },
    { id: 'fac_speed', kind: 'factor' },
    { id: 'out_1', kind: 'outcome' },
    { id: 'goal_1', kind: 'goal' },
  ],
  edges: [
    { from: 'opt_a', to: 'fac_cost' },
    { from: 'opt_b', to: 'fac_speed' },
    { from: 'fac_cost', to: 'out_1' },
    { from: 'fac_speed', to: 'out_1' },
    { from: 'out_1', to: 'goal_1' },
  ],
});

const ok = (graph: unknown): UnifiedPipelineResult => ({ statusCode: 200, body: { graph } });
const qualityEvents = () => emitted.filter((e) => e.name === 'cee.draft_graph.quality');

/** Graph-aware, so the suite is not built on a non-discriminating instrument. */
const graphAwareJudge = async ({ graph }: { graph: unknown }) =>
  JSON.stringify(graph).includes('fac_speed')
    ? ({ kind: 'adequate' } as const)
    : ({ kind: 'impoverished', grounds: ['collapsed_dimensions'] } as const);

// ───────────────────────────────────────────────────────────────────────────
// [P1c.1] The enforcement auto-retry arm emits nothing
// ───────────────────────────────────────────────────────────────────────────

describe('[P1c.1] the enforcement auto-retry arm reaches the quality pass', () => {
  const wrapperPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../unified-pipeline/index.ts',
  );
  const wrapper = readFileSync(wrapperPath, 'utf8');
  /** The body of `runUnifiedPipeline` only — not the attempt runner below it. */
  const fnBody = wrapper.slice(
    wrapper.indexOf('export async function runUnifiedPipeline('),
    wrapper.indexOf('async function runUnifiedPipelineAttempt('),
  );

  it('the wrapper has no bare `return second;` — a successful retry is never shipped unmeasured', () => {
    expect(fnBody.length).toBeGreaterThan(500); // the slice found the function
    expect(fnBody).not.toMatch(/\n\s*return second;/);
  });

  it('⭐ BOTH success arms return through the quality pass', () => {
    const calls = fnBody.match(/return applyDraftQualityPass\(\{/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it('⭐ DERIVED CENSUS — every return arm of the wrapper is classified, so a NEW arm REDs here', () => {
    // A hand-listed set that FAILS LOUD on drift, rather than a mirror that
    // goes quietly stale: adding any return statement to `runUnifiedPipeline`
    // breaks this until it is classified as measured or as a failure arm.
    const returns = (fnBody.match(/\n\s*return [A-Za-z_][^\n]*/g) ?? []).map((s) => s.trim());
    expect(returns.length).toBeGreaterThan(0);
    const classified = returns.map((r) => {
      if (r.startsWith('return applyDraftQualityPass({')) return 'measured';
      if (r.startsWith('return applyRetryUnaffordableCopy(')) return 'failure_arm';
      if (r.startsWith('return applyRetryExhaustedCopy(')) return 'failure_arm';
      return `UNCLASSIFIED:${r}`;
    });
    expect(classified.filter((c) => c.startsWith('UNCLASSIFIED'))).toEqual([]);
    expect(classified.filter((c) => c === 'measured')).toHaveLength(2);
  });

  it('⭐ a draw taken on the retry arm is MEASURED but can never fund another draw', async () => {
    const redraw = vi.fn();
    const judge = vi.fn();
    const first = ok(THIN);

    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'p1c1',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      attemptSource: 'enforcement_retry',
      redraw,
      judge: judge as never,
    });

    // Byte-identical: this arm observes, it never acts.
    expect(result).toBe(first);
    expect(redraw).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();

    const ev = qualityEvents();
    // The whole defect: this used to be zero.
    expect(ev).toHaveLength(1);
    expect(ev[0]?.data.is_redraw).toBe(true);
    expect(ev[0]?.data.verdict).toBe('not_assessed');
    expect(ev[0]?.data.not_assessed_reason).toBe('redraw_already_spent');
    // ⭐ WHICH population this draw is in. `is_redraw` alone conflates a
    // quality redraw with a failure retry — two very different populations,
    // since an enforcement-retry draw had already failed once. A metric that
    // cannot separate them cannot answer "is the drafter getting better?".
    expect(ev[0]?.data.attempt_source).toBe('enforcement_retry');
    // The continuous structural metric is present, which is the point of
    // measuring this arm at all.
    expect(ev[0]?.data.causal_waist).toBe(1);
    expect(ev[0]?.data.option_count).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [P1c.2] Unjudged arms must not be labelled `adequate`
// ───────────────────────────────────────────────────────────────────────────

describe('[P1c.2] a draw that was never assessed is distinguishable from one assessed and passed', () => {
  it.each([
    ['not nominated', RICH, AFFORDABLE_MS, false, 'not_nominated'],
    ['redraw already spent', THIN, AFFORDABLE_MS, true, 'redraw_already_spent'],
    ['budget unaffordable', THIN, UNAFFORDABLE_MS, false, 'budget_unaffordable'],
  ])('%s → not_assessed, never adequate', async (_l, graph, elapsedMs, isRedraw, reason) => {
    const judge = vi.fn();
    const outcome = await assessDraftQuality({
      graph,
      brief: BRIEF,
      requestId: 'p1c2',
      elapsedMs: elapsedMs as number,
      isRedraw: isRedraw as boolean,
      judge: judge as never,
    });
    expect(judge).not.toHaveBeenCalled();
    expect(outcome.assessment.verdict).toEqual({ kind: 'not_assessed', reason });
    expect(outcome.noRedrawReason).toBe(reason);
  });

  it('⭐ CONTRAST CONTROL — a draw the judge DID pass is still `adequate`', async () => {
    const outcome = await assessDraftQuality({
      graph: THIN,
      brief: BRIEF,
      requestId: 'p1c2-ctl',
      elapsedMs: AFFORDABLE_MS,
      isRedraw: false,
      judge: async () => ({ kind: 'adequate' }) as never,
    });
    expect(outcome.assessment.verdict).toEqual({ kind: 'adequate' });
    expect(outcome.noRedrawReason).toBe('judged_adequate');
  });

  it('⭐ the JUDGE cannot claim `not_assessed` — only the code that did not ask may', async () => {
    // Otherwise the fix would open exactly the hole it closes: a model able to
    // mark itself unassessed could exit the judged population at will.
    const outcome = await assessDraftQuality({
      graph: THIN,
      brief: BRIEF,
      requestId: 'p1c2-forge',
      elapsedMs: AFFORDABLE_MS,
      isRedraw: false,
      judge: async () => ({ kind: 'not_assessed', reason: 'not_nominated' }) as never,
    });
    expect(outcome.assessment.verdict).toEqual({ kind: 'unavailable', reason: 'parse_failed' });
    expect(outcome.noRedrawReason).toBe('judge_unavailable');
  });

  it('⭐ the impoverished RATE is computable — the denominator excludes the unjudged', async () => {
    // Three rows across two turns: one draw the judge never saw, one it judged
    // impoverished, and one it judged adequate. The rate is a ratio over the
    // JUDGED population, and it is only expressible because the first row can
    // now be excluded — while it read `adequate` it silently sat in the
    // denominator AND the numerator's complement, diluting the number nobody
    // could see was diluted.
    await applyDraftQualityPass({
      first: ok(RICH), // waist 2 → never nominated, judge never called
      brief: BRIEF,
      requestId: 'rate-1',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: vi.fn(),
      judge: vi.fn() as never,
    });
    await applyDraftQualityPass({
      first: ok(THIN), // judged impoverished → redraw → second draw judged adequate
      brief: BRIEF,
      requestId: 'rate-2',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICH),
      judge: graphAwareJudge as never,
    });

    const rows = qualityEvents();
    expect(rows).toHaveLength(3);

    const judged = rows.filter(
      (e) => e.data.verdict === 'impoverished' || e.data.verdict === 'adequate',
    );
    const unjudged = rows.filter((e) => e.data.verdict === 'not_assessed');
    expect(judged).toHaveLength(2);
    expect(unjudged).toHaveLength(1);
    // impoverished rate = 1/2. Before the fix this read 1/3, because the draw
    // nothing looked at was counted as a pass.
    expect(judged.filter((e) => e.data.verdict === 'impoverished')).toHaveLength(1);

    // ⭐ THE LOAD-BEARING IMPLICATION, asserted rather than described: no row
    // may say `adequate` unless a judge actually answered on it. `not_nominated`
    // and `adequate` on the same row is precisely the old lie.
    for (const row of rows) {
      if (row.data.verdict === 'adequate') {
        expect(row.data.no_redraw_reason).not.toBe('not_nominated');
        expect(row.data.not_assessed_reason).toBeUndefined();
      }
    }
    expect(unjudged[0]?.data.not_assessed_reason).toBe('not_nominated');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [P1c.3] The second-draw record must derive its own nomination
// ───────────────────────────────────────────────────────────────────────────

describe('[P1c.3] the second draw reports its OWN structural signal, not the first draw\'s', () => {
  it('⭐ a redraw that fixed the waist records nominated=false on the second row', async () => {
    await applyDraftQualityPass({
      first: ok(THIN),
      brief: BRIEF,
      requestId: 'p1c3',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICH),
      judge: graphAwareJudge as never,
    });

    const ev = qualityEvents();
    expect(ev).toHaveLength(2);
    // Row 1 — the impoverished first draw. Nominated, by its own coverage.
    expect(ev[0]?.data.is_redraw).toBe(false);
    expect(ev[0]?.data.nominated).toBe(true);
    expect(ev[0]?.data.causal_waist).toBe(1);
    // Row 2 — the redraw. Its waist is 2, so it is NOT nominated. Copying the
    // first draw's `true` here reported the input as the outcome, and made the
    // one field that says whether the redraw worked structurally unreadable.
    expect(ev[1]?.data.is_redraw).toBe(true);
    expect(ev[1]?.data.causal_waist).toBe(2);
    expect(ev[1]?.data.nominated).toBe(false);
    // CONTRAST on the population field: the same `is_redraw: true` byte, a
    // different source than the enforcement-retry case pinned above.
    expect(ev[1]?.data.attempt_source).toBe('quality_redraw');
    expect(ev[0]?.data.attempt_source).toBe('first');
  });

  it('⭐ DISCRIMINATING TWIN — a redraw that did NOT fix the waist records nominated=true', async () => {
    // Same code path, opposite structural outcome. Together with the case above
    // this proves the field tracks the SECOND draw: a copy of the first would
    // read `true` in both, and a hardcoded `false` would read false in both.
    await applyDraftQualityPass({
      first: ok(THIN),
      brief: BRIEF,
      requestId: 'p1c3-twin',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(THIN),
      judge: graphAwareJudge as never,
    });

    const ev = qualityEvents();
    expect(ev).toHaveLength(2);
    expect(ev[1]?.data.is_redraw).toBe(true);
    expect(ev[1]?.data.causal_waist).toBe(1);
    expect(ev[1]?.data.nominated).toBe(true);
  });

  it('the second row carries the second draw\'s OWN verdict, not a placeholder', async () => {
    await applyDraftQualityPass({
      first: ok(THIN),
      brief: BRIEF,
      requestId: 'p1c3-verdict',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICH),
      judge: graphAwareJudge as never,
    });
    const ev = qualityEvents();
    // Before: a hardcoded `unavailable / insufficient_headroom` on every second
    // row — a fabricated reason for a call that was never attempted.
    expect(ev[1]?.data.verdict).toBe('adequate');
    expect(ev[1]?.data.unavailable_reason).toBeUndefined();
  });
});
