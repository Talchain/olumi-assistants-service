/**
 * ⛔ "APPLIED" RESTS ON THE WRITER'S OWN TYPED OUTCOME, THROUGH THE REAL DOOR (MG F1 T6 fix-forward #2471; CODEX overflow
 * 5937013605 P1 + P2, DL scope on the PR).
 *
 * Served `b213138f` said "could not be confirmed" on 4 of 4 option presses that landed (R3 #85 5936732295): a guest's write
 * mints no model version, and #2467 required a receipt. The first fix-forward inferred "this operation wrote" from the
 * reply's display bytes, which a no-write replay also carries (`replyForAttemptThatWroteNothing`). Now the Agent reads the
 * writer's typed `writeOutcome` in-process (`commitOptionStatusInProcess`, fenced by `runFencedInProcessWrite` exactly as
 * the Agent route wires it).
 *
 * Every row runs the REAL writer (`applyOptionStatusEdit`), the REAL door (`dispatchOptionStatusEdit`), the REAL port and
 * the REAL fence wrapper into the REAL Agent. Only the store edges are faked, spreading the real modules (the
 * `factor-value-edit-freshness-branch` harness): the graph read, the analysis-facts read, the pending-action read and
 * `commitDirectAnswer`, whose `CommitResult` is the seam that says what THIS attempt did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadPersistedGraphStrict: vi.fn(),
  loadMostRecentPendingActionsIntegrityStrict: vi.fn(),
  loadScenarioAnalysisFactsForRead: vi.fn(),
  commitDirectAnswer: vi.fn(),
  getSessionStore: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadPersistedGraphStrict: mocks.loadPersistedGraphStrict,
  loadMostRecentPendingActionsIntegrityStrict: mocks.loadMostRecentPendingActionsIntegrityStrict,
  loadScenarioAnalysisFactsForRead: mocks.loadScenarioAnalysisFactsForRead,
}));

vi.mock('../../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commit.js')>()),
  commitDirectAnswer: mocks.commitDirectAnswer,
}));

vi.mock('../../session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session/index.js')>()),
  getSessionStore: mocks.getSessionStore,
}));

import { authorisationTurnId, createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { userWordsOf } from '../stated-by-user.js';
import { commitOptionStatusInProcess, type CommitOptionStatusInput } from '../../system-events/dispatch.js';
import { PARTICIPATION_FOR_STATUS } from '../../system-events/option-status-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { reconcileScenarioAnalysisFacts, SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT } from '../../context/reconcile-scenario-analysis-facts.js';
import { runFencedInProcessWrite } from '../../../orchestrator/turn-fence-prehandler.js';
import { TurnFenceRejectedError } from '../../session/turn-fence.js';
import { ModelVersionMutationReceiptV1LocalSchema } from '../../model-management/mutation-receipt.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';

type Json = Record<string, any>;
const SCENARIO = '550e8400-e29b-41d4-a716-446655440e71';
const OPTION = 'o-launch';
const SAID = 'Launching now is not really an option for us — take it out.';
const ctxOf = (turn: string, earlier: readonly string[] = []) =>
  ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: userWordsOf(earlier, turn), user_turn_text: turn });

/** A receipt that passes the real strict schema, naming the turn that committed it. */
const receiptFor = (turnId: string) => ModelVersionMutationReceiptV1LocalSchema.parse({
  schema: 'model_version_mutation_receipt.v1', scenario_id: SCENARIO,
  mutation_id: 'cb1dd25d-36c3-4beb-aadf-5a016b2bce25', version_id: 'c0813c01-1111-4111-8111-111111111111', sequence: 7,
  graph: { nodes: [], edges: [] }, full_hash: 'a'.repeat(64), hash_algorithm: 'sha256', identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1', graph_schema_version: 'graph_v3', analysis_affecting_hash: 'b'.repeat(64),
  actor: { kind: 'unknown' }, creation: { kind: 'committed_mutation' }, source_turn_id: turnId,
  lineage: { kind: 'known', parent_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', root_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
  undo_version_id: null, event_id: 'model_version_created_mutation_cb1dd25d-36c3-4beb-aadf-5a016b2bce25',
});

const healthyEmpty = () => ({
  hotWindow: { status: 'ok' as const, facts: [] as never[] },
  factSet: reconcileScenarioAnalysisFacts({
    scenarioId: SCENARIO, hotWindowFacts: [],
    durableRead: { status: 'ok', scenario_id: SCENARIO, query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT, total_count: 0, facts: [] },
  }),
});

/** The stored model: the D1 fixture, parsed exactly as the store hands it on. */
let stored: Json;
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as Parameters<typeof computeAnalysisAffectingGraphHash>[0])!;
const optionOf = (g: Json): Json => (g.nodes as Json[]).find((n) => n.id === OPTION)!;
const withStatus = (g: Json, status: 'feasible' | 'infeasible' | 'removed'): Json => ({
  ...g, nodes: (g.nodes as Json[]).map((n) => (n.id === OPTION ? { ...n, option_status: status, analysis_participation: PARTICIPATION_FOR_STATUS[status] } : n)),
});

