/**
 * ⭐ B RESTATED GOAL — PAUL'S MARKETING L20 ON THE SERVED EARLY DRAFT (DL ruling (B); PL 6116779075; AIE 0244).
 *
 * The draft is the SERVED one (`fixtures/marketing-020148Z-draft-before-L20.json`: the read before L20 on run 020148Z,
 * graph and brief verbatim; the construction's commit turn id is the database's own row). It models "product feature
 * launch" in "% complete" and holds neither conversion nor new customers, so L20's two targets cannot land as rows.
 *
 * What runs for real: the capability (`propose_goal_target` → the gates → C's construction in prepare-only mode →
 * admission → the card → `authorise_change` → `/graph/register` with compare-and-set), the approval chip, the store's
 * contract parse, and the production Run loader and handler that build the PLoT request. What is scripted: the drafter's
 * words (`candidate`, written by hand like C's readback spec, so this is TESTED, not WIRE-WITNESSED) and the store
 * (in memory, with the register route's compare-and-set and operation-id replay rules, and its committed turn ledger).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createAgentCapabilities, draftGateDetail, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { humanMaterialAfterTheDraft } from '../runtime/draft-replacement.js';
import { isAllowedRunAnalysisAssistantText } from '../../coaching/analysis-result-headline.js';
import { agentLicenceRecordOf, goalChanceLicenceForAgent } from '../../goal-target/goal-chance-licence.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import { retainedLimitOnlyNodeIds, RETAINED_LIMIT_QUANTITY_WITHHELD } from '../../../graph/retained-limit.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { constructionOperationId, type CallStructuredModel } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { sentDigest } from '../../tools/handlers/run-input-snapshot.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { CommittedTurnLedger } from '../../session/store.js';

// The drafter-raw recorder writes its own table; it is a recorder, not logic, so it passes the build straight through.
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/marketing-020148Z-draft-before-L20.json', import.meta.url), 'utf8')) as {
  scenario_id: string; brief_text: string; graph_hash: string; graph_identity_hash: string; graph: Rec;
  l1: { turn_id: string; message: string }; l20: { turn_id: string; message: string }; construction_commit_turn_id: string;
};
const CAPTURE_1318 = JSON.parse(readFileSync(new URL('./fixtures/marketing-131858Z-run-state.json', import.meta.url), 'utf8')) as Rec;
const SID = FX.scenario_id;
const L20 = FX.l20.message;

/**
 * The drafter's answer for the brief + L20 (hand-written, C's readback candidate plus L1's own time limit): the goal is
 * at least 20 new customers over the first three months after launch, conversion above 15% is its second target, and
 * the brief's £100,000-a-year budget and 25%-of-time limits are kept.
 */
