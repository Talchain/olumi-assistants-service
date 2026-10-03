import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyGrammarRedraw } from '../../draft-quality/grammar-redraw.js';
import { applyDraftQualityPass } from '../../draft-quality/pipeline-hook.js';
import type { UnifiedPipelineResult } from '../types.js';

/**
 * ⛔⛔ B4 — THE MOUNT HAD NO BEHAVIOURAL TEST, and independent review proved it
 * with two one-line mutants that survived the WHOLE 160-file reader set
 * (1,561 passed, 0 failed):
 *
 *   M13  the quality pass is handed the ORIGINAL first draw instead of
 *        `grammar.result` — the redraw's winner is discarded, so the entire
 *        user-facing effect of the change is disconnected and every test stays
 *        green. The feature ships as a no-op.
 *
 *   M14  the observe-only arm funds a THIRD draw on the user's clock, which the
 *        docblock above it calls "structurally impossible".
 *
 * Both are about COMPOSITION — what the two passes do when chained — which no
 * test of either pass alone can see. That is the gap, and it is why these run
 * the real `applyGrammarRedraw` into the real `applyDraftQualityPass`.
 *
 * ⚠ The chaining is reproduced here rather than importing `runUnifiedPipeline`,
 * whose signature needs a Fastify request, a scenario store and a live LLM
 * adapter. The two source-shape guards in
 * `draft-quality/__tests__/pipeline-mount-path.test.ts` pin that the wrapper
 * chains them THIS way; these pin what that chaining DOES.
 */
