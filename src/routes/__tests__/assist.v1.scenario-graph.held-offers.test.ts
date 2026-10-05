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
// suite is actually asserting about.
const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  mockConfig.value = {
    ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false },
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
const store = {
  readMostRecentPendingActions: vi.fn(async () => latest),
  scenarioExists,
  loadGraphAndBriefText,
  ensureScenarioExists,
  getScenarioOwner,
  readRecent,
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



import { agentProposals } from '../../orchestrator-v5/agent-lane/held-approval-offers.js'
import { createProposal, ProposalStore } from '../../orchestrator-v5/agent-lane/proposal.js'
import { proposalPendingAction } from '../../orchestrator-v5/agent-lane/durable-proposal.js'
import { parsePendingAction, type PendingAction } from '../../orchestrator-v5/session/pending-action.js'
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js'
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
  readRecent.mockResolvedValue([{ id: 'answer-row', scenario_id: SCENARIO, turn_id: 'held-turn',
    request_hash: 'agent_turn:' + 'a'.repeat(64), created_at: new Date().toISOString(),
    user_message: 'Make this change', assistant_message: 'Approve this change?', pending_actions: [offered] }])
})
afterEach(() => { vi.restoreAllMocks() })
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
