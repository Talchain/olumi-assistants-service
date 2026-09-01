/**
 * THE SEAM — every arm of the draft-quality pass, each with its
 * OPPOSITE-DIRECTION TWIN.
 *
 * This estate has shipped a fix and its exact inverse in consecutive rounds
 * more than once, always under a green suite, always because the corpus tested
 * one direction. Every predicate here therefore carries both:
 *
 *   catches an impoverished model      ↔  leaves a legitimately simple one alone
 *   spends a redraw when affordable    ↔  spends nothing when it is not
 *   ships the richer second draw       ↔  keeps the first when the second is not
 *   a failed redraw does not ship      ↔  ...and does not destroy the good first
 *   the judge decides                  ↔  the judge failing decides nothing
 *
 * Assertions bind by IDENTITY (`toBe`, the same object) wherever "unchanged" is
 * the claim, never by a value predicate another object could satisfy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setTestSink } from '../../../utils/telemetry.js';
import { applyDraftQualityPass, IMPOVERISHED_DISCLOSURE_ID } from '../pipeline-hook.js';
import type { UnifiedPipelineResult } from '../../unified-pipeline/types.js';
import type { DraftQualityVerdict } from '../types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Five options, ONE shared factor — the motivating defect. */
const THIN_GRAPH = {
  nodes: [
    { id: 'dec_1', kind: 'decision' },
    { id: 'opt_a', kind: 'option' },
    { id: 'opt_b', kind: 'option' },
    { id: 'opt_c', kind: 'option' },
    { id: 'opt_d', kind: 'option' },
    { id: 'opt_e', kind: 'option' },
    { id: 'fac_dilution', kind: 'factor', label: 'Equity dilution' },
    { id: 'out_1', kind: 'outcome' },
    { id: 'goal_1', kind: 'goal' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a' },
    { from: 'dec_1', to: 'opt_b' },
    { from: 'dec_1', to: 'opt_c' },
    { from: 'dec_1', to: 'opt_d' },
    { from: 'dec_1', to: 'opt_e' },
    { from: 'opt_a', to: 'fac_dilution' },
    { from: 'opt_b', to: 'fac_dilution' },
    { from: 'opt_c', to: 'fac_dilution' },
    { from: 'opt_d', to: 'fac_dilution' },
    { from: 'opt_e', to: 'fac_dilution' },
    { from: 'fac_dilution', to: 'out_1' },
    { from: 'out_1', to: 'goal_1' },
  ],
};

/** The same decision, drafted with four distinct dimensions. */
const RICH_GRAPH = {
  nodes: [
    { id: 'dec_1', kind: 'decision' },
    { id: 'opt_a', kind: 'option' },
    { id: 'opt_b', kind: 'option' },
    { id: 'fac_dilution', kind: 'factor' },
    { id: 'fac_speed', kind: 'factor' },
    { id: 'fac_strategic', kind: 'factor' },
    { id: 'fac_control', kind: 'factor' },
    { id: 'out_1', kind: 'outcome' },
    { id: 'goal_1', kind: 'goal' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a' },
    { from: 'dec_1', to: 'opt_b' },
    { from: 'opt_a', to: 'fac_dilution' },
    { from: 'opt_a', to: 'fac_speed' },
    { from: 'opt_b', to: 'fac_strategic' },
    { from: 'opt_b', to: 'fac_control' },
    { from: 'fac_dilution', to: 'out_1' },
    { from: 'fac_speed', to: 'out_1' },
    { from: 'fac_strategic', to: 'out_1' },
    { from: 'fac_control', to: 'out_1' },
    { from: 'out_1', to: 'goal_1' },
  ],
};

const ok = (graph: unknown): UnifiedPipelineResult => ({ statusCode: 200, body: { graph } });
const failed = (): UnifiedPipelineResult => ({
  statusCode: 422,
  body: { code: 'CEE_GRAPH_INVALID', retryable: true },
});

const BRIEF = 'Four things matter here: dilution, speed, strategic value and board control.';

const impoverished: DraftQualityVerdict = {
  kind: 'impoverished',
  grounds: ['collapsed_dimensions'],
};

/** Affordable: the retry gate funds a redraw only when the remaining window
 *  clears MIN_DRAFT_RETRY_BUDGET_MS (55s of a 120s budget), i.e. attempt 1 has
 *  to have been fast. 1s is comfortably inside that. */
const AFFORDABLE_MS = 1_000;
/** Unaffordable: 118s of a 120s budget leaves no window at all. */
const UNAFFORDABLE_MS = 118_000;

let events: Array<{ name: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  events = [];
  setTestSink((name, data) => events.push({ name, data }));
});
afterEach(() => setTestSink(null));

const qualityEvents = () => events.filter((e) => e.name === 'cee.draft_graph.quality');
const redrawEvents = () => events.filter((e) => e.name === 'cee.draft_graph.quality_redraw');

// ── The pairs ───────────────────────────────────────────────────────────────

describe('draft-quality seam — catch / leave-alone', () => {
  it('CATCHES an impoverished model and spends exactly one redraw', async () => {
    const first = ok(THIN_GRAPH);
    const redraw = vi.fn(async () => ok(RICH_GRAPH));

    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'r1',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw,
      judge: async () => impoverished,
    });

    expect(redraw).toHaveBeenCalledTimes(1);
    expect(result).not.toBe(first);
    expect((result.body as { graph: unknown }).graph).toEqual(RICH_GRAPH);
  });

  it('TWIN — an adequate model is returned as the SAME OBJECT, no redraw', async () => {
    const first = ok(THIN_GRAPH);
    const redraw = vi.fn();

    const result = await applyDraftQualityPass({
      first,
      brief: 'Only dilution matters.',
      requestId: 'r2',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw,
      judge: async () => ({ kind: 'adequate' }),
    });

    expect(redraw).not.toHaveBeenCalled();
    // Identity, not equality: nothing was rebuilt, nothing was touched.
    expect(result).toBe(first);
  });
});

