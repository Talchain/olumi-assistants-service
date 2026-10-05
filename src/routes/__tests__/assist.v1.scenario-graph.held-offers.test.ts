/** R2: the opt-in /graph read serves only CEE-authorised original held offers. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";
const OTHER_USER = "9e8d7c6b-5a49-4382-b716-0c5d4e3f2a1b";

// `vi.hoisted` because `vi.mock` factories are lifted above ordinary consts,
// and this route's import chain (route-v2-preflight → build-turn-context)
// reads `config` at module-init time — early enough to lose the race.
//
// The mock SPREADS THE REAL CONFIG rather than hand-listing the sections this
// suite happens to touch: a `vi.mock` factory REPLACES the module, so a
// hand-listed stub silently drops every config key added since it was written
// (CLAUDE.md trap 12 — the flags-mock allowlist defect, verbatim). Only
// `requireUserJwt` is pinned, because it is the one field whose value this
// suite is actually asserting about. The Agent lane is enabled only for the local turn witnesses.
const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  mockConfig.value = {
    ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false },
    proxy: { ...actual.config.proxy, agentLaneEnabled: true, agentLanePreview: false },
  };
  return { ...actual, config: mockConfig.value };
});

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// ── The store double ────────────────────────────────────────────────────────
// `ensureScenarioExists` is the UPSERT. It is a spy here so the suite can
// assert not just the RESPONSE but whether the row-creating call was reached
// at all — the difference between "answers 404" and "answers 404 without
// having created the scenario first", which is the whole of pin (1).
const scenarioExists = vi.fn();
const loadGraphAndBriefText = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();

const readRecent = vi.fn();
const readCommittedTurn = vi.fn();
const append = vi.fn(async (_write: Record<string, unknown>) => ({ id: 'answer-row' }));
const store = {
  readMostRecentPendingActions: vi.fn(async () => latest),
  scenarioExists,
  loadGraphAndBriefText,
  ensureScenarioExists,
  getScenarioOwner,
  readRecent,
  readCommittedTurn,
  append,
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => store,
}));

/**
 * IDENTITY IS NOW CARRIED BY THE VERIFIED TOKEN SUBJECT, NOT BY THE BODY.
 *
 * These cases previously established ownership by putting `user_id` in the
 * request body. That is no longer an ownership input on this route, so the
 * carrier changes and every assertion stays.
 *
 * ⚠ THE OVERRIDES BELOW ARE LOAD-BEARING, NOT TIDINESS. Without them the
 * cross-user refusal cases would still PASS — because an unverified caller is
 * refused whatever id they name — and would therefore have stopped
 * discriminating between "someone else's scenario" and "no identity at all".
 * A guard that passes for a reason unrelated to what it names is the failure
 * mode these positive controls exist to prevent, so each cross-user case now
 * states the OTHER user as a VERIFIED subject.
 *
 * `importOriginal` spread, never a hand-listed factory: a factory REPLACES the
 * module and every other export in the pre-flight import chain would silently
 * vanish.
 */
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock("../../orchestrator/user-identity.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import scenarioGraphRoute from "../assist.v1.scenario-graph.js";

/** A graph with no positional keys anywhere — the shape `scenarios.graph` holds today. */
const GRAPH_NO_LAYOUT = {
  nodes: [
    { id: "n1", label: "Take the job", kind: "option" },
    { id: "n2", label: "Commute time", kind: "factor" },
  ],
  edges: [{ from: "n1", to: "n2", weight: 0.4 }],
  options: [{ id: "n1", label: "Take the job" }],
};


async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  return app;
}

