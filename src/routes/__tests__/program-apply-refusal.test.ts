/**
 * A PRESSED CARD WHOSE SAVE IS REFUSED, AS THE AGENT READS IT (Paul, 25 Oct 09:39–09:41Z, scenario 19faa1f8): three presses
 * were each refused by the register, and the agent, told only `registration_refused`, blamed his "typed yes" and offered
 * the same button again. The REAL apply_change tool, the REAL register and the REAL scenario read (the store is a stateful
 * mock; 0 AI calls): the result the agent reads says the approval was received, what refused the save, and that nothing
 * was written; an outcome that cannot be confirmed still never says so. Synthetic bakery.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { RunContext, type FunctionTool } from '@openai/agents';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

const SCENARIO = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn() };
});
const append = vi.fn();
const loadGraph = vi.fn();
const store = { append, loadGraph, ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(), readCommittedTurn: vi.fn(), readMostRecentPendingActions: vi.fn(),
  readExistingScenario: vi.fn(), readRecent: vi.fn(), readFactsFor: vi.fn(), readFactsWithTurnFor: vi.fn(), readScenarioRunAnalysisFactsFor: vi.fn(), readAnalysisInvalidatedAt: vi.fn() };
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity }));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { PROGRAM_GRAPH_MAX_NODES } from '../../config/graphCaps.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { MODEL_PROGRAM, savedProgramOf, type SavedProgram } from '../../orchestrator-v5/model-program-turn/program-store.js';
import { holdProgramCard } from '../../orchestrator-v5/model-program-turn/program-tools.js';
import { bakery, BRIEF, q } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { ProposalStore } from '../../orchestrator-v5/agent-lane/proposal.js';
import { isSavedRead, readSaved } from '../../orchestrator-v5/path-b/tools/context-tool.js';
import { pathBTools } from '../../orchestrator-v5/path-b/tools/index.js';

type Rec = Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: 'u-1' });
  store.ensureScenarioExists.mockResolvedValue({ user_id: null });
  store.getScenarioOwner.mockResolvedValue(null);
  store.scenarioExists.mockResolvedValue(true);
  store.readCommittedTurn.mockResolvedValue(null);
  store.readMostRecentPendingActions.mockResolvedValue([]);
  for (const read of [store.readRecent, store.readFactsFor, store.readFactsWithTurnFor]) read.mockResolvedValue([]);
  store.readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [], total_count: 0 });
  store.readAnalysisInvalidatedAt.mockResolvedValue(null);
});

/** A stateful store behind the REAL register and the REAL scenario read: what the register appends is what the read serves. */
async function realRoutes() {
  let saved: Rec | null = null;
  loadGraph.mockImplementation(async () => (saved === null ? null : JSON.parse(JSON.stringify(saved))));
  append.mockImplementation(async (w: Rec) => { saved = JSON.parse(JSON.stringify(w.graph)) as Rec; return { id: `turn-${append.mock.calls.length}` }; });
  store.readExistingScenario.mockImplementation(async () => (saved === null ? null
    : { userId: null, graph: JSON.parse(JSON.stringify(saved)), briefText: BRIEF, analysisInvalidatedAt: null, revision: append.mock.calls.length }));
  const app = Fastify();
  await registerRoute(app);
  await scenarioGraphRoute(app);
  app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
  await app.ready();
  // The Agent's in-process dispatch: a register inside its mark for this scenario, as `core-turn.ts` sends it.
  const dispatch = async (path: string, payload: unknown) => {
    const r = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: payload as never });
    return { status: r.statusCode, json: r.json() as Rec };
  };
  return { app, dispatch };
}

/**
 * The bakery saved, and a pressed card on it: `tooLarge`, a program the store will not take (more figures than a saved model
 * may hold: a program's own cap, W11); otherwise one ordinary new figure.
 */
async function pressedCard(tooLarge: boolean) {
  const routes = await realRoutes();
  const first = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
  const created = await routes.dispatch(`/assist/v1/scenarios/${SCENARIO}/graph/register`, { graph: first.graph, thin_core: true, expected_graph_identity_hash: null, brief_text: BRIEF });
  expect(created.status).toBe(200);
  const base = await readSaved({ dispatch: routes.dispatch }, SCENARIO);
  if (!isSavedRead(base)) throw new Error('no saved base');
  const big = bakery();
  big.quantities.push(...Array.from({ length: tooLarge ? PROGRAM_GRAPH_MAX_NODES : 1 }, (_, i) => q(`stall_${i}`, 'loaf/week', { status: 'asked', question: `How many loaves does stall ${i} sell?` })));
  const next: SavedProgram = withNewRun({ ...first.program, canonical: big }).program;
  const proposals = new ProposalStore();
  const card = holdProgramCard(proposals, { scenarioId: SCENARIO, userId: null, graphHash: base.graphHash, identity: base.identity! },
    { label: 'Ask what each stall sells', basis: 'their stalls', program: next,
      changes: big.quantities.slice(bakery().quantities.length).map((x) => ({ id: x.id, kind: 'quantity' as const, action: 'add' as const, label: x.label, before: null, after: 'still to be given', author: 'olumi' as const })) });
  // The press: on this turn the apply is bound to the pressed card (`pressedProposal`), as the core route binds it.
  const tools = pathBTools({ dispatch: routes.dispatch, proposals, pressedProposal: card.proposal_id } as never,
    { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: 'press-1', verified_user_messages: ['Yes, make that change.'], user_turn_text: 'Yes, make that change.' },
    'core', () => {}, 'program');
  const apply = tools.find((t) => t.name === 'apply_change') as FunctionTool;
  const press = async (): Promise<Rec> => JSON.parse(String(await apply.invoke(new RunContext(), JSON.stringify({ proposal_id: card.proposal_id })))) as Rec;
  return { ...routes, base, first, press };
}

describe('a pressed program card whose save is refused, as the agent reads it', () => {
  it('Paul 25 Oct: the agent is told the approval was received, what refused the save, and that nothing was written; the saved model is unchanged', async () => {
    const { app, dispatch, base, first, press } = await pressedCard(true);
    const told = await press();
    expect(told).toEqual({ status: 'refused', reason: 'registration_refused',
      detail: 'The person’s approval of this card was received; the save itself was refused by the model store’s check, so nothing was written and the saved model is unchanged. Pressing the card again would be refused the same way.',
      data: { code: 'GRAPH_TOO_LARGE', written: false } });
    // Nothing was written: one append (the first save), and the read serves the base, byte for byte.
    expect(append).toHaveBeenCalledTimes(1);
    const after = await readSaved({ dispatch }, SCENARIO);
    await app.close();
    if (!isSavedRead(after)) throw new Error('no readback');
    expect(after.identity).toBe(base.identity);
    expect(stableStringify(savedProgramOf(after.graph))).toBe(stableStringify(first.program));
  });

  it('KEPT DISTINCTION: a save whose outcome cannot be confirmed is said as unknown, never as "nothing was written"', async () => {
    const { app, press } = await pressedCard(false);
    // The store fails in a way that says nothing about whether the write landed: the register answers 5xx.
    append.mockRejectedValue(new Error('connection reset'));
    const told = await press().finally(() => app.close());
    expect(told).toMatchObject({ status: 'unavailable', write: 'unknown' });
    expect(JSON.stringify(told)).not.toMatch(/nothing was written|written/);
  });
});
