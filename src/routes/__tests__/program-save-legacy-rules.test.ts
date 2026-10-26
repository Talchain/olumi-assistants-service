/**
 * ⛔ A MODEL PROGRAM'S SAVE RUNS NONE OF THE LEGACY MODEL'S WRITE RULES (inventory F4). The register stores a program as it was
 * built: no persistence projection pass, no goal-scope check, no legacy hold threading and no extra pending read. The program's
 * held cards are carried on the row and judged by their own revision. Through the REAL register and the REAL scenario read, with
 * a stateful mock store and spies that call the real functions; each row's contrast is the SAME graph with no program. Synthetic
 * bakery.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

const SCENARIO = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f';

const spies = vi.hoisted(() => ({ core: vi.fn(), full: vi.fn(), thread: vi.fn(), scope: vi.fn() }));
vi.mock('../../orchestrator-v5/persisted-graph-projection.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/persisted-graph-projection.js')>();
  spies.core.mockImplementation(actual.projectCorePostimageForPersistence);
  spies.full.mockImplementation(actual.projectGraphForPersistence);
  return { ...actual, projectCorePostimageForPersistence: spies.core, projectGraphForPersistence: spies.full };
});
vi.mock('../../orchestrator-v5/handlers/hold-thread-through.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/handlers/hold-thread-through.js')>();
  spies.thread.mockImplementation(actual.threadHoldsThroughMutatingCommit);
  return { ...actual, threadHoldsThroughMutatingCommit: spies.thread };
});
vi.mock('../../orchestrator-v5/agent-lane/goal-scope.js', async (load) => {
  const actual = await load<typeof import('../../orchestrator-v5/agent-lane/goal-scope.js')>();
  spies.scope.mockImplementation(actual.assertNoPendingScopeAmendment);
  return { ...actual, assertNoPendingScopeAmendment: spies.scope };
});
vi.mock('../../config/index.js', async (load) => {
  const actual = await load<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../utils/telemetry.js', async (load) => {
  const actual = await load<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn() };
});
const append = vi.fn();
const loadGraph = vi.fn();
const store = { append, loadGraph, ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn(),
  readExistingScenario: vi.fn(), readRecent: vi.fn(), readFactsFor: vi.fn(), readFactsWithTurnFor: vi.fn(), readScenarioRunAnalysisFactsFor: vi.fn(), readAnalysisInvalidatedAt: vi.fn() };
vi.mock('../../orchestrator-v5/session/index.js', async (load) => ({
  ...(await load<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (load) => ({ ...(await load<Record<string, unknown>>()), resolveUserIdentity }));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { MODEL_PROGRAM, savedProgramOf } from '../../orchestrator-v5/model-program-turn/program-store.js';
import { holdProgramCard } from '../../orchestrator-v5/model-program-turn/program-tools.js';
import { bakery, BRIEF } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { ProposalStore } from '../../orchestrator-v5/agent-lane/proposal.js';
import { approvalChipIdFor } from '../../orchestrator-v5/agent-lane/approval-chips.js';
import { proposalPendingAction } from '../../orchestrator-v5/agent-lane/durable-proposal.js';
import { heldCardUnderReview } from '../../orchestrator-v5/agent-lane/proposal-object/still-applies.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';

type Rec = Record<string, unknown>;
let saved: Rec | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  saved = null;
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  store.ensureScenarioExists.mockResolvedValue({ user_id: null });
  store.getScenarioOwner.mockResolvedValue(null);
  store.scenarioExists.mockResolvedValue(true);
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
  for (const read of [store.readRecent, store.readFactsFor, store.readFactsWithTurnFor]) read.mockResolvedValue([]);
  store.readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [], total_count: 0 });
  store.readAnalysisInvalidatedAt.mockResolvedValue(null);
  loadGraph.mockImplementation(async () => (saved === null ? null : JSON.parse(JSON.stringify(saved))));
  append.mockImplementation(async (w: Rec) => { saved = JSON.parse(JSON.stringify(w.graph)) as Rec; return { id: `turn-${append.mock.calls.length}` }; });
  store.readExistingScenario.mockImplementation(async () => (saved === null ? null
    : { userId: null, graph: JSON.parse(JSON.stringify(saved)), briefText: BRIEF, analysisInvalidatedAt: null, revision: append.mock.calls.length }));
});

const first = () => withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
/** The same graph with no program: its living model loses only the discriminator, as a non-program scenario's would. */
const withoutProgram = (g: Rec): Rec => { const { living_model: _program, ...plain } = g; return plain; };
async function register(graph: Rec): Promise<void> {
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const expected = saved === null ? null : computeGraphIdentityHash(saved as never)!.value;
  const res = await injectAsCeeWriter(app, { method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`,
    payload: { graph, thin_core: true, expected_graph_identity_hash: expected, brief_text: BRIEF } });
  await app.close();
  expect(res.statusCode, res.body).toBe(200);
}
const counts = () => [spies.core.mock.calls.length, spies.full.mock.calls.length, spies.thread.mock.calls.length, spies.scope.mock.calls.length,
  store.readMostRecentPendingActions.mock.calls.length];

describe('a model program\'s save runs none of the legacy model\'s write rules (inventory F4)', () => {
  it('a save over a saved program: no projection pass, no scope check, no legacy threading; ONE pending read; the program stored exactly as sent, its held card carried as it stands', async () => {
    await register(first().graph as Rec);
    const base = savedProgramOf(saved)!;
    // A card held on the saved program; a Run-only save keeps its revision, so the card stays approvable.
    const card = holdProgramCard(new ProposalStore(), { scenarioId: SCENARIO, userId: null, graphHash: computeAnalysisAffectingGraphHash(saved as never)!,
      identity: computeGraphIdentityHash(saved as never)!.value, base },
    { label: 'Estimate the oven price', basis: 'a typical oven', program: withNewRun({ ...base, canonical: bakery() }).program, changes: [] });
    const carrier = proposalPendingAction(card, { id: approvalChipIdFor(card.proposal_id), label: 'Make this change', message: 'Yes.' }, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() });
    store.readMostRecentPendingActions.mockResolvedValue([carrier]);
    vi.clearAllMocks();
    store.readMostRecentPendingActions.mockResolvedValue([carrier]);
    const sent = withNewRun(base).graph as Rec;
    await register(sent);
    expect(counts(), 'core projection, full projection, legacy threading, scope check, pending reads').toEqual([0, 0, 0, 0, 1]);
    expect(JSON.stringify(savedProgramOf(saved))).toBe(JSON.stringify(savedProgramOf(sent)));
    // The display graph as sent; the register adds only each entity's storage ref (`withEntityRefs`).
    const withoutRef = (nodes: unknown) => (nodes as Rec[]).map(({ ref: _ref, ...n }) => n);
    expect(JSON.stringify(withoutRef((saved as Rec).nodes))).toBe(JSON.stringify(sent.nodes));
    const row = append.mock.calls.at(-1)![0] as { pending_actions?: PendingAction[] };
    expect(row.pending_actions, 'the held card is carried, exactly').toEqual([carrier]);
    expect(heldCardUnderReview(row.pending_actions![0]!)).toBe(false);
  });

  it('CONTRAST: the SAME graph with no program, as a core write, still runs the projection, the scope check and the legacy threading, and reads its pendings more than once', async () => {
    await register(withoutProgram(first().graph as Rec));
    vi.clearAllMocks();
    store.readMostRecentPendingActions.mockResolvedValue([]);
    await register(withoutProgram(withNewRun(savedProgramOf(first().graph)!).graph as Rec));
    const [core, full, thread, scope, reads] = counts();
    expect([core > 0, full, thread > 0, scope > 0, reads > 1]).toEqual([true, 0, true, true, true]);
  });
});
