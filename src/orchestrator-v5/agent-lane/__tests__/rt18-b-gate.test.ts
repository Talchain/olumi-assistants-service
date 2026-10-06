/**
 * ⭐ RT-18 (red team 19, #87 6008735232; DL 0df0e1 ruling, cut 5): on a served dental draft (CEE 74cc7aea, guest sid
 * d2821553-a771-4f35-9f9a-ac8ece03fbe3) the (B) ask "how much would a £1 … rise in ‘Missed-appointment fee’ change
 * ‘no-shows’ that way, in %?" had NO answer that records: the Agent sizes fee → no-shows, which the model does not hold,
 * and the refusal told the user to "click the link from ‘Missed-appointment fee’ to ‘no-shows’", which the canvas does
 * not show. Cut 5: the (B) ask is GATED OFF, and a link the model does not hold is said first, never a click route to it.
 * Fixture: the served draft_graph (wire f2j4-A1).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { placeholderAskWords } from '../goal-certainty.js';
import { mediatorReadings } from '../mediator-reading.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import type { SessionTurnWrite } from '../../session/store.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';

type Rec = Record<string, any>;
const SID = 'd2821553-a771-4f35-9f9a-ac8ece03fbe3';
const DENTAL = (): Rec => assignEntityRefs(projectGraphForPersistence(JSON.parse(readFileSync(new URL('./fixtures/rt18-dental-74cc7aea-graph.json',
  import.meta.url), 'utf8'))), { nodes: [], edges: [] }).graph as Rec;
const FEE = 'Missed-appointment fee';
const M = 'Fee-related patient dissatisfaction';
const A1 = 'Through fee-related patient dissatisfaction, each £1 rise in the missed-appointment fee raises no-shows by about 0.05 percentage points of appointments.';
const A2 = 'A £1 per missed appointment rise in Missed-appointment fee would raise no-shows by about 0.05% that way.';
const ctxSaying = (user_text: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'rt18', user_text });

/** The real proposer, card, approval and commit door over a serialized SessionStore (link-effect-gauge-door's world). */
function world(initial: Rec) {
  let graphJson = JSON.stringify(initial);
  const graph = () => JSON.parse(graphJson) as Rec;
  const proposals = new ProposalStore();
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(),
    loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [],
    readAnalysisInvalidatedAt: async () => null,
    getScenarioOwner: async () => null,
    append: async (write) => {
      const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      const id = `rt18-row-${rows.length + 1}`;
      rows.push({ id, write: s });
      if (s.graph !== undefined) graphJson = JSON.stringify(s.graph);
      return { id };
    },
    readRecent: async () => rows.map(({ id, write }) => makeSessionTurnRow({ id, scenario_id: write.scenario_id,
      turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id,
      request_hash: write.request_hash, response_emitted: write.response_emitted,
      llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((row) => ids.includes(row.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-06T00:00:00.000Z', fact }))),
  });
  const commits: CommitOptionLevelsInput[] = [];
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    const out = await executeOptionInterventionBatch({ scenarioId: input.scenario_id, turnId: input.turn_id,
      requestId: 'rt18-real-commit', requestHash: `rt18:${input.turn_id}`, stage: 'frame',
      freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.link_effect !== undefined ? { linkEffect: input.link_effect } : {}),
      ...(input.link_effects !== undefined ? { linkEffects: input.link_effects } : {}),
    }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind !== 'committed') throw new Error(`Real commit did not verify: ${JSON.stringify(out)}`);
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    const read = graph();
    return { status: 200, json: { graph: read, graph_hash: computeAnalysisAffectingGraphHash(read as never) } };
  };
  return { caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels }), proposals, commits, graph };
}
const propose = (w: ReturnType<typeof world>, to: string, quote: string, unit: string) => w.caps.proposeLinkEffect!(ctxSaying(quote),
  { from_label: FEE, to_label: to, amount: 0.05, amount_unit: unit, per_source_change: 1, per_source_change_unit: '£ per missed appointment', quote }) as Promise<Rec>;
const edge = (g: Rec, from: string, to: string): Rec => g.edges.find((e: Rec) => e.from === from && e.to === to);