/** The Agent's graph read (the card's base hash and the read-back), over the stored model. */
const d: InternalDispatch = async (path) => {
  if (path.endsWith('/graph')) return { status: 200, json: { graph: stored, graph_hash: hashOf(stored) } };
  throw new Error(`unexpected dispatch ${path}`);
};

/** The port exactly as `agent-v1-turn.ts` wires it: the real door inside the real fence wrapper. */
const fenceRefused = (verdict: 'unclaimed' | 'unavailable') => ({ status: 'refused' as const, reason: `turn_fence_${verdict}` });
const port = (input: CommitOptionStatusInput) =>
  runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitOptionStatusInProcess(input, 'req-t6'), () => ({ status: 'stale' as const }), fenceRefused);

/**
 * What THIS attempt did, as the commit seam reports it (`CommitResult`): `thisAttemptWrote`, the minted version
 * (`modelVersionReceipt`, null = none) and the response's public receipt. `persisted` is what the store holds afterwards.
 */
function commitAnswers(a: { wrote: boolean; minted: boolean; receipt?: unknown; persisted: (written: Json) => Json }) {
  mocks.commitDirectAnswer.mockImplementation(async (response: Json, metadata: Json) => {
    stored = a.persisted(metadata.graph as Json);
    return {
      response: { ...response, ...(a.receipt !== undefined ? { model_version_receipt: a.receipt } : {}) },
      performed: true, persisted_row_id: 'row-1',
      modelVersionReceipt: a.minted ? { version_number: 7 } : null,
      graphPersisted: true, persistedGraph: stored, persistedAnalysisGraphHash: hashOf(stored),
      thisAttemptWrote: a.wrote,
    };
  });
}

async function press() {
  const store = new ProposalStore();
  const caps = createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionStatus: port });
  const p = await caps.proposeOptionStatus!(ctxOf(SAID), { option_label: 'Launch now', status: 'removed', rationale: SAID });
  expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
  const r = await caps.authoriseChange(ctxOf('Yes.', [SAID]), { proposal_id: String(p.proposal_id) });
  return { r, turnId: authorisationTurnId(String(p.proposal_id)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  const parsed = GraphV3.safeParse(buildD1Fixture());
  if (!parsed.success) throw new Error(`fixture must parse: ${JSON.stringify(parsed.error.issues[0])}`);
  stored = parsed.data as Json;
  expect(optionOf(stored).label, 'precondition: the option the user names').toBe('Launch now');
  mocks.loadPersistedGraphStrict.mockImplementation(async () => stored);
  mocks.loadMostRecentPendingActionsIntegrityStrict.mockResolvedValue([]);
  mocks.loadScenarioAnalysisFactsForRead.mockResolvedValue(healthyEmpty());
  // No `claimTurnFence`: the fence admits (as with no fence store); a row that needs a verdict throws it from the commit.
  mocks.getSessionStore.mockReturnValue({});
});

