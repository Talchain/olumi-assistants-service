/**
 * ⭐ M3c on the real path (served hiring negative r4, CEE e7f95dc6): the user's sentence → `propose_statement` → ONE card per
 * option ("Use this reading": the months and the step are Olumi's reading) → the press → the level door's `statement_record`
 * member (one commit) → read-back → the receipt. Real capabilities, the real atomic batch writer and a store.
 */
import { readFileSync } from 'node:fs';
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
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import { optionTimingAtPeriodEnd } from '../fields/goal-timing.js';
import { AGENT_TOOLS, dispatchTool } from '../../agent-lane/runtime/agent-tools.js';

type Rec = Record<string, any>;
const SID = 'c3c0c3c0-0000-4000-8000-00000000c3c0';
const SAID = 'The tech lead would lift productivity from month 2, and each developer from month 2.';
const plain = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
const HIRING = (): Rec => plain(JSON.parse(readFileSync(new URL('./fixtures/hiring-negative-r4-turn09.json', import.meta.url), 'utf8')).graph);

function world(start: Rec = HIRING()) {
  let json = JSON.stringify(start);
  const graph = (): Rec => JSON.parse(json) as Rec;
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [], readAnalysisInvalidatedAt: async () => null, getScenarioOwner: async () => null,
    append: async (write) => { const s = JSON.parse(JSON.stringify(write)) as SessionTurnWrite, id = `m3c-row-${rows.length + 1}`;
      rows.push({ id, write: s }); if (s.graph !== undefined) json = JSON.stringify(s.graph); return { id }; },
    readRecent: async () => rows.map(({ id, write: x }) => makeSessionTurnRow({ id, scenario_id: x.scenario_id, turn_id: x.turn_id,
      turn_class: x.turn_class, handler_id: x.handler_id, request_hash: x.request_hash, response_emitted: x.response_emitted, llm_calls_used: x.llm_calls_used, duration_ms: x.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((r) => ids.includes(r.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-15T03:00:05.000Z', fact }))),
  });
  const commit = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    const out = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'm3c', requestHash: `m3c:${input.turn_id}`,
      stage: 'frame', freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      // One record alone, mapped as the real door maps it (C2: an array is the level card's adoptions, never alone).
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
  return { graph, rows, proposals, caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: commit, now: () => new Date('2026-10-15T03:00:00Z') }) };
}
const ctx = (turn: string): Rec => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'm3c', user_text: turn, user_turn_text: turn });
const args = (label: string, words: string): Rec => ({ subject: { kind: 'option', label, field: 'lead' }, statements: [{ quote: SAID, reading_words: words }] });
const PRESS = 'Yes, use this reading.';
const press = (w: ReturnType<typeof world>, id: string) =>
  w.caps.authoriseChange({ ...ctx(PRESS), typed_approval_of: id, typed_approval_words: PRESS } as never, { proposal_id: id }) as Promise<Rec>;

describe('M3c on the real path: their words → one card per option → their press → the option holds its lead → the reading at month 3', () => {
  it('RED: each option\'s card quotes them and says Olumi\'s reading; nothing is written until pressed; the presses give the reading at month 3', async () => {
    const w = world();
    const goalId = w.graph().nodes.find((n: Rec) => n.kind === 'goal').id;
    expect(goalHorizonVerdict(w.graph())).toBe('no_horizon');
    const before = JSON.stringify(w.graph());
    const lead = await w.caps.proposeStatement!(ctx(SAID) as never, args('Hire a Tech lead', 'lift productivity from month 2') as never) as Rec;
    expect(lead, JSON.stringify(lead)).toMatchObject({ ok: true, mutated: false, statement: { subject: 'Hire a Tech lead', field: 'lead', quotes: [SAID] } });
    expect(lead.public_label).toContain('your forecast that ‘Hire a Tech lead’ would be fully in place by month two from today');
    expect(lead.public_label).toContain('Olumi reads the effect as fully in place from that point, with no further build-up after it, and holds everything else at today’s level.');
    expect(lead.public_label).toContain('That is by month three, so its chance at month three can use your forecast.');
    expect(JSON.stringify(w.graph())).toBe(before);
    const res = await press(w, lead.proposal_id);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, applied: true });
    expect(res.follow_up).toBe('Recorded your forecast: ‘Hire a Tech lead’ fully in place by month two from today. That is by month three, so its chance at month three can use your forecast.');
    for (const [label, words] of [['Hire two developers', 'each developer from month 2'], ['Hire one developer', 'each developer from month 2']]) {
      const card = await w.caps.proposeStatement!(ctx(SAID) as never, args(label!, words!) as never) as Rec;
      expect(card, JSON.stringify(card)).toMatchObject({ ok: true });
      expect(await press(w, card.proposal_id)).toMatchObject({ ok: true, applied: true });
    }
    expect(optionTimingAtPeriodEnd(w.graph(), goalId)?.options.map((o) => [o.option_id, o.kind])).toEqual([
      ['hire_a_tech_lead', 'in_place'], ['hire_one_developer', 'in_place'], ['hire_two_developers', 'in_place']]);
    expect(goalHorizonVerdict(w.graph())).toBe('basis_at_h');
    // Words only on each option: no level, link or reading on the goal moved.
    const was = JSON.parse(before) as Rec;
    for (const n of w.graph().nodes as Rec[]) {
      const { user_statements: _u, ...rest } = n;
      const { user_statements: _w, ...prior } = was.nodes.find((x: Rec) => x.id === n.id);
      expect(rest, n.id).toEqual(prior);
    }
  });

  it('CONTRAST: words the user never typed, or a clause about another option, prepare nothing', async () => {
    const w = world();
    expect(await w.caps.proposeStatement!(ctx('Please record it.') as never, args('Hire a Tech lead', 'lift productivity from month 2') as never))
      .toMatchObject({ ok: false });
    expect(await w.caps.proposeStatement!(ctx(SAID) as never, args('Hire two developers', 'lift productivity from month 2') as never))
      .toMatchObject({ ok: false, refusal: 'not_this_subject' });
    expect(w.proposals.outstanding(SID, null)).toEqual([]);
  });
});