describe('draft-quality seam — affordable / unaffordable', () => {
  it('spends a redraw when the budget can fund one', async () => {
    const redraw = vi.fn(async () => ok(RICH_GRAPH));
    await applyDraftQualityPass({
      first: ok(THIN_GRAPH),
      brief: BRIEF,
      requestId: 'r3',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw,
      judge: async () => impoverished,
    });
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('TWIN — spends NOTHING when it cannot, and does not even call the judge', async () => {
    const first = ok(THIN_GRAPH);
    const redraw = vi.fn();
    const judge = vi.fn();

    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'r4',
      elapsedMs: UNAFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw,
      judge,
    });

    expect(judge).not.toHaveBeenCalled();
    expect(redraw).not.toHaveBeenCalled();
    expect(result).toBe(first);
    expect(qualityEvents()[0]?.data.no_redraw_reason).toBe('budget_unaffordable');
  });
});

describe('draft-quality seam — ship the better of the two', () => {
  it('ships the SECOND draw when it is materially richer', async () => {
    const result = await applyDraftQualityPass({
      first: ok(THIN_GRAPH),
      brief: BRIEF,
      requestId: 'r5',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICH_GRAPH),
      judge: async () => impoverished,
    });
    expect((result.body as { graph: unknown }).graph).toEqual(RICH_GRAPH);
    expect(redrawEvents()[0]?.data).toMatchObject({ shipped: 'second', improved: true });
  });

  it('TWIN — keeps the FIRST draw when the redraw is no richer, and discloses', async () => {
    const first = ok(THIN_GRAPH);
    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'r6',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      // A second draw with the SAME single-waist shape — a real outcome, and
      // the one the bounded-cost rule exists for.
      redraw: async () => ok(THIN_GRAPH),
      judge: async () => impoverished,
    });

    const body = result.body as { graph: unknown; draft_warnings?: Array<{ id: string }> };
    expect(body.graph).toEqual(THIN_GRAPH);
    expect(redrawEvents()[0]?.data).toMatchObject({ shipped: 'first', improved: false });
    // The user is told, rather than quietly handed a model we judged thin.
    expect(body.draft_warnings?.map((w) => w.id)).toContain(IMPOVERISHED_DISCLOSURE_ID);
  });

  it('a tie keeps the FIRST draw — a redraw that buys nothing may not silently replace it', async () => {
    const result = await applyDraftQualityPass({
      first: ok(THIN_GRAPH),
      brief: BRIEF,
      requestId: 'r7',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok({ ...THIN_GRAPH, nodes: [...THIN_GRAPH.nodes] }),
      judge: async () => impoverished,
    });
    expect(redrawEvents()[0]?.data.shipped).toBe('first');
    // Bound to the object, not just the event: the graph the user receives is
    // the FIRST draw, not the equal-but-different second one.
    expect((result.body as { graph: unknown }).graph).toBe(THIN_GRAPH);
  });
});

describe('draft-quality seam — a redraw can never make things worse', () => {
  it('a FAILED redraw ships the good first draw, not the failure', async () => {
    const first = ok(THIN_GRAPH);
    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'r8',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => failed(),
      judge: async () => impoverished,
    });

    expect(result.statusCode).toBe(200);
    expect((result.body as { graph: unknown }).graph).toEqual(THIN_GRAPH);
    expect(redrawEvents()[0]?.data).toMatchObject({
      shipped: 'first',
      improved: false,
      second_outcome: 'draft_failed',
    });
  });

  it('TWIN — a FAILED first draw is left entirely alone (the other authority owns it)', async () => {
    const first = failed();
    const judge = vi.fn();
    const redraw = vi.fn();
    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'r9',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw,
      judge,
    });
    expect(result).toBe(first);
    expect(judge).not.toHaveBeenCalled();
    expect(redraw).not.toHaveBeenCalled();
    // And nothing is emitted about it — a failure is not a quality observation.
    expect(qualityEvents()).toHaveLength(0);
  });
});

