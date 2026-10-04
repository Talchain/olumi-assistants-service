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
import { enforceLeaderLicenceAtFinalEgress, FINAL_EGRESS_FAILED_TEXT, knownSafeEnvelope } from '../leader-final-egress.js';
import { AnalysisResultBlockSchema, OlumiResponseSchema, RunDeltaSchema } from '@talchain/schemas/boundary';
import { LICENSED_LABEL_KEYS } from '../licensed-run-view.js';
import * as leaderWireEnforcement from '../../compose/leading-option-wire-enforcement.js';

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
    // P0 SHARED DATA matrix M6 (#85 5963281356, DL ruling via PTL 5963175273 §3): the licence fails CLOSED here; the shared
    // V5 gate's `analysisReadyPermitsLeaderNaming` still stands down (PR-L2), a named residual.
    ['entitled, admission absent (fails CLOSED — matrix M6)', { mayNameLeadingOption: true, analysisReady: ready(null) }, 'withheld'],
    ['entitled, run-refusal axis (structurally_analysable:false — matrix M5)', { mayNameLeadingOption: true, analysisReady: { status: 'blocked', analysis_admission: { structurally_analysable: false, permitted_analysis_mode: 'none' } } }, 'withheld'],
  ];
  it.each(rows)('%s', (_name, input, expected) => {
    expect(leaderLicence(input)).toBe(expected);
  });

  it('the Agent lane wire gate reads the same licence on every row', () => {
    for (const [, input, expected] of rows) expect(agentLaneLeaderWithheld(input as Parameters<typeof agentLaneLeaderWithheld>[0])).toBe(expected === 'withheld');
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
  const opts = (licence: 'withheld' | 'permitted') => ({
    requestId: 'req-l1', exitPath: 'test', licence,
    mayNameLeadingOption: licence !== 'withheld', graph: GRAPH, analysisReady: ready('comparative_leader'),
  });

  it('RED: on a withheld turn it REMOVES the leader from chips and run_delta, logs level 50, leaves the provisional view', () => {
    const error = vi.spyOn(log, 'error');
    const out = enforceLeaderLicenceAtFinalEgress(base({}), opts('withheld'));
    const body = out.response as unknown as Record<string, any>;
    expect(body.suggested_actions.map((c: { id: string }) => c.id)).toEqual(['agent-next-pre-mortem']);
    // REMOVED, not nulled: the contract types both optional + non-nullable (strip gap, CANVAS 5943987710).
    expect(body.run_delta.leader).not.toHaveProperty('current_leading_option_id');
    expect(body.run_delta.leader).not.toHaveProperty('prior_leading_option_id');
    expect(body._agent).toEqual(Reflect.get(base({}), '_agent'));
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
      opts('withheld'),
    );
    expect(out.proseEdited).toBe(true);
    expect((out.response as { assistant_text: string }).assistant_text).not.toContain('AI Reporting Sprint currently performs best');
  });

  it("RED (DL 5931709758): text rewritten AFTER the earlier gate (break-even / A7 / shape) still gets the exact-label edit", () => {
    // An analysis-bearing turn: the gate ran on the model's words, then a later rewrite appended a leader sentence.
    const body = base({ assistant_text: 'The figures are below.\n\nAI Reporting Sprint currently performs best, leading in 46% of simulations.', suggested_actions: [], run_delta: undefined });
    const out = enforceLeaderLicenceAtFinalEgress(body, opts('withheld'));
    expect((out.response as { assistant_text: string }).assistant_text).not.toContain('AI Reporting Sprint currently performs best');
    expect(out.proseEdited).toBe(true);
  });

  it('RED: if the egress itself throws, the reply FAILS CLOSED to the known-safe envelope', () => {
    const error = vi.spyOn(log, 'error');
    const hostile = { get nodes(): never { throw new Error('boom'); } };
    const out = enforceLeaderLicenceAtFinalEgress(base({}), { ...opts('withheld'), graph: hostile });
    const body = out.response as unknown as Record<string, any>;
    expect(body.assistant_text).toBe(FINAL_EGRESS_FAILED_TEXT);
    expect(body.suggested_actions).toEqual([]);
    expect(body.run_delta).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('ai_reporting_sprint');
    expect(JSON.stringify(body)).not.toContain('AI Reporting Sprint');
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: 'agent_lane.leader_final_egress_failed' }), expect.any(String));
  });

  // CODEX CEE BUDDY 5932438459: the envelope kept `analysis_result.summary` by spreading the block. The class is every
  // unchecked text member, so the hostile body carries the leader sentence in EVERY carrier the Agent reply has.
  const LEADER = 'AI Reporting Sprint currently performs best, leading in 46% of simulations.';
  const everyCarrier = (): Record<string, unknown> => ({
    assistant_text: LEADER,
    framing_question: LEADER,
    blocks: [
      { ...SERVED.block, summary: LEADER, leading_option_id: 'ai_reporting_sprint', enrichment: { fragility_note: LEADER } },
      { type: 'review_card', title: LEADER, body: LEADER, signal_id: 's1' },
      { type: 'text', text: LEADER },
    ],
    suggested_actions: [{ id: 'x', label: LEADER, message: LEADER }],
    run_delta: { leader: { current_leading_option_id: 'ai_reporting_sprint' }, summary: LEADER },
    insights: [LEADER, { text: LEADER }],
    analysis_state: { run_state: { kind: 'complete_current', note: LEADER }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld', leading_option_id: 'ai_reporting_sprint' } },
    analysis_ready: { status: 'ready', options: [{ id: 'ai_reporting_sprint', label: 'AI Reporting Sprint', description: LEADER }], blockers: [{ code: 'b1', message: LEADER }] },
    draft_graph: { nodes: [{ id: 'ai_reporting_sprint', kind: 'option', label: 'AI Reporting Sprint', description: LEADER }], edges: [] },
    graph: { nodes: [{ id: 'ai_reporting_sprint', kind: 'option', label: 'AI Reporting Sprint', description: LEADER }], edges: [] },
    _diagnostic_trace: { exit_path: 'agent_lane_v1', note: LEADER },
    _agent: { provisional_view: { text: LEADER }, tool_calls: [{ name: 'run_analysis' }], offered: [{ label: 'Why is AI Reporting Sprint the leading option?' }] },
    _answer_shape: { text: LEADER },
  });
  const strings = (v: unknown, key: string | undefined, out: Array<[string | undefined, string]>): Array<[string | undefined, string]> => {
    if (typeof v === 'string') out.push([key, v]);
    else if (Array.isArray(v)) v.forEach((x) => strings(x, key, out));
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, k, out);
    return out;
  };

  it.each(['roster', 'shared'] as const)('RED (CODEX 5932438459): a forced %s error omits unchecked model carriers and all hostile prose', (failure) => {
    const hostile = { get nodes(): never { throw new Error('boom'); } };
    if (failure === 'shared') vi.spyOn(leaderWireEnforcement, 'enforceLeadingOptionClaimsAtWire').mockImplementationOnce(() => { throw new Error('shared check failed'); });
    const input = everyCarrier();
    const original = JSON.stringify(input);
    const out = enforceLeaderLicenceAtFinalEgress(input, { ...opts('withheld'), graph: failure === 'roster' ? hostile : GRAPH });
    const body = out.response as Record<string, any>;
    expect(body.assistant_text).toBe(FINAL_EGRESS_FAILED_TEXT);
    const all = strings(body, undefined, []);
    expect(all.filter(([, v]) => /performs best|leading|strongest/i.test(v) && v !== FINAL_EGRESS_FAILED_TEXT)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(LEADER);
    for (const [k, v] of all) if (v.includes('AI Reporting Sprint')) expect(k !== undefined && LICENSED_LABEL_KEYS.has(k) && v === 'AI Reporting Sprint', `${k}=${v}`).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/leading_option_id":"ai_reporting_sprint/);
    // The deterministic result survives, schema-valid; unchecked model carriers are omitted only from the wire.
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0]).toMatchObject({ type: 'analysis_result', summary: '', leading_option_id: null, computed_against_hash: SERVED.block.computed_against_hash });
    expect(body.blocks[0].enrichment).toBeUndefined();
    expect(AnalysisResultBlockSchema.safeParse(body.blocks[0]).success).toBe(true);
    expect(body.draft_graph).toBeUndefined();
    expect(body.graph).toBeUndefined();
    expect(body.analysis_ready).toBeUndefined();
    expect(JSON.stringify(input)).toBe(original);
    expect(body.run_delta).toBeUndefined();
    expect(body.suggested_actions).toEqual([]);
    expect(body.analysis_state.leader_claim).toEqual({ permitted: false, withheld_reason: 'constraint_verdict_withheld', leading_option_id: null });
    expect(body.analysis_state.run_state).toEqual({ kind: 'complete_current' });
    expect(body._agent.provisional_view).toBeUndefined();
    expect(body._agent.tool_calls).toEqual([{ name: 'run_analysis' }]);
  });

  it('RED: when building the envelope itself fails, the minimal envelope ships — nothing from the reply', () => {
    const poisoned = { get blocks(): never { throw new Error('boom'); }, assistant_text: LEADER } as Record<string, unknown>;
    const env = knownSafeEnvelope(poisoned);
    expect(env).toEqual({ assistant_text: FINAL_EGRESS_FAILED_TEXT, suggested_actions: [], blocks: [] });
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

/**
 * ⭐ STRIP GAP (CANVAS #85 5943987710): on a withheld Run the egress NULLED `run_delta.leader.{prior,current}_leading_
 * option_id`, which the contract types optional + non-nullable, so the UI quarantined the whole `run_delta` and the
 * strip and Compare went empty. Served bytes: CEE 03763318, the run turn of Paul's step 10. The ids are restored from
 * that guest's cold read (`current_read.run_delta.leader`: integration_bug_fix_sprint) to make the egress INPUT.
 */
describe('the final egress never adds a contract violation (served 03763318 withheld Run)', () => {
  const SERVED_RUN = (JSON.parse(readFileSync(join(here, 'fixtures/served-withheld-run-03763318.json'), 'utf8')) as { body: Record<string, any> }).body;
  const ID = 'integration_bug_fix_sprint';
  /** C0 = as served; C1 = the same pair with a changed hash (the schema's own C1 entitlement); C2 = unpaired. */
  const input = (attribution: 'C0_identical' | 'C1_attributable' | 'C2_unpaired' = 'C0_identical'): Record<string, any> => {
    const b = structuredClone(SERVED_RUN);
    b.run_delta.leader = { ...b.run_delta.leader, prior_leading_option_id: ID, current_leading_option_id: ID };
    b.run_delta.attribution_case = attribution;
    if (attribution === 'C1_attributable') b.run_delta.pair_provenance = { ...b.run_delta.pair_provenance, hash_equal: false };
    return b;
  };
  const egress = (b: Record<string, any>) => enforceLeaderLicenceAtFinalEgress(b as unknown as OlumiResponse, {
    requestId: 'req-strip', exitPath: 'test', licence: 'withheld', mayNameLeadingOption: false, graph: b.draft_graph, analysisReady: b.analysis_ready,
  }).response as unknown as Record<string, any>;
  const issues = (b: unknown) => {
    const r = OlumiResponseSchema.safeParse(b);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}|${i.code}`).sort();
  };

  it.each(['C0_identical', 'C1_attributable', 'C2_unpaired'] as const)('RED (%s): run_delta survives the withheld egress AND parses — the leader ids are absent, every other member kept', (attribution) => {
    const before = input(attribution);
    expect(RunDeltaSchema.safeParse(before.run_delta).success, 'control: the input run_delta parses').toBe(true);
    const out = egress(before);
    expect(RunDeltaSchema.safeParse(out.run_delta).success, JSON.stringify(out.run_delta?.leader)).toBe(true);
    expect(out.run_delta.leader).not.toHaveProperty('prior_leading_option_id');
    expect(out.run_delta.leader).not.toHaveProperty('current_leading_option_id');
    expect(JSON.stringify(out.run_delta.leader), 'no leader designation (option rows follow F1b\'s licences, not this scrub)').not.toContain(ID);
    const { leader: _a, ...restIn } = before.run_delta; const { leader: _b, ...restOut } = out.run_delta;
    expect(restOut, 'the delta the strip and Compare read is kept').toEqual(restIn);
  });

  it('SPEC: the egress output has no contract issue its input did not have (whole OlumiResponseSchema)', () => {
    const before = input();
    expect(issues(egress(before)).filter((i) => !issues(before).includes(i))).toEqual([]);
  });

  it('CONTROL: a required + nullable key keeps null — the analysis_result block\'s leading_option_id', () => {
    const before = input();
    const i = before.blocks.findIndex((x: { type?: string }) => x.type === 'analysis_result');
    expect(i, 'control: the served turn carries the analysis block').toBeGreaterThanOrEqual(0);
    before.blocks[i] = { ...before.blocks[i], leading_option_id: ID };
    const out = egress(before);
    expect(out.blocks[i]).toHaveProperty('leading_option_id', null);
    expect(AnalysisResultBlockSchema.safeParse(out.blocks[i]).success).toBe(true);
  });
});
