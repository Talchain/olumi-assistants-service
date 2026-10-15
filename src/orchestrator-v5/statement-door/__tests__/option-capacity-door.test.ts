/**
 * ⭐ SYSTEM 1 M5: an option's new share of time on the ONE statement door, on Paul's SERVED graph (legacy brief, CEE de659cfd;
 * the coaching loop's fixture, byte-pinned there). His answer "it would cut legacy work from 25% to 15%" is the user's statement of
 * the level "Reduce legacy-fix time" sets "Legacy-code fixing time" to: `propose_statement` → ONE door card → its press writes the
 * option-capacity member's registered revision, read back by identity. Serialised in-process register/read boundary.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { unresolvedEventOptionIds } from '../../goal-target/event-by-date-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { dispatchTool } from '../../agent-lane/runtime/agent-tools.js';
import { doorRowFor } from '../role-table.js';
import { asMemberOp, doorAsks } from '../door.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/paul-legacy-de659cfd-served-graph-20261014.json', import.meta.url), 'utf8')) as { graph_text: string };
const SCENARIO = '5b52ff13-0000-4000-8000-0000000c0a7c';
const LEGACY = 'event_option_2', LEGACY_TIME = 'event_context_7', CARRIER = 'event_capacity_2';
const PAUL = 'it would cut legacy work from 25% to 15%';
const SUBJECT = { kind: 'factor', label: 'Legacy-code fixing time', option_label: 'Reduce legacy-fix time', field: 'level' };
const stored = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphStateIngressSchema.parse(g) as never), { nodes: [], edges: [] }).graph as Rec;
const ctx = (text: string, preceding?: string): Rec => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'm5', user_text: text, user_turn_text: text,
  ...(preceding !== undefined ? { preceding_assistant_text: preceding } : {}) });

function world(initial: string = FX.graph_text) {
  let json = initial;
  const graph = (): Rec => JSON.parse(json);
  const registers: Rec[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      const b = body as Rec, now = graph();
      registers.push(b);
      if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(now as never)
        || b.expected_graph_identity_hash !== computeGraphIdentityHash(now as never)!.value) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      json = JSON.stringify(stored(b.graph));
      return { status: 200, json: { registered: true, model_version: { version_number: 9, version_id: 'v-m5', mutation_id: 'm-m5' } } };
    }
    if (path.endsWith('/graph')) {
      const g = graph();
      return { status: 200, json: { graph: g, graph_hash: computeAnalysisAffectingGraphHash(g as never), graph_identity_hash: computeGraphIdentityHash(g as never) } };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    throw new Error(`Unexpected dispatch ${path}`);
  };
  const proposals = new ProposalStore();
  return { graph, registers, proposals, caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { now: () => new Date('2026-10-14T21:30:00Z') }) };
}
/** Readiness's own ask for this option's share (the served graph's MISSING_OPTION_VALUE), which Paul's answer answers. */
const ASK = 'Factor "Legacy-code fixing time" is currently 25 % of developer time. What should option "Reduce legacy-fix time" set it to?';
const offer = (w: ReturnType<typeof world>, subject: Rec = SUBJECT, quote = PAUL, text = PAUL, answering: string | null = ASK) =>
  dispatchTool('propose_statement', JSON.stringify({ subject, statements: [{ quote, ...(answering !== null ? { answering } : {}) }] }), ctx(text) as never, w.caps) as Promise<Rec>;

