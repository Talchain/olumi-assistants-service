/**
 * ⛔ AN OFF-SCALE LIMIT IS NOT A MISSING LEVEL (AIQ #72 5868296245; DL 5868320182, folded after #2233).
 *
 * Served `pj-20260928T101026Z` A14: churn HAD a level (Olumi's 3%, frame 100), and PLoT refused the ≤ 4% limit on its
 * frame (`threshold_clamped`, `CONSTRAINT_REFUSED_FRAME_FIDELITY`). The reply asked "What is Monthly churn today? …
 * can only be checked against Olumi's estimate of 3%": a today-level ask for a level that exists, and a cause that was
 * not the cause. (MG's #2236 fixes the frame; this fixes what is SAID whenever an engine cannot place a limit.)
 *
 * The rule (`limit-checks.ts`): an `unscored` row whose reason is a scale precondition (`OFF_SCALE_LIMIT_REASONS`)
 * says the limit could not be placed on the model's scale, and carries NO ask. Every other row is unchanged. The graph
 * is the served C10 one (#2223's fixture), where MG's producer asks about both limits, so dropping the ask is the change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { limitChecksForAgent, OFF_SCALE_LIMIT_REASONS } from '../limit-checks.js';
import { limitCheckAsks } from '../limited-level-ask.js';
import type { StoredLimitVerdicts } from '../../../orchestrator/context/constraint-feasibility.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/pj-c10-063347Z-limits-estimate-only.json', import.meta.url), 'utf8')) as {
  graph: Record<string, unknown> & { nodes: unknown[] }; limit_verdicts: StoredLimitVerdicts;
};
const LIMIT = 'agent-lane:total_investment:<=';
const CHURN = 'agent-lane:monthly_churn:<=';
const withChurn = (state: string, reason: string): StoredLimitVerdicts => ({
  ...FX.limit_verdicts,
  per_limit: FX.limit_verdicts.per_limit.map((r) => (r.constraint_id === CHURN ? { ...r, state, reason } as never : r)),
});

describe('⛔ a limit the engine could not place on the model’s scale is said so, with no today-level ask', () => {
  it('PRECONDITION: MG’s producer asks a today-level question about churn on this graph', () => {
    expect(limitCheckAsks(FX.graph as never).some((a) => a.constraint_id === CHURN)).toBe(true);
  });

  for (const reason of OFF_SCALE_LIMIT_REASONS) {
    it(`RED (${reason}): the churn row says it is off the model's scale, and asks nothing`, () => {
      const rows = limitChecksForAgent(FX.graph, withChurn('unscored', reason))!;
      const churn = rows.find((r) => r.constraint_id === CHURN)!;
      expect(churn.state).toBe('unscored');
      expect(churn.say).toMatch(/couldn’t be checked: the limit doesn’t sit on the scale the model holds for it\.$/);
      expect(churn).not.toHaveProperty('ask');
      expect(churn.say).not.toMatch(/today|estimate/i);
      // The other limit is untouched: its own row and its own question (B6's, AIQ 5916187873: two options set it at Olumi's figure).
      const other = rows.find((r) => r.constraint_id === LIMIT)!;
      expect(other.state).toBe('estimate_only');
      expect(other.ask).toBe('What’s each option’s likely range for ‘Total investment’?');
    });
  }

  it('CONTRAST: an unscored limit for any other reason keeps its sentence and its ask', () => {
    const churn = limitChecksForAgent(FX.graph, withChurn('unscored', 'no_score_returned'))!.find((r) => r.constraint_id === CHURN)!;
    expect(churn.say).toMatch(/cannot be checked in this model yet\.$/);
    expect(churn.ask).toBeDefined();
  });

  it('CONTRAST: the served estimate_only rows keep their per-option words and a question (B6, AIQ 5916187873), never the off-scale sentence', () => {
    const rows = limitChecksForAgent(FX.graph, FX.limit_verdicts)!;
    for (const r of rows) {
      expect(r.say).toMatch(/it isn’t shown: /);
      expect(r.say).not.toMatch(/scale the model holds/);
      expect(r.ask).toBeDefined();
    }
  });
});
