/**
 * ⛔ "CAN'T RUN YET" MUST SAY WHY — even when the reason is not a per-option gap.
 *
 * Served (F) f-20260926T020217Z on CEE ef99a97 (Paul's brief): after the starting point was approved ("Saved 3 of 3
 * option levels"), two options set IDENTICAL levels (price 0.295, AI availability 1), so the ONE admission verdict
 * says `may_run: false` — and carries its reason only as a critique (`IDENTICAL_OPTION_INTERVENTIONS`), not a
 * readiness issue. The readiness view read issues only, so the Agent was handed "can't run" with no reason.
 *
 * FIXTURE: that run's own served `draft_graph`, verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readinessViewOf, readinessSentence } from '../readiness-view.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-identical-options-ef99a97.json', import.meta.url), 'utf8')) as { nodes: { id: string; kind: string; interventions?: Record<string, { value: number }> | null }[] };

describe('the readiness view names the verdict\'s own reason when options cannot be told apart', () => {
  it('RED: served graph with two identical options → may_run false AND the reason, in the verdict\'s own words', () => {
    const view = readinessViewOf(served);
    expect(view.may_run).toBe(false);
    expect(JSON.stringify(view.needs_from_user)).toMatch(/identical/i);
    expect(readinessSentence(view)).toMatch(/^The analysis can't run yet\. .*identical/i);
  });

  it('CONTRAST: give one option a different level → the identical-options reason is gone', () => {
    const g = JSON.parse(JSON.stringify(served)) as typeof served;
    const opt = g.nodes.find((n) => n.id === 'test_59_with_ai_release')!;
    opt.interventions = { ...(opt.interventions ?? {}), pro_plan_price: { ...(opt.interventions!['pro_plan_price']!), value: 0.27 } };
    expect(JSON.stringify(readinessViewOf(g).needs_from_user)).not.toMatch(/identical/i);
  });
});
