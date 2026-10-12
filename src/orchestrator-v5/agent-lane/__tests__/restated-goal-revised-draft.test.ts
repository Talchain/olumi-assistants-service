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
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createAgentCapabilities, draftGateDetail, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { humanMaterialAfterTheDraft, limitsKeptBy, targetsHeldBy } from '../runtime/draft-replacement.js';
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
  beforeAck?: (stored: Rec) => void } = {}, fx: typeof FX = FX) {
  const SID = fx.scenario_id;
  let graph: Rec = structuredClone(opts.graph ?? fx.graph);
  const commits: { turn_id: string; bytes: string }[] = [];
  const ledger = {
    write_turn_ids: [fx.construction_commit_turn_id], user_message_turn_ids: [fx.l1.turn_id],
    first_user_message: fx.l1.message.trim(), complete: true, ...opts.ledger,
  } as { write_turn_ids: string[]; user_message_turn_ids: string[]; first_user_message: string | null; complete: boolean };
  const identity = () => computeGraphIdentityHash(graph as never)!.value;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SID}/graph`) {
      return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), brief_text: fx.brief_text,
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
async function runFromStore(bytes: string): Promise<{ payload: Rec; snapshot: Rec }> {
  const port = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: FX.brief_text, revision: 2 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const snap = await loadScenarioSnapshotForRunAnalysis(SID, 'req-run', port as never);
  let payload: Rec | undefined;
  let inputSnapshot: Rec | undefined;
  const handler = createRunAnalysisHandler({
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snap,
    probe: async (sent) => { payload = sent.plotPayload as Rec; inputSnapshot = sent.runInputSnapshot as Rec; },
  });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SID, request_id: 'req-run', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SID, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
  } as never);
  expect(payload, 'the Run handler built a PLoT request').toBeDefined();
  return { payload: payload!, snapshot: inputSnapshot ?? {} };
}

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
      + 'Kept from your brief: ‘Annual marketing spend’ at most £100,000 / year; ‘Founder marketing time’ at most 25%. '
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

  it('a revised draft that drops one of the brief\'s limits is never offered (the 25%-of-time limit, here)', async () => {
    const s = server();
    const losesTime = () => { const c = candidate(); c.constraints = (c.constraints as Rec[]).filter((x) => x.metric !== 'Founder marketing time'); return c; };
    const r = await lane(s, new ProposalStore(), losesTime).caps.proposeGoalTarget!(l20Turn, conversion as never);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'revised_draft_dropped_a_limit' });
    expect(String(r.detail)).toMatch(/\u2018Founder marketing time\u2019 at most 25%/);
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

  it('RED (quantity): "<= 25%" on ANOTHER quantity is not the founder-time limit; the card is not offered', async () => {
    const elsewhere = () => {
      const c = candidate();
      c.constraints = (c.constraints as Rec[]).map((x) => (x.metric === 'Founder marketing time' ? { ...x, metric: 'Advertising time' } : x));
      c.factors = [...(c.factors as Rec[]), { label: 'Advertising time', role: 'controllable', baseline_known: false, baseline_value: 10, unit: '%', provenance: 'ai_proposed', plausible_max: 100 }];
      return c;
    };
    const s = server();
    const r = await offerOn(s, elsewhere);
    expect(r).toMatchObject({ ok: false, refusal: 'revised_draft_dropped_a_limit' });
    expect(String(r.detail)).toMatch(/\u2018Founder marketing time\u2019 at most 25%/);
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

/**
 * ⭐ BATCH F (DL GO (a), 12 Oct): THE DRAFT'S LIMITS ARE CARRIED BY CONSTRUCTION, ON RUN 4'S REAL DRAFTS. Run 4 (CEE a770ce49,
 * scenario 35ecad67): turn 2 ("conversion over 15% and 20 new customers within the first 3 months") was refused
 * `revised_draft_dropped_a_limit` for both targets, because the real drafter re-expressed the brief's limits ("GBP/year" for
 * "£/year"; "Founder marketing time" for "Founder time on campaign"). The base is the served read body at step 3; the drafter's
 * answer is its recorded raw text (`cee_drafter_raw_responses` a5ada94b, the retry), byte-exact by the database's sha256.
 */
const RUN4 = JSON.parse(readFileSync(new URL('./fixtures/marketing-run4-35ecad67-draft-before-turn2.json', import.meta.url), 'utf8')) as typeof FX & {
  t2: { turn_id: string; message: string } };
const RUN4_DRAFTER_BYTES = readFileSync(new URL('./fixtures/marketing-run4-revised-drafter-retry-dea73578.json', import.meta.url), 'utf8').replace(/\n$/, '');
const run4Draft = (edit: (d: Rec) => void = () => {}) => (): Rec => { const d = JSON.parse(RUN4_DRAFTER_BYTES) as Rec; edit(d); return d; };
const t2Turn = { scenario_id: RUN4.scenario_id, authenticated_user_id: null, request_id: 'req-t2', turn_id: RUN4.t2.turn_id,
  user_turn_text: RUN4.t2.message, user_text: `${RUN4.l1.message}\n${RUN4.t2.message}` };
const t2Conversion = { constraint_type: 'at_least', value: 15, unit: '%', measures: 'conversion rate', rationale: RUN4.t2.message };
const t2Customers = { constraint_type: 'at_least', value: 20, unit: 'customers', measures: 'new customers', rationale: RUN4.t2.message };
const baseLimit = (nodeId: string): Rec => (RUN4.graph.goal_constraints as Rec[]).find((r) => r.node_id === nodeId)!;
const candidateOf = (proposals: ProposalStore, id: string): Rec => (proposals.get(id)!.operations[0]!.value as Rec).candidate as Rec;

describe('Batch F: the revised draft keeps the user\'s limits by construction (run 4, real drafts)', () => {
  it('preconditions: the drafter bytes are the database\'s; the base holds the two limits; the ledger is the construction\'s', () => {
    expect(createHash('sha256').update(RUN4_DRAFTER_BYTES, 'utf8').digest('hex')).toBe('dea735780d517ab142f7e1a913c55b1fae6efcf5b990ce8701a6ecbf66854f9b');
    expect((RUN4.graph.goal_constraints as Rec[]).map((r) => [r.label, r.operator, r.value, r.unit])).toEqual([
      ['Annual campaign spend', '<=', 100000, '£/year'], ['Founder time on campaign', '<=', 25, '%']]);
    expect(registrationTurnId(RUN4.scenario_id, constructionOperationId(RUN4.scenario_id, RUN4.brief_text))).toBe(RUN4.construction_commit_turn_id);
    expect(RUN4.brief_text).toBe(RUN4.l1.message.trim());
  });

  it('RED→GREEN: both targets get ONE card that keeps both limits as the base\'s own rows, and the card says so', async () => {
    const s = server({}, RUN4);
    const proposals = new ProposalStore();
    const { caps, drafts } = lane(s, proposals, run4Draft());
    const a = await caps.proposeGoalTarget!(t2Turn as never, t2Conversion as never);
    const b = await caps.proposeGoalTarget!(t2Turn as never, t2Customers as never);
    expect(a, JSON.stringify(a)).toMatchObject({ ok: true, mutated: false });
    expect(b.proposal_id).toBe(a.proposal_id);
    expect(drafts()).toBe(1);
    expect(s.commits).toHaveLength(0);
    expect(String(a.public_label)).toContain('Kept from your brief: ‘Annual campaign spend’ at most £100,000 / year; ‘Founder time on campaign’ at most 25%. ');
    const c = candidateOf(proposals, a.proposal_id as string);
    // Both targets recorded; both limits are the base rows, byte for byte.
    expect(targetsHeldBy(c).map((t) => [t.quantity, t.comparator, t.value])).toEqual(expect.arrayContaining([
      [expect.stringMatching(/conversion rate/i), expect.stringMatching(/^>/), 15], [expect.stringMatching(/new customers/i), '>=', 20]]));
    const limits = (c.goal_constraints as Rec[]).filter((r) => r.role !== 'goal_target' && !(c.nodes as Rec[]).some((n) => n.kind === 'goal' && n.id === r.node_id));
    expect(limits).toEqual([baseLimit('annual_campaign_spend'), baseLimit('founder_time_on_campaign')]);
    expect(limitsKeptBy(RUN4.graph, c)).toMatchObject({ dropped: [] });
  });

  it('founder time: ONE concept, the drafter\'s own node under the base\'s id and name; every reference is re-pointed', async () => {
    const proposals = new ProposalStore();
    const r = await lane(server({}, RUN4), proposals, run4Draft()).caps.proposeGoalTarget!(t2Turn as never, t2Customers as never);
    const c = candidateOf(proposals, r.proposal_id as string);
    // The revised draft's own node as C's construction built it from the recorded drafter answer (its category, scale and
    // Olumi's fresh 15% estimate: "Not carried: Olumi's earlier estimates…"), named as the user's draft names it. No `ref`.
    expect((c.nodes as Rec[]).find((n) => n.id === 'founder_time_on_campaign')).toEqual({ id: 'founder_time_on_campaign', kind: 'factor',
      label: 'Founder time on campaign', provenance: 'ai_inferred', category: 'controllable',
      observed_state: { value: 0.15, raw_value: 15, unit: '%', source: 'cee_inference', extractionType: 'inferred' }, scale_frame: 100 });
    // No duplicate concept: the drafter's node and its id are gone from every position.
    expect((c.nodes as Rec[]).some((n) => /founder marketing time/i.test(String(n.label)))).toBe(false);
    expect(JSON.stringify(c)).not.toContain('founder_marketing_time');
    // Its links and option settings now name the base node: the drafter's 3 option links and its 1 effect link.
    expect((c.edges as Rec[]).filter((e) => e.from === 'founder_time_on_campaign' || e.to === 'founder_time_on_campaign').map((e) => [e.from, e.to]))
      .toEqual([['hire_marketing_manager', 'founder_time_on_campaign'], ['ai_planning_and_more_ads', 'founder_time_on_campaign'],
        ['continue_as_now', 'founder_time_on_campaign'], ['founder_time_on_campaign', 'campaign_plan_quality']]);
    for (const id of ['hire_marketing_manager', 'ai_planning_and_more_ads']) {
      const setting = ((c.nodes as Rec[]).find((n) => n.id === id)!.interventions as Rec).founder_time_on_campaign as Rec;
      expect(setting.target_match?.node_id ?? 'founder_time_on_campaign').toBe('founder_time_on_campaign');
    }
  });

  it('(ii) annual campaign spend: the candidate\'s own node and identity formula stay; only the base row (£/year) is carried', async () => {
    const proposals = new ProposalStore();
    const r = await lane(server({}, RUN4), proposals, run4Draft()).caps.proposeGoalTarget!(t2Turn as never, t2Customers as never);
    const c = candidateOf(proposals, r.proposal_id as string);
    const node = (c.nodes as Rec[]).find((n) => n.id === 'annual_campaign_spend')!;
    expect(node).toMatchObject({ kind: 'outcome', label: 'Annual campaign spend',
      nonlinear_identity: { operation: 'sum', factor_ids: ['annual_advertising_spend', 'annual_marketing_manager_cost', 'annual_ai_tool_cost'] } });
    for (const id of (node.nonlinear_identity as Rec).factor_ids as string[]) expect((c.nodes as Rec[]).some((n) => n.id === id), id).toBe(true);
    expect((c.goal_constraints as Rec[]).filter((x) => x.node_id === 'annual_campaign_spend')).toEqual([baseLimit('annual_campaign_spend')]);
  });

  it('the press writes the carried draft, and the stored graph still keeps both limits (the press\'s own keeper)', async () => {
    const s = server({}, RUN4);
    const proposals = new ProposalStore();
    const { caps } = lane(s, proposals, run4Draft());
    const offer = await caps.proposeGoalTarget!(t2Turn as never, t2Conversion as never);
    s.said(RUN4.t2.turn_id);
    const id = offer.proposal_id as string;
    const pressedT2 = { scenario_id: RUN4.scenario_id, authenticated_user_id: null, request_id: 'req-approve', turn_id: 'approve-turn-run4',
      user_turn_text: '', user_text: `${RUN4.l1.message}\n${RUN4.t2.message}`, typed_approval_of: id };
    expect(await caps.authoriseChange(pressedT2 as never, { proposal_id: id } as never)).toMatchObject({ ok: true, mutated: true });
    expect(limitsKeptBy(RUN4.graph, s.graph())).toMatchObject({ dropped: [] });
  });

  it.each([
    ['a limit\'s figure changes (founder time 25 → 30)', (d: Rec) => { (d.constraints as Rec[])[2]!.value = 30; }, /‘Founder time on campaign’ at most 25%/],
    ['a limit\'s comparator changes (≤ → <)', (d: Rec) => { (d.constraints as Rec[])[2]!.operator = '<'; }, /‘Founder time on campaign’ at most 25%/],
    ['the budget\'s currency changes (GBP → USD: never a conversion)', (d: Rec) => { (d.constraints as Rec[])[1]!.unit = 'USD/year'; }, /‘Annual campaign spend’ at most/],
    ['two re-worded limits share the figure (no ONE counterpart)', (d: Rec) => {
      (d.constraints as Rec[]).push({ metric: 'Advertising share of budget', operator: '<=', value: 25, unit: '%', provenance: 'explicit', frame: 'level', role: 'limit' });
      (d.factors as Rec[]).push({ label: 'Advertising share of budget', role: 'controllable', baseline_known: false, baseline_evidence: null, baseline_value: 20,
        unit: '%', provenance: 'ai_proposed', plausible_max: 100 }); }, /‘Founder time on campaign’ at most 25%/],
  ])('NEGATIVE — %s: still refused, nothing drafted twice or written', async (_name, edit, said) => {
    const s = server({}, RUN4);
    const r = await lane(s, new ProposalStore(), run4Draft(edit)).caps.proposeGoalTarget!(t2Turn as never, t2Customers as never);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'revised_draft_dropped_a_limit' });
    expect(String(r.detail)).toMatch(said);
    expect(s.commits).toHaveLength(0);
  });
});
