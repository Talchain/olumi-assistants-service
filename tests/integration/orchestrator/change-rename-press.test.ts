/**
 * ⭐ S5 propose_change op rename (Paul's ≤¼ PoC ruling, DL 15 Oct): the user's own new name for ONE option, factor or risk, from
 * their words in THIS message, is ONE card; only its press renames, through the existing label writer (`structural_rename`).
 *
 * (The removal card's harness, reused:) ⭐ S5 (DL 15 Oct, unseen brief R4 item 3): "set this link to zero" was refused and the user was sent to a canvas with no zero
 * control; removing a factor or risk had no chat route. Olumi proposes; the user authors: `propose_change` (op remove, or set_zero
 * for a link; S5's ONE generic change tool) prepares ONE card that
 * quotes the user's own request in THIS message and says exactly what goes with it, and only its press removes it, through the REAL
 * in-process door (`commitStructuralDeleteInProcess` → the ONE removal writer, `structural_delete`).
 *
 * Two briefs: hiring (remove the factor ‘Hiring spend’, which two options set) and capacity (a link set to zero is removed).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

type Rec = Record<string, any>;
const fixture = (name: string): Rec => JSON.parse(readFileSync(new URL(`../../../src/orchestrator-v5/agent-lane/__tests__/fixtures/${name}`,
  import.meta.url), 'utf8')) as Rec;
const HIRING = fixture('hiring-42d10ecf-read-before-effects.json').graph as Rec;
const SCENARIO_ID = 'e9e63843-b4c9-4354-a976-1fb43a8a7303';

let persisted: unknown = structuredClone(HIRING);
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    readRecent: async () => [],
    readFactsWithTurnFor: async () => [],
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id };
    },
    getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const hash = (): string => computeAnalysisAffectingGraphHash(persisted as never)!;
const g = (): Rec => persisted as Rec;

const OPT_ASK = 'Rename Hire two developers to Hire three developers.';
const OPT_CARD = `From your message: “${OPT_ASK}”. Olumi proposes renaming ‘Hire two developers’ to ‘Hire three developers’. Rename it?`;
const FAC_ASK = 'Call hiring spend Recruitment budget instead.';

describe('a rename the user asks for is ONE card; only its press renames, through the ONE label writer', () => {
  let mods: {
    commitOptionRenameInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionRenameInProcess;
    createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
    ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
    dispatchTool: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-tools.js').dispatchTool;
    approvalChipsFor: typeof import('../../../src/orchestrator-v5/agent-lane/approval-chips.js').approvalChipsFor;
  };
  beforeAll(async () => {
    const d = await import('../../../src/orchestrator-v5/system-events/dispatch.js');
    const c = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js');
    const p = await import('../../../src/orchestrator-v5/agent-lane/proposal.js');
    const t = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-tools.js');
    const a = await import('../../../src/orchestrator-v5/agent-lane/approval-chips.js');
    mods = { commitOptionRenameInProcess: d.commitOptionRenameInProcess, createAgentCapabilities: c.createAgentCapabilities,
      ProposalStore: p.ProposalStore, dispatchTool: t.dispatchTool, approvalChipsFor: a.approvalChipsFor };
  });
  beforeEach(() => { persisted = structuredClone(HIRING); rows.clear(); });

  function world() {
    const store = new mods.ProposalStore();
    const read = async () => ({ status: 200, json: { graph: structuredClone(persisted), graph_hash: hash() } });
    const caps = mods.createAgentCapabilities(read as never, store, undefined, 'full', undefined, {
      commitOptionRename: (input) => mods.commitOptionRenameInProcess(input, 'req-rename'),
    });
    const ctx = (said: string): Rec => ({ scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: said, user_turn_text: said });
    const propose = async (said: string, args: Rec): Promise<Rec> =>
      await mods.dispatchTool('propose_change', JSON.stringify({ ops: [{ op: 'rename', ...args }] }), ctx(said) as never, caps) as Rec;
    const press = async (proposalId: string, typed = true): Promise<Rec> => await caps.authoriseChange({ ...ctx('Yes, rename it.'),
      ...(typed ? { typed_approval_of: proposalId } : {}) } as never, { proposal_id: proposalId }) as Rec;
    return { store, propose, press };
  }
  const labelOf = (id: string): string => g().nodes.find((n: Rec) => n.id === id).label;

  it('RED (hiring, an option): "Rename Hire two developers to Hire three developers." → ONE card ("Rename it"); the press renames in ONE commit', async () => {
    const w = world();
    const card = await w.propose(OPT_ASK, { kind: 'option', label: 'Hire two developers', new_label: 'Hire three developers', quote: OPT_ASK });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false, public_label: OPT_CARD });
    const stored = w.store.get(card.proposal_id)!;
    expect(stored.operations).toEqual([{ op: 'rename_option', path: 'hire_two_developers', value: { expected_label: 'Hire two developers', label: 'Hire three developers' } }]);
    const chips = mods.approvalChipsFor([{ name: 'propose_change', ok: true, mutated: false, proposal_id: card.proposal_id }], () => ({ proposal: stored, result: card as never }));
    expect(chips[0]).toMatchObject({ label: 'Rename it', message: 'Yes, rename it.', detail: OPT_CARD });
    const cells = structuredClone(g().nodes.find((n: Rec) => n.id === 'hire_two_developers').interventions);
    const out = await w.press(card.proposal_id);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true, follow_up: 'Renamed ‘Hire two developers’ to ‘Hire three developers’.' });
    expect(rows.size).toBe(1);
    expect(labelOf('hire_two_developers')).toBe('Hire three developers');
    expect(g().nodes.find((n: Rec) => n.id === 'hire_two_developers').interventions).toEqual(cells);
  });

  it('RED (hiring, a factor): the user\'s own new name for ‘Hiring spend’ → the card; the press renames it, its links and settings kept', async () => {
    const w = world();
    const edges = g().edges.map((e: Rec) => `${e.from}::${e.to}`);
    const card = await w.propose(FAC_ASK, { kind: 'factor', label: 'Hiring spend', new_label: 'Recruitment budget', quote: FAC_ASK });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true,
      public_label: `From your message: “${FAC_ASK}”. Olumi proposes renaming ‘Hiring spend’ to ‘Recruitment budget’. Rename it?` });
    const out = await w.press(card.proposal_id);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    expect(labelOf('hiring_spend')).toBe('Recruitment budget');
    expect(g().edges.map((e: Rec) => `${e.from}::${e.to}`)).toEqual(edges);
  });

  it('CONTRAST: card-only — a typed yes without the card\'s press renames nothing', async () => {
    const w = world();
    const card = await w.propose(OPT_ASK, { kind: 'option', label: 'Hire two developers', new_label: 'Hire three developers', quote: OPT_ASK });
    expect(await w.press(card.proposal_id, false)).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(rows.size).toBe(0);
    expect(labelOf('hire_two_developers')).toBe('Hire two developers');
  });

  it('CONTRAST: a name not in the user\'s words, words not in this message, a name another part has, or a link → nothing prepared', async () => {
    const w = world();
    // Olumi's own name: the user's words do not hold it.
    expect(await w.propose(OPT_ASK, { kind: 'option', label: 'Hire two developers', new_label: 'Expand the dev team', quote: OPT_ASK })).toMatchObject({ ok: false, refusal: 'not_asked' });
    expect(await w.propose('What does hiring cost?', { kind: 'option', label: 'Hire two developers', new_label: 'Hire three developers', quote: OPT_ASK })).toMatchObject({ ok: false, refusal: 'not_asked' });
    const taken = 'Rename Hire two developers to Carry on as now.';
    expect(await w.propose(taken, { kind: 'option', label: 'Hire two developers', new_label: 'Carry on as now', quote: taken })).toMatchObject({ ok: false, refusal: 'name_taken' });
    expect(await w.propose(OPT_ASK, { kind: 'link', label: 'Hire two developers', new_label: 'Hire three developers', quote: OPT_ASK })).toMatchObject({ ok: false, refusal: 'not_renamable' });
    expect(w.store.outstanding(SCENARIO_ID, 'user-a')).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it('CONTRAST: a name changed after the card was offered is never overwritten', async () => {
    const w = world();
    const card = await w.propose(OPT_ASK, { kind: 'option', label: 'Hire two developers', new_label: 'Hire three developers', quote: OPT_ASK });
    g().nodes.find((n: Rec) => n.id === 'hire_two_developers').label = 'Hire a pair of developers';
    const out = await w.press(card.proposal_id);
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(labelOf('hire_two_developers')).toBe('Hire a pair of developers');
  });
});
