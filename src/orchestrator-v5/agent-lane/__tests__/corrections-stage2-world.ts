import Fastify from 'fastify';
import { afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { injectAsCeeWriter } from '../../../../tests/utils/inject-as-cee-writer.js';

vi.mock('../../../config/index.js', async original => {
  const actual = await original<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as object | null } }));
vi.mock('../../session/index.js', async original => ({ ...await original<Record<string, unknown>>(), getSessionStore: () => storeRef.value }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
import registerRoute from '../../../routes/assist.v1.scenario-graph-register.js';
import graphRoute from '../../../routes/assist.v1.scenario-graph.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type AgentToolContext } from '../runtime/agent-tools.js';
import { ProposalStore, type StructuredProposal } from '../proposal.js';
import { proposalPendingAction, rehydrateProposals } from '../durable-proposal.js';
import { parsePendingAction } from '../../session/pending-action.js';
import { approvalChipsFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';

export type Rec = Record<string, any>;
const close: Array<() => Promise<unknown>> = [];
afterEach(async () => { while (close.length) await close.pop()!(); });

/** Real register/read routes over a JSON-rehydrated store double; no provider, database or remote service. */
export async function correctionWorld(original: Rec, message: string) {
  const scenario = randomUUID();
  let graph: Rec = structuredClone(original), revision = 2;
  const writes: Rec[] = [], registers: Rec[] = [], responses: Rec[] = [];
  const installStore = () => { storeRef.value = {
    append: async (write: Rec) => { graph = structuredClone(write.graph); writes.push(structuredClone(write)); revision += 1; return { id: `turn-${revision}` }; },
    loadGraph: async () => structuredClone(graph),
    loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: null, revision }),
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true, readCommittedTurn: async () => null, readMostRecentPendingActions: async () => [], readRecent: async () => [],
  }; };
  installStore();
  const appOf = async () => { const app = Fastify(); await registerRoute(app); await graphRoute(app); await app.ready(); return app; };
  let app = await appOf(); close.push(() => app.close());
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(graph),
      graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: computeGraphIdentityHash(graph as never) } };
    if (!path.endsWith('/graph/register')) throw new Error(`No provider or other writer is allowed: ${path}`);
    registers.push(structuredClone(body as Rec));
    const response = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body as Rec });
    responses.push({ status: response.statusCode, body: response.json() });
    return { status: response.statusCode, json: response.json() };
  };
  const proposals = new ProposalStore();
  const caps = (store = proposals) => createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { turnAuthority: true,
    readCommittedTurnLedger: async () => ({ first_user_message: message, messages: [], complete: true,
      write_turn_ids: writes.map(w => w.turn_id) }) as never });
  const ctx: AgentToolContext = { scenario_id: scenario, authenticated_user_id: null, request_id: 'native-correction', turn_id: randomUUID(),
    user_turn_text: message, user_text: message, verified_user_messages: [message], user_text_complete: true };
  return { ctx, proposals, caps, graph: () => graph, writes, registers, responses,
    change: (fn: (g: Rec) => void) => fn(graph),
    offer: (tool: string, args: unknown) => dispatchTool(tool, JSON.stringify(args), ctx, caps()),
    press: (pid: string, store = proposals, own = true) => caps(store).authoriseChange({ ...ctx, turn_id: randomUUID(), user_turn_text: '',
      ...(own ? { typed_approval_of: pid } : {}) }, { proposal_id: pid }),
    chips: (tool: string, result: Rec) => approvalChipsFor([{ name: tool, ok: true, mutated: false, proposal_id: result.proposal_id }],
      pid => ({ proposal: proposals.get(pid)!, result, args: {} })),
    restoreCard: (proposal: StructuredProposal, result: Rec, tool = 'propose_statement') => {
      const chip = approvalChipsFor([{ name: tool, ok: true, mutated: false, proposal_id: proposal.proposal_id }],
        () => ({ proposal, result, args: {} }))[0]!;
      const pending = proposalPendingAction(proposal, chip, { scenario_id: scenario, emitted_at_iso: new Date().toISOString() });
      const parsed = parsePendingAction(JSON.parse(JSON.stringify(pending)));
      const store = new ProposalStore();
      rehydrateProposals([parsed!], store, { scenario_id: scenario, user_id: null });
      return store;
    },
    cold: async () => {
      await app.close();
      graph = JSON.parse(JSON.stringify(graph)); installStore(); app = await appOf();
      // A new capabilities/store has no earlier proposal, cached source or readback.
      const fresh = caps(new ProposalStore());
      const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${scenario}/graph`, payload: {} });
      return { status: response.statusCode, body: response.json() as Rec, fresh };
    },
  };
}
