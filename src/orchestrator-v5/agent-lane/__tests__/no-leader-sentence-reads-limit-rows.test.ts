/**
 * ⭐ THE NO-LEADER SENTENCE SAYS WHAT THE LIMIT ROWS SAY, AND NEVER "ON THIS RUN" WHEN NOTHING RAN (served 28 Sep,
 * CEE 651a7fd, MG's 3 × journey C for #2214/#2215).
 *
 *   - Run 1: both limits `estimate_only` (`level_olumi_estimate`). The model said, correctly, "Both the £30,000 spend
 *     limit and the churn limit were checked only against Olumi estimates." The sentence this module appends then said
 *     "…ask me what the limit needs before it can be checked": the reply contradicted itself, and the one next action it
 *     offered cannot change the verdict. What can is a real figure from the user.
 *   - Run 2: the Run was refused upstream (`run_state.kind` `never_run`, no `analysis_result` block). `never_run` still
 *     carries `leader_claim.withheld_reason: constraint_verdict_withheld` by default (`composeLeaderClaim`; the
 *     provisional view already refuses it for this reason), so the reply said a limit "was not shown to be met on this
 *     run" about a run that never happened.
 *
 * The rules, both keyed on TYPED fields, never prose:
 *   1. `constraint_verdict_withheld` + per-limit rows that are ALL `estimate_only` on Olumi's estimates → the sentence
 *      says they were checked only against Olumi's estimates and asks for a real figure. Any other mix keeps the
 *      default (an `unscored` limit really does need something before it can be checked).
 *   2. A `run_state.kind` that says no result exists (`never_run`, `refused`, `blocked`, `running`) → ranking sentences
 *      are still dropped, but no "why" about a run is appended (AX2's rule for the build turn). An absent or degraded
 *      run state keeps today's behaviour, and a reply the drop would leave EMPTY still gets a sentence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import {
  AGENT_NO_LEADER_SENTENCES,
  agentNoLeaderReason,
  agentNoLeaderSentence,
  enforceAgentLaneLeaderClaimsAtWire,
  sentenceRanksOptions,
} from '../withheld-leader-fail-closed.js';
import { leaderStandingOf } from '../provisional-view.js';
import type { StoredLimitVerdicts } from '../../../orchestrator/context/constraint-feasibility.js';

type Served = {
  analysis_ready: unknown; analysis_state: { run_state?: { kind?: string } } & Record<string, unknown>;
  limit_verdicts: StoredLimitVerdicts | null; blocks: unknown[]; graph: unknown; served_reply: string;
};
const load = (f: string): Served => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as Served;
const RUN1 = load('pj-c10-071622Z-1-no-leader-sentence.json');
const RUN2 = load('pj-c10-071622Z-2-no-leader-sentence.json');

const DEFAULT_TAIL = 'ask me what the limit needs before it can be checked';
const ON_THIS_RUN = /not shown to be met on this run/;
/** A ranking sentence of the served shape: names an option of the served graph and puts it first. */
const RANKING = 'Features and Pro price rise leads the comparison at 41%.';

const gate = (s: Served, text: string, opts: Record<string, unknown> = {}) => enforceAgentLaneLeaderClaimsAtWire(
  { assistant_text: text, blocks: s.blocks, suggested_actions: [], analysis_state: s.analysis_state } as unknown as OlumiResponse,
  {
    requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld',
    graph: s.graph, analysisReady: s.analysis_ready, ...(s.limit_verdicts !== null ? { limitVerdicts: s.limit_verdicts } : {}), ...opts,
  } as never,
).response.assistant_text;

const rows = (...r: Array<[string, string?]>): StoredLimitVerdicts => ({
  per_limit: r.map(([state, reason], i) => ({ constraint_id: `agent-lane:l${i}:<=`, state, ...(reason !== undefined ? { reason } : {}) })),
  joint: { state: 'estimate_only' },
} as unknown as StoredLimitVerdicts);

