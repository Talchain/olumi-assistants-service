/**
 * AI HARNESS PR-L1 — ONE leader licence, the licensed run view the model reads, and the Agent lane's fail-closed final
 * egress (programme-docs#85 5931097719). Fixture: Paul's served 09:48Z Run block (1 Oct, scenario 96c6f5f4), whose
 * PLoT warning named the withheld leader by id beside "the leading option's draws".
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { log } from '../../../utils/telemetry.js';
import { leaderLicence, leaderLicenceFromState, type LeaderLicenceInput } from '../../compose/leader-licence.js';
import { WITHHELD_NEAR_TIE, WITHHELD_SEPARATION_UNAVAILABLE, WITHHELD_CONSTRAINT_VERDICT } from '../../compose/analysis-state-v1.js';
import { agentLaneLeaderWithheld } from '../withheld-leader-fail-closed.js';
import { claimPermissionsFrom } from '../first-analysis.js';
import { analysisResultForAgent } from '../decision-sensitivity.js';
import { modelFacingToolResult, withoutLeaderDesignations } from '../licensed-run-view.js';
import { enforceLeaderLicenceAtFinalEgress } from '../leader-final-egress.js';

const here = dirname(fileURLToPath(import.meta.url));
const SERVED = JSON.parse(readFileSync(join(here, 'fixtures/served-withheld-leader-0948Z.json'), 'utf8')) as {
  analysis_state: Record<string, unknown>;
  block: Record<string, unknown>;
};

const ready = (mode: string | null) => (mode === null ? { status: 'ready' } : { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: mode } });

afterEach(() => vi.restoreAllMocks());

describe('ONE leader licence', () => {
  const rows: Array<[string, LeaderLicenceInput, ReturnType<typeof leaderLicence>]> = [
    ['not entitled', { mayNameLeadingOption: false, analysisReady: ready('comparative_leader') }, 'withheld'],
    ['entitled, separated, quantified_provisional', { mayNameLeadingOption: true, separationEstablished: true, analysisReady: ready('quantified_provisional') }, 'permitted_with_caveat'],
    ['entitled, provisional, NOT separated', { mayNameLeadingOption: true, separationEstablished: false, analysisReady: ready('quantified_provisional') }, 'withheld'],
    ['entitled, admission below comparative', { mayNameLeadingOption: true, analysisReady: ready('exploratory') }, 'withheld'],
    ['entitled, comparative, looked and declined (near tie)', { mayNameLeadingOption: true, analysisReady: ready('comparative_leader'), leaderClaimWithheldReason: WITHHELD_NEAR_TIE }, 'withheld'],
    ['ruling (ii): separation could not be evaluated', { mayNameLeadingOption: true, analysisReady: ready('comparative_leader'), leaderClaimWithheldReason: WITHHELD_SEPARATION_UNAVAILABLE }, 'withheld'],
    ['entitled, comparative, nothing declined', { mayNameLeadingOption: true, analysisReady: ready('comparative_leader') }, 'permitted'],
    ['entitled, admission absent (fails open, as the shared gate)', { mayNameLeadingOption: true, analysisReady: ready(null) }, 'permitted'],
  ];
  it.each(rows)('%s', (_name, input, expected) => {
    expect(leaderLicence(input)).toBe(expected);
  });

  it('the Agent lane wire gate reads the same licence on every row', () => {
    for (const [, input, expected] of rows) expect(agentLaneLeaderWithheld(input)).toBe(expected === 'withheld');
  });

  it('what the Agent is told follows the same licence (+ comparative_leader for a plain naming)', () => {
    const state = (permitted: boolean, extra: Record<string, unknown> = {}) => ({ leader_claim: { permitted, ...extra } });
    expect(claimPermissionsFrom(state(true), ready('comparative_leader'), { requested: true }).leader_may_be_named).toBe(true);
    // A run that looked and declined is never named, whatever `permitted` says.
    expect(claimPermissionsFrom(state(true, { withheld_reason: WITHHELD_NEAR_TIE }), ready('comparative_leader'), { requested: true }).leader_may_be_named).toBe(false);
    // Caveat arm: named as provisional, requested runs only.
    const caveat = claimPermissionsFrom(state(true, { separation: 'separated' }), ready('quantified_provisional'), { requested: true });
    expect(caveat).toMatchObject({ leader_may_be_named: true, provisional: true });
    expect(claimPermissionsFrom(state(true, { separation: 'separated' }), ready('quantified_provisional')).leader_may_be_named).toBe(false);
    // Absent admission fails CLOSED for the Agent's told permission.
    expect(claimPermissionsFrom(state(true), ready(null), { requested: true }).leader_may_be_named).toBe(false);
  });

  it("Paul's 09:48Z readback is withheld", () => {
    expect(leaderLicenceFromState(SERVED.analysis_state, ready('comparative_leader'))).toBe('withheld');
  });
});

describe('the licensed run view the model reads', () => {
  const toolOutput = (mayName: boolean) => ({
    ok: true,
    ran: true,
    claim_permissions: { leader_may_be_named: mayName, withheld_reason: WITHHELD_CONSTRAINT_VERDICT, permitted_analysis_mode: 'comparative_leader' },
    result: analysisResultForAgent(SERVED.block),
  });

  it("RED on Paul's block: no producer prose and no leader-vocabulary reaches the model on a withheld run", () => {
    const raw = JSON.stringify(toolOutput(false));
    // Precondition: the raw tool output (what the model read before PR-L1) carries the leak.
    expect(raw).toContain("the leading option's draws");
    const seen = JSON.stringify(modelFacingToolResult('run_analysis', toolOutput(false)));
    expect(seen).not.toContain("leading option");
    expect(seen).not.toContain('of draws outside the level domain');
    // Every producer `message` / `note` is gone; codes, severities, ids and labels stay.
    expect(seen).not.toMatch(/"message":/);
    expect(seen).not.toMatch(/"note":/);
    expect(seen).toContain('CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN');
    expect(seen).toContain('"severity":"warning"');
    expect(seen).toContain('"option_label":"AI Reporting Sprint"');
  });

  it('decides nothing about figures: every number the run carried is still there (F1b owns which figures show)', () => {
    const numbers = (v: unknown): number[] => (typeof v === 'number' ? [v] : Array.isArray(v) ? v.flatMap(numbers)
      : v !== null && typeof v === 'object' ? Object.values(v).flatMap(numbers) : []);
    const before = toolOutput(false);
    const after = modelFacingToolResult('run_analysis', toolOutput(false));
    const rows = (o: { result: unknown }) => (o.result as { enrichment?: { option_comparison?: unknown } }).enrichment?.option_comparison;
    expect(numbers(rows(after))).toEqual(numbers(rows(before)));
  });

  it("RED: the Run button's interpreter state carries no run-over-run leader ids on a withheld run", () => {
    const state = { analysis_state: SERVED.analysis_state, run_delta: { leader: { current_leading_option_id: 'ai_reporting_sprint', prior_leading_option_id: 'signup_fix_sprint' }, rows: [] } };
    const seen = withoutLeaderDesignations(state) as { run_delta: { leader: Record<string, unknown> } };
    expect(seen.run_delta.leader).toEqual({ current_leading_option_id: null, prior_leading_option_id: null });
    const clean = { analysis_state: SERVED.analysis_state };
    expect(withoutLeaderDesignations(clean)).toBe(clean);
  });

  it('CONTROL: a run the model may name a leader on is returned by reference; other tools are untouched', () => {
    const permitted = toolOutput(true);
    expect(modelFacingToolResult('run_analysis', permitted)).toBe(permitted);
    const other = toolOutput(false);
    expect(modelFacingToolResult('get_canonical_state', other)).toBe(other);
  });
});

describe('the Agent lane fail-closed final egress', () => {
  const GRAPH = { nodes: [
    { id: 'ai_reporting_sprint', kind: 'option', label: 'AI Reporting Sprint' },
    { id: 'signup_fix_sprint', kind: 'option', label: 'Signup Fix Sprint' },
  ] };
  const base = (extra: Record<string, unknown>): OlumiResponse => ({
    assistant_text: 'Here is what the analysis found.',
    blocks: [],
    suggested_actions: [
      { id: 'agent-next-pre-mortem', label: 'Run a pre-mortem', message: 'Run a pre-mortem with me.' },
      { id: 'x-leader', label: 'Why is AI Reporting Sprint the leading option?', message: 'Why is AI Reporting Sprint the leading option?' },
    ],
    run_delta: { leader: { current_leading_option_id: 'ai_reporting_sprint', prior_leading_option_id: 'signup_fix_sprint' } },
    _agent: { provisional_view: { text: 'AI Reporting Sprint looks strongest, provisionally.' } },
    ...extra,
  } as unknown as OlumiResponse);
  const opts = (licence: 'withheld' | 'permitted', proseGateRan = true) => ({
    requestId: 'req-l1', exitPath: 'test', licence, proseGateRan,
    mayNameLeadingOption: licence !== 'withheld', graph: GRAPH, analysisReady: ready('comparative_leader'),
  });

  it('RED: on a withheld turn it REMOVES the leader from chips and run_delta, logs level 50, leaves the provisional view', () => {
    const error = vi.spyOn(log, 'error');
    const out = enforceLeaderLicenceAtFinalEgress(base({}), opts('withheld'));
    const body = out.response as unknown as Record<string, any>;
    expect(body.suggested_actions.map((c: { id: string }) => c.id)).toEqual(['agent-next-pre-mortem']);
    expect(body.run_delta.leader.current_leading_option_id).toBeNull();
    expect(body.run_delta.leader.prior_leading_option_id).toBeNull();
    expect(body._agent).toEqual(base({})._agent as never);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: 'agent_lane.leader_claim_residual_removed', enforced: true }), expect.any(String));
  });

  it("RED: Paul's warning prose in the analysis block's enrichment is removed at the wire on a withheld turn", () => {
    const block = { ...SERVED.block };
    const out = enforceLeaderLicenceAtFinalEgress(base({ blocks: [block], suggested_actions: [], run_delta: undefined }), opts('withheld'));
    const shipped = JSON.stringify(out.response);
    expect(JSON.stringify(block)).toContain("the leading option's draws");
    expect(shipped).not.toContain("the leading option's draws");
    expect(shipped).toContain('CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN');
  });

  it('a non-analysis turn still gets the exact-label prose edit', () => {
    const out = enforceLeaderLicenceAtFinalEgress(
      base({ assistant_text: 'AI Reporting Sprint currently performs best, leading in 46% of simulations.', suggested_actions: [], run_delta: undefined }),
      opts('withheld', false),
    );
    expect(out.proseEdited).toBe(true);
    expect((out.response as { assistant_text: string }).assistant_text).not.toContain('AI Reporting Sprint currently performs best');
  });

  it('CONTROL: a permitted turn is returned by reference', () => {
    const body = base({});
    expect(enforceLeaderLicenceAtFinalEgress(body, opts('permitted')).response).toBe(body);
  });

  it('CONTROL: a clean withheld turn changes nothing and logs nothing at level 50', () => {
    const error = vi.spyOn(log, 'error');
    const body = base({ suggested_actions: [{ id: 'agent-next-pre-mortem', label: 'Run a pre-mortem', message: 'Run a pre-mortem with me.' }], run_delta: undefined });
    const out = enforceLeaderLicenceAtFinalEgress(body, opts('withheld'));
    expect(out.response).toBe(body);
    expect(error).not.toHaveBeenCalled();
  });
});
