/**
 * ⭐ A MODEL PROGRAM'S CARD HOLDS WHILE ITS OWN REVISION DOES (inventory F6, part a). A program card was judged by the analysis hash
 * of the display projection when held, served and threaded, and by the full graph identity when pressed, so two cases offered a
 * card and then refused its press `superseded`:
 *  · W2: the model moved where the analysis hash cannot see (an approval, a label, a quote): the card stayed approvable;
 *  · W3: a Run was stored on the unchanged model (a Run press after an engine update): the card was refused although nothing of
 *    the person's had moved.
 * The REAL apply_change tool, the REAL register and the REAL scenario read (the store is a stateful mock; 0 AI calls). Synthetic bakery.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { RunContext, type FunctionTool } from '@openai/agents';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

const SCENARIO = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

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
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { MODEL_PROGRAM, savedProgramOf, type SavedProgram } from '../../orchestrator-v5/model-program-turn/program-store.js';
import { holdProgramCard } from '../../orchestrator-v5/model-program-turn/program-tools.js';
import { programCardApplies, programDigestOf } from '../../orchestrator-v5/model-program-turn/program-card.js';
import { bakery, BRIEF } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { ProposalStore, type StructuredProposal } from '../../orchestrator-v5/agent-lane/proposal.js';
import { approvalChipIdFor } from '../../orchestrator-v5/agent-lane/approval-chips.js';
import { proposalPendingAction } from '../../orchestrator-v5/agent-lane/durable-proposal.js';
import { heldCardAppliesAt, heldCardUnderReview } from '../../orchestrator-v5/agent-lane/proposal-object/still-applies.js';
import { isSavedRead, readSaved } from '../../orchestrator-v5/path-b/tools/context-tool.js';
import { pathBTools } from '../../orchestrator-v5/path-b/tools/index.js';
import type { CanonicalModelT } from '../../orchestrator-v5/model-program/canonical.js';
import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';

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
  const dispatch = async (path: string, payload: unknown) => {
    const r = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: payload as never });
    return { status: r.statusCode, json: r.json() as Rec };
  };
  return { app, dispatch };
}

/** The bakery saved, and a change card held on it (one new figure), with the program it was made on as its base. */
async function heldCard() {
  const routes = await realRoutes();
  const first = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
  const created = await routes.dispatch(`/assist/v1/scenarios/${SCENARIO}/graph/register`, { graph: first.graph, thin_core: true, expected_graph_identity_hash: null, brief_text: BRIEF });
  expect(created.status).toBe(200);
  const base = await readSaved({ dispatch: routes.dispatch }, SCENARIO);
  if (!isSavedRead(base)) throw new Error('no saved base');
  const changed = bakery();
  changed.quantities = changed.quantities.map((x) => (x.id === 'oven_price' ? { ...x, status: 'estimated', author: 'olumi', value: 2500, low: 2000, high: 3000, range_kind: 'plausible',
    question: null, basis: 'A typical second-hand deck oven.' } : x)) as CanonicalModelT['quantities'];
  const next: SavedProgram = withNewRun({ ...savedProgramOf(base.graph)!, canonical: changed }).program;
  const proposals = new ProposalStore();
  const card = holdProgramCard(proposals, { scenarioId: SCENARIO, userId: null, graphHash: base.graphHash, identity: base.identity!, base: savedProgramOf(base.graph)! },
    { label: 'Estimate the oven price', basis: 'a typical oven', program: next,
      changes: [{ id: 'oven_price', kind: 'quantity', action: 'change', label: 'oven price', before: 'still to be given', after: 'about £2,500', author: 'olumi' }] });
  const tools = pathBTools({ dispatch: routes.dispatch, proposals, pressedProposal: card.proposal_id } as never,
    { scenario_id: SCENARIO, authenticated_user_id: null, turn_id: 'press-1', verified_user_messages: ['Yes, make that change.'], user_turn_text: 'Yes, make that change.' },
    'core', () => {}, 'program');
  const apply = tools.find((t) => t.name === 'apply_change') as FunctionTool;
  const press = async (): Promise<Rec> => JSON.parse(String(await apply.invoke(new RunContext(), JSON.stringify({ proposal_id: card.proposal_id })))) as Rec;
  /** A write the card did not make: `graph` saved on the identity saved now. */
  const resave = async (graph: Rec) => {
    const now = await readSaved({ dispatch: routes.dispatch }, SCENARIO);
    if (!isSavedRead(now)) throw new Error('no read');
    const r = await routes.dispatch(`/assist/v1/scenarios/${SCENARIO}/graph/register`, { graph, thin_core: true, expected_graph_identity_hash: now.identity, brief_text: BRIEF });
    expect(r.status).toBe(200);
  };
  return { ...routes, base, first, next, card, press, resave };
}

