/**
 * ⭐ CLAIM RECORD (plan v6.0 S1a; outbox/CLAIM-RECORD-SPEC.md): the `user_statements` record is the claim. Each statement says who
 * asserts its figure (`said_by`: user / party / unknown / olumi); the record carries its status, its approval (the displayed card's
 * proposal id) and the claims it supersedes. Real path: the AI's reading → `propose_statement` → the card → the press → the one
 * commit → read-back. SYNTHETIC words only.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import * as statements from '../statements.js';
import { claimStatusOf } from '../statements.js';
import { userStatementFor } from '../statements.js';
import { saidByOf, userStatementOf } from '../../agent-lane/user-statements.js';

type Rec = Record<string, any>;
const SID = 'c1a1c1a1-0000-4000-8000-00000000c1a1';
const plain = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
const START = (): Rec => plain({ nodes: [
  { id: 'waste_goal', kind: 'goal', label: 'Daily food waste goal' },
  { id: 'pre_order', kind: 'factor', label: 'Pre-order system in use', observed_state: { value: 0, raw_value: 0, unit: '%' } },
  { id: 'daily_waste', kind: 'factor', label: 'Daily food waste', observed_state: { value: 40, raw_value: 40, unit: 'kg' } },
], edges: [
  { id: 'pre_order::daily_waste', from: 'pre_order', to: 'daily_waste', strength: { mean: -0.3, std: 0.2 }, exists_probability: 0.8, effect_direction: 'negative' },
  { id: 'daily_waste::waste_goal', from: 'daily_waste', to: 'waste_goal', strength: { mean: 0.9, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
] });

function world(start: Rec = START()) {
  let json = JSON.stringify(start);
  const graph = (): Rec => JSON.parse(json) as Rec;
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [], readAnalysisInvalidatedAt: async () => null, getScenarioOwner: async () => null,
    append: async (write) => { const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite, id = `claim-row-${rows.length + 1}`;
      rows.push({ id, write: s }); if (s.graph !== undefined) json = JSON.stringify(s.graph); return { id }; },
    readRecent: async () => rows.map(({ id, write: x }) => makeSessionTurnRow({ id, scenario_id: x.scenario_id, turn_id: x.turn_id,
      turn_class: x.turn_class, handler_id: x.handler_id, request_hash: x.request_hash, response_emitted: x.response_emitted, llm_calls_used: x.llm_calls_used, duration_ms: x.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((r) => ids.includes(r.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-18T15:00:05.000Z', fact }))),
  });
  const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    const out = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'claim', requestHash: `claim:${input.turn_id}`,
      stage: 'frame', freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.statement_record !== undefined && 'node_id' in input.statement_record ? { statementRecord: input.statement_record } : {}) }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind === 'unchanged') return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph() as never)!, receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
    if (out.kind !== 'committed') return { status: 'unconfirmed' };
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch ${path}`);
    return { status: 200, json: { graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
      graph_identity_hash: computeGraphIdentityHash(graph() as never), brief_text: null } };
  };
  const proposals = new ProposalStore();
  return { graph, rows, proposals, caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit, now: () => new Date('2026-10-18T15:00:00Z') }) };
}
const ctx = (turn: string): Rec => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'claim', user_text: turn, user_turn_text: turn,
  verified_user_messages: [turn], user_text_complete: true });
const LINK = { kind: 'link', id: 'pre_order', label: 'Pre-order system in use', to_id: 'daily_waste', to_label: 'Daily food waste', field: 'effect' };
const OWN = 'Switching on pre-orders would cut daily food waste by between 4 and 6 kg.';
const PARTY = 'Our kitchen manager reckons switching on pre-orders would cut daily food waste by between 4 and 6 kg.';
const reading = (quote: string, speaker: string, extra: Rec = {}): Rec => ({ subject: LINK, statements: [{ quote, speaker, form: 'range', low: 4, high: 6,
  unit: 'kg', reading_words: 'a cut of 4 to 6 kg', ...extra }] });
const PRESS = 'Yes, use this reading.';
const press = (w: ReturnType<typeof world>, id: string) =>
  w.caps.authoriseChange({ ...ctx(PRESS), typed_approval_of: id, typed_approval_words: PRESS } as never, { proposal_id: id }) as Promise<Rec>;
const SUBJECT = { kind: 'link' as const, id: 'pre_order', to_id: 'daily_waste', field: 'effect' as const };
const heldRaw = (g: Rec): Rec[] => (g.nodes.find((n: Rec) => n.id === 'pre_order')?.user_statements ?? []) as Rec[];

/** The ONE claim reader (spec §3: `recordsWithUnknownSpeakerOn` generalised and renamed). Looked up loosely so every row runs RED alone. */
const claimRecordsOn = (node: unknown): Rec[] => {
  const f = (statements as Rec).claimRecordsOn as ((n: unknown) => Rec[]) | undefined;
  if (f === undefined) throw new Error('claimRecordsOn is not exported yet (spec §3)');
  return f(node);
};
const fromNode = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === 'pre_order');

/** Card → press → the record as committed, with the card it came from. */
async function pressed(said: string, speaker: string, extra: Rec = {}) {
  const w = world();
  const card = await w.caps.proposeStatement!(ctx(said) as never, reading(said, speaker, extra) as never) as Rec;
  expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
  const res = await press(w, card.proposal_id);
  expect(res, JSON.stringify(res)).toMatchObject({ ok: true, applied: true });
  const held = heldRaw(w.graph()).filter((r) => r.subject_key === 'link|pre_order|daily_waste||effect');
  expect(held).toHaveLength(1);
  return { w, card, record: held[0]! };
}