// ⭐ S5 (DL 15 Oct, unseen brief R4): the option's label was copied from the brief and the timing card "did not recognise the saved
// option". The AI's state view gives each part its id; the tool's subject now takes it, and the id names the part exactly. No
// label matching is loosened (only SCIENCE's case-only match stands).
describe('the option is named by its id when a copied label differs from the stored one', () => {
  const withId = (label: string, id: string | undefined, words: string): Rec => {
    const a = args(label, words);
    return { ...a, subject: { ...a.subject, ...(id !== undefined ? { id } : {}) } };
  };
  it('RED: the tool offers the AI the part\'s id (and the option\'s and a link end\'s), beside the label', () => {
    const subject = (AGENT_TOOLS.find((t) => t.name === 'propose_statement') as Rec).parameters.properties.subject.properties as Rec;
    expect(Object.keys(subject)).toEqual(expect.arrayContaining(['id', 'to_id', 'option_id']));
    expect(subject.id.description).toBe('The part’s id, as get_canonical_state returned it. Give it whenever you have it: it names the part exactly.');
  });
  it('a label differing in punctuation ("Hire a Tech-lead") with the option\'s id → ONE card, naming the stored label', async () => {
    const w = world();
    const card = await w.caps.proposeStatement!(ctx(SAID) as never, withId('Hire a Tech-lead', 'hire_a_tech_lead', 'lift productivity from month 2') as never) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, statement: { subject: 'Hire a Tech lead', field: 'lead', quotes: [SAID] } });
  });
  it('CONTRAST: the same label without the id → not found, nothing prepared (no fuzzy match)', async () => {
    const w = world();
    expect(await w.caps.proposeStatement!(ctx(SAID) as never, withId('Hire a Tech-lead', undefined, 'lift productivity from month 2') as never))
      .toMatchObject({ ok: false, refusal: 'subject_not_found' });
    expect(w.proposals.outstanding(SID, null)).toEqual([]);
  });
  it('CONTRAST: an id no option has → not found, never the label\'s guess', async () => {
    const w = world();
    expect(await w.caps.proposeStatement!(ctx(SAID) as never, withId('Hire a Tech lead', 'no_such_option', 'lift productivity from month 2') as never))
      .toMatchObject({ ok: false, refusal: 'subject_not_found' });
  });
});


// ⭐ S5 propose_change op option_timing (Paul's ≤¼ PoC ruling): the generic change tool reaches the SAME lead row and card.
describe('propose_change op option_timing → the door\'s option-lead card', () => {
  const change = (w: ReturnType<typeof world>, op: Rec) => dispatchTool('propose_change', JSON.stringify({ ops: [op] }), ctx(SAID) as never, w.caps) as Promise<Rec>;
  it('RED: the option\'s timing, through propose_change, is the same ONE card propose_statement prepares (by id, a copied label)', async () => {
    const w = world();
    const viaChange = await change(w, { op: 'option_timing', kind: 'option', label: 'Hire a Tech-lead', id: 'hire_a_tech_lead', quote: SAID,
      reading_words: 'lift productivity from month 2' });
    expect(viaChange, JSON.stringify(viaChange)).toMatchObject({ ok: true, statement: { subject: 'Hire a Tech lead', field: 'lead', quotes: [SAID] } });
    const w2 = world();
    const viaDoor = await w2.caps.proposeStatement!(ctx(SAID) as never, { subject: { kind: 'option', label: 'Hire a Tech lead', field: 'lead' },
      statements: [{ quote: SAID, reading_words: 'lift productivity from month 2' }] } as never) as Rec;
    expect(viaChange.public_label).toBe(viaDoor.public_label);
  });
  it('CONTRAST: option_timing on a part that is not an option → nothing prepared', async () => {
    const w = world();
    expect(await change(w, { op: 'option_timing', kind: 'factor', label: 'Hire a Tech lead', quote: SAID, reading_words: 'from month 2' }))
      .toMatchObject({ ok: false, refusal: 'unsupported_change' });
    expect(w.proposals.outstanding(SID, null)).toEqual([]);
  });
});