// `await`ed inside on purpose: an un-awaited `app.inject()` is Light-my-Request's
// chainable builder, not a response, and returning it would type every caller's
// `.statusCode` / `.json()` as an error the BUILD gate cannot see (it excludes
// tests — CLAUDE.md trap 2's refinement; `Typecheck Drift` is what catches it).
async function read(
  app: FastifyInstance,
  scenarioId: string,
  body: Record<string, unknown> = {},
) {
  return await app.inject({
    method: "POST",
    url: `/assist/v1/scenarios/${scenarioId}/graph`,
    payload: body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default posture: the scenario exists, is UNOWNED (guest), and holds a graph.
  scenarioExists.mockResolvedValue(true);
  // The signed-in owner is the default caller. Cases about a DIFFERENT user
  // override this explicitly — see the note on the mock.
  resolveUserIdentity.mockResolvedValue({ mode: "verified", userId: OWNER });
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  loadGraphAndBriefText.mockResolvedValue({
    graph: GRAPH_NO_LAYOUT,
    briefText: "Should I take the job?",
  });
});



import { agentProposals, HELD_OFFER_ROWS_READ_CAP } from '../../orchestrator-v5/agent-lane/held-approval-offers.js'
import { createProposal, ProposalStore, MAX_PROPOSALS, type StructuredProposal } from '../../orchestrator-v5/agent-lane/proposal.js'
import { proposalPendingAction } from '../../orchestrator-v5/agent-lane/durable-proposal.js'
import { parsePendingAction, type PendingAction } from '../../orchestrator-v5/session/pending-action.js'
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js'
import { SupabaseSessionStore } from '../../orchestrator-v5/session/supabase-store.js'
import { SessionLRUCache } from '../../orchestrator-v5/session/cache.js'
import { agentV1TurnRoute } from '../agent-v1-turn.js'

// Only the client is fake: both read paths and the strict vendored projection are real.
let table: Record<string, unknown>[] = []
let realStore: SupabaseSessionStore
const selections: string[] = []
const fakeClient = {
  from: () => {
    let columns: string[] = []; const eqs: [string, unknown][] = []
    let limit = Infinity
    const chain = {
      select: (s: string) => { selections.push(s); columns = s.split(',').map(c => c.trim()); return chain },
      eq: (k: string, v: unknown) => { eqs.push([k, v]); return chain },
      not: () => chain, order: () => chain, abortSignal: () => chain,
      limit: (n: number) => { limit = n; return chain },
      then: (resolve: (v: unknown) => void) => resolve({ data: table
        .filter(r => eqs.every(([k, v]) => r[k] === v)).slice(0, limit)
        .map(r => Object.fromEntries(columns.map(c => [c, r[c]]))), error: null }),
    }
    return chain
  },
}
const carrierPatchOf = (pa: PendingAction) => {
  if (pa.action.kind !== 'apply_proposed_change') throw new Error('fixture is not a proposal carrier')
  return pa.action.inline_patch
}
const proposalOf = (pa: PendingAction) => carrierPatchOf(pa).agent_proposal as StructuredProposal
const sharedSnapshot = () => ({ size: agentProposals.size(), outstanding: agentProposals.outstanding(SCENARIO, OWNER),
  // Include every scenario and settlement/order map, so even an LRU bump is observable.
  internals: JSON.stringify(agentProposals, (_key, value) => value instanceof Map ? [...value] : value) })
const answerRow = (pa: PendingAction, turnId = 'held-turn') => ({
  id: '11111111-1111-4111-8111-111111111111', scenario_id: pa.scenario_id, user_id: OWNER,
  turn_id: turnId, turn_class: 'direct_answer', handler_id: null,
  request_hash: 'agent_turn:' + 'a'.repeat(64), response_emitted: true, llm_calls_used: 0, duration_ms: 1,
  created_at: new Date().toISOString(), user_message: 'Make this change', assistant_message: 'Approve this change?', pending_actions: [pa],
})
let latest: PendingAction[] = []
let serial = 0
let chip: { id: string; label: string; message: string; detail: string }
let offered: PendingAction
beforeEach(() => {
  serial += 1
  const graphHash = computeAnalysisAffectingGraphHash(GRAPH_NO_LAYOUT)
  expect(graphHash).not.toBeNull()
  if (graphHash === null) throw new Error('fixture has no current graph identity')
  const proposal = createProposal({ scenario_id: SCENARIO, user_id: OWNER,
    base_graph_identity_hash: graphHash,
    operations: [{ op: 'add_edge', path: 'n1::n2', value: serial }],
    provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: 'The held change',
  })
  chip = { id: `agent-approve-proposal:${proposal.proposal_id}`, label: 'Record this link', message: 'Yes, record that.', detail: 'The exact offered card.' }
  offered = parsePendingAction(proposalPendingAction(proposal, chip, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() }))!
  expect(offered).not.toBeNull()
  latest = [offered]
  store.readMostRecentPendingActions.mockImplementation(async () => latest)
  table = [answerRow(offered)]
  selections.length = 0
  realStore = new SupabaseSessionStore(fakeClient as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }), { defaultReadLimit: 20 })
  readRecent.mockImplementation((sid: string, cap?: number) => realStore.readRecent(sid, cap))
  readCommittedTurn.mockImplementation((sid: string, tid: string) => realStore.readCommittedTurn(sid, tid))
  append.mockClear()

})
afterEach(() => {
  // Isolate shared process memory without changing its production API.
  for (const [id] of (agentProposals as unknown as { items: Map<string, unknown> }).items) agentProposals.discard(id)
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const heldRead = async (request: Record<string, unknown> = { include_conversation_turns: true }) => {
  const app = await buildApp()
  try {
    const res = await read(app, SCENARIO, request)
    expect(res.statusCode).toBe(200)
    return res.json()
  } finally { await app.close() }
}
describe('R2 /graph server-validated held offers (only when conversation requested)', () => {
  it('(c) executable held proposal → exact original approve plus shared amend', async () => {
    expect(await realStore.readRecent(SCENARIO)).toHaveLength(1)
    expect((await realStore.readRecent(SCENARIO))[0]).not.toHaveProperty('pending_actions')
    expect((await heldRead()).held_proposal_offers).toEqual([{ turn_id: 'held-turn',
      proposal_id: chip.id.slice('agent-approve-proposal:'.length), suggested_actions: [chip,
        { id: 'agent-amend-proposal', label: 'Change something first', message: 'Before you apply it, I want to change some of it.' }] }])
  })
  it('(d) graph moved → field absent', async () => {
    loadGraphAndBriefText.mockResolvedValue({ graph: { ...GRAPH_NO_LAYOUT, edges: [] }, briefText: 'Changed' })
    expect(await heldRead()).not.toHaveProperty('held_proposal_offers')
  })
  it('(e) another verified caller on a readable guest graph → field absent', async () => {
    resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OTHER_USER })
    expect(await heldRead()).not.toHaveProperty('held_proposal_offers')
  })
  it('(f) already executed on this unchanged graph → field absent', async () => {
    expect((await heldRead()).held_proposal_offers).toHaveLength(1)
    agentProposals.put(proposalOf(offered))
    agentProposals.markApplied(chip.id.slice('agent-approve-proposal:'.length))
    expect(await heldRead()).not.toHaveProperty('held_proposal_offers')
  })
  it('(g) authorise throws → field absent, graph and conversation still read', async () => {
    vi.spyOn(ProposalStore.prototype, 'authorise').mockImplementation(() => { throw new Error('authority unreadable') })
    const body = await heldRead()
    expect(body).not.toHaveProperty('held_proposal_offers'); expect(body.graph).toEqual(GRAPH_NO_LAYOUT)
    expect(body.conversation_turns).toHaveLength(1)
  })
  it('not requested → absent even with an executable held proposal', async () => {
    expect(await heldRead({})).not.toHaveProperty('held_proposal_offers')
    expect(await heldRead({ include_conversation_turns: 'true' })).not.toHaveProperty('held_proposal_offers')
  })
  it('requested, nothing executable → absent, never null or []', async () => {
    latest = []; expect(await heldRead()).not.toHaveProperty('held_proposal_offers')
  })
  it.each(['expired wall clock', 'expired turn count', 'superseded carrier'])('%s → absent', async kind => {
    expect((await heldRead()).held_proposal_offers).toHaveLength(1) // warm cache must not revive expired/dropped authority
    latest = kind === 'superseded carrier' ? [] : [{ ...offered,
      ...(kind === 'expired wall clock' ? { expires_at_iso: new Date(Date.now()-1).toISOString() } : { expires_at_turn_count: 0 }) }]
    expect(await heldRead()).not.toHaveProperty('held_proposal_offers')
  })
  it('latest authority read throws → graph unavailable and no held field', async () => {
    store.readMostRecentPendingActions.mockRejectedValue(new Error('unreadable'))
    const app = await buildApp()
    try {
      const res = await read(app, SCENARIO, { include_conversation_turns: true })
      expect(res.statusCode).toBe(503); expect(res.json()).not.toHaveProperty('held_proposal_offers')
    } finally { await app.close() }
  })
})