describe('claim record rows (spec §1–§4, §6): who asserts the figure is saved, and only the user\'s reads as "you said"', () => {
  it('OWN: the user\'s words → said_by user, confirmed, the approval bound to the displayed card; "you said" reads it', async () => {
    const { w, card, record } = await pressed(OWN, 'user');
    // The user's own claim keeps today's bytes (`speaker: 'user'`, `said_by` derived), plus its status and the host's receipt.
    expect(record.statements[0]).toMatchObject({ speaker: 'user', low: 4, high: 6, unit: 'kg', quote: OWN,
      status: 'confirmed', approval: { proposal_id: card.proposal_id } });
    expect(saidByOf(record.statements[0])).toBe('user');
    expect(userStatementFor(w.graph(), SUBJECT)?.statements[0]).toMatchObject({ low: 4, high: 6 });
    expect(claimRecordsOn(fromNode(w.graph()))).toEqual([expect.objectContaining({ subject_key: record.subject_key })]);
  });

  it('PARTY: a named party relayed by the user → said_by party, the name verbatim, relayed_by user; NEVER "you said"', async () => {
    const { w, record } = await pressed(PARTY, 'other', { party: 'Our kitchen manager' });
    expect(record.statements[0]).toMatchObject({ said_by: 'party', party: 'Our kitchen manager', relayed_by: 'user', low: 4, high: 6, unit: 'kg' });
    expect(record.statements[0]).not.toHaveProperty('speaker');
    expect(record.statements[0].status).toBe('confirmed');
    expect(userStatementFor(w.graph(), SUBJECT)).toBeUndefined();
    expect(claimRecordsOn(fromNode(w.graph()))[0]?.statements[0]).toMatchObject({ said_by: 'party', low: 4, high: 6 });
  });

  it('UNKNOWN (ambiguous source): words the AI cannot place → said_by unknown with the figure kept; NEVER "you said"', async () => {
    const { w, record } = await pressed(PARTY, 'unknown');
    expect(record.statements[0]).toMatchObject({ said_by: 'unknown', low: 4, high: 6, unit: 'kg' });
    expect(record.statements[0]).not.toHaveProperty('speaker');
    expect(userStatementFor(w.graph(), SUBJECT)).toBeUndefined();
  });

  it('COLD READ-BACK: a fresh parse of the saved bytes gives the same claim (identity, every new field)', async () => {
    const { w, record } = await pressed(PARTY, 'other', { party: 'Our kitchen manager' });
    const cold = JSON.parse(JSON.stringify(w.graph()));
    expect(claimRecordsOn(fromNode(cold))).toEqual(claimRecordsOn(fromNode(w.graph())));
    expect(claimRecordsOn(fromNode(cold))[0]?.statements[0]).toMatchObject({ said_by: 'party', status: 'confirmed',
      approval: record.statements[0].approval, party: 'Our kitchen manager', relayed_by: 'user' });
  });

  it('PARSER (spec §2): a party statement with figures parses; a said_by that disagrees with speaker is nobody\'s', () => {
    const base = { quote: PARTY, source: PARTY, form: 'range', reading: 'olumi', subject: { quantity: 'effect', node_id: 'pre_order' }, low: 4, high: 6, unit: 'kg' };
    expect(userStatementOf({ ...base, said_by: 'party', party: 'Our kitchen manager', relayed_by: 'user' }))
      .toMatchObject({ said_by: 'party', party: 'Our kitchen manager', low: 4, high: 6 });
    expect(userStatementOf({ ...base, said_by: 'party', relayed_by: 'user' })).toBeUndefined();
    expect(userStatementOf({ ...base, said_by: 'party', party: 'Our kitchen manager', relayed_by: 'user', speaker: 'user' })).toBeUndefined();
  });

  it('LEGACY (spec v2 rule 3): an old record reads with derived said_by, construction → proposed, else status UNKNOWN (never confirmed); NO rewrite; both hashes unchanged', () => {
    const legacy = (attest?: Rec): Rec => ({ subject_key: 'link|pre_order|daily_waste||effect', field: 'effect', recorded_at: '2026-10-10T10:00:00.000Z',
      statements: [{ speaker: 'user', quote: OWN, source: OWN, form: 'range', reading: 'olumi', subject: { quantity: 'effect', node_id: 'pre_order' }, low: 4, high: 6, unit: 'kg' }],
      ...(attest !== undefined ? { attest } : {}) });
    for (const [attest, status] of [[undefined, undefined], [{ recorded_by: 'construction' }, 'proposed']] as const) {
      const g = START();
      g.nodes.find((n: Rec) => n.id === 'pre_order').user_statements = [legacy(attest as Rec | undefined)];
      const bytes = JSON.stringify(g), analysis = computeAnalysisAffectingGraphHash(g as never), identity = computeGraphIdentityHash(g as never);
      const held = claimRecordsOn(fromNode(g))[0]!;
      expect(saidByOf(held.statements[0]!)).toBe('user');
      expect(claimStatusOf(held.statements[0]!, held)).toBe(status);
      expect(userStatementFor(g, SUBJECT)?.statements[0]).toMatchObject({ low: 4, high: 6 });
      expect(JSON.stringify(g)).toBe(bytes);
      expect(computeAnalysisAffectingGraphHash(g as never)).toEqual(analysis);
      expect(computeGraphIdentityHash(g as never)).toEqual(identity);
    }
  });
});