describe('RT-18 (cut 5): no (B) ask without a working answer, and never a click route to a link the model does not hold', () => {
  it('GATE: the dental withhold asks no (B) "that way" question; the gauge links are offered as before (no gauge set)', () => {
    const g = DENTAL();
    expect(mediatorReadings(g).get('fee_related_patient_dissatisfaction')).toMatchObject({ via: 'gauge', child: 'no_shows' }); // precondition
    const links = [{ from: 'missed_appointment_fee', to: 'fee_related_patient_dissatisfaction' }, { from: 'fee_related_patient_dissatisfaction', to: 'no_shows' }];
    const words = placeholderAskWords(g, links);
    expect(words?.message ?? '').not.toMatch(/that way/);
    expect(words?.message ?? '').not.toMatch(/through ‘Fee-related patient dissatisfaction’/);
    expect([...(words?.gaugeLinks ?? [])]).toEqual([]);
  });
  it('NO FALSE CLICK (RED on 179f0645): A1 sized as fee → no-shows is told the link does not exist, with no click route to it', async () => {
    const r = await propose(world(DENTAL()), 'no-shows', A1, 'percentage points');
    expect(r).toMatchObject({ ok: false, refusal: 'no_such_link' });
    expect(String(r.detail)).not.toMatch(/click the link from “Missed-appointment fee” to “no-shows”/);
  });
  it('A2 sized as fee → no-shows: the same honest no_such_link', async () => {
    const r = await propose(world(DENTAL()), 'no-shows', A2, '%');
    expect(r).toMatchObject({ ok: false, refusal: 'no_such_link' });
  });
  it('CONTROL: a link the model DOES hold keeps its canvas route in a figure question', async () => {
    const r = await propose(world(DENTAL()), M, A1, 'percentage points');
    expect(r).toMatchObject({ ok: false, refusal: 'not_the_users_statement' });
    expect(String(r.detail)).toMatch(/click the link from “Missed-appointment fee” to “Fee-related patient dissatisfaction”/);
  });
  it('REAL DOOR (DL mandatory): a through-M answer sized on the link the model holds commits, gauge stored (#2634)', async () => {
    const said = 'Through fee-related patient dissatisfaction, each £1 rise in the missed-appointment fee raises no-shows by about 0.05 percentage points.';
    const w = world(DENTAL());
    const r = await propose(w, M, said, 'percentage points');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
      (id) => ({ proposal: w.proposals.get(id), result: r as never }))[0]!;
    expect(card?.message).toMatch(/"no-shows" through "Fee-related patient dissatisfaction" by 0\.05 percentage points/);
    const out = await w.caps.authoriseChange({ ...ctxSaying(card.message), typed_approval_of: String(r.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    const g = w.graph();
    expect(edge(g, 'missed_appointment_fee', 'fee_related_patient_dissatisfaction').provenance.magnitude).toBe('user_stated');
    expect(edge(g, 'fee_related_patient_dissatisfaction', 'no_shows').provenance.sized_by_identity).toEqual({ op: 'gauge' });
  });
  it('NO FALSE CLICK (grouped proposer): a group naming fee → no-shows is told the link does not exist, with no click route', async () => {
    const w = world(DENTAL());
    const r = await w.caps.proposeLinkEffect!(ctxSaying(A1), { links: [{ from_label: FEE, to_label: 'no-shows', amount: 0.05,
      amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£ per missed appointment', quote: A1 }] }) as Rec;
    expect(JSON.stringify(r)).toMatch(/no_such_link/);
    expect(JSON.stringify(r)).not.toMatch(/click the link from \\u201cMissed-appointment fee\\u201d to \\u201cno-shows\\u201d|click the link from “Missed-appointment fee” to “no-shows”/);
  });
  it('CARD CONTROL: a gauge answer in an unrelated unit (£) still builds no card (points meet % only)', async () => {
    const said = 'Through fee-related patient dissatisfaction, each £1 rise in the missed-appointment fee costs us about £5 of no-shows.';
    const w = world(DENTAL());
    const r = await propose(w, M, said, '£');
    const chips = r.ok === true ? approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
      (id) => ({ proposal: w.proposals.get(id), result: r as never })) : [];
    expect(chips).toEqual([]);
  });
});

