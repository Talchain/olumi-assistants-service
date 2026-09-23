import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyGrammarRedraw, decideGrammarRedraw } from '../grammar-redraw.js';
import type { UnifiedPipelineResult } from '../../unified-pipeline/types.js';

const capture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.graph.json`, import.meta.url), 'utf8'));

const DIRTY_8 = capture('draft');                          // 8 violations, 4 options
const DIRTY_2 = capture('draft-pricing');                  // 2 violations, 2 options
const CLEAN = capture('draft-pricing-no-churn-READY');     // 0 — reached a scored PLoT run

const ok = (graph: unknown): UnifiedPipelineResult =>
  ({ statusCode: 200, body: { graph } }) as unknown as UnifiedPipelineResult;
const failed = (): UnifiedPipelineResult =>
  ({ statusCode: 422, body: { error: 'CEE_GRAPH_INVALID' } }) as unknown as UnifiedPipelineResult;

/** Comfortably inside the budget (MIN_DRAFT_RETRY_BUDGET_MS defaults to 55s
 *  against a much larger LLM window), matching the 17–31s at which the
 *  failure-retry seam's own measured population lands. */
const AFFORDABLE_MS = 20_000;

describe('the decision — order of guards, and every skip is its own diagnosis', () => {
  it('a CLEAN draw is not redrawn', () => {
    const d = decideGrammarRedraw({ first: ok(CLEAN), elapsedMs: AFFORDABLE_MS, redraw: async () => ok(CLEAN) });
    expect(d.redraw).toBe(false);
    expect(d).toMatchObject({ reason: 'grammar_clean' });
  });

  it('a VIOLATING draw is redrawn when it can be afforded', () => {
    const d = decideGrammarRedraw({ first: ok(DIRTY_8), elapsedMs: AFFORDABLE_MS, redraw: async () => ok(CLEAN) });
    expect(d.redraw).toBe(true);
    if (d.redraw) expect(d.facts.violations).toHaveLength(8);
  });

  it('a FAILED draft is the other authority’s question and is never touched', () => {
    // `classifyRetryableDraftFailure` owns failures and fails CLOSED. This pass
    // must not double-handle them.
    const d = decideGrammarRedraw({ first: failed(), elapsedMs: AFFORDABLE_MS, redraw: async () => ok(CLEAN) });
    expect(d).toMatchObject({ redraw: false, reason: 'draft_failed', facts: null });
  });

  it('an UNREADABLE graph does not trigger a redraw, and says so distinctly', () => {
    // ⛔ Distinct from `grammar_clean`. A payload-shape change would otherwise
    // retire this check silently while every count still read zero.
    const d = decideGrammarRedraw({ first: ok(null), elapsedMs: AFFORDABLE_MS, redraw: async () => ok(CLEAN) });
    expect(d).toMatchObject({ redraw: false, reason: 'graph_unreadable' });
  });

  it('an attempt-2 draw can never fund a further draw', () => {
    for (const attemptSource of ['quality_redraw', 'enforcement_retry'] as const) {
      const d = decideGrammarRedraw({ first: ok(DIRTY_8), elapsedMs: AFFORDABLE_MS, attemptSource, redraw: async () => ok(CLEAN) });
      expect(d).toMatchObject({ redraw: false, reason: 'redraw_already_spent' });
    }
  });

  it('no redraw callback means no redraw', () => {
    const d = decideGrammarRedraw({ first: ok(DIRTY_8), elapsedMs: AFFORDABLE_MS });
    expect(d).toMatchObject({ redraw: false, reason: 'no_redraw_available' });
  });

  it('an unaffordable budget is refused, and is NOT spelled the same as clean', () => {
    // The two cases whose honest advice differs most: "the server never tried"
    // vs "there was nothing to try".
    const d = decideGrammarRedraw({ first: ok(DIRTY_8), elapsedMs: 10_000_000, redraw: async () => ok(CLEAN) });
    expect(d).toMatchObject({ redraw: false, reason: 'budget_unaffordable' });
  });
});

describe('the pass — fail open, always', () => {
  it('a clean draw returns the SAME OBJECT and never calls the drafter', async () => {
    // Roughly half of live traffic already drafts clean and must not pay for
    // this: identity, not deep equality.
    const first = ok(CLEAN);
    const redraw = vi.fn(async () => ok(CLEAN));
    const out = (await applyGrammarRedraw({ first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw })).result;
    expect(out).toBe(first);
    expect(redraw).not.toHaveBeenCalled();
  });

  /**
   * ⭐⭐ `drawSpent` IS NOT "the second draw won". The caller chains this into
   * `applyDraftQualityPass`, which can fund a draw of its own. A redraw that
   * was SPENT AND LOST returns the first draw — identical, by object identity,
   * to never having redrawn — so a caller inferring spend from the result would
   * fund a THIRD full draw on the user's clock in exactly the expensive case.
   */
  describe('drawSpent reports the SPEND, never the winner', () => {
    it('is false only when the drafter was never called again', async () => {
      const clean = await applyGrammarRedraw({ first: ok(CLEAN), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => ok(CLEAN) });
      expect(clean.drawSpent).toBe(false);
      const noCallback = await applyGrammarRedraw({ first: ok(DIRTY_8), requestId: 'r', elapsedMs: AFFORDABLE_MS });
      expect(noCallback.drawSpent).toBe(false);
      const broke = await applyGrammarRedraw({ first: ok(DIRTY_8), requestId: 'r', elapsedMs: 10_000_000, redraw: async () => ok(CLEAN) });
      expect(broke.drawSpent).toBe(false);
    });

    it('is TRUE when the redraw was spent and LOST — the expensive case', async () => {
      for (const second of [ok(DIRTY_8), failed(), ok('not a graph')]) {
        const r = await applyGrammarRedraw({ first: ok(DIRTY_2), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => second });
        expect(r.drawSpent).toBe(true);
      }
    });

    it('is TRUE when the redraw threw — the drafter may already have been called', async () => {
      const r = await applyGrammarRedraw({
        first: ok(DIRTY_8), requestId: 'r', elapsedMs: AFFORDABLE_MS,
        redraw: async () => { throw new Error('provider exploded'); },
      });
      expect(r.result).toBe(r.result);
      expect(r.drawSpent).toBe(true);
    });

    it('is TRUE when the second draw won', async () => {
      const r = await applyGrammarRedraw({ first: ok(DIRTY_8), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => ok(CLEAN) });
      expect(r.drawSpent).toBe(true);
    });
  });

  it('ships the SECOND draw when it is cleaner', async () => {
    const second = ok(CLEAN);
    const out = (await applyGrammarRedraw({
      first: ok(DIRTY_8), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => second,
    })).result;
    expect(out).toBe(second);
  });

  it('ships the second draw when it is merely LESS dirty', async () => {
    const second = ok(DIRTY_2);
    const out = (await applyGrammarRedraw({
      first: ok(DIRTY_8), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => second,
    })).result;
    expect(out).toBe(second);
  });

  it('keeps the FIRST draw on a tie', async () => {
    const first = ok(DIRTY_2);
    const out = (await applyGrammarRedraw({
      first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => ok(DIRTY_2),
    })).result;
    expect(out).toBe(first);
  });

  it('keeps the FIRST draw when the second is dirtier', async () => {
    const first = ok(DIRTY_2);
    const out = (await applyGrammarRedraw({
      first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => ok(DIRTY_8),
    })).result;
    expect(out).toBe(first);
  });

  it('⛔ a FAILED second draw never replaces a shippable first draw', async () => {
    const first = ok(DIRTY_8);
    const out = (await applyGrammarRedraw({
      first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => failed(),
    })).result;
    expect(out).toBe(first);
    expect(out.statusCode).toBe(200);
  });

  it('\u26d4 a failed second draw is refused ON ITS STATUS, not by luck of its body', async () => {
    // ⛔ THE MUTANT THAT SURVIVED THE FIRST ROUND. Deleting the `statusCode`
    // guard still passed every test above, because the 422 fixture's body was
    // unreadable and the first draw won at the SELECTION step instead. That is
    // an accident of the fixture, not the contract: a failure whose body does
    // carry a readable, CLEANER graph would then be shipped to the user as a
    // 422. This is the case that separates the two mechanisms.
    const first = ok(DIRTY_8);
    const poisoned = { statusCode: 422, body: { error: 'CEE_GRAPH_INVALID', graph: CLEAN } } as unknown as UnifiedPipelineResult;
    const out = (await applyGrammarRedraw({
      first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => poisoned,
    })).result;
    expect(out).toBe(first);
    expect(out.statusCode).toBe(200);
  });

  it('an UNREADABLE second draw never wins', async () => {
    const first = ok(DIRTY_8);
    const out = (await applyGrammarRedraw({
      first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => ok('not a graph'),
    })).result;
    expect(out).toBe(first);
  });

  it('a THROWING redraw returns the first draw and does not propagate', async () => {
    const first = ok(DIRTY_8);
    const out = (await applyGrammarRedraw({
      first, requestId: 'r', elapsedMs: AFFORDABLE_MS,
      redraw: async () => { throw new Error('provider exploded'); },
    })).result;
    expect(out).toBe(first);
  });

  it('spends EXACTLY ONE extra draw — there is no loop', async () => {
    const redraw = vi.fn(async () => ok(DIRTY_8));  // still dirty: a loop would keep going
    await applyGrammarRedraw({ first: ok(DIRTY_8), requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw });
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('hands the drafter a directive that names the rule and keeps the risks', async () => {
    let seen = '';
    await applyGrammarRedraw({
      first: ok(DIRTY_8), requestId: 'r', elapsedMs: AFFORDABLE_MS,
      redraw: async (d) => { seen = d; return ok(CLEAN); },
    });
    expect(seen).toContain('ALLOWED EDGE PATTERNS');
    expect(seen).toContain('option → factor → risk');
    expect(seen.toLowerCase()).toContain('do not delete a risk');
  });

  it('MUTATES NOTHING — the shipped body is the drafter’s own object', async () => {
    // This pass chooses between two draws. If it ever starts editing a graph,
    // this is the assertion that has to be deleted first.
    const graph = structuredClone(DIRTY_8);
    const before = JSON.stringify(graph);
    const first = ok(graph);
    await applyGrammarRedraw({
      first, requestId: 'r', elapsedMs: AFFORDABLE_MS, redraw: async () => ok(CLEAN),
    });
    expect(JSON.stringify(graph)).toBe(before);
  });
});
