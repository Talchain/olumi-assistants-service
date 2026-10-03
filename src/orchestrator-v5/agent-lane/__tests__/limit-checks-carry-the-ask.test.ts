/**
 * ⭐ EACH LIMIT'S ROW CARRIES MG'S ASK, VERBATIM (seam: MG 5865508951, Runtime ACK 5865567691; DL ruling 5865003207
 * "one wording, one producer").
 *
 * The run result's `limit_checks` says HOW each limit was checked (`limit-checks.ts`). What the user could give so it is
 * checked against THEIR figures is MG's question (`limitCheckAsks`, `limited-level-ask.ts`), read off the SAME graph
 * read and joined on `constraint_id`. Quoted, never paraphrased; absent when MG asks nothing, and never on a limit that
 * was checked against the user's own figures.
 *
 * Served `pj-20260928T063347Z` C10 (the fixture's graph is the same served graph as MG's
 * `served-journey-c-budget-limit-063347Z.json` c10): both limits `estimate_only / level_olumi_estimate`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { limitChecksForAgent, LIMIT_CHECKS_NOTE } from '../limit-checks.js';
import { limitCheckAsks } from '../limited-level-ask.js';
import type { StoredLimitVerdicts } from '../../../orchestrator/context/constraint-feasibility.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/pj-c10-063347Z-limits-estimate-only.json', import.meta.url), 'utf8')) as {
  graph: Record<string, unknown> & { nodes: unknown[] }; analysis_state: unknown; analysis_ready: unknown; analysis_result: unknown;
  limit_verdicts: StoredLimitVerdicts;
};
const LIMIT = 'agent-lane:total_investment:<=';
const CHURN = 'agent-lane:monthly_churn:<=';
const asksOf = (g: unknown) => new Map(limitCheckAsks(g as never).map((a) => [a.constraint_id, a.question] as const));

describe('⭐ each limit row carries MG’s ask, verbatim', () => {
  it('PRECONDITION: MG’s producer asks about both served limits on this graph', () => {
    expect([...asksOf(FX.graph).keys()].sort()).toEqual([CHURN, LIMIT].sort());
  });

  /**
   * R-c per option (AI Quality #72 5900908629): on C10 both Olumi options move churn through price on an unsized link, so
   * the churn row's ask is MG's level question word for word, then the link-size question (`limit-checks.ts`).
   */
  /**
   * ⛔ B6 SUPERSEDES MG's level question on these rows (AIQ #75 5916187873 (a)+(b)): each served option whose P rests on
   * Olumi's figure is withheld, and the row's ONE question is the first withheld option's arm question — never MG's
   * "can only be checked against Olumi's estimate", which would call a withheld guess a check.
   */
  const LIMIT_B6_ASK = 'What’s each option’s likely range for ‘Total investment’, and its most likely figure?';
  const CHURN_B6_ASK = 'What is ‘Monthly churn’ today? How much does ‘Pro plan price’ change ‘Monthly churn’?';

  it('B6 (served C10): each row asks its first withheld option\'s arm question, and never MG\'s "checked against" wording', () => {
    const rows = limitChecksForAgent(FX.graph, FX.limit_verdicts)!;
    expect(rows.map((r) => [r.constraint_id, r.ask])).toEqual([[LIMIT, LIMIT_B6_ASK], [CHURN, CHURN_B6_ASK]]);
    for (const r of rows) expect(r.ask).not.toMatch(/checked against/);
  });

  it('CONTRAST: a limit checked against the user’s own figures carries no ask, even if one were produced', () => {
    const scored = { per_limit: FX.limit_verdicts.per_limit.map((r) => (r.constraint_id === LIMIT ? { constraint_id: LIMIT, state: 'scored' } : r)), joint: FX.limit_verdicts.joint } as unknown as StoredLimitVerdicts;
    const rows = limitChecksForAgent(FX.graph, scored)!;
    // MG's level question never rides a scored row; only B6's question for the two options set at Olumi's £20,000 does.
    expect(rows.find((r) => r.constraint_id === LIMIT)!.ask).toBe(LIMIT_B6_ASK);
    expect(rows.find((r) => r.constraint_id === CHURN)!.ask).toBe(CHURN_B6_ASK);
  });

  it('CONTRAST: where MG asks nothing (every figure on the limit is the user’s), that row gains no ask key', () => {
    const OLUMI_SET = ['features_and_pro_price', 'additional_advertising'];
    const g = structuredClone(FX.graph) as { nodes: Array<Record<string, any>> };
    for (const n of g.nodes) {
      if (n.id === 'total_investment') n.observed_state = { ...n.observed_state, source: 'user_override' };
      if (n.kind === 'option' && OLUMI_SET.includes(n.id) && n.interventions?.total_investment !== undefined) {
        n.interventions.total_investment = { ...n.interventions.total_investment, source: 'user_specified' };
      }
    }
    expect(asksOf(g).has(LIMIT), 'control: MG’s producer is silent on this limit').toBe(false);
    const rows = limitChecksForAgent(g, FX.limit_verdicts)!;
    expect(rows.find((r) => r.constraint_id === LIMIT)).not.toHaveProperty('ask');
    expect(rows.find((r) => r.constraint_id === CHURN)!.ask).toBe(CHURN_B6_ASK);
  });

  it('the note tells the model to ask it once, in its words', () => {
    expect(LIMIT_CHECKS_NOTE).toMatch(/\bask\b.*\bonce\b/i);
    expect(LIMIT_CHECKS_NOTE).toMatch(/its words|as written|word for word/i);
  });

  it('RED at the capability: the run result’s limit_checks rows carry the ask', async () => {
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) {
        return { status: 200, json: { graph: FX.graph, graph_hash: 'h1', analysis_state: FX.analysis_state, analysis_limit_verdicts: FX.limit_verdicts } };
      }
      if (path === '/orchestrate/v2/turn') {
        return { status: 200, json: { assistant_text: '', analysis_state: FX.analysis_state, analysis_ready: FX.analysis_ready, blocks: [FX.analysis_result] } };
      }
      throw new Error(`unexpected dispatch ${path}`);
    };
    const caps = createAgentCapabilities(d, new ProposalStore());
    const r = await caps.runAnalysis({ scenario_id: '550e8400-e29b-41d4-a716-4466554400e1', authenticated_user_id: null, request_id: 'r' } as never, {} as never);
    const checks = (r as { limit_checks?: { limits: { constraint_id: string; ask?: string }[] } }).limit_checks;
    expect(checks, JSON.stringify(Object.keys(r))).toBeDefined();
    expect(checks!.limits.find((l) => l.constraint_id === LIMIT)!.ask).toBe(LIMIT_B6_ASK);
  });
});