// A real turn route, with the internal Run result and provider response fixed locally.
// No network or model is contacted. The approval hydration/carrier path is production code.
async function runTurn(sid = SCENARIO, approveId?: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message',
    content: [{ type: 'output_text', text: 'The run is provisional.' }] }] }), { status: 200 })))
  const app = Fastify()
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH_NO_LAYOUT,
    graph_hash: computeAnalysisAffectingGraphHash(GRAPH_NO_LAYOUT) }))
  app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran',
    suggested_actions: [], insights: [], graph_hash: computeAnalysisAffectingGraphHash(GRAPH_NO_LAYOUT),
    blocks: [{ type: 'analysis_result', data: { marker: 'local-run' } }],
    analysis_ready: { status: 'ready', options: [], blockers: [] } }))
  await app.register(agentV1TurnRoute); await app.ready()
  try {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message',
      scenario_id: sid, message: approveId ? 'Yes, record that.' : 'Run analysis.', source: 'chip',
      chip: approveId ? { id: `agent-approve-proposal:${approveId}` } : { id: 'agent-run-analysis', action_type: 'run_analysis' } } })
    expect(r.statusCode).toBe(200)
    return r.json()
  } finally { await app.close() }
}

describe('R2 graph read isolation from the turn approval authority', () => {
  it.each(['served', 'stale hash', 'other caller', 'executed', 'authority throws', 'malformed carrier'])('(h) shared snapshot unchanged: %s', async branch => {
    if (branch === 'stale hash') loadGraphAndBriefText.mockResolvedValue({ graph: { ...GRAPH_NO_LAYOUT, edges: [] }, briefText: 'Changed' })
    if (branch === 'other caller') resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OTHER_USER })
    if (branch === 'executed') { agentProposals.put(proposalOf(offered)); agentProposals.markApplied(proposalOf(offered).proposal_id) }
    if (branch === 'authority throws') vi.spyOn(ProposalStore.prototype, 'authorise').mockImplementation(() => { throw new Error('authority unreadable') })
    // A corrupt offered-row carrier with valid latest authority must also leave memory untouched.
    if (branch === 'malformed carrier') table[0].pending_actions = [{ ...offered, action: { kind: 'apply_proposed_change' } }]
    const before = sharedSnapshot()
    const body = await heldRead()
    expect(sharedSnapshot()).toEqual(before)
    if (branch === 'served') expect(body.held_proposal_offers?.[0]?.proposal_id).toBe(proposalOf(offered).proposal_id)
    else expect(body).not.toHaveProperty('held_proposal_offers')
  })
  it('(i) graph read → next turn has no-read parity for exact offers and answer carrier', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }) // byte-stable lifetimes for control and graph-read turns
    // Same content on a distinct scenario gives an independent no-graph-read control.
    const controlSid = 'b6ccf5cf-aab0-4f01-b889-e0d6c072067c'
    const { proposal_id: _id, ...content } = proposalOf(offered)
    const controlProposal = createProposal({ ...content, scenario_id: controlSid })
    const controlChip = { ...chip, id: `agent-approve-proposal:${controlProposal.proposal_id}` }
    const controlCarrier = proposalPendingAction(controlProposal, controlChip, { scenario_id: controlSid, emitted_at_iso: offered.emitted_at_iso })
    store.readMostRecentPendingActions.mockImplementation(async (sid?: string) => sid === controlSid ? [controlCarrier] : latest)
    const control = await runTurn(controlSid)
    const controlWrite = append.mock.calls.at(-1)?.[0] as unknown as { pending_actions: PendingAction[] }
    expect(control.suggested_actions.map((a: { id: string }) => a.id)).toEqual([controlChip.id, 'agent-amend-proposal'])
    const controlAnswerCarrier = controlWrite.pending_actions.find(pa => pa.chip_id === controlChip.id)
    expect(controlAnswerCarrier).toBeDefined()
    append.mockClear()
    await heldRead()
    const body = await runTurn()
    expect(body.suggested_actions).toEqual([chip, { id: 'agent-amend-proposal', label: 'Change something first', message: 'Before you apply it, I want to change some of it.' }])
    const answer = append.mock.calls.at(-1)?.[0] as unknown as { pending_actions: PendingAction[] }
    const carried = answer?.pending_actions.find(pa => pa.chip_id === chip.id)
    expect(carried).toBeDefined()
    expect(proposalOf(carried!)).toEqual(proposalOf(offered))
    expect(carrierPatchOf(carried!).approve_detail).toBe(chip.detail)
    const normalize = (pa: PendingAction) => JSON.stringify(pa, (key, value) =>
      key === 'id' ? '<pending-id>' : typeof value === 'string'
        ? value.replaceAll(controlSid, SCENARIO).replaceAll(controlProposal.proposal_id, proposalOf(offered).proposal_id) : value)
    expect(normalize(carried!)).toEqual(normalize(controlAnswerCarrier!))
    expect(body.suggested_actions).toEqual(control.suggested_actions.map((a: { id: string }) => ({ ...a,
      id: a.id.replace(controlProposal.proposal_id, proposalOf(offered).proposal_id) })))
  })
  it('(j) pre-expiry graph read → expired next graph and next turn refuse by identity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse(offered.expires_at_iso) - 1)
    await heldRead()
    vi.setSystemTime(Date.parse(offered.expires_at_iso) + 1)
    expect(await heldRead()).not.toHaveProperty('held_proposal_offers')
    const next = await runTurn()
    expect(next.suggested_actions.map((a: { id: string }) => a.id)).not.toContain(chip.id)
    const approval = await runTurn(SCENARIO, proposalOf(offered).proposal_id)
    expect(approval._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change',
      proposal_id: proposalOf(offered).proposal_id, refusal: 'unknown_proposal', mutated: false }))
    expect(agentProposals.outstanding(SCENARIO, OWNER).map(p => p.proposal_id)).not.toContain(proposalOf(offered).proposal_id)
    expect(append.mock.calls.flatMap(call => ((call[0] as unknown as { pending_actions?: PendingAction[] })?.pending_actions ?? [])).map(pa => pa.chip_id)).not.toContain(chip.id)
  })
  it('(k) capacity: graph-read scenario B cannot evict scenario A mid-approval', async () => {
    const scenarioA = 'c6ccf5cf-aab0-4f01-b889-e0d6c072067c'
    const { proposal_id: _id, ...content } = proposalOf(offered)
    for (let i = 0; i < MAX_PROPOSALS; i++) agentProposals.put(createProposal({ ...content, scenario_id: scenarioA, public_label: `A ${i}` }))
    const before = sharedSnapshot(); const ids = agentProposals.outstanding(scenarioA, OWNER)
    expect(agentProposals.size()).toBe(MAX_PROPOSALS)
    await heldRead()
    expect(agentProposals.outstanding(scenarioA, OWNER)).toEqual(ids)
    expect(sharedSnapshot()).toEqual(before)
  })
})