const candidate = (): Rec => ({
  goal: { metric: 'New customers', operator: '>=', target_stated: true, value: 20, unit: 'customers', horizon_months: null, provenance: 'explicit',
    frame: 'level', quantity_frame: 'level', baseline_known: true, baseline_value: 0, baseline_provenance: 'explicit', scope: null,
    basis: { reference: 'launch', denominator: null, period_months: 3, period_kind: 'over_period',
      effect_unit: 'customers, or percentage points of conversion, over the first three months after launch', effects_at_period_end: true,
      also_required: null, open_question: null } },
  constraints: [
    { metric: 'Conversion rate', operator: '>', value: 15, unit: '%', provenance: 'explicit', frame: 'level', role: 'target' },
    { metric: 'Annual marketing spend', operator: '<=', value: 100000, unit: 'GBP/year', provenance: 'explicit', frame: 'level', role: 'limit' },
    { metric: 'Founder marketing time', operator: '<=', value: 25, unit: '%', provenance: 'explicit', frame: 'level', role: 'limit' },
  ],
  options: [
    { label: 'Hire a marketing manager', provenance: 'explicit', interventions: [
      { factor_label: 'Marketing manager hired', value: 1, unit: 'people', provenance: 'explicit' },
      { factor_label: 'Annual marketing spend', value: 90000, unit: 'GBP/year', provenance: 'ai_proposed' }] },
    { label: 'AI planning plus advertising', provenance: 'explicit', interventions: [
      { factor_label: 'Advertising spend', value: 60000, unit: 'GBP/year', provenance: 'ai_proposed' },
      { factor_label: 'Annual marketing spend', value: 70000, unit: 'GBP/year', provenance: 'ai_proposed' }] },
  ],
  factors: [
    { label: 'Marketing manager hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 3 },
    { label: 'Advertising spend', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP/year', provenance: 'explicit', plausible_max: 100000 },
    { label: 'Annual marketing spend', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP/year', provenance: 'explicit', plausible_max: 200000 },
    { label: 'Founder marketing time', role: 'controllable', baseline_known: false, baseline_value: 10, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    { label: 'Conversion rate', role: 'observable', baseline_known: false, baseline_value: 10, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
  ],
  risks: [], outcomes: [],
  links: [
    { from: 'Marketing manager hired', to: 'Conversion rate', direction: 'positive', provenance: 'ai_proposed', effect_amount: 4,
      effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null, basis: 'A specialist improves targeting.' },
    { from: 'Advertising spend', to: 'Conversion rate', direction: 'positive', provenance: 'ai_proposed', effect_amount: 2,
      effect_per_source_change: 50000, effect_provenance: 'ai_proposed', definitional: null, basis: 'More reach brings warmer leads.' },
    { from: 'Conversion rate', to: 'New customers', direction: 'positive', provenance: 'ai_proposed', effect_amount: 2,
      effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null, basis: 'Each point of conversion adds customers.' },
    { from: 'Founder marketing time', to: 'Conversion rate', direction: 'positive', provenance: 'ai_proposed', effect_amount: 1,
      effect_per_source_change: 10, effect_provenance: 'ai_proposed', definitional: null, basis: 'Founder attention sharpens the message.' },
  ],
  identities: [], unknowns: [], decision_question: null,
});

/** The in-memory store: the read route, the register route's compare-and-set and replay rules, and the committed turn ledger. */
function server(opts: { graph?: Rec; ledger?: Partial<CommittedTurnLedger>; ledgerFails?: boolean; afterCommit?: (g: Rec) => void;
  /** A route that stores something other than the approved candidate, and acknowledges what it stored (AIE B34). */
  beforeAck?: (stored: Rec) => void } = {}) {
  let graph: Rec = structuredClone(opts.graph ?? FX.graph);
  const commits: { turn_id: string; bytes: string }[] = [];
  const ledger = {
    write_turn_ids: [FX.construction_commit_turn_id], user_message_turn_ids: [FX.l1.turn_id],
    first_user_message: FX.l1.message.trim(), complete: true, ...opts.ledger,
  } as { write_turn_ids: string[]; user_message_turn_ids: string[]; first_user_message: string | null; complete: boolean };
  const identity = () => computeGraphIdentityHash(graph as never)!.value;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SID}/graph`) {
      return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), brief_text: FX.brief_text,
        graph_identity_hash: computeGraphIdentityHash(graph as never) } };
    }
    if (path === `/assist/v1/scenarios/${SID}/graph/register`) {
      const b = body as { graph: Rec; expected_graph_hash?: unknown; expected_graph_identity_hash?: unknown; operation_id?: string };
      const stored = GraphV3.parse(b.graph) as Rec;
      opts.beforeAck?.(stored);
      const bytes = JSON.stringify(stored);
      const turn = registrationTurnId(SID, b.operation_id);
      const prior = commits.find((c) => c.turn_id === turn);
      if (prior !== undefined) {
        return prior.bytes === bytes ? { status: 200, json: { registered: true, replayed: true } }
          : { status: 409, json: { details: { code: 'OPERATION_ID_REUSED' } } };
      }
      // Both of the route's CAS checks: the analysis-space hash and the identity.
      if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(graph as never)
        || b.expected_graph_identity_hash !== identity()) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = stored;
      commits.push({ turn_id: turn, bytes });
      ledger.write_turn_ids.push(turn);
      // The route's acknowledgement names the bytes it stored (`assist.v1.scenario-graph-register.ts`: graph_identity_hash).
      const acknowledged = computeGraphIdentityHash(stored as never);
      opts.afterCommit?.(graph);
      return { status: 200, json: { registered: true, graph_identity_hash: acknowledged } };
    }
    return { status: 404, json: {} };
  };
  return {
    dispatch, commits, ledger,
    graph: () => graph,
    bytes: () => JSON.stringify(graph),
    readCommittedTurnLedger: async (): Promise<CommittedTurnLedger> => {
      if (opts.ledgerFails) throw new Error('turn_ledger_read_failed');
      return structuredClone(ledger);
    },
    /** A turn's answer row lands (its user message, whatever its origin). */
    said: (turnId: string) => { ledger.user_message_turn_ids.push(turnId); },
    /** Another writer moves the model. */
    move: (mutate: (g: Rec) => void) => { mutate(graph); },
  };
}

function lane(s: ReturnType<typeof server>, proposals = new ProposalStore(), draft: () => Rec = candidate) {
  let drafted = 0;
  const call = (async () => { drafted += 1; return { text: JSON.stringify(draft()) }; }) as unknown as CallStructuredModel;
  const caps = createAgentCapabilities(s.dispatch, proposals, call, 'full', undefined, {
    readCommittedTurnLedger: s.readCommittedTurnLedger,
    readStatedObjections: async () => [],
  });
  return { caps, proposals, drafts: () => drafted };
}

const l20Turn = { scenario_id: SID, authenticated_user_id: null, request_id: 'req-l20', turn_id: FX.l20.turn_id,
  user_turn_text: L20, user_text: `${FX.l1.message}\n${L20}` };
const conversion = { constraint_type: 'at_least', value: 15, unit: '%', measures: 'conversion rate', rationale: L20 };
const customers = { constraint_type: 'at_least', value: 20, unit: 'customers', measures: 'new customers', rationale: L20 };
const pressed = (proposalId: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'req-approve',
  turn_id: 'approve-turn-0001', user_turn_text: '', user_text: `${FX.l1.message}\n${L20}`, typed_approval_of: proposalId });

/** The production Run loader and handler over the stored bytes: the exact PLoT request and its Run-input record. */
async function runFromStore(bytes: string, complete = false, recorded?: Rec): Promise<{ payload: Rec; snapshot: Rec; outcome: Rec }> {
  const port = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: recorded?.brief_text ?? FX.brief_text, revision: 2 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const snap = await loadScenarioSnapshotForRunAnalysis(SID, 'req-run', port as never);
  let payload: Rec | undefined;
  let inputSnapshot: Rec | undefined;
  const handler = createRunAnalysisHandler({
    plotClient: { run: vi.fn(async (sent: Rec) => {
      payload = structuredClone(sent);
      if (recorded !== undefined) return { ...structuredClone(recorded.enrichment), analysis_status: 'computed', response_hash: 'captured-131858Z', meta: { seed_used: 42, n_samples: 1000 } };
      const results = sent.options.map((o: Rec, i: number) => ({ option_id: o.id, option_label: o.label,
        win_probability: i === 0 ? 0.7 : 0.3, probability_of_goal: 0.8, probability_of_joint_goal: 0.7,
        probability_of_joint_goal_precision: { n: 1000, standard_error: 0.01 },
        outcome: { mean: 20, p10: 15, p50: 20, p90: 25 },
        constraint_probabilities: Object.fromEntries(sent.goal_constraints.map((c: Rec) => [c.constraint_id, 0.9])) }));
      return { analysis_status: 'computed', response_hash: 'm1b-scripted-engine',
        meta: { seed_used: 42, n_samples: 1000 }, results, option_comparison: results,
        constraint_results: sent.goal_constraints.map((c: Rec) => ({ constraint_id: c.constraint_id, decision_grade: true })),
        constraints_status: 'computed', constraint_analysis: { joint_probability: 0.7 }, robustness: { level: 'moderate' } };
    }), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snap,
    ...(complete ? {} : { probe: async (sent: { plotPayload: unknown; runInputSnapshot: unknown }) => { payload = sent.plotPayload as Rec; inputSnapshot = sent.runInputSnapshot as Rec; } }),
  });
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SID, request_id: 'req-run', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SID, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
  } as never);
  expect(payload, 'the Run handler built a PLoT request').toBeDefined();
  return { payload: payload!, snapshot: inputSnapshot ?? {}, outcome };
}

// M1: exact base goal_constraints from marketing/turns/02.json (2026-10-12T172858Z).
// Other base graph/ledger scaffolding remains the existing served L20 fixture.
const capturedLimits = [
  {
    "unit": "£/year",
    "label": "Annual campaign spend",
    "value": 100000,
    "node_id": "annual_campaign_spend",
    "operator": "<=",
    "provenance": "explicit",
    "value_frame": "level",
    "constraint_id": "agent-lane:annual_campaign_spend:<="
  },
  {
    "unit": "%",
    "label": "Founder time on campaign",
    "value": 25,
    "node_id": "founder_time_on_campaign",
    "operator": "<=",
    "provenance": "explicit",
    "value_frame": "level",
    "constraint_id": "agent-lane:founder_time_on_campaign:<="
  }
];
const marketingBase = (): Rec => {
  const g = JSON.parse(JSON.stringify(FX.graph)
    .replaceAll('annual_marketing_spend', 'annual_campaign_spend')
    .replaceAll('Annual marketing spend', 'Annual campaign spend')
    .replaceAll('founder_marketing_time', 'founder_time_on_campaign')
    .replaceAll('Founder marketing time', 'Founder time on campaign')) as Rec;
  g.goal_constraints = structuredClone(capturedLimits);
  return g;
};

// Drafter goal/target/limits verbatim from a5ada94b as recorded in DIAGNOSIS §1–2.
// The remaining construction scaffold is scripted, not a fresh provider response.
const marketingCandidate = (): Rec => {
  const c = JSON.parse(JSON.stringify(candidate())
    .replaceAll('New customers', 'New customers in first 3 months')
    .replaceAll('Conversion rate', 'conversion rate')
    .replaceAll('Annual marketing spend', 'Annual campaign spend')) as Rec;
  c.goal = { ...c.goal, metric: 'conversion rate', operator: '>', value: 15, unit: '%',
    baseline_known: false, baseline_value: null,
    basis: { ...c.goal.basis, reference: 'launch', period_months: 3, effects_at_period_end: false,
      also_required: ['secure 20 new customers within the first 3 months'] } };
  c.constraints[0] = { metric: 'New customers in first 3 months', operator: '>=', value: 20,
    unit: 'customers', provenance: 'explicit', frame: 'level', role: 'target' };
  c.factors = c.factors.filter((f: Rec) => f.label !== 'conversion rate');
  c.outcomes = [{ label: 'New customers in first 3 months', unit: 'customers', provenance: 'explicit' }];
  return c;
};

const marketingCard = 'Replace the early draft with a revised one built from your brief and the goal you just gave: '
  + '‘conversion rate’ above 15% and ‘New customers in first 3 months’ at least 20 customers over the first 3 months after launch '
  + '(the draft modelled ‘product feature launch’). '
  + 'Limits in the revised draft: ‘Annual campaign spend’ at most £100,000 / year; ‘Founder marketing time’ at most 25%. '
  + 'Previous: ‘Founder time on campaign’ at most 25%; proposed: ‘Founder marketing time’ at most 25%. '
  + 'Do these describe the same limit? Both are retained unless you explicitly ask to remove one. '
  + 'The result for the full goal, including the joint chance with its limits, is withheld while the earlier and proposed limits have not been confirmed to describe the same quantity. Both limits remain recorded. '
  + 'Options: ‘Hire a marketing manager’, ‘AI planning plus advertising’. '
  + 'Earlier nodes needed by carried limits are kept; other estimates and links from Olumi are drafted afresh. '
  + 'Check the targets, limits and options on this card before choosing.';

const cardStart = 'Replace the early draft with a revised one built from your brief and the goal you just gave: '
  + '‘New customers’ at least 20 customers and ‘Conversion rate’ above 15% over the first 3 months after launch '
  + '(the draft modelled ‘product feature launch’). ';
const carriedCardEnd = 'Options: ‘Hire a marketing manager’, ‘AI planning plus advertising’. '
  + 'Earlier nodes needed by carried limits are kept; other estimates and links from Olumi are drafted afresh. '
  + 'Check the targets, limits and options on this card before choosing.';
const omissionCard = cardStart
  + 'Limits in the revised draft: ‘Annual marketing spend’ at most £100,000 / year. '
  + 'Carried forward unchanged because the draft omitted it: ‘Founder marketing time’ at most 25%. ' + carriedCardEnd;
const uncertainCard = cardStart
  + 'Limits in the revised draft: ‘Annual marketing spend’ at most £100,000 / year; ‘Advertising time’ at most 25%. '
  + 'Previous: ‘Founder marketing time’ at most 25%; proposed: ‘Advertising time’ at most 25%. '
  + 'Do these describe the same limit? Both are retained unless you explicitly ask to remove one. '
  + 'The result for the full goal, including the joint chance with its limits, is withheld while the earlier and proposed limits have not been confirmed to describe the same quantity. Both limits remain recorded. ' + carriedCardEnd;

const pendingLimit = (previous: Rec, proposedId: string): Rec => ({ ...previous, retained_unresolved_limit: {
  state: 'unscored', role: 'original', reason: 'retained_limit_equivalence_unresolved', previous_constraint_id: previous.constraint_id,
  proposed_constraint_ids: [proposedId], question: 'Do these describe the same limit?',
} });

const withheldReason = 'The result for the full goal, including the joint chance with its limits, is withheld while the earlier and proposed limits have not been confirmed to describe the same quantity. Both limits remain recorded.';
function assertUnresolvedRun(outcome: Rec, rows: Rec[]) {
  const reason = rows.some((r) => r.retained_unresolved_limit?.reason === 'retained_limit_quantity_unresolved')
    ? RETAINED_LIMIT_QUANTITY_WITHHELD : withheldReason;
  expect(outcome.assistant_text).toBe(reason);
  const fact = outcome.handler_facts[0];
  expect(fact.result.summary).toBe(reason);
  expect(fact.result.constraint_verdict.may_name_leading_option).toBe(false);
  expect(fact.result.constraint_verdict.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored',
    constraint_ids: expect.arrayContaining(rows.filter((r) => r.retained_unresolved_limit).map((r) => r.constraint_id)) });
  expect(buildAnalysisResultBlock(fact).summary).toBe(reason);
  const enrichment = fact.result.enrichment;
  expect(enrichment.constraint_analysis?.joint_probability).toBeUndefined();
  expect(enrichment.joint_withheld).toEqual({ reason: 'limit_unscored',
    constraint_ids: rows.filter((r) => r.retained_unresolved_limit).map((r) => r.constraint_id) });
  for (const result of enrichment.option_comparison) {
    expect(result.probability_of_joint_goal).toBeUndefined();
    expect(result.probability_of_goal).toBeUndefined();
    expect(result.win_probability).toBeUndefined();
    for (const row of rows.filter((r) => r.retained_unresolved_limit)) {
      expect(result.constraint_probabilities[row.constraint_id]).toBeUndefined();
    }
  }
}

async function expectStoredRunAndReopen(s: ReturnType<typeof server>, rows: Rec[]) {
  expect(s.graph().goal_constraints).toEqual(rows);
  expect(JSON.parse(s.commits[0]!.bytes).goal_constraints).toEqual(rows);
  const wire = rows.map(({ role: _role, operator_as_stated, ...row }) => {
    const sent: Rec = { ...row, operator: operator_as_stated ?? row.operator };
    if (row.retained_unresolved_limit !== undefined) delete sent.value_frame;
    return sent;
  });
  const complete = rows.some((r) => r.retained_unresolved_limit !== undefined);
  const { payload, outcome } = await runFromStore(s.bytes(), complete);
  expect(payload.goal_constraints).toEqual(wire);
  if (complete) {
    assertUnresolvedRun(outcome, rows);
    const licence = goalChanceLicenceForAgent(outcome.handler_facts[0].result);
    expect(agentLicenceRecordOf(outcome.handler_facts[0].result)?.pct_by_option).toEqual({});
    expect(licence?.targets?.conditions.map((c) => c.constraint_id)).toEqual(rows.map((r) => r.constraint_id));
    expect(licence?.targets?.joint.status).toBe('withheld');
    expect(JSON.stringify(licence)).not.toMatch(/Run the analysis again|Run again/);
    expect(licence?.targets?.conditions.filter((c) => c.role === 'target').every((c) => c.clause.endsWith('over the first three months after launch'))).toBe(true);
    expect(licence?.notes?.some((n) => n.includes('retained') || n.includes('limits'))).toBe(true);
  }
  if (complete && rows.some((r) => r.node_id === 'founder_time_on_campaign') && process.env.M1B_EVIDENCE_DIR) {
    writeFileSync(`${process.env.M1B_EVIDENCE_DIR}/marketing-run.json`, JSON.stringify({ constraints: payload.goal_constraints, outcome }, null, 2));
  }
  // Fresh store adapter and production scenario loader: no reuse of the capability's in-memory graph.
  const reopened = server({ graph: GraphV3.parse(JSON.parse(s.commits[0]!.bytes)) });
  expect(reopened.graph().goal_constraints).toEqual(rows);
  const next = await runFromStore(reopened.bytes(), complete);
  expect(next.payload.goal_constraints).toEqual(wire);
  if (complete) assertUnresolvedRun(next.outcome, rows);
}

describe('MA2 original 13:18Z evidence, kept separate from the scripted revised-draft continuation', () => {
  it('replays the captured saved old model through Run: both exact unscored-limit reasons persist, and no absent AND target is invented', async () => {
    const { payload, outcome } = await runFromStore(JSON.stringify(CAPTURE_1318.graph), true, CAPTURE_1318);
    expect(payload.goal_constraints).toEqual(CAPTURE_1318.graph.goal_constraints);
    expect(outcome.handler_facts[0].result.constraint_verdict.per_limit).toEqual(CAPTURE_1318.limit_verdicts.per_limit);
    expect(goalChanceLicenceForAgent(outcome.handler_facts[0].result)).toBeUndefined();
    expect(CAPTURE_1318.graph.nodes.filter((n: Rec) => n.kind === 'goal').map((n: Rec) => n.label)).toEqual(['Product feature launch']);
    expect(CAPTURE_1318.graph.goal_constraints.filter((c: Rec) => c.role === 'goal_target')).toEqual([]);
  });
});

describe('M1 captured marketing limit spellings through revised-draft offer and approval', () => {
  it('offers both captured targets and limits through approval, saved postimage, Run and cold reopen', async () => {
    const s = server({ graph: marketingBase() });
    const { caps } = lane(s, new ProposalStore(), marketingCandidate);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    expect(offer.public_label).toBe(marketingCard);
    expect(s.commits).toHaveLength(0);
    s.said(FX.l20.turn_id);
    const applied = await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never);
    expect(applied).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(s.commits).toHaveLength(1);
    const expectedRows: Rec[] = [
      { constraint_id: 'agent-lane:conversion_rate:>=', node_id: 'conversion_rate', operator: '>=', operator_as_stated: '>',
        value: 15, label: 'conversion rate', unit: '%', provenance: 'explicit', value_frame: 'level', role: 'goal_target' },
      { constraint_id: 'agent-lane:new_customers_in_first_3_months:>=', node_id: 'new_customers_in_first_3_months', operator: '>=',
        value: 20, label: 'New customers in first 3 months', unit: 'customers', provenance: 'explicit', value_frame: 'level', role: 'goal_target' },
      { constraint_id: 'agent-lane:annual_campaign_spend:<=', node_id: 'annual_campaign_spend', operator: '<=',
        value: 100000, label: 'Annual campaign spend', unit: 'GBP/year', provenance: 'explicit', value_frame: 'level' },
      { constraint_id: 'agent-lane:founder_marketing_time:<=', node_id: 'founder_marketing_time', operator: '<=',
        value: 25, label: 'Founder marketing time', unit: '%', provenance: 'explicit', value_frame: 'level' },
    ];
    expectedRows.push(pendingLimit(capturedLimits[1]!, 'agent-lane:founder_marketing_time:<='));
    await expectStoredRunAndReopen(s, expectedRows);
  });
});

describe('M1b retained-limit disclosure reaches the Run text forwarder', () => {
  it('admits the exact truthful withheld reason; never arbitrary added prose', () => {
    expect(isAllowedRunAnalysisAssistantText(withheldReason)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText(withheldReason + ' You should choose the winner.')).toBe(false);
  });
});

describe('M1b connectivity exception is only for a question-bound retained limit', () => {
  it('question identity, sole role and currentness stay bound to the saved rows', async () => {
    const { caps, proposals } = lane(server({ graph: marketingBase() }), new ProposalStore(), marketingCandidate);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    const g = (proposals.get(offer.proposal_id as string)!.operations[0]!.value as Rec).candidate;
    expect([...retainedLimitOnlyNodeIds(g)]).toEqual(['founder_time_on_campaign']);
    const unmarked = structuredClone(g);
    delete unmarked.goal_constraints.find((r: Rec) => r.node_id === 'founder_time_on_campaign').retained_unresolved_limit;
    expect([...retainedLimitOnlyNodeIds(unmarked)]).toEqual([]);
    expect(computeAnalysisAffectingGraphHash(unmarked as never)).not.toBe(computeAnalysisAffectingGraphHash(g as never));
    const missingQuestionPartner = structuredClone(g);
    missingQuestionPartner.goal_constraints = missingQuestionPartner.goal_constraints.filter((r: Rec) => r.node_id !== 'founder_marketing_time');
    expect([...retainedLimitOnlyNodeIds(missingQuestionPartner)]).toEqual([]);
    const linked = structuredClone(g);
    linked.edges.push({ from: 'founder_time_on_campaign', to: 'conversion_rate' });
    expect([...retainedLimitOnlyNodeIds(linked)]).toEqual([]);
    const set = structuredClone(g);
    set.nodes.find((n: Rec) => n.kind === 'option').interventions.founder_time_on_campaign = { value: 10 };
    expect([...retainedLimitOnlyNodeIds(set)]).toEqual([]);
  });

  it('an ordinary disconnected factor still refuses with ORPHAN_NODE', async () => {
    const s = server();
    const { caps, proposals } = lane(s);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    const g = structuredClone((proposals.get(offer.proposal_id as string)!.operations[0]!.value as Rec).candidate);
    g.nodes.push({ id: 'ordinary_orphan', kind: 'factor', label: 'Ordinary orphan', category: 'observable',
      observed_state: { value: 10, unit: '%' } });
    expect(validateGraphStructure(g as never).violations.filter((v) => v.code === 'ORPHAN_NODE').map((v) => v.factor_id))
      .toEqual(['ordinary_orphan']);
    await expect(runFromStore(JSON.stringify(g))).rejects.toThrow('ORPHAN_NODE');
  });
});

describe('the served draft and its record (preconditions, else nothing below proves anything)', () => {
  it('the draft holds neither quantity; its goal is "% complete"; the construction commit id is derived from the stored brief', () => {
    const labels = (FX.graph.nodes as Rec[]).map((n) => String(n.label).toLowerCase());
    expect(labels.some((l) => l.includes('conversion') || l.includes('customer'))).toBe(false);
    expect((FX.graph.nodes as Rec[]).find((n) => n.kind === 'goal')).toMatchObject({ id: 'product_feature_launch', goal_threshold_unit: '% complete' });
    // The database's own row for this scenario, against the lane's derivation from the stored brief.
    expect(registrationTurnId(SID, constructionOperationId(SID, FX.brief_text))).toBe(FX.construction_commit_turn_id);
    expect(FX.brief_text).toBe(FX.l1.message.trim());
  });
});

describe('L20 on the served early draft: ONE revised-draft card, prepared once, nothing written', () => {
  it('RED: both target calls (and a retried call) return the same card; the drafter ran once; the model is untouched', async () => {
    const s = server();
    const { caps, proposals, drafts } = lane(s);
    const a = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    // One preparation is one construction: its drafter call (E6, in the B combine, parks the draft-time widening call).
    const preparation = drafts();
    expect(preparation).toBe(1);
    const b = await caps.proposeGoalTarget!(l20Turn, customers as never);
    const again = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect([b.proposal_id, again.proposal_id]).toEqual([a.proposal_id, a.proposal_id]);
    expect(drafts(), 'the other target and the retry prepare nothing').toBe(preparation);
    expect(a.revised_draft).toEqual({ replaces_goal: 'product feature launch', holds_this_target: true });
    expect(b.revised_draft).toEqual({ replaces_goal: 'product feature launch', holds_this_target: true });
    expect(s.commits).toHaveLength(0);
    expect(s.bytes()).toBe(JSON.stringify(FX.graph));
    // The card is the candidate's own words: both targets, their window, both limits kept, the options, what is not carried.
    expect(a.public_label).toBe('Replace the early draft with a revised one built from your brief and the goal you just gave: '
      + '‘New customers’ at least 20 customers and ‘Conversion rate’ above 15% over the first 3 months after launch '
      + '(the draft modelled ‘product feature launch’). '
      + 'Limits in the revised draft: ‘Annual marketing spend’ at most £100,000 / year; ‘Founder marketing time’ at most 25%. '
      + 'Options: ‘Hire a marketing manager’, ‘AI planning plus advertising’. '
      + 'Not carried: Olumi’s earlier estimates and links, which are drafted afresh. Check the targets, limits and options on this card before choosing.');
    // ONE chip, the card's own button, and the card rides in its detail.
    const calls = [a, b, again].map((r) => ({ name: 'propose_goal_target', ok: r.ok, mutated: false, proposal_id: r.proposal_id as string }));
    const chips = approvalChipsFor(calls, (id) => ({ proposal: proposals.get(id), result: a }));
    expect(chips[0]).toMatchObject({ label: 'Use the revised draft', message: 'Yes, use the revised draft.', detail: a.public_label });
  });

  it('a single restated target offers the revised draft too', async () => {
    const { caps } = lane(server());
    const r = await caps.proposeGoalTarget!(l20Turn, customers as never);
    expect(r).toMatchObject({ ok: true, revised_draft: { holds_this_target: true } });
  });
});

describe('approve → save → Run → cold reopen, on the same model', () => {
  it('RED: pressing the card writes the candidate once, both target rows with the strict ">", both limits kept; the Run sends them; reopening sends the same', async () => {
    const s = server();
    const { caps } = lane(s);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    await caps.proposeGoalTarget!(l20Turn, customers as never);
    s.said(FX.l20.turn_id);
    const hashBefore = computeAnalysisAffectingGraphHash(s.graph() as never);
    const applied = await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(s.commits).toHaveLength(1);
    // The old analysis was of another model: its hash no longer matches.
    expect(computeAnalysisAffectingGraphHash(s.graph() as never)).not.toBe(hashBefore);
    const rows = s.graph().goal_constraints as Rec[];
    expect(rows.find((r) => r.node_id === 'conversion_rate')).toMatchObject({ operator: '>=', operator_as_stated: '>', value: 15, unit: '%', role: 'goal_target' });
    expect(rows.find((r) => r.node_id === 'new_customers')).toMatchObject({ operator: '>=', value: 20, unit: 'customers', role: 'goal_target' });
    expect(rows.find((r) => r.node_id === 'annual_marketing_spend')).toMatchObject({ operator: '<=', value: 100000, unit: 'GBP/year' });
    expect(rows.find((r) => r.node_id === 'founder_marketing_time')).toMatchObject({ operator: '<=', value: 25, unit: '%' });
    expect(rows.filter((r) => r.role !== 'goal_target').every((r) => r.role === undefined)).toBe(true);
    const goal = (s.graph().nodes as Rec[]).find((n) => n.kind === 'goal')!;
    expect(goal.goal_target_basis).toMatchObject({ reference: 'launch', period_months: 3, period_kind: 'over_period' });

    // Run: the PLoT request carries both targets (strict ">" for conversion) and both limits as explicit rows.
    const { payload } = await runFromStore(s.bytes());
    const sent = payload.goal_constraints as Rec[];
    expect(sent.find((r) => r.node_id === 'conversion_rate')).toMatchObject({ operator: '>', value: 15, value_frame: 'level' });
    expect(sent.find((r) => r.node_id === 'new_customers')).toMatchObject({ operator: '>=', value: 20, value_frame: 'level' });
    expect(sent.find((r) => r.node_id === 'annual_marketing_spend')).toMatchObject({ operator: '<=', value: 100000 });
    expect(sent.find((r) => r.node_id === 'founder_marketing_time')).toMatchObject({ operator: '<=', value: 25 });

    // Cold reopen: the stored bytes through the contract parse again are the same, and so is the Run request.
    const reopened = JSON.stringify(GraphV3.parse(JSON.parse(s.bytes())));
    expect(reopened).toBe(s.bytes());
    expect(sentDigest((await runFromStore(reopened)).payload)).toBe(sentDigest(payload));
  });

  it('a retried press writes nothing twice: the same process recovers it; a fresh process meets the moved base', async () => {
    const s = server();
    const proposals = new ProposalStore();
    const { caps } = lane(s, proposals);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    s.said(FX.l20.turn_id);
    const id = offer.proposal_id as string;
    await caps.authoriseChange(pressed(id), { proposal_id: id } as never);
    const retried = await caps.authoriseChange(pressed(id), { proposal_id: id } as never);
    expect(retried).toMatchObject({ ok: true, already_applied: true, mutated: false });
    const fresh = new ProposalStore();
    fresh.put(proposals.get(id)!);
    const elsewhere = await lane(s, fresh).caps.authoriseChange(pressed(id), { proposal_id: id } as never);
    expect(elsewhere).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(s.commits).toHaveLength(1);
  });
});

/** AIE 6128697025 (row 10), verbatim: said whenever a target's quantity is not on the canvas, then what is missing. */
const AIE_NOT_HELD = 'This goal change was not applied. The model needs quantities or conditions it does not yet hold, and this route cannot add them without replacing your saved work.';

describe('the gates refuse, and nothing is drafted or written', () => {
  // Marketing's turn-2 request (L20): neither conversion nor new customers is on the canvas, so the canvas step does not
  // exist; the AIE's words name what is missing, from the call's own target. The gate's findings are no longer said
  // (the AIE's sentence replaces them): each row below changes ONE input from the CONTROL, which is offered.
  const refusedAtOffer = async (s: ReturnType<typeof server>) => {
    const { caps, drafts } = lane(s);
    const r = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'draft_holds_your_work' });
    expect(String(r.detail)).toBe(`${AIE_NOT_HELD} Missing: \u2018conversion rate\u2019 above 15%.`);
    expect(drafts()).toBe(0);
    expect(s.commits).toHaveLength(0);
  };

  it('CONTROL: the untouched state is offered the revised-draft card, so each refusal below is its one changed input', async () => {
    const r = await lane(server()).caps.proposeGoalTarget!(l20Turn, conversion as never);
    expect(r).toMatchObject({ ok: true, mutated: false });
    expect(typeof r.proposal_id).toBe('string');
  });

  it('G2: one saved edit since the draft (a UI edit\'s commit row, as on this scenario at 02:18:35Z) refuses', async () => {
    await refusedAtOffer(server({ ledger: { write_turn_ids: [FX.construction_commit_turn_id, 'd920b614-9d04-413f-a047-dab6bcf807ac'] } }));
  });

  it('G1: a reviewed Olumi estimate refuses (an adopted figure is the user\'s act, whatever its number)', async () => {
    const g = structuredClone(FX.graph);
    const f = (g.nodes as Rec[]).find((n) => n.id === 'advertising_spend')!;
    f.observed_state = { ...f.observed_state, source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } };
    expect(humanMaterialAfterTheDraft(g)).toEqual(['your review of the value for \u2018Advertising spend\u2019']);
    await refusedAtOffer(server({ graph: g }));
  });

  it('G3: a message between the brief and this turn refuses, typed or chip alike', async () => {
    await refusedAtOffer(server({ ledger: { user_message_turn_ids: [FX.l1.turn_id, 'chip-turn-run-analysis'] } }));
  });

  it('an omission carries the founder-time row forward unchanged through approval, Run and reopen', async () => {
    const s = server();
    const losesTime = () => {
      const c = candidate();
      c.constraints = c.constraints.filter((x: Rec) => x.metric !== 'Founder marketing time');
      return c;
    };
    const { caps, proposals } = lane(s, new ProposalStore(), losesTime);
    const r = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    expect(r).toMatchObject({ ok: true, mutated: false });
    const proposed = (proposals.get(r.proposal_id as string)!.operations[0]!.value as Rec).candidate;
    const original = FX.graph.goal_constraints.find((row: Rec) => row.node_id === 'founder_marketing_time');
    // First assertion kills a missing carry-forward even if its disclosure remains on the card.
    expect(proposed.goal_constraints.find((row: Rec) => row.node_id === original.node_id)).toEqual(original);
    expect(r.public_label).toBe(omissionCard);
    expect(String(r.public_label).match(/\?/g) ?? []).toHaveLength(0);
    expect(s.commits).toHaveLength(0);
    s.said(FX.l20.turn_id);
    expect(await caps.authoriseChange(pressed(r.proposal_id as string), { proposal_id: r.proposal_id } as never))
      .toMatchObject({ ok: true, mutated: true, applied: true });
    await expectStoredRunAndReopen(s, [
      { constraint_id: 'agent-lane:new_customers:>=', node_id: 'new_customers', operator: '>=', value: 20,
        label: 'New customers', unit: 'customers', provenance: 'explicit', value_frame: 'level', role: 'goal_target' },
      { constraint_id: 'agent-lane:conversion_rate:>=', node_id: 'conversion_rate', operator: '>=', operator_as_stated: '>',
        value: 15, label: 'Conversion rate', unit: '%', provenance: 'explicit', value_frame: 'level', role: 'goal_target' },
      { constraint_id: 'agent-lane:annual_marketing_spend:<=', node_id: 'annual_marketing_spend', operator: '<=',
        value: 100000, label: 'Annual marketing spend', unit: 'GBP/year', provenance: 'explicit', value_frame: 'level' },
      original,
    ]);
  });

  it('a limit omitted WITH its node is retained unscored through approval, production Run and reopen', async () => {
    const s = server();
    const draft = () => {
      const c = candidate();
      c.constraints = c.constraints.filter((x: Rec) => x.metric !== 'Founder marketing time');
      c.factors = c.factors.filter((x: Rec) => x.label !== 'Founder marketing time');
      c.links = c.links.filter((x: Rec) => x.from !== 'Founder marketing time' && x.to !== 'Founder marketing time');
      return c;
    };
    const { caps, proposals } = lane(s, new ProposalStore(), draft);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    expect(offer.ok).toBe(true);
    const prepared = (proposals.get(offer.proposal_id as string)!.operations[0]!.value as Rec).candidate;
    const original = FX.graph.goal_constraints.find((r: Rec) => r.node_id === 'founder_marketing_time');
    const retained = { ...original, retained_unresolved_limit: { state: 'unscored', role: 'original',
      reason: 'retained_limit_quantity_unresolved', previous_constraint_id: original.constraint_id,
      proposed_constraint_ids: [], question: 'What forecast and basis should be used to evaluate this retained limit?' } };
    expect(prepared.goal_constraints.find((r: Rec) => r.constraint_id === original.constraint_id)).toEqual(retained);
    expect(prepared.nodes.find((n: Rec) => n.id === original.node_id)).toEqual(FX.graph.nodes.find((n: Rec) => n.id === original.node_id));
    expect(prepared.edges.filter((e: Rec) => e.from === original.node_id || e.to === original.node_id)).toEqual([]);
    expect(offer.public_label).toBe(omissionCard.replace(carriedCardEnd, RETAINED_LIMIT_QUANTITY_WITHHELD + ' ' + carriedCardEnd));
    expect(isAllowedRunAnalysisAssistantText(RETAINED_LIMIT_QUANTITY_WITHHELD)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText(RETAINED_LIMIT_QUANTITY_WITHHELD + ' All conditions passed.')).toBe(false);
    s.said(FX.l20.turn_id);
    expect(await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never))
      .toMatchObject({ ok: true, mutated: true, applied: true });
    await expectStoredRunAndReopen(s, prepared.goal_constraints);
  });

  it('a revised draft with no target is still refused', async () => {
    const s = server();
    const noTarget = () => {
      const c = candidate();
      c.goal = { ...c.goal, target_stated: false, value: null };
      c.constraints = c.constraints.filter((row: Rec) => row.role !== 'target');
      return c;
    };
    const r = await lane(s, new ProposalStore(), noTarget).caps.proposeGoalTarget!(l20Turn, conversion as never);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'revised_draft_has_no_target' });
    expect(s.commits).toHaveLength(0);
  });

  it('unknown authority refuses: a ledger that cannot be read', async () => {
    await refusedAtOffer(server({ ledgerFails: true }));
  });

  it('no approval, no write: the Agent\'s own authorise_change (no pressed card) is refused', async () => {
    const s = server();
    const { caps } = lane(s);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    s.said(FX.l20.turn_id); // every gate would pass: only the missing press may refuse it
    const r = await caps.authoriseChange({ ...pressed(offer.proposal_id as string), typed_approval_of: undefined }, { proposal_id: offer.proposal_id } as never);
    expect(r).toMatchObject({ ok: false, mutated: false });
    expect(s.commits).toHaveLength(0);
    // CONTROL: the same request WITH the press writes, so the refusal above is the approval rule's.
    expect(await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never)).toMatchObject({ ok: true, mutated: true });
  });

  it('a conflict writes nothing: another writer renames a node between the card and the press (identity moves, analysis hash does not)', async () => {
    const s = server();
    const { caps } = lane(s);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    s.said(FX.l20.turn_id);
    s.move((g) => { (g.nodes as Rec[]).find((n) => n.id === 'advertising_spend')!.label = 'Ad spend'; });
    const r = await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(s.commits).toHaveLength(0);
  });

  it('G3 at the press: a message after L20 and before the press refuses the replacement', async () => {
    const s = server();
    const { caps } = lane(s);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    s.said(FX.l20.turn_id);
    s.said('typed-turn-after-l20');
    const r = await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'draft_holds_your_work' });
    // At the press: the targets the card carried, neither on the canvas, named as missing (AIE 6128697025, row 10).
    expect(String(r.detail)).toBe(`${AIE_NOT_HELD} Missing: \u2018New customers\u2019 at least 20 customers and \u2018Conversion rate\u2019 above 15%.`);
    expect(s.commits).toHaveLength(0);
  });
});

describe('AIE 6128697025 (row 10): the canvas step is said ONLY when every target\'s quantity is already on the canvas', () => {
  const found = ['1 saved change since the draft'];
  it('CONTRAST, every target on the canvas: the canvas step, with what was found', () => {
    expect(draftGateDetail(found, 'replaced', [{ words: '\u2018New customers\u2019 at least 20 customers', onCanvas: true },
      { words: '\u2018Conversion rate\u2019 above 15%', onCanvas: true }])).toBe('Olumi found 1 saved change since the draft, so a revised draft '
      + 'was not replaced: replacing the draft could discard your work, and nothing was changed. Tell the user that plainly, that their goal '
      + 'is not yet in the model, and give the one step that works today: edit the goal on the canvas to \u2018New customers\u2019 at least '
      + '20 customers and \u2018Conversion rate\u2019 above 15%. Never rebuild part of it.');
  });
  it('one target off the canvas: the AIE\'s words, naming only the missing one (never the canvas step)', () => {
    expect(draftGateDetail(found, 'offered', [{ words: '\u2018New customers\u2019 at least 20 customers', onCanvas: true },
      { words: '\u2018Conversion rate\u2019 above 15%', onCanvas: false }])).toBe(`${AIE_NOT_HELD} Missing: \u2018Conversion rate\u2019 above 15%.`);
  });
});

describe('AIE 0452 amendments: unknown authority, quantity-bound limits and targets, the whole approved graph', () => {
  const offerOn = async (s: ReturnType<typeof server>, draft: () => Rec = candidate, args: Rec = conversion) =>
    lane(s, new ProposalStore(), draft).caps.proposeGoalTarget!(l20Turn, args as never);

  it('RED (unknown): a PRESENT value with no source stamp is unknown authority and refuses', async () => {
    const g = structuredClone(FX.graph);
    delete ((g.nodes as Rec[]).find((n) => n.id === 'advertising_spend')!.observed_state as Rec).source;
    const s = server({ graph: g });
    expect(humanMaterialAfterTheDraft(g)).toEqual(['a value for \u2018Advertising spend\u2019 whose author is not recorded']);
    const r = await offerOn(s);
    expect(r).toMatchObject({ ok: false, refusal: 'draft_holds_your_work' });
    expect(String(r.detail)).toBe(`${AIE_NOT_HELD} Missing: \u2018conversion rate\u2019 above 15%.`);
    expect(s.commits).toHaveLength(0);
  });

  it('RED (unknown): a present option setting, and a present link, with no source stamp refuse', async () => {
    const g = structuredClone(FX.graph);
    const option = (g.nodes as Rec[]).find((n) => n.kind === 'option' && n.interventions !== undefined && Object.keys(n.interventions).length > 0)!;
    const factorId = Object.keys(option.interventions)[0]!;
    delete (option.interventions[factorId] as Rec).source;
    expect(humanMaterialAfterTheDraft(g)).toEqual([`a level for \u2018${option.label}\u2019 whose author is not recorded`]);
    const r1 = await offerOn(server({ graph: g }));
    expect(r1).toMatchObject({ ok: false, refusal: 'draft_holds_your_work' });
    const g2 = structuredClone(FX.graph);
    const link = (g2.edges as Rec[]).find((e) => e.from === 'advertising_spend')!;
    delete (link.provenance as Rec).source;
    expect(humanMaterialAfterTheDraft(g2)).toEqual([expect.stringMatching(/^a link \u2018Advertising spend\u2019 \u2192 .* whose author is not recorded$/)]);
    const r2 = await offerOn(server({ graph: g2 }));
    expect(r2).toMatchObject({ ok: false, refusal: 'draft_holds_your_work' });
  });

  it('CONTROL (unknown): construction\'s own unstamped "100 % of today" definition is not a human contribution', async () => {
    const g = structuredClone(FX.graph);
    (g.nodes as Rec[]).find((n) => n.id === 'marketing_experience')!.observed_state = { value: 1, raw_value: 100, unit: '% of today' };
    const r = await offerOn(server({ graph: g }));
    expect(r).toMatchObject({ ok: true });
  });

  it('uncertain equivalence: one question, previous and proposed limits retained side by side', async () => {
    const elsewhere = () => {
      const c = candidate();
      c.constraints = (c.constraints as Rec[]).map((x) => (x.metric === 'Founder marketing time' ? { ...x, metric: 'Advertising time' } : x));
      c.factors = [...(c.factors as Rec[]), { label: 'Advertising time', role: 'controllable', baseline_known: false, baseline_value: 10, unit: '%', provenance: 'ai_proposed', plausible_max: 100 }];
      return c;
    };
    const s = server();
    const { caps, proposals } = lane(s, new ProposalStore(), elsewhere);
    const r = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    expect(r).toMatchObject({ ok: true, mutated: false });
    expect(r.public_label).toBe(uncertainCard);
    expect(String(r.public_label).match(/\?/g)).toHaveLength(1);
    const rows = (proposals.get(r.proposal_id as string)!.operations[0]!.value as Rec).candidate.goal_constraints;
    expect(rows.filter((row: Rec) => row.value === 25)).toEqual([
      { constraint_id: 'agent-lane:advertising_time:<=', node_id: 'advertising_time', operator: '<=',
        value: 25, label: 'Advertising time', unit: '%', provenance: 'explicit', value_frame: 'level',
        retained_unresolved_limit: { state: 'unscored', role: 'proposed', reason: 'retained_limit_equivalence_unresolved',
          previous_constraint_id: 'agent-lane:founder_marketing_time:<=', proposed_constraint_ids: ['agent-lane:advertising_time:<='],
          question: 'Do these describe the same limit?' } },
      pendingLimit(FX.graph.goal_constraints.find((row: Rec) => row.node_id === 'founder_marketing_time'), 'agent-lane:advertising_time:<='),
    ]);
    s.said(FX.l20.turn_id);
    expect(await caps.authoriseChange(pressed(r.proposal_id as string), { proposal_id: r.proposal_id } as never))
      .toMatchObject({ ok: true, mutated: true, applied: true });
    await expectStoredRunAndReopen(s, rows);
  });

  it('RED (measures): a target call names its quantity; the same figure on ANOTHER quantity is not "held"', async () => {
    const s = server();
    // "customers" is in L20; 15% is a figure L20 states. The candidate holds "> 15%" only on Conversion rate.
    const r = await offerOn(s, candidate, { constraint_type: 'at_least', value: 15, unit: '%', measures: 'customers', rationale: L20 });
    expect(r).toMatchObject({ ok: true, revised_draft: { holds_this_target: false } });
    expect(String(r.note)).toMatch(/This target \(15%\) is NOT in the revised draft/);
  });

  it('RED (whole graph): a postimage that is not the acknowledged registration is unconfirmed, and no replacement receipt is issued', async () => {
    const s = server({ afterCommit: (g) => {
      // A foreign write lands between the registration and the read-back; the targets and limits are untouched.
      const e = (g.edges as Rec[]).find((x) => x.from === 'marketing_manager_hired' || x.to === 'conversion_rate')!;
      e.strength = { mean: 0.9, std: 0.05 };
    } });
    const proposals = new ProposalStore();
    const { caps } = lane(s, proposals);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    s.said(FX.l20.turn_id);
    const r = await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never);
    expect(r).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' });
    expect(r.follow_up).toBeUndefined();
    // The same press again is not answered "already applied": no receipt was recorded for an unconfirmed write.
    const again = await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never);
    expect(again.already_applied).not.toBe(true);
  });
  /**
   * ⛔ AIE B34 (6119577581): the acknowledgement names what the route STORED, so a component omitted or changed BEFORE it
   * is acknowledged and read back unchanged. Each such store is unconfirmed: no replacement receipt, and the same press is
   * never "already applied". The CONTROL: a route that only ADDS its own field (a node `ref`, as the real route does) confirms.
   */
  const preAck: [string, (g: Rec) => void][] = [
    ['a link omitted', (g) => { g.edges = (g.edges as Rec[]).filter((e) => !(e.from === 'advertising_spend' && e.to === 'conversion_rate')); }],
    ['a link strength changed', (g) => { const e = (g.edges as Rec[]).find((x) => x.from === 'marketing_manager_hired' && x.to === 'conversion_rate')!; e.strength = { ...(e.strength as Rec), mean: 0.91 }; }],
    ['an option setting changed', (g) => { const o = (g.nodes as Rec[]).find((n) => n.id === 'hire_a_marketing_manager')!; const iv = o.interventions as Rec; const k = Object.keys(iv)[0]!; iv[k] = typeof iv[k] === 'number' ? (iv[k] as number) + 1 : { ...(iv[k] as Rec), value: Number((iv[k] as Rec).value ?? 0) + 1 }; }],
    ['an option dropped', (g) => { g.nodes = (g.nodes as Rec[]).filter((n) => n.id !== 'ai_planning_plus_advertising'); g.edges = (g.edges as Rec[]).filter((e) => e.from !== 'ai_planning_plus_advertising' && e.to !== 'ai_planning_plus_advertising'); }],
    ['a label changed', (g) => { (g.nodes as Rec[]).find((n) => n.id === 'marketing_manager_hired')!.label = 'Marketing manager recruited'; }],
  ];
  it.each(preAck)('RED (B34, before the acknowledgement): %s → unconfirmed, no receipt, never "already applied"', async (_what, change) => {
    const s = server({ beforeAck: change });
    const proposals = new ProposalStore();
    const { caps } = lane(s, proposals);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    s.said(FX.l20.turn_id);
    const r = await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never);
    expect(r).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' });
    expect(r.follow_up).toBeUndefined();
    const again = await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never);
    expect(again.already_applied).not.toBe(true);
  });

  it('CONTROL (B34): a route that only adds its own field to each node (a `ref`) confirms the replacement', async () => {
    const s = server({ beforeAck: (g) => { (g.nodes as Rec[]).forEach((n, i) => { n.ref = `N${i + 1}`; }); } });
    const { caps } = lane(s);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    s.said(FX.l20.turn_id);
    const r = await caps.authoriseChange(pressed(offer.proposal_id as string), { proposal_id: offer.proposal_id } as never);
    expect(r).toMatchObject({ ok: true, mutated: true, applied: true });
  });

  it('the L20 candidate fixture the real-route spec registers is the one the capability prepares (drift is RED)', async () => {
    const s = server();
    const proposals = new ProposalStore();
    const { caps } = lane(s, proposals);
    const offer = await caps.proposeGoalTarget!(l20Turn, conversion as never);
    const v = proposals.get(offer.proposal_id as string)!.operations[0]!.value as Rec;
    const url = new URL('./fixtures/marketing-l20-revised-draft-candidate.json', import.meta.url);
    // A deliberate regeneration only (a reviewed rule change moved the candidate), never to turn this drift check green.
    if (process.env.L20_CANDIDATE_REWRITE === '1') {
      const was = JSON.parse(readFileSync(url, 'utf8')) as Rec;
      writeFileSync(url, `${JSON.stringify({ ...was, operation_id: v.operation_id, candidate: v.candidate }, null, 1)}\n`);
    }
    const fixture = JSON.parse(readFileSync(url, 'utf8')) as Rec;
    expect({ operation_id: v.operation_id, candidate: v.candidate }).toEqual({ operation_id: fixture.operation_id, candidate: fixture.candidate });
  });

});
