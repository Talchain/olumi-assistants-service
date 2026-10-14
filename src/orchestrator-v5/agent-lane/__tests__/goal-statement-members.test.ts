/**
 * ⭐ T1H (DL 14 Oct 22:3xZ): THE USER'S OWN STATEMENT OF HOW THE GOAL IS READ (served hiring positive r4, CEE e7f95dc6).
 *
 * Paul said "We measure productivity as story points completed per sprint." and "All of these effects would be fully in place by
 * month 3." Neither had a writer: the goal kept "measured against today's productivity" and its open question, and
 * `effects_at_period_end` stayed the drafter's false. One verified statement now sets ONE member of the goal's reading through
 * its one writer, on one card and one press; the reading stays Olumi's (`source`), and the words stay the user's.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/hiring-positive-r4-turn06.json', import.meta.url), 'utf8')) as { graph: Rec };
const SID = '8d690a1e-8ac8-4108-b9c7-9913c5781b9a';
const MEANING = 'I mean at least 10% more than today’s productivity, achieved by the launch date. We measure productivity as story points completed per sprint.';
const MEASURE_SENTENCE = 'We measure productivity as story points completed per sprint.';
const TIMING = 'All of these effects would be fully in place by month 3.';
const basisOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal').goal_target_basis;

function world() {
  let bytes = JSON.stringify(SERVED.graph);
  const read = (): Rec => JSON.parse(bytes);
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => read(), loadGraphAndBriefText: async () => ({ graph: read(), briefText: '' }),
    readMostRecentPendingActions: async () => [], getScenarioOwner: async () => null,
    append: async (write) => { const saved = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      const id = `gs-${rows.length}`; rows.push({ id, write: saved });
      if (saved.graph !== undefined) bytes = JSON.stringify(saved.graph); return { id }; },
    readRecent: async () => rows.map(({ id, write: w }) => makeSessionTurnRow({ id, scenario_id: w.scenario_id, turn_id: w.turn_id,
      turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash, response_emitted: w.response_emitted,
      llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((r) => ids.includes(r.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-14T22:10:00.000Z', fact }))),
  });
  const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    const out = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'gs', requestHash: input.turn_id,
      stage: 'frame', freshness: 'fresh', hasExistingAnalysis: true, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.goal_reading !== undefined ? { goalReading: input.goal_reading } : {}) }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind !== 'committed' && out.kind !== 'unchanged') throw new Error(JSON.stringify(out));
    return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(read() as never)!, receipt: null,
      already_applied: out.kind === 'unchanged', committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (path.endsWith('/graph')) return { status: 200, json: { graph: read(), graph_hash: computeAnalysisAffectingGraphHash(read() as never) } };
    throw new Error(path);
  };
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit });
  const ctx = (turn: string, extra: Rec = {}) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'gs', user_turn_text: turn,
    user_text: turn, verified_user_messages: [turn], user_text_complete: true, ...extra });
  const approve = (id: string, turn: string) => caps.authoriseChange({ ...ctx(turn), typed_approval_of: id } as never, { proposal_id: id });
  return { read, proposals, caps, ctx, approve };
}
afterEach(() => vi.restoreAllMocks());

describe('the goal\'s MEASURE from the user\'s own statement', () => {
  it('⭐ RED→GREEN real path: one card quoting them; the press sets what the % is a % of and answers the open question', async () => {
    const w = world();
    const before = basisOf(w.read());
    const card = await w.caps.proposeGoalStatement!(w.ctx(MEANING) as never,
      { member: 'measure', quote: MEASURE_SENTENCE, measure_words: 'story points completed per sprint' }) as Rec;
    expect(card.ok, JSON.stringify(card)).toBe(true);
    expect(String(card.public_label)).toContain(`From your message: ‘${MEASURE_SENTENCE}’`);
    expect(String(card.public_label)).toContain('measured against today’s story points completed per sprint');
    expect(w.proposals.get(String(card.proposal_id))?.provenance.authored_by).toBe('user_stated');
    // Nothing is written before the press.
    expect(basisOf(w.read())).toEqual(before);
    const applied = await w.approve(String(card.proposal_id), 'Yes, read it that way') as Rec;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    const after = basisOf(w.read());
    expect(after).toEqual({ ...Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'open_question')),
      denominator: 'today’s story points completed per sprint', effect_unit: '% of today’s story points completed per sprint' });
    expect(after.source).toBe('olumi_reading');
  });
  it('⛔ measure words not written by the user (Olumi\'s paraphrase) prepare nothing', async () => {
    const w = world();
    const r = await w.caps.proposeGoalStatement!(w.ctx(MEANING) as never,
      { member: 'measure', quote: MEASURE_SENTENCE, measure_words: 'sprint velocity' }) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'measure_not_in_quote' });
  });
  it('⛔ a quote that is not a whole statement of the user\'s own words prepares nothing', async () => {
    const w = world();
    const r = await w.caps.proposeGoalStatement!(w.ctx(MEANING) as never,
      { member: 'measure', quote: 'story points completed per sprint', measure_words: 'story points completed per sprint' }) as Rec;
    expect(r.ok).toBe(false);
  });
});

describe('the user\'s own EFFECT TIMING', () => {
  it('⭐ RED→GREEN real path: "all … fully in place by month 3" within a 3-month goal → effects_at_period_end true, on the press only', async () => {
    const w = world();
    const card = await w.caps.proposeGoalStatement!(w.ctx(TIMING) as never,
      { member: 'effects_timing', quote: TIMING, month: 3, covers_all_effects: true }) as Rec;
    expect(card.ok, JSON.stringify(card)).toBe(true);
    expect(card.members).toEqual({ effects_at_period_end: true });
    expect(basisOf(w.read()).effects_at_period_end).toBe(false);
    const applied = await w.approve(String(card.proposal_id), 'Yes, read it that way') as Rec;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(basisOf(w.read()).effects_at_period_end).toBe(true);
  });
  it('a month after the goal\'s period reads as NOT in place by its end', async () => {
    const said = 'All of these effects would be fully in place by month 5.';
    const w = world();
    const card = await w.caps.proposeGoalStatement!(w.ctx(said) as never, { member: 'effects_timing', quote: said, month: 5, covers_all_effects: true }) as Rec;
    expect(card.members).toEqual({ effects_at_period_end: false });
  });
  it('⛔ a statement about SOME effects sets nothing; a month the quote does not state prepares nothing', async () => {
    const some = 'The Tech lead’s effect would be in place by month 2.';
    const w = world();
    expect(await w.caps.proposeGoalStatement!(w.ctx(some) as never, { member: 'effects_timing', quote: some, month: 2, covers_all_effects: false }))
      .toMatchObject({ ok: false, refusal: 'not_all_effects' });
    expect((await w.caps.proposeGoalStatement!(w.ctx(TIMING) as never, { member: 'effects_timing', quote: TIMING, month: 2, covers_all_effects: true }) as Rec).ok).toBe(false);
  });
});