describe('M5: an option\'s new share of time is a statement on the door (served de659cfd)', () => {
  it('the door has ONE row for {factor, option, level} on this option\'s share, and none for a factor\'s own level', () => {
    const g = JSON.parse(FX.graph_text) as Rec;
    expect(doorRowFor({ kind: 'factor', id: LEGACY_TIME, option_id: LEGACY, field: 'level' }, g)?.carrier).toBe('option_capacity');
    expect(doorRowFor({ kind: 'factor', id: LEGACY_TIME, field: 'level' }, g)).toBeUndefined();
  });

  it('propose_statement → ONE card; the press writes the option-capacity revision and the option acts', async () => {
    const w = world();
    const r = await offer(w);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false });
    const op = w.proposals.get(String(r.proposal_id))!.operations[0]!;
    expect(asMemberOp(op)).toMatchObject({ op: 'set_option_capacity_change', path: LEGACY, value: { option_id: LEGACY, factor_id: LEGACY_TIME, today: 25, to: 15 } });
    expect(w.registers).toEqual([]);
    const out = await w.caps.authoriseChange({ ...ctx('Use this reading'), typed_approval_of: r.proposal_id } as never, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: true, applied: true,
      follow_up: '‘Reduce legacy-fix time’ is saved: it now acts in the deadline forecast through the time it frees, with your figure and Olumi’s assumptions kept distinct.' });
    expect(w.registers).toHaveLength(1);
    const after = w.graph();
    expect(unresolvedEventOptionIds(after)).toEqual([]);
    expect(after.nodes.find((n: Rec) => n.id === CARRIER).observed_state.extra_share_by_date.ratio_source.settings).toEqual({ [LEGACY_TIME]: 15 });
  });

  it('CONTRAST (binding): the same words answering no ask Olumi said are not bound to the share, so nothing is prepared', async () => {
    const r = await offer(world(), SUBJECT, PAUL, PAUL, null);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'not_this_subject' });
  });

  it('CONTRAST: a statement with no new figure for the share prepares nothing, and keeps the words', async () => {
    const r = await offer(world(), SUBJECT, 'legacy work is 25% today', 'legacy work is 25% today');
    expect(r).toMatchObject({ ok: false, mutated: false });
  });

  it('SECOND CAPTURE (7f5659fd, another drafting of the legacy brief: "Legacy-code time share", unit %): same row, same card, same write', async () => {
    const FX2 = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/paul-legacy-7f5659fd-unsized-options-graph-20261014.json', import.meta.url), 'utf8')) as { graph_text: string };
    const w = world(FX2.graph_text);
    const ask = 'Factor "Legacy-code time share" is currently 25%. What should option "Reduce legacy-fix time" set it to?';
    const r = await offer(w, { kind: 'factor', label: 'Legacy-code time share', option_label: 'Reduce legacy-fix time', field: 'level' }, PAUL, PAUL, ask);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false });
    const out = await w.caps.authoriseChange({ ...ctx('Use this reading'), typed_approval_of: r.proposal_id } as never, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(unresolvedEventOptionIds(w.graph())).toEqual(['event_option_3']);
    // CONTRAST: "Add two developers" changes no share of time, so the door has no row for it and readiness's ask for it is not a door ask.
    const g = JSON.parse(FX2.graph_text) as Rec;
    expect(doorRowFor({ kind: 'factor', id: 'event_context_6', option_id: 'event_option_3', field: 'level' }, g)).toBeUndefined();
    expect(doorAsks(g).map((a) => a.subject.option_id)).toEqual(['event_option_2']);
  });

  it('⛔ "in 3 months, cut legacy from 25% to 15%" → 25→15 with a 3-month lead (session 4\'s reader), never a 3%', async () => {
    const SENTENCE = 'in 3 months, cut legacy from 25% to 15%';
    const w = world();
    const r = await offer(w, SUBJECT, SENTENCE, SENTENCE);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const card = String(r.public_label);
    expect(card).toContain('sets ‘Legacy-code fixing time’ to 15% of developer time (25% of developer time today)');
    expect(card).toContain('Full effect 3 months from now: your start in 3 months');
    expect(card).not.toMatch(/\b3%/);
    await w.caps.authoriseChange({ ...ctx('Use this reading'), typed_approval_of: r.proposal_id } as never, { proposal_id: String(r.proposal_id) });
    const extra = w.graph().nodes.find((n: Rec) => n.id === CARRIER).observed_state.extra_share_by_date;
    expect(extra).toMatchObject({ lead_low: 3, lead_high: 3, lead_reading: { start: { low: 3, high: 3, role: 'stated' } } });
    expect(extra.capacity_ratio).toBeCloseTo(85 / 75, 12);
  });
});