const wire = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../draft-quality/__tests__/fixtures/${name}.wire.json`, import.meta.url), 'utf8'));

const DIRTY = wire('wire-both-mechanisms');
const CLEAN = wire('wire-ready-control');

const ok = (body: unknown): UnifiedPipelineResult =>
  ({ statusCode: 200, body }) as unknown as UnifiedPipelineResult;
const AFFORDABLE_MS = 20_000;

/** The wrapper's own chaining, reproduced exactly (see `unified-pipeline/index.ts`). */
async function chain(first: UnifiedPipelineResult, redrawAttempt: (d: string | null | undefined) => Promise<UnifiedPipelineResult>) {
  const grammar = await applyGrammarRedraw({
    first, requestId: 'r', elapsedMs: AFFORDABLE_MS, attemptSource: 'first', redraw: redrawAttempt,
  });
  const qualityInput = {
    first: grammar.result,
    brief: 'a brief',
    requestId: 'r',
    elapsedMs: AFFORDABLE_MS,
    retryBaselineMs: Date.now(),
  } as const;
  const result = await applyDraftQualityPass(
    grammar.drawSpent
      ? { ...qualityInput, attemptSource: 'quality_redraw' }
      : { ...qualityInput, attemptSource: 'first', redraw: redrawAttempt },
  );
  return { result, grammar };
}

describe('B4 — what the chained passes actually DO', () => {
  it('⛔ M13: the redraw’s WINNER is what reaches the quality pass, not the original', async () => {
    // The mutant: `first: first` instead of `first: grammar.result`. Every unit
    // test of either pass stays green while the feature ships as a no-op.
    // ⚠ NOT object identity: a shipped redraw now carries a DISCLOSURE, so the
    // result wraps the second draw's body. What is pinned is that the SECOND
    // DRAW'S MODEL is what survives the chain — by its own node ids.
    const second = ok(CLEAN);
    const { result, grammar } = await chain(ok(DIRTY), async () => second);
    const ids = (b: unknown) => ((b as { nodes?: { id: string }[] }).nodes ?? []).map((n) => n.id);
    expect(ids(grammar.result.body)).toEqual(ids(CLEAN));
    expect(ids(result.body)).toEqual(ids(CLEAN));      // the winner survived the chain
    expect(ids(result.body)).not.toEqual(ids(DIRTY));  // and the original did not ship
  });

  /**
   * ⭐⭐ M14 — DEFENDED TWICE, AND MY OWN DOCBLOCK OVERSTATED IT.
   *
   * The review's M14 keeps the `redraw` callback on the observe-only arm and
   * says that funds a THIRD draw. **Measured: it does not.** With a judge that
   * always wants a redraw and a graph thin enough to be nominated — both
   * necessary, and the first two instruments I built were non-discriminating
   * without them — the quality pass called the callback **1** time on the
   * `first` arm (the contrast control) and **0** times on `quality_redraw`,
   * reporting `redraw_already_spent`.
   *
   * So the arm is gated by `attemptSource` INDEPENDENTLY of the omission. The
   * omission is belt-and-braces, and `index.ts` saying "structurally impossible
   * rather than merely gated" was MY overstatement: it is gated AND omitted.
   * Corrected there; pinned here.
   */
  it('⛔ M14: the observe-only arm spends NOTHING even when handed a callback', async () => {
    const THIN = {
      nodes: [
        { id: 'opt_a', kind: 'option' }, { id: 'opt_b', kind: 'option' },
        { id: 'fac_1', kind: 'factor' }, { id: 'out_1', kind: 'outcome' }, { id: 'goal_1', kind: 'goal' },
      ],
      edges: [
        { from: 'opt_a', to: 'fac_1' }, { from: 'opt_b', to: 'fac_1' },
        { from: 'fac_1', to: 'out_1' }, { from: 'out_1', to: 'goal_1' },
      ],
    };
    const judge = (async () => ({ kind: 'impoverished', grounds: ['collapsed_dimensions'] })) as never;
    const brief = 'Four things matter here: dilution, speed, strategic value and board control.';
    const spend = async (attemptSource: 'first' | 'quality_redraw') => {
      const redraw = vi.fn(async () => ok({ graph: THIN }));
      await applyDraftQualityPass({
        first: ok({ graph: THIN }), brief, requestId: 'r',
        elapsedMs: 1_000, retryBaselineMs: Date.now(), attemptSource, redraw, judge,
      });
      return redraw.mock.calls.length;
    };
    // ⚠ CONTRAST CONTROL FIRST. Without it, "0 draws on the observe-only arm"
    // is equally consistent with a pass that never redraws at all — which is
    // exactly what my first two probes measured before I found `not_nominated`.
    expect(await spend('first')).toBe(1);
    expect(await spend('quality_redraw')).toBe(0);
  });

  it('⛔ a spent redraw funds EXACTLY TWO draws, never a third', async () => {
    // The mutant: the observe-only arm keeps its `redraw` callback. The docblock
    // calls a third draw "structurally impossible"; nothing proved it.
    // A redraw that is spent and LOSES is the discriminating case — it returns
    // the first draw byte-identical, so a caller inferring spend from object
    // identity would fund another.
    const redraw = vi.fn(async () => ok(DIRTY));       // still dirty ⇒ the second LOSES
    const { result, grammar } = await chain(ok(DIRTY), redraw);
    expect(grammar.drawSpent).toBe(true);
    expect(redraw).toHaveBeenCalledTimes(1);           // ⛔ exactly one EXTRA draw
    expect(result.statusCode).toBe(200);
  });

  it('a clean first draw spends nothing and reaches the quality pass unchanged', async () => {
    const first = ok(CLEAN);
    const redraw = vi.fn(async () => ok(CLEAN));
    const { result, grammar } = await chain(first, redraw);
    expect(grammar.drawSpent).toBe(false);
    expect(result).toBe(first);
    // ⚠ NOT `not.toHaveBeenCalled()` — on this arm the quality pass legitimately
    // holds the callback and may spend its own draw. What is pinned is that the
    // GRAMMAR pass spent nothing.
    expect(grammar.result).toBe(first);
  });

  it('⛔ a failed second draw never replaces a shippable first through the chain', async () => {
    const first = ok(DIRTY);
    const failed = { statusCode: 422, body: { error: 'CEE_GRAPH_INVALID', graph: CLEAN } } as unknown as UnifiedPipelineResult;
    const { result } = await chain(first, async () => failed);
    expect(result).toBe(first);
    expect(result.statusCode).toBe(200);
  });
});
