/**
 * ⭐ S5 (DL 15 Oct, unseen brief R4 item 3): "set this link to zero" was refused and the user was sent to a canvas with no zero
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
const CAPACITY = fixture('capacity-post3017-turn01-read.json').j.graph as Rec;
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
const nodeIds = (): string[] => g().nodes.map((n: Rec) => String(n.id));
const edgePairs = (): string[] => g().edges.map((e: Rec) => `${String(e.from)}::${String(e.to)}`);

const FACTOR_ASK = 'Remove hiring spend from the model.';
// AIE 6188873084's cards, exact.
const FACTOR_CARD = `From your message: “${FACTOR_ASK}”. Olumi proposes removing ‘Hiring spend’ from this model. Its links with `
  + '‘Carry on as now’ and ‘Budget pressure’ go with it. ‘Hire a Tech lead’ and ‘Hire two developers’ no longer set it. Remove it?';
const LINK_ASK = 'Set the link from tickets resolved per specialist to additional specialist capacity to zero.';
const LINK_CARD = `From your message: “${LINK_ASK}”. Olumi proposes removing the direct link from ‘Tickets resolved per specialist’ to `
  + '‘Additional specialist capacity’. The model will no longer include that direct influence; other modelled paths between them may remain. '
  + 'Remove this link?';
const ZERO_READING = 'Olumi is reading “zero” here as removing this direct link, rather than setting only its average effect to zero. ';
const ZERO_CARD = LINK_CARD.replace('”. Olumi proposes', `”. ${ZERO_READING}Olumi proposes`);

describe('a removal the user asks for is ONE card; only its press removes it, through the ONE removal writer', () => {
  let mods: {
    commitStructuralDeleteInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitStructuralDeleteInProcess;
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
    mods = { commitStructuralDeleteInProcess: d.commitStructuralDeleteInProcess, createAgentCapabilities: c.createAgentCapabilities,
      ProposalStore: p.ProposalStore, dispatchTool: t.dispatchTool, approvalChipsFor: a.approvalChipsFor };
  });
  beforeEach(() => { persisted = structuredClone(HIRING); rows.clear(); });

  function world() {
    const store = new mods.ProposalStore();
    let pending: (() => void) | undefined;
    const read = async () => {
      const at = { status: 200, json: { graph: structuredClone(persisted), graph_hash: hash() } };
      const then = pending; pending = undefined; then?.();
      return at;
    };
    const caps = mods.createAgentCapabilities(read as never, store, undefined, 'full', undefined, {
      commitStructuralDelete: (input) => mods.commitStructuralDeleteInProcess(input, 'req-remove'),
    });
    const ctx = (said: string): Rec => ({ scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: said, user_turn_text: said });
    const propose = async (said: string, args: Rec, op = 'remove'): Promise<Rec> =>
      await mods.dispatchTool('propose_change', JSON.stringify({ ops: [{ op, ...args }] }), ctx(said) as never, caps) as Rec;
    const press = async (proposalId: string, typed = true): Promise<Rec> => await caps.authoriseChange({ ...ctx('Yes, remove it.'),
      ...(typed ? { typed_approval_of: proposalId } : {}) } as never, { proposal_id: proposalId }) as Rec;
    return { store, propose, press, afterNextRead: (f: () => void) => { pending = f; }, caps };
  }

  it('RED (hiring): "Remove hiring spend" → ONE card saying what goes with it; the press removes it in ONE commit', async () => {
    const w = world();
    const card = await w.propose(FACTOR_ASK, { kind: 'factor', label: 'Hiring spend', quote: FACTOR_ASK });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false, public_label: FACTOR_CARD });
    expect(w.store.get(card.proposal_id)?.operations).toEqual([{ op: 'remove_node', path: 'hiring_spend',
      value: { kind: 'factor', expected_label: 'Hiring spend' } }]);
    expect(nodeIds()).toContain('hiring_spend');
    const before = { nodes: nodeIds().filter((id) => id !== 'hiring_spend'), edges: edgePairs().filter((p) => !p.split('::').includes('hiring_spend')) };
    const out = await w.press(card.proposal_id);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true, follow_up: 'Removed ‘Hiring spend’ from the model.' });
    expect(rows.size).toBe(1);
    expect(nodeIds()).toEqual(before.nodes);
    expect(edgePairs()).toEqual(before.edges);
    // The options' settings of the removed factor go with it; their other settings stay.
    const ivs = (id: string): string[] => Object.keys(g().nodes.find((n: Rec) => n.id === id).interventions ?? {});
    expect(ivs('hire_a_tech_lead')).toEqual(['tech_leads']);
    expect(ivs('hire_two_developers')).toEqual(['mid_weight_developers']);
  });

  it('RED (capacity): "set this link to zero" → the link is removed by its card; both parts and every other link stay', async () => {
    persisted = structuredClone(CAPACITY);
    const w = world();
    const card = await w.propose(LINK_ASK, { kind: 'link', label: 'Tickets resolved per specialist', to_label: 'Additional specialist capacity', quote: LINK_ASK });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, public_label: LINK_CARD });
    const nodesBefore = nodeIds();
    const edgesBefore = edgePairs().filter((p) => p !== 'tickets_resolved_per_specialist::additional_specialist_capacity');
    const out = await w.press(card.proposal_id);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true,
      follow_up: 'Removed the direct link from ‘Tickets resolved per specialist’ to ‘Additional specialist capacity’.' });
    expect(rows.size).toBe(1);
    expect(nodeIds()).toEqual(nodesBefore);
    expect(edgePairs()).toEqual(edgesBefore);
  });

  it('RED (capacity): op set_zero on the link → the removal card, showing "zero" read as removing the direct link; button "Remove it"', async () => {
    persisted = structuredClone(CAPACITY);
    const w = world();
    const card = await w.propose(LINK_ASK, { kind: 'link', label: 'Tickets resolved per specialist', to_label: 'Additional specialist capacity', quote: LINK_ASK }, 'set_zero');
    // AIE 6188873084: "zero" is not automatically removal — the card SHOWS that reading for the user to adopt.
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, public_label: ZERO_CARD });
    const stored = w.store.get(card.proposal_id)!;
    const chips = mods.approvalChipsFor([{ name: 'propose_change', ok: true, mutated: false, proposal_id: card.proposal_id }],
      () => ({ proposal: stored, result: card as never }));
    expect(chips[0]).toMatchObject({ label: 'Remove it', message: 'Yes, remove it.', detail: ZERO_CARD });
    expect(String(chips[0]!.id)).toBe(`agent-approve-proposal:${card.proposal_id}`);
  });

  it('CONTRAST: set_zero names a link only; an op the tool does not hold, or two ops → nothing prepared', async () => {
    const w = world();
    expect(await w.propose(FACTOR_ASK, { kind: 'factor', label: 'Hiring spend', quote: FACTOR_ASK }, 'set_zero')).toMatchObject({ ok: false, refusal: 'unsupported_change' });
    expect(await w.propose(FACTOR_ASK, { kind: 'factor', label: 'Hiring spend', quote: FACTOR_ASK }, 'delete')).toMatchObject({ ok: false, refusal: 'unsupported_change' });
    const one = { op: 'remove', kind: 'factor', label: 'Hiring spend', quote: FACTOR_ASK };
    expect(await mods.dispatchTool('propose_change', JSON.stringify({ ops: [one, one] }), { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a',
      request_id: 'r', user_text: FACTOR_ASK, user_turn_text: FACTOR_ASK } as never, w.caps)).toMatchObject({ ok: false, refusal: 'unsupported_change' });
    expect(w.store.outstanding(SCENARIO_ID, 'user-a')).toEqual([]);
  });

  it('a risk\'s card says removing it is no evidence it cannot happen (AIE 6188873084)', async () => {
    const w = world();
    const ask = 'Drop the budget pressure risk.';
    const card = await w.propose(ask, { kind: 'risk', label: 'Budget pressure', quote: ask });
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true });
    expect(card.public_label).toMatch(/^From your message: “Drop the budget pressure risk\.”\. Olumi proposes removing ‘Budget pressure’ from this model\. /);
    expect(card.public_label).toMatch(/ Removing it from this model does not mean it cannot happen\. Remove it\?$/);
  });

  it('CONTRAST: card-only — a typed yes without the card\'s press removes nothing', async () => {
    const w = world();
    const card = await w.propose(FACTOR_ASK, { kind: 'factor', label: 'Hiring spend', quote: FACTOR_ASK });
    const out = await w.press(card.proposal_id, false);
    expect(out).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(rows.size).toBe(0);
    expect(nodeIds()).toContain('hiring_spend');
  });

  it('CONTRAST: words the user did not say in THIS message → nothing prepared (a removal is never Olumi\'s idea)', async () => {
    const w = world();
    const out = await w.propose('What drives productivity most?', { kind: 'factor', label: 'Hiring spend', quote: FACTOR_ASK });
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'not_asked' });
    expect(w.store.outstanding(SCENARIO_ID, 'user-a')).toEqual([]);
  });

  it('CONTRAST: an option or the goal is never removed here; an unknown label is not found, never guessed', async () => {
    const w = world();
    const ask = 'Remove Hire two developers.';
    expect(await w.propose(ask, { kind: 'option', label: 'Hire two developers', quote: ask })).toMatchObject({ ok: false, refusal: 'not_removable' });
    expect(await w.propose('Remove productivity.', { kind: 'goal', label: 'Productivity', quote: 'Remove productivity.' })).toMatchObject({ ok: false, refusal: 'not_removable' });
    // An option's label offered as a factor names no factor.
    expect(await w.propose(ask, { kind: 'factor', label: 'Hire two developers', quote: ask })).toMatchObject({ ok: false, refusal: 'subject_not_found' });
    expect(await w.propose('Remove hiring costs.', { kind: 'factor', label: 'Hiring costs', quote: 'Remove hiring costs.' })).toMatchObject({ ok: false, refusal: 'subject_not_found' });
    expect(w.store.outstanding(SCENARIO_ID, 'user-a')).toEqual([]);
  });

  it('CONTRAST: the model changed after the card was offered → nothing removed', async () => {
    const w = world();
    const card = await w.propose(FACTOR_ASK, { kind: 'factor', label: 'Hiring spend', quote: FACTOR_ASK });
    // Another write moves the analysis before the press.
    const tl = g().nodes.find((n: Rec) => n.id === 'hire_a_tech_lead').interventions.tech_leads;
    if (typeof tl === 'object' && tl !== null) tl.value = Number(tl.value ?? 0) + 1; else g().nodes.find((n: Rec) => n.id === 'hire_a_tech_lead').interventions.tech_leads = 2;
    const out = await w.press(card.proposal_id);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(nodeIds()).toContain('hiring_spend');
    expect(rows.size).toBe(0);
  });

  it('CONTRAST: a write landing after the approval check, before the removal → the door refuses on the card\'s base; nothing removed', async () => {
    const w = world();
    const card = await w.propose(FACTOR_ASK, { kind: 'factor', label: 'Hiring spend', quote: FACTOR_ASK });
    // The press reads the model once to check the card; another write lands right after that read.
    w.afterNextRead(() => { g().nodes.find((n: Rec) => n.id === 'hire_a_tech_lead').interventions.tech_leads.raw_value = 2; });
    const out = await w.press(card.proposal_id);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: false, applied: false, refusal: 'superseded' });
    expect(nodeIds()).toContain('hiring_spend');
    expect(rows.size).toBe(0);
  });
});