describe('⭐ the no-leader sentence reads the limit rows', () => {
  it('PRECONDITION (served run 1): the leader is withheld on constraint_verdict_withheld, both rows estimate_only on Olumi’s estimates, and the served reply ended on the default sentence', () => {
    expect((RUN1.analysis_state as { leader_claim?: { withheld_reason?: string } }).leader_claim?.withheld_reason).toBe('constraint_verdict_withheld');
    expect(RUN1.limit_verdicts!.per_limit.map((r) => [r.state, (r as { reason?: string }).reason])).toEqual([
      ['estimate_only', 'level_olumi_estimate'], ['estimate_only', 'level_olumi_estimate'],
    ]);
    expect(RUN1.served_reply).toContain('were checked only against Olumi estimates');
    expect(RUN1.served_reply).toContain(DEFAULT_TAIL);
  });

  it('RED (served run 1): every limit checked on Olumi’s estimates → says so, and asks for a real figure, never "before it can be checked"', () => {
    const s = agentNoLeaderSentence('constraint_verdict_withheld', RUN1.analysis_ready, [], RUN1.limit_verdicts ?? undefined);
    expect(s).toBe('No single option can be put forward yet, because your limits were checked only against Olumi’s estimates, not figures you gave, and running the analysis again as it stands will not change that; give me a real figure you know.');
    expect(s).not.toContain(DEFAULT_TAIL);
  });

  it('RED at the wire (served run 1): the route’s rows reach the appended sentence', () => {
    const body = RUN1.served_reply.slice(0, RUN1.served_reply.indexOf('No single option can be put forward yet')).trimEnd();
    const out = gate(RUN1, `${RANKING} ${body}`);
    expect(out).not.toContain(RANKING);
    expect(out).toContain('your limits were checked only against Olumi’s estimates');
    expect(out).not.toContain(DEFAULT_TAIL);
  });

  it('one limit → "your limit was"', () => {
    expect(agentNoLeaderSentence('constraint_verdict_withheld', undefined, [], rows(['estimate_only', 'level_olumi_estimate'])))
      .toContain('because your limit was checked only against Olumi’s estimates, not figures you gave');
  });

  it('CONTRAST: an unscored limit in the mix, a limit on the user’s own assumption, a scored one, or no rows → the default sentence', () => {
    const def = agentNoLeaderSentence('constraint_verdict_withheld', undefined, []);
    expect(def).toContain(DEFAULT_TAIL);
    for (const r of [
      rows(['unscored', 'CONSTRAINT_NOT_CONVERTIBLE'], ['estimate_only', 'level_olumi_estimate']), // served run 3's mix
      rows(['estimate_only', 'level_user_assumption']),
      rows(['estimate_only', 'level_olumi_estimate'], ['estimate_only', 'level_user_assumption']),
      rows(['scored'], ['estimate_only', 'level_olumi_estimate']),
      rows(['estimate_only']),
      undefined,
    ]) expect(agentNoLeaderSentence('constraint_verdict_withheld', undefined, [], r), JSON.stringify(r)).toBe(def);
  });

  it('CONTRAST: another withheld reason is never re-worded by the rows', () => {
    const est = RUN1.limit_verdicts ?? undefined;
    for (const reason of ['near_tie', 'no_option_meets_limit', 'every_option_likely_breaks_limit', 'run_out_of_date']) {
      expect(agentNoLeaderSentence(reason, undefined, [], est)).toBe(agentNoLeaderSentence(reason, undefined, []));
    }
  });

  it('the new sentences are the module’s own (kept by identity) and none reads as a ranking', () => {
    for (const n of [1, 2]) {
      const s = agentNoLeaderSentence('constraint_verdict_withheld', undefined, [], rows(...Array.from({ length: n }, () => ['estimate_only', 'level_olumi_estimate'] as [string, string])));
      expect(AGENT_NO_LEADER_SENTENCES).toContain(s);
      expect(sentenceRanksOptions(s)).toBe(false);
    }
  });

  it('C5: the provisional view’s "because" gives the same cause from the same rows', () => {
    const standing = leaderStandingOf({ analysisState: RUN1.analysis_state, analysisReady: RUN1.analysis_ready, limitVerdicts: RUN1.limit_verdicts ?? undefined });
    expect(standing.because).toBe(agentNoLeaderReason('constraint_verdict_withheld', RUN1.analysis_ready, [], RUN1.limit_verdicts ?? undefined));
    expect(standing.because).toContain('checked only against Olumi’s estimates');
  });
});

describe('⭐ no "on this run" when nothing ran', () => {
  it('PRECONDITION (served run 2): never_run, no analysis_result block, leader_claim still says constraint_verdict_withheld, and the served reply said "on this run"', () => {
    expect(RUN2.analysis_state.run_state?.kind).toBe('never_run');
    expect(RUN2.blocks.some((b) => (b as { type?: string }).type === 'analysis_result')).toBe(false);
    expect((RUN2.analysis_state as { leader_claim?: { withheld_reason?: string } }).leader_claim?.withheld_reason).toBe('constraint_verdict_withheld');
    expect(RUN2.served_reply).toMatch(ON_THIS_RUN);
  });

  it('RED (served run 2): the ranking is still dropped, and no sentence about a run is appended', () => {
    const body = RUN2.served_reply.slice(0, RUN2.served_reply.indexOf('No single option can be put forward yet')).trimEnd();
    const out = gate(RUN2, `${body}\n\nFeatures and Price Rise leads the comparison at 41%.`);
    expect(out).not.toContain('leads the comparison');
    expect(out).not.toMatch(ON_THIS_RUN);
    expect(out).toBe(body);
  });

  it('every typed no-result kind is treated the same; absent, degraded and completed runs keep the sentence', () => {
    const text = `${RANKING} The model is ready.`;
    for (const kind of ['never_run', 'refused', 'blocked', 'running']) {
      const s = { ...RUN1, limit_verdicts: null, analysis_state: { ...RUN1.analysis_state, run_state: { kind } } };
      expect(gate(s, text), kind).toBe('The model is ready.');
    }
    for (const run_state of [undefined, { kind: 'unknown_degraded' }, { kind: 'complete_current' }, { kind: 'complete_stale' }]) {
      const s = { ...RUN1, limit_verdicts: null, analysis_state: { ...RUN1.analysis_state, run_state } };
      expect(gate(s, text), JSON.stringify(run_state)).toMatch(ON_THIS_RUN);
    }
  });

  it('never a silent turn: a reply the drop would leave EMPTY still gets a sentence, and it claims no run', () => {
    const out = gate(RUN2, RANKING);
    expect(out.length).toBeGreaterThan(0);
    expect(AGENT_NO_LEADER_SENTENCES).toContain(out);
    expect(out).not.toMatch(ON_THIS_RUN);
  });
});
