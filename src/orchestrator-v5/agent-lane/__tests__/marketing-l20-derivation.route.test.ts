/**
 * ⭐ MARKETING L20 THROUGH THE REAL ROUTE AND DOOR (DL, 12 Oct; `paul-test-20261012/MARKETING-DATING.md` rows 3a/3b/1).
 *
 * Served 11 Oct 22:29Z and A′ (12 Oct 02:01Z): 4 of 4 L20 `propose_goal_target` calls were refused `unreadable_derivation`.
 * The target door's derivation gate refused an EMPTY (`{}`) or IDENTITY (`{ base, multiplier: 1 }`) `derived_from`, which
 * derives nothing; omitted or null passed. B's revised-draft card runs only AFTER that gate, and B's own L20 spec
 * (`restated-goal-revised-draft.test.ts`) sends no `derived_from`, so it never met the served path. The arguments the
 * served Agent sent are UNVERIFIED (not on the wire); these are the shapes the probe found refused.
 *
 * THE PATH: the REAL `agentV1TurnRoute` (Fastify inject) → the REAL Agent loop (its one-change-per-approval rule) → the
 * REAL `propose_goal_target` door → the revised-draft gates → C's construction in prepare-only mode → the card → the chip
 * press → `/graph/register` with compare-and-set on both hashes. The draft is the SERVED one before L20
 * (`fixtures/marketing-020148Z-draft-before-L20.json`). Scripted: the Agent's outputs and the drafter's words (the
 * restated-goal spec's hand-written candidate), so this is TESTED, not WIRE-WITNESSED. 0 provider calls.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the L20 replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the L20 replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { approvalChipIdFor, ONE_CHANGE_PER_APPROVAL } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { resolveMagnitudeFrame, sizeLink } from '../../../cee/magnitude/link-effect.js';
import { magnitudeNodes, percentLevelIds } from '../../../cee/magnitude/frame-defaulted-links.js';
import { refitFramesForOlumiEstimates } from '../refit-frames.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/marketing-020148Z-draft-before-L20.json', import.meta.url), 'utf8')) as {
  scenario_id: string; brief_text: string; graph: Rec; l1: { turn_id: string; message: string }; l20: { turn_id: string; message: string };
  construction_commit_turn_id: string;
};
const SID = FX.scenario_id;
const L20 = FX.l20.message;
const NOW = new Date('2026-10-12T02:05:00.000Z');
/** The first row pays the route's cold import; a timed-out row would keep consuming the next row's scripted outputs. */
const ROUTE_MS = 60_000;

/** The drafter's answer for the brief + L20: `restated-goal-revised-draft.test.ts`'s hand-written candidate, verbatim. */
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
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });

/** The served draft in a stateful store: the read route, the register route's CAS on both hashes, and the committed turn ledger. */
function world() {
  let graph: Rec = structuredClone(FX.graph);
  const rows: SessionTurnWithContent[] = [];
  const registers: Rec[] = [];
  // Mutable here (the store appends to it); read back as the store's readonly `CommittedTurnLedger`.
  const ledger: { write_turn_ids: string[]; user_message_turn_ids: string[]; first_user_message: string | null; complete: boolean } = {
    write_turn_ids: [FX.construction_commit_turn_id], user_message_turn_ids: [FX.l1.turn_id], first_user_message: FX.l1.message.trim(), complete: true };
  const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const store = createMockSessionStore({
    loadGraph: async () => graph, loadGraphAndBriefText: async () => ({ graph, briefText: FX.brief_text }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async (_sid, id) => { const r = rows.find(x => x.turn_id === id); return r ? { id: r.id, request_hash: r.request_hash,
      user_message: r.user_message ?? null, assistant_message: r.assistant_message ?? null, llm_calls_used: r.llm_calls_used, pending_actions: (r as Rec).pending_actions ?? [] } : null; },
    readMostRecentPendingActions: async (_sid, opts) => { opts?.onLatestRowId?.(latest()?.id ?? null); return (latest() as Rec)?.pending_actions ?? []; },
    readRecent: async () => rows.filter(r => !r.turn_id.endsWith(':claim')),
    readCommittedTurnLedger: async (): Promise<CommittedTurnLedger> => structuredClone(ledger),
    append: async write => {
      const id = randomUUID(); rows.unshift({ ...makeSessionTurnRow({ id, scenario_id: SID, turn_id: write.turn_id, request_hash: write.request_hash,
        turn_class: write.turn_class, handler_id: write.handler_id, response_emitted: write.response_emitted, created_at: new Date().toISOString(),
        user_message: write.userMessage ?? null, assistant_message: write.assistantMessage ?? null }), pending_actions: write.pending_actions ?? [] } as SessionTurnWithContent);
      return { id };
    },
  });
  live.store = store;
  const graphWire = () => ({ graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: computeGraphIdentityHash(graph as never),
    brief_text: FX.brief_text, scenario_created_at: '2026-10-12T02:01:48.000Z', analysis_ready: buildCanonicalAnalysisReadyFromGraph(graph) });
  const versions = () => ({ versions: [{ version_id: 'draft-v1', sequence: 1, created_at: '2026-10-12T02:01:48.000Z',
    creation: { kind: 'initial', source_turn_id: FX.construction_commit_turn_id } }] });
  const register = (b: Rec): Rec => {
    registers.push(b);
    if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(graph as never)
      || b.expected_graph_identity_hash !== computeGraphIdentityHash(graph as never)!.value) return { status: 409, body: { details: { code: 'GRAPH_STALE' } } };
    graph = GraphV3.parse(b.graph) as Rec;
    ledger.write_turn_ids.push(registrationTurnId(SID, b.operation_id));
    return { status: 200, body: { registered: true, graph_hash: computeAnalysisAffectingGraphHash(graph as never),
      graph_identity_hash: computeGraphIdentityHash(graph as never), model_version: { version_number: 2, version_id: 'v-l20', mutation_id: 'm-l20' } } };
  };
  /** A turn's user message lands in the ledger once its turn completes (the typed goal's turn is then an allowed message). */
  const said = (turnId: string) => { ledger.user_message_turn_ids.push(turnId); };
  return { rows, registers, ledger, said, read: () => graph, graphWire, versions, register };
}