const carrierOf = (card: StructuredProposal): PendingAction => proposalPendingAction(card, { id: approvalChipIdFor(card.proposal_id), label: 'Make this change', message: 'Yes, make that change.' },
  { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() });

describe('a model program card is judged by its own revision', () => {
  it('the card records the revision it was made on, and applies exactly while the saved program has it', async () => {
    const { app, dispatch, base, card, resave, first } = await heldCard();
    expect(card.base_revision_digest).toBe(programDigestOf(savedProgramOf(base.graph)!));
    expect(programCardApplies(card, base.graph)).toBe(true);
    // A card that does not carry its revision, or is not a program card, is left to the caller's own rule.
    const { base_revision_digest: _d, ...legacy } = card;
    expect(programCardApplies(legacy, base.graph)).toBeUndefined();
    expect(programCardApplies({ ...card, living_model: { nodes: [] } }, base.graph)).toBeUndefined();
    // A Run stored on the same model keeps the revision; a moved model does not.
    await resave(withNewRun(first.program).graph);
    const runOnly = await readSaved({ dispatch }, SCENARIO);
    await app.close();
    if (!isSavedRead(runOnly)) throw new Error('no read');
    expect(programCardApplies(card, runOnly.graph)).toBe(true);
  });

  it('W3 RED→GREEN: a Run stored on the unchanged model since the card was made → the press saves the card\'s model on the Runs saved now, never "superseded"', async () => {
    const { app, dispatch, card, press, resave, first } = await heldCard();
    // A Run press after an engine update: the same model, a new Run stored. Its revision is the card's.
    await resave(withNewRun(first.program).graph);
    const between = await readSaved({ dispatch }, SCENARIO);
    if (!isSavedRead(between)) throw new Error('no read');
    const runsBefore = savedProgramOf(between.graph)!.runs;
    expect(runsBefore).toHaveLength(2);
    const told = await press();
    const after = await readSaved({ dispatch }, SCENARIO);
    await app.close();
    expect(told).toMatchObject({ status: 'ok', data: { saved: true } });
    if (!isSavedRead(after)) throw new Error('no readback');
    const saved = savedProgramOf(after.graph)!;
    // The card's model, the person's words as the card had them, and every Run saved since kept, with one new Run for this model.
    expect(stableStringify(saved.canonical)).toBe(stableStringify(savedProgramOf({ living_model: card.living_model })!.canonical));
    expect(saved.runs).toHaveLength(3);
    expect(stableStringify(saved.runs.slice(0, 2))).toBe(stableStringify(runsBefore));
    expect(saved.runs[2]!.receipt.revision_digest).toBe(programDigestOf(saved));
  });

  it('W2 RED→GREEN: the model moved where the analysis hash cannot see (an approval) → the register keeps the held card for review, never approvable; its press stays refused', async () => {
    const { app, dispatch, base, card, press, resave, first } = await heldCard();
    // The person approved one of their own figures: the model moved; the display projection did not.
    const approved = bakery();
    approved.quantities = approved.quantities.map((x) => (x.id === 'base_sales' ? { ...x, approval: 'approved' as const } : x));
    store.readMostRecentPendingActions.mockResolvedValue([carrierOf(card)]);
    await resave(withNewRun({ ...first.program, canonical: approved }).graph);
    const moved = await readSaved({ dispatch }, SCENARIO);
    if (!isSavedRead(moved)) throw new Error('no read');
    // The case itself: the analysis hash is unchanged, the program's revision is not.
    expect(moved.graphHash).toBe(base.graphHash);
    expect(programCardApplies(card, moved.graph)).toBe(false);
    // The register's own row carries the card kept for review, and no reader serves it as approvable.
    const row = append.mock.calls.at(-1)![0] as { pending_actions?: PendingAction[] };
    const carried = (row.pending_actions ?? []).filter((pa) => pa.action.kind === 'apply_proposed_change' && pa.action.inline_patch['agent_proposal'] !== undefined);
    expect(carried).toHaveLength(1);
    expect(heldCardUnderReview(carried[0]!)).toBe(true);
    expect(heldCardAppliesAt(card, moved.graph, moved.graphHash)).toBe(false);
    // And the press agrees: refused, nothing written.
    const writes = append.mock.calls.length;
    const told = await press();
    await app.close();
    expect(told).toMatchObject({ status: 'refused', reason: 'superseded' });
    expect(append.mock.calls.length).toBe(writes);
  });
});
