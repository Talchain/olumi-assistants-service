/**
 * ⭐ F1b B6: ONE LIST OF WHAT STOPS A FIGURE (RCA D5; lease #85 5932805160).
 *
 * Paul's 1 Oct test: "can you fix them all?" got link sizing only, and the next blocker surfaced one Run at a time. The
 * Run tool now carries `to_resolve`: every open item from four producers, one action each, each `ask` its producer's
 * own sentence (bound by identity below), merged per subject (B-1), and no remedy where none can change the result (B-2).
 *
 * The served body is C10 (`pj-c10-063347Z`, verbatim): a target the Run can't test (P5, an unsized lever) and two limits
 * checked only against Olumi's estimates. Rung: TESTED (in-process, through the real run tool), not a wire witness.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { limitChecksForAgent } from '../limit-checks.js';
import { resultBlockersOf, TO_RESOLVE_NOTE, type ResultBlocker } from '../result-blockers.js';
import { targetTestabilityOf, notTargetTestableSentence } from '../../admission/target-testability.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../orchestrator/context/option-result-source.js';

type Json = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/pj-c10-063347Z-limits-estimate-only.json', import.meta.url), 'utf8')) as {
  graph: Json; analysis_state: unknown; analysis_ready: unknown; analysis_result: unknown;
  limit_verdicts: { per_limit: { constraint_id: string; state: string; reason?: string }[]; joint: { state: string } };
};
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400e1', authenticated_user_id: null, request_id: 'r' };
const clone = <T>(x: T): T => structuredClone(x);

function world(graph: Json = FX.graph, verdicts: unknown = FX.limit_verdicts) {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h1', analysis_state: FX.analysis_state, analysis_limit_verdicts: verdicts } };
    if (path === '/orchestrate/v2/turn') {
      return { status: 200, json: { assistant_text: '', analysis_state: FX.analysis_state, analysis_ready: FX.analysis_ready, blocks: [FX.analysis_result] } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
}
const subjectKey = (b: ResultBlocker): string => `${b.next_action.kind}:${b.subject_ids.join('|')}`;

describe('F1b B6: the Run tool carries ONE list of what stops a figure, one action each', () => {
  it('PRECONDITION: served C10 has an untestable target (P5) and two limits checked only against Olumi’s estimates, each with an ask', () => {
    expect(targetTestabilityOf(FX.graph)).toMatchObject({ kind: 'not_testable', failures: [{ precondition: 'P5' }] });
    const rows = limitChecksForAgent(FX.graph, FX.limit_verdicts as never)!;
    expect(rows.map((r) => [r.state, typeof r.ask])).toEqual([['estimate_only', 'string'], ['estimate_only', 'string']]);
  });

  it('RED (through the real run tool): `to_resolve` lists the target AND both limits, each with its producer’s own ask', async () => {
    const r = await world().runAnalysis(ctx, { reason: 'Run it.' });
    const list = r.to_resolve as { items: ResultBlocker[]; note: string } | undefined;
    expect(list, JSON.stringify(Object.keys(r))).toBeDefined();
    expect(list!.note).toBe(TO_RESOLVE_NOTE);
    expect(list!.items.map((b) => b.code)).toEqual(['TARGET_P5', 'LIMIT_estimate_only', 'LIMIT_estimate_only']);
    // Identity: each ask is its producer's sentence, joined by subject — never a paraphrase made here.
    expect(list!.items[0]!.next_action.ask).toBe(notTargetTestableSentence(FX.graph, targetTestabilityOf(FX.graph)));
    const limitRows = (r.limit_checks as { limits: { constraint_id: string; ask?: string }[] }).limits;
    expect(list!.items.slice(1).map((b) => b.next_action.ask)).toEqual(limitRows.map((l) => l.ask));
    expect(list!.items.slice(1).map((b) => b.subject_ids)).toEqual([['total_investment'], ['monthly_churn']]);
    expect(list!.items.map((b) => b.next_action.kind)).toEqual(['size_link', 'give_option_value', 'give_level']);
    for (const b of list!.items) expect(b.next_action.can_change_result).toBe(true);
  });

  it('RED (all four classes): no today’s level, two links to accept, a limit with an ask and one no figure can fix → one list', () => {
    const g = clone(FX.graph);
    const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
    delete goal.observed_state.baseline; // P1: no today's level for the goal
    const twoLinks = (g.edges as Json[]).slice(0, 2).map((e) => ({ from: e.from, to: e.to }));
    const warnings = [{ code: GOAL_FIGURES_PLACEHOLDER_PATH, message: 'Not shown.', option_ids: [], acceptable_links: twoLinks }];
    const rows = { per_limit: [
      { constraint_id: 'agent-lane:total_investment:<=', state: 'estimate_only', reason: 'level_olumi_estimate' },
      { constraint_id: 'agent-lane:monthly_churn:<=', state: 'unscored', reason: 'threshold_unframed' },
    ], joint: { state: 'withheld' } };
    const items = resultBlockersOf({ graph: g, limitChecks: limitChecksForAgent(g, rows as never), warnings });
    const codes = items.map((b) => b.code);
    expect(codes.filter((c) => c === 'TARGET_P1')).toHaveLength(1);
    expect(items.filter((b) => b.code === 'LINK_UNSIZED').map((b) => b.subject_ids)).toEqual(twoLinks.map((l) => [l.from, l.to]));
    expect(codes).toContain('LIMIT_estimate_only');
    // B-2: the off-scale limit has no figure that changes its check — listed, with no remedy offered.
    const none = items.find((b) => b.code === 'LIMIT_unscored')!;
    expect(none.next_action).toEqual({ kind: 'none', can_change_result: false });
    // B-2 across the list: an ask exactly when answering it can change the result.
    for (const b of items) expect(typeof b.next_action.ask === 'string', b.id).toBe(b.next_action.can_change_result);
  });

  it('RED (B-1): two limits on the same quantity → ONE item for it, blocking both, with one ask', () => {
    const g = clone(FX.graph);
    const churn = (g.goal_constraints as Json[]).find((c) => c.node_id === 'monthly_churn')!;
    g.goal_constraints.push({ ...clone(churn), constraint_id: 'agent-lane:monthly_churn:>=', operator: '>=', value: 1 });
    const rows = { per_limit: [
      { constraint_id: 'agent-lane:monthly_churn:<=', state: 'estimate_only', reason: 'level_olumi_estimate' },
      { constraint_id: 'agent-lane:monthly_churn:>=', state: 'estimate_only', reason: 'level_olumi_estimate' },
    ], joint: { state: 'estimate_only' } };
    const checks = limitChecksForAgent(g, rows as never)!;
    expect(checks.filter((c) => typeof c.ask === 'string'), 'precondition: both limits carry an ask').toHaveLength(2);
    const items = resultBlockersOf({ graph: g, limitChecks: checks });
    const churnItems = items.filter((b) => b.subject_ids.includes('monthly_churn'));
    expect(churnItems).toHaveLength(1);
    // No blocker is lost in the merge: the item says what it blocks for BOTH limits' sources.
    expect(churnItems[0]!.sources).toEqual(['LIMIT_estimate_only']);
    expect(new Set(items.map(subjectKey)).size).toBe(items.length);
  });

  it('CONTROL: no target, every limit scored, no placeholder warning → no target, limit or link item', () => {
    const g = clone(FX.graph);
    const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
    delete goal.goal_threshold;
    delete goal.goal_threshold_raw;
    expect(targetTestabilityOf(g).kind, 'precondition: no stated target').toBe('no_target');
    const rows = { per_limit: FX.limit_verdicts.per_limit.map((r) => ({ constraint_id: r.constraint_id, state: 'scored' })), joint: { state: 'scored' } };
    const items = resultBlockersOf({ graph: g, limitChecks: limitChecksForAgent(g, rows as never), warnings: [] });
    expect(items.map((b) => b.code).filter((c) => /^(TARGET_|LIMIT_|LINK_)/.test(c))).toEqual([]);
  });
});