describe('the Agent says APPLIED only on the option-status writer\'s own typed outcome (#2471)', () => {
  it('RED (R3 5936732295, served b213138f): a GUEST\'s commit (this attempt wrote, no version minted, no receipt) → APPLIED', async () => {
    commitAnswers({ wrote: true, minted: false, persisted: (written) => written });
    const { r } = await press();
    expect(mocks.commitDirectAnswer, 'the real door committed once').toHaveBeenCalledTimes(1);
    expect(optionOf(stored)).toMatchObject({ option_status: 'removed', analysis_participation: 'retained_excluded' });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true, receipts: [] }));
    expect(String(r.follow_up)).toMatch(/Launch now/);
  });

  it('CONTROL: a SIGNED-IN commit (version minted, its receipt names THIS turn) → APPLIED, with the receipt', async () => {
    let turn = '';
    mocks.commitDirectAnswer.mockImplementationOnce(async (response: Json, metadata: Json) => {
      turn = String(metadata.turn_id); stored = metadata.graph as Json;
      return { response: { ...response, model_version_receipt: receiptFor(turn) }, performed: true, persisted_row_id: 'row-1',
        modelVersionReceipt: { version_number: 7 }, graphPersisted: true, persistedGraph: stored, persistedAnalysisGraphHash: hashOf(stored), thisAttemptWrote: true };
    });
    const { r, turnId } = await press();
    expect(turn).toBe(turnId);
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, applied: true, receipts: [expect.objectContaining({ source_turn_id: turnId })] }));
  });

  it('CODEX P1: a NO-WRITE replay (a reused-id conflict) whose stored bytes hold the status because ANOTHER writer set it → UNCONFIRMED, never "Saved"', async () => {
    // This attempt wrote nothing; the store holds the requested status from someone else; no receipt names this turn.
    commitAnswers({ wrote: false, minted: false, persisted: () => withStatus(stored, 'removed') });
    const { r } = await press();
    expect(optionOf(stored), 'precondition: the model DOES hold the status (another writer)').toMatchObject({ option_status: 'removed' });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' }));
    expect(String(r.detail)).not.toMatch(/did not change|not changed|nothing changed/i);
  });

  it('CONTROL: a replay PROVEN to be this turn\'s own earlier write (its stored receipt names this turn, the change is visible) → APPLIED', async () => {
    mocks.commitDirectAnswer.mockImplementationOnce(async (response: Json, metadata: Json) => {
      stored = metadata.graph as Json;
      return { response: { ...response, model_version_receipt: receiptFor(String(metadata.turn_id)) }, performed: true, persisted_row_id: 'row-1',
        modelVersionReceipt: { version_number: 7 }, graphPersisted: true, persistedGraph: stored, persistedAnalysisGraphHash: hashOf(stored), thisAttemptWrote: false };
    });
    const { r } = await press();
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, applied: true }));
  });

  it('CODEX P2: a SIGNED-IN write whose commit MINTED a version but whose receipt is missing → UNCONFIRMED', async () => {
    commitAnswers({ wrote: true, minted: true, persisted: (written) => written });
    const { r } = await press();
    expect(optionOf(stored), 'precondition: the write landed').toMatchObject({ option_status: 'removed' });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, applied: false, refusal: 'not_confirmed' }));
  });

  it('a receipt naming ANOTHER turn → UNCONFIRMED (someone else\'s version)', async () => {
    commitAnswers({ wrote: true, minted: true, receipt: receiptFor('another-turn'), persisted: (written) => written });
    const { r } = await press();
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, applied: false, refusal: 'not_confirmed' }));
  });

  it.each(['superseded', 'stopped'] as const)('B8 FENCE (#2456): a %s turn → STALE ("superseded"), nothing claimed, never applied', async (verdict) => {
    mocks.commitDirectAnswer.mockRejectedValueOnce(new TurnFenceRejectedError(`fence ${verdict}`, { verdict, generation: 1, maxGeneration: 2 } as never));
    const before = JSON.stringify(stored);
    const { r } = await press();
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, applied: false, refusal: 'superseded' }));
    expect(JSON.stringify(stored), 'nothing written').toBe(before);
  });

  it('B8 FENCE: an UNAVAILABLE fence reaches the wrapper (never swallowed into "unconfirmed") → not applied, nothing written', async () => {
    mocks.commitDirectAnswer.mockRejectedValueOnce(new TurnFenceRejectedError('fence unavailable', { verdict: 'unavailable', generation: null, maxGeneration: null } as never));
    const { r } = await press();
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, applied: false, refusal: 'not_applied' }));
  });
});