describe('R2 committed carrier read failure and bounded newest-offer identity', () => {
  it('committed read throws → no controls, graph and conversation still readable', async () => {
    readCommittedTurn.mockRejectedValue(new Error('durable row unavailable'))
    const before = sharedSnapshot(); const body = await heldRead()
    expect(body).not.toHaveProperty('held_proposal_offers')
    expect(body.graph).toEqual(GRAPH_NO_LAYOUT); expect(body.conversation_turns).toHaveLength(1)
    expect(sharedSnapshot()).toEqual(before)
  })
  it('store without committed reader → no controls', async () => {
    const ref = store as { readCommittedTurn?: typeof readCommittedTurn }; const saved = ref.readCommittedTurn
    delete ref.readCommittedTurn
    try { expect(await heldRead()).not.toHaveProperty('held_proposal_offers') }
    finally { ref.readCommittedTurn = saved }
  })
  it('newest originally offered carrier wins, carried-only rows skipped, no older reads', async () => {
    const p = proposalOf(offered)
    const carryOnly = proposalPendingAction(p, chip, { scenario_id: SCENARIO, emitted_at_iso: offered.emitted_at_iso }, false)
    table = [answerRow(carryOnly, 'newest-carried'), answerRow(offered, 'newest-offer'), answerRow(offered, 'older-offer')]
    const body = await heldRead()
    expect(body.held_proposal_offers[0]).toMatchObject({ turn_id: 'newest-offer', proposal_id: p.proposal_id })
    expect(body.held_proposal_offers[0].suggested_actions.map((a: { id: string }) => a.id)).toEqual([chip.id, 'agent-amend-proposal'])
    expect(readCommittedTurn.mock.calls).toEqual([[SCENARIO, 'newest-carried'], [SCENARIO, 'newest-offer']])
    expect(selections.some(s => s.includes('pending_actions'))).toBe(true)
  })
  it('fixed cap stops before an older offer', async () => {
    const carryOnly = proposalPendingAction(proposalOf(offered), chip, { scenario_id: SCENARIO, emitted_at_iso: offered.emitted_at_iso }, false)
    table = [...Array.from({ length: HELD_OFFER_ROWS_READ_CAP }, (_, i) => answerRow(carryOnly, `carry-${i}`)), answerRow(offered)]
    expect(await heldRead()).not.toHaveProperty('held_proposal_offers')
    expect(readCommittedTurn).toHaveBeenCalledTimes(HELD_OFFER_ROWS_READ_CAP)
    expect(readCommittedTurn.mock.calls.map(c => c[1])).not.toContain('held-turn')
  })
})