let agentScript: Rec[] = [];
const providerCalls: string[] = [];
const apps: FastifyInstance[] = [];
beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }); agentScript = []; providerCalls.length = 0; });
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as Rec;
    const format = body.text?.format;
    // The brief reading is optional display work: a failure only means nothing is shown.
    if (format?.name === 'brief_spans') { providerCalls.push('brief_spans'); return new Response('{}', { status: 500 }); }
    if (format?.type === 'json_schema') {
      if (String(body.instructions).includes("This is Olumi's own check of a first draft")) { providerCalls.push('widening');
        return new Response(JSON.stringify(say(JSON.stringify({ risk_suggestions: [] }))), { status: 200 }); }
      providerCalls.push('drafter');
      return new Response(JSON.stringify(say(JSON.stringify(candidate()))), { status: 200 });
    }
    providerCalls.push('agent');
    return new Response(JSON.stringify(agentScript.shift() ?? say('Done.')), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => w.graphWire());
  app.post('/assist/v1/scenarios/:id/versions', async () => w.versions());
  app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => { const r = w.register(req.body as Rec); return reply.code(r.status).send(r.body); });
  await app.register(agentV1TurnRoute); await app.ready();
  return async (over: Rec, script: Rec[] = []): Promise<Rec> => {
    agentScript = [...script];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: randomUUID(), scenario_id: SID, ...over } });
    expect(r.statusCode, r.body.slice(0, 2000)).toBe(200);
    return r.json() as Rec;
  };
}

const CONVERSION = { constraint_type: 'at_least', value: 15, unit: '%', measures: 'conversion rate', rationale: L20 };
const CUSTOMERS = { constraint_type: 'at_least', value: 20, unit: 'customers', measures: 'new customers', rationale: L20 };
/** Each `derived_from` the Agent may send for a target it did not derive (conversion's, customers'): the two the gate refused, and the two it passed. */
const SHAPES: readonly [string, Rec, Rec][] = [
  ['an empty derivation {}', { derived_from: {} }, { derived_from: {} }],
  ['an identity derivation {base, multiplier: 1}', { derived_from: { base: 15, multiplier: 1 } }, { derived_from: { base: 20, multiplier: 1 } }],
  ['CONTRAST: derived_from omitted', {}, {}],
  ['CONTRAST: derived_from null', { derived_from: null }, { derived_from: null }],
];
/** Paul's L20 turn as the Agent served it: one call per target (the tool says "once per target"), then its words. */
const l20Script = (conversion: Rec, customers: Rec) => [
  call('propose_goal_target', { ...CONVERSION, ...conversion }),
  call('propose_goal_target', { ...CUSTOMERS, ...customers }),
  say('I have prepared a revised draft that holds both of your goals.'),
];