describe('draft-quality seam — FAIL OPEN, observably', () => {
  it.each([
    ['the judge returns unavailable', async () => ({ kind: 'unavailable' as const, reason: 'timeout' as const })],
    ['the judge throws', async () => { throw new Error('boom'); }],
    ['the judge returns garbage', async () => ({ kind: 'nonsense' } as never)],
  ])('%s → the original draft ships, same object', async (_label, judge) => {
    const first = ok(THIN_GRAPH);
    const redraw = vi.fn();
    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'r10',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw,
      judge: judge as never,
    });
    expect(result).toBe(first);
    expect(redraw).not.toHaveBeenCalled();
  });

  it('a redraw that THROWS still ships the first draw', async () => {
    const first = ok(THIN_GRAPH);
    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'r11',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => {
        throw new Error('pipeline exploded');
      },
      judge: async () => impoverished,
    });
    expect(result).toBe(first);
  });

  it('⭐ every fail-open arm is OBSERVABLE — a silent skip would be the real defect', async () => {
    await applyDraftQualityPass({
      first: ok(THIN_GRAPH),
      brief: BRIEF,
      requestId: 'r12',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: vi.fn(),
      judge: async () => ({ kind: 'unavailable', reason: 'llm_error' }),
    });
    const ev = qualityEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]?.data).toMatchObject({
      verdict: 'unavailable',
      unavailable_reason: 'llm_error',
      no_redraw_reason: 'judge_unavailable',
    });
  });
});

describe('draft-quality seam — the continuous metric', () => {
  it('emits coverage facts on a draft nothing else touches', async () => {
    await applyDraftQualityPass({
      first: ok(RICH_GRAPH),
      brief: BRIEF,
      requestId: 'r13',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: vi.fn(),
      judge: vi.fn(),
    });
    const ev = qualityEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]?.data).toMatchObject({
      nominated: false,
      no_redraw_reason: 'not_nominated',
      option_count: 2,
      factor_count: 4,
      causal_waist: 4,
      private_factor_count: 4,
    });
  });

  it('emits TWO quality rows on a redrawn turn, discriminated by is_redraw', async () => {
    await applyDraftQualityPass({
      first: ok(THIN_GRAPH),
      brief: BRIEF,
      requestId: 'r14',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICH_GRAPH),
      judge: async () => impoverished,
    });
    const ev = qualityEvents();
    expect(ev).toHaveLength(2);
    expect(ev[0]?.data.is_redraw).toBe(false);
    expect(ev[1]?.data.is_redraw).toBe(true);
    expect(ev[0]?.data.grounds).toEqual(['collapsed_dimensions']);
  });

  it('carries NO user content — codes, counts, booleans and model ids only', async () => {
    await applyDraftQualityPass({
      first: ok(THIN_GRAPH),
      brief: BRIEF,
      requestId: 'r15',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICH_GRAPH),
      judge: async () => impoverished,
    });
    const serialised = JSON.stringify(events);
    // The fixture's only distinctive label, and a distinctive word from the
    // brief. Neither may appear anywhere in any emitted event.
    expect(serialised).not.toContain('Equity dilution');
    expect(serialised).not.toContain('board control');
    // Contrast control: the sweep CAN see things that are present, so the two
    // absences above are evidence rather than a blind instrument.
    expect(serialised).toContain('collapsed_dimensions');
    expect(serialised).toContain('causal_waist');
  });
});

describe('draft-quality seam — the discarded draw is preserved for inspection', () => {
  it('attaches the discarded graph and both coverage records to the pipeline trace', async () => {
    const result = await applyDraftQualityPass({
      first: ok(THIN_GRAPH),
      brief: BRIEF,
      requestId: 'r16',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(RICH_GRAPH),
      judge: async () => impoverished,
    });

    const dq = (result.body as { trace?: { pipeline?: { draft_quality?: Record<string, unknown> } } })
      .trace?.pipeline?.draft_quality;
    expect(dq).toBeDefined();
    expect(dq?.redraw_spent).toBe(true);
    expect(dq?.shipped).toBe('second');
    expect(dq?.improved).toBe(true);
    // ⭐ The pre-redraw draft, kept whole. This is what stops the pass hiding a
    // degrading drafter behind its own repair.
    expect(dq?.discarded_graph).toEqual(THIN_GRAPH);
    expect(dq?.first_coverage).toMatchObject({ option_count: 5, causal_waist: 1 });
    expect(dq?.second_coverage).toMatchObject({ option_count: 2, causal_waist: 4 });
  });

  it('preserves an existing trace rather than replacing it', async () => {
    const first: UnifiedPipelineResult = {
      statusCode: 200,
      body: { graph: THIN_GRAPH, trace: { pipeline: { repair_summary: { kept: true } }, other: 1 } },
    };
    const result = await applyDraftQualityPass({
      first,
      brief: BRIEF,
      requestId: 'r17',
      elapsedMs: AFFORDABLE_MS,
      retryBaselineMs: Date.now(),
      redraw: async () => ok(THIN_GRAPH),
      judge: async () => impoverished,
    });
    const trace = (result.body as { trace: Record<string, unknown> }).trace;
    expect(trace.other).toBe(1);
    expect((trace.pipeline as Record<string, unknown>).repair_summary).toEqual({ kept: true });
    expect((trace.pipeline as Record<string, unknown>).draft_quality).toBeDefined();
  });
});
