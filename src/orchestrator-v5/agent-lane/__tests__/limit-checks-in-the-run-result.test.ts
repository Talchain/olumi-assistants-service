/**
 * ⛔ THE AGENT IS TOLD HOW EACH LIMIT WAS CHECKED (MG #72 5864956818; Runtime claim 5864979840; DL ruling 5865003207).
 *
 * Served `pj-20260928T063347Z` C10 (fixture below, verbatim): both of the user's limits came back
 * `estimate_only / level_olumi_estimate`. They WERE checked, but against Olumi's own figures. The Agent's run result
 * carried only `leader_claim.withheld_reason: constraint_verdict_withheld`, and the reply said "the total-investment
 * constraint was not checkable in this model" and "the model needs a checkable definition of total investment".
 *
 * The rule: `run_analysis` carries `limit_checks`, one fixed sentence per limit from the run's own per-limit rows on the
 * same graph read. An `estimate_only` limit is said to have been checked against Olumi's estimates; only an `unscored`
 * one "cannot be checked in this model yet". What the user could give instead is MG's ask, never a second paraphrase
 * here (the DL's "one wording, one producer").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { limitChecksForAgent, LIMIT_CHECKS_NOTE } from '../limit-checks.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/pj-c10-063347Z-limits-estimate-only.json', import.meta.url), 'utf8')) as {
  graph: Record<string, unknown>; analysis_state: unknown; analysis_ready: unknown; analysis_result: unknown;
  limit_verdicts: { per_limit: { constraint_id: string; state: string; reason?: string }[]; joint: { state: string } };
};
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400e1', authenticated_user_id: null, request_id: 'r' };

/** The served run turn's response, then the graph route as it serves the run's own per-limit rows. */
/** `null` = the graph route serves no per-limit rows (JS defaults would swallow an explicit `undefined`). */
function world(verdicts: unknown | null = FX.limit_verdicts) {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) {
      return { status: 200, json: { graph: FX.graph, graph_hash: 'h1', analysis_state: FX.analysis_state, ...(verdicts !== null ? { analysis_limit_verdicts: verdicts } : {}) } };
    }
    if (path === '/orchestrate/v2/turn') {
      return { status: 200, json: { assistant_text: '', analysis_state: FX.analysis_state, analysis_ready: FX.analysis_ready, blocks: [FX.analysis_result] } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
}

/** R-c per option (AI Quality #72 5900908629): the C10 options whose own churn check is withheld, as the sentence names them. */
const CHURN_WITHHELD = ' For ‘Features and Pro price’ and ‘Additional advertising’ it couldn’t be checked: those options move it through a link Olumi has not sized (a placeholder, not an estimate).';

describe('⛔ run_analysis says how each of the user’s limits was checked', () => {
  it('the served premise: the run withheld its leader with the generic reason, and both limits are estimate_only', () => {
    expect((FX.analysis_state as { leader_claim?: { withheld_reason?: string } }).leader_claim?.withheld_reason).toBe('constraint_verdict_withheld');
    expect(FX.limit_verdicts.per_limit.map((r) => [r.state, r.reason])).toEqual([['estimate_only', 'level_olumi_estimate'], ['estimate_only', 'level_olumi_estimate']]);
  });

  it('⭐ RED (served C10): each limit is said to have been CHECKED against Olumi’s estimates, never "cannot be checked"', async () => {
    const r = await world().runAnalysis(ctx, { reason: 'Run it.' });
    const checks = r.limit_checks as { limits: { limit: string; state: string; say: string }[]; note: string } | undefined;
    expect(checks, JSON.stringify(Object.keys(r))).toBeDefined();
    // Each row also carries MG's ask for that limit, verbatim (`limit-checks-carry-the-ask.test.ts` binds the join).
    expect(checks!.limits.map(({ ask: _ask, ...row }: { ask?: string } & Record<string, unknown>) => row)).toEqual([
      { constraint_id: 'agent-lane:total_investment:<=', limit: 'Total investment', state: 'estimate_only', say: '‘Total investment’ was checked, but only against Olumi’s estimates, not figures you gave.' },
      // R-c per option (AIQ 5900908629): both Olumi options move churn through price on an unsized link — named, not hidden.
      { constraint_id: 'agent-lane:monthly_churn:<=', limit: 'Monthly churn', state: 'estimate_only', say: '‘Monthly churn’ was checked, but only against Olumi’s estimates, not figures you gave.'
        + CHURN_WITHHELD, withheld_for: ['Features and Pro price', 'Additional advertising'] },
    ]);
    expect(checks!.note).toBe(LIMIT_CHECKS_NOTE);
    expect(JSON.stringify(checks)).not.toMatch(/cannot be checked in this model/);
  });

  it('CONTROL: an unscored limit — and only that — cannot be checked yet; a scored one was checked', () => {
    const rows = { per_limit: [
      { constraint_id: 'agent-lane:total_investment:<=', state: 'unscored' as const, reason: 'no_frame' },
      { constraint_id: 'agent-lane:monthly_churn:<=', state: 'scored' as const },
    ], joint: { state: 'withheld' as const } };
    expect(limitChecksForAgent(FX.graph, rows)!.map((c) => c.say)).toEqual([
      '‘Total investment’ cannot be checked in this model yet.',
      `‘Monthly churn’ was checked against the figures in your model.${CHURN_WITHHELD}`,
    ]);
  });

  it('CONTROL: a limit checked against a figure the user accepted as an assumption says so', () => {
    const rows = { per_limit: [{ constraint_id: 'agent-lane:monthly_churn:<=', state: 'estimate_only' as const, reason: 'level_user_assumption' }], joint: { state: 'estimate_only' as const } };
    expect(limitChecksForAgent(FX.graph, rows)![0]!.say).toBe(`‘Monthly churn’ was checked, against a figure you accepted as an assumption.${CHURN_WITHHELD}`);
  });

  it('CONTROL: no per-limit rows on the read → no limit_checks (nothing invented); a row whose limit has no label is left out', async () => {
    const r = await world(null).runAnalysis(ctx, { reason: 'Run it.' });
    expect(r).not.toHaveProperty('limit_checks');
    expect(limitChecksForAgent(FX.graph, { per_limit: [{ constraint_id: 'unknown:limit', state: 'unscored' }], joint: { state: 'withheld' } })).toBeUndefined();
  });

  it('one wording, one producer: the sentence says only HOW it was checked — no remedy of its own (that is MG’s ask)', () => {
    for (const c of limitChecksForAgent(FX.graph, FX.limit_verdicts as never)!) expect(c.say).not.toMatch(/would let|give us|tell me|if you/i);
  });
});