describe('marketing L20 through the real route: the target door offers ONE revised-draft card for every derivation shape the Agent sends', () => {
  it.each(SHAPES)('%s → ONE card holding both targets; the second target call is the same approval, nothing written yet', async (_name, conversion, customers) => {
    const w = world();
    const turn = await route(w);
    const body = await turn({ turn_id: randomUUID(), message: L20 }, l20Script(conversion, customers));
    const calls = (body._agent.tool_calls as Rec[]).filter(c => c.name === 'propose_goal_target');
    expect(calls.map(c => c.refusal ?? null), JSON.stringify(calls)).not.toContain('unreadable_derivation');
    const offered = calls.filter(c => c.ok === true);
    expect(offered, JSON.stringify(calls)).toHaveLength(1);
    // The second target is on the same card (the revised draft is built from the whole L20), so the loop's one-change rule
    // refusing its call before it is stored does not lose it: the turn ends with ONE control.
    expect(calls.filter(c => c.ok !== true).map(c => c.refusal)).toEqual([ONE_CHANGE_PER_APPROVAL]);
    const chip = (body.suggested_actions as Rec[]).find(c => c.id === approvalChipIdFor(String(offered[0]!.proposal_id)));
    expect(chip, JSON.stringify(body.suggested_actions)).toMatchObject({ label: 'Use the revised draft' });
    expect(chip!.detail).toContain('‘New customers’ at least 20 customers and ‘Conversion rate’ above 15%');
    expect(w.registers).toHaveLength(0);
    expect(providerCalls.filter(c => c === 'drafter')).toHaveLength(1);
  }, ROUTE_MS);

  it('NEGATIVE (a real derivation keeps its checks): {base: 15, multiplier: 2} for 15% is refused derivation_mismatch, nothing offered', async () => {
    const w = world();
    const turn = await route(w);
    const body = await turn({ turn_id: randomUUID(), message: L20 },
      [call('propose_goal_target', { ...CONVERSION, derived_from: { base: 15, multiplier: 2 } }), say('Could not prepare it.')]);
    expect((body._agent.tool_calls as Rec[]).filter(c => c.name === 'propose_goal_target').map(c => c.refusal)).toEqual(['derivation_mismatch']);
    expect(w.registers).toHaveLength(0);
  }, ROUTE_MS);
});

describe('marketing L20 → press → the revised draft (DL question 3: do the new goal nodes get a level or frame that sizes their links?)', () => {
  it('the press writes the revised draft once; what its goal and target nodes and their incoming links carry is recorded', async () => {
    const w = world();
    const turn = await route(w);
    // Each row its own L20 turn: the route keeps ONE revised draft per turn and base, so a shared id would reuse a card.
    const l20 = randomUUID();
    const offer = await turn({ turn_id: l20, message: L20 }, l20Script({ derived_from: {} }, { derived_from: {} }));
    w.said(l20);
    const proposal = (offer._agent.tool_calls as Rec[]).find(c => c.name === 'propose_goal_target' && c.ok === true)!;
    const yes = (offer.suggested_actions as Rec[]).find(c => c.id === approvalChipIdFor(String(proposal.proposal_id)))!;
    const pressed = await turn({ message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: offer._agent.session_id });
    const writes = (pressed._agent.tool_calls as Rec[]).filter(c => c.name === 'authorise_change');
    expect(writes, JSON.stringify(pressed._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: proposal.proposal_id })]);
    expect(w.registers).toHaveLength(1);
    const g = w.read();
    const rows = g.goal_constraints as Rec[];
    expect(rows.filter(r => r.role === 'goal_target').map(r => r.node_id).sort()).toEqual(['conversion_rate', 'new_customers']);
    // Evidence for question 3 (REPORT, not a fix): each target node's level/frame and each incoming link's size author.
    const targets = (g.nodes as Rec[]).filter(n => n.id === 'conversion_rate' || n.id === 'new_customers');
    const reading = {
      goal_node_id: (g.nodes as Rec[]).find(n => n.kind === 'goal')?.id,
      targets: targets.map(n => ({ id: n.id, kind: n.kind, observed_state: n.observed_state ?? null, frame: resolveMagnitudeFrame(n as never) ?? null })),
      incoming: (g.edges as Rec[]).filter(e => targets.some(n => n.id === e.to))
        .map(e => ({ from: e.from, to: e.to, strength: e.strength, magnitude: e.provenance?.magnitude ?? null,
          natural_effect: e.provenance?.natural_effect ?? null, defaulted: e.defaulted ?? false, provenance: e.provenance ?? null })),
      // Why the drafter's own goal-link size ("2 customers per point of conversion") is or is not carried, on the stored frames.
      drafted_goal_link: (() => { const m = magnitudeNodes(g.nodes as Rec[], percentLevelIds(g));
        const r = sizeLink({ direction: 'positive', effect_amount: 2, effect_per_source_change: 1, user_stated: false },
          m.get('conversion_rate')!, m.get('new_customers')!);
        // Construction's Olumi-estimate refit (`refitFramesForOlumiEstimates`, build-model after admission), replayed on the
        // stored frames with this link's fit candidate restored: where, and why, it declines to move a frame.
        const replay = structuredClone(g);
        (replay.edges as Rec[]).find(e => e.from === 'conversion_rate' && e.to === 'new_customers')!.provenance.olumi_fit_candidate = r.fit_candidate;
        const refit = refitFramesForOlumiEstimates(replay);
        return { outcome: r.outcome, mean: r.mean, problem: r.problem ?? null, stated_strength: r.stated_strength ?? null, set_aside: r.set_aside ?? null,
          fit_candidate: r.fit_candidate ?? null, refit_fitted: refit.fitted, refit_refused: refit.refused }; })(),
    };
    if (process.env.SYS1_EVIDENCE) writeFileSync(`${process.env.SYS1_EVIDENCE}/l20-revised-draft-sizes.json`, JSON.stringify(reading, null, 2));
    expect(reading.incoming.length).toBeGreaterThan(0);
  }, ROUTE_MS);
});
