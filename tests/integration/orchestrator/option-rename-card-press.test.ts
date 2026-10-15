/**
 * ⭐ S5 (DL 15 Oct): the rename card's PRESS, through the REAL in-process door (`commitOptionRenameInProcess` → the ONE durable
 * label writer, `structural_rename`), on the served hiring bytes (CEE c1e944a4, scenario e9e63843): only the press renames, ONE
 * commit, the reopened model holds the new name; a name changed after the card was offered is never overwritten.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../../src/orchestrator-v5/agent-lane/__tests__/fixtures/s5-hiring-rename-e2e-c1e944a4.json',
  import.meta.url), 'utf8')) as Rec;
const SCENARIO_ID = 'e9e63843-b4c9-4354-a976-1fb43a8a7303';

let persisted: unknown = structuredClone(FX.after_edit);
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
const labelOf = (id: string): string => (persisted as Rec).nodes.find((n: Rec) => n.id === id).label;

describe('the rename card\'s press renames through the ONE label writer, and only the press', () => {
  let mods: {
    commitOptionRenameInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionRenameInProcess;
    createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
    ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
    createProposal: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').createProposal;
    optionRenameCardOf: typeof import('../../../src/orchestrator-v5/agent-lane/option-label-count.js').optionRenameCardOf;
  };
  beforeAll(async () => {
    const d = await import('../../../src/orchestrator-v5/system-events/dispatch.js');
    const c = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js');
    const p = await import('../../../src/orchestrator-v5/agent-lane/proposal.js');
    const o = await import('../../../src/orchestrator-v5/agent-lane/option-label-count.js');
    mods = { commitOptionRenameInProcess: d.commitOptionRenameInProcess, createAgentCapabilities: c.createAgentCapabilities,
      ProposalStore: p.ProposalStore, createProposal: p.createProposal, optionRenameCardOf: o.optionRenameCardOf };
  });
  beforeEach(() => { persisted = structuredClone(FX.after_edit); rows.clear(); });

  /** The card exactly as the route mints it on the receipt, then the press (typed approval of that card). */
  async function press(typed = true) {
    const card = mods.optionRenameCardOf(persisted, 'hire_two_developers', 'developer_hires_from_today')!;
    const store = new mods.ProposalStore();
    const proposal = store.put(mods.createProposal({ scenario_id: SCENARIO_ID, user_id: 'user-a', base_graph_identity_hash: hash(),
      operations: [{ op: 'rename_option', path: card.option_id, value: { expected_label: card.expected_label, label: card.label } }],
      provenance: { authored_by: 'model_proposed', basis: 'the option’s name counts what its level no longer holds' },
      validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: card.words }));
    const read = async () => ({ status: 200, json: { graph: persisted, graph_hash: hash() } });
    const caps = mods.createAgentCapabilities(read as never, store, undefined, 'full', undefined, {
      commitOptionRename: (input) => mods.commitOptionRenameInProcess(input, 'req-rename'),
    });
    const ctx = { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: 'Yes, rename it.' };
    return { proposal, out: await caps.authoriseChange({ ...ctx, ...(typed ? { typed_approval_of: proposal.proposal_id } : {}) },
      { proposal_id: proposal.proposal_id }) as Rec };
  }

  it('RED: the press renames ‘Hire two developers’ to ‘Hire three developers’ in ONE commit; the level is untouched', async () => {
    const cell = structuredClone((persisted as Rec).nodes.find((n: Rec) => n.id === 'hire_two_developers').interventions);
    const { out } = await press();
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.follow_up).toBe('Renamed ‘Hire two developers’ to ‘Hire three developers’.');
    expect(rows.size).toBe(1);
    expect(labelOf('hire_two_developers')).toBe('Hire three developers');
    expect((persisted as Rec).nodes.find((n: Rec) => n.id === 'hire_two_developers').interventions).toEqual(cell);
    expect(labelOf('hire_one_developer')).toBe('Hire one developer');
  });

  it('CONTRAST: card-only — a typed yes without the card\'s press renames nothing', async () => {
    const { out } = await press(false);
    expect(out).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(rows.size).toBe(0);
    expect(labelOf('hire_two_developers')).toBe('Hire two developers');
  });

  it('CONTRAST: a name the user changed after the card was offered is never overwritten', async () => {
    const card = mods.optionRenameCardOf(persisted, 'hire_two_developers', 'developer_hires_from_today')!;
    expect(card.expected_label).toBe('Hire two developers');
    // Another write renames the option before the press (a label-only edit moves no analysis hash).
    (persisted as Rec).nodes.find((n: Rec) => n.id === 'hire_two_developers').label = 'Hire a pair of developers';
    const store = new mods.ProposalStore();
    const proposal = store.put(mods.createProposal({ scenario_id: SCENARIO_ID, user_id: 'user-a', base_graph_identity_hash: hash(),
      operations: [{ op: 'rename_option', path: card.option_id, value: { expected_label: card.expected_label, label: card.label } }],
      provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: card.words }));
    const read = async () => ({ status: 200, json: { graph: persisted, graph_hash: hash() } });
    const caps = mods.createAgentCapabilities(read as never, store, undefined, 'full', undefined, {
      commitOptionRename: (input) => mods.commitOptionRenameInProcess(input, 'req-rename'),
    });
    const out = await caps.authoriseChange({ scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: 'Yes, rename it.',
      typed_approval_of: proposal.proposal_id }, { proposal_id: proposal.proposal_id }) as Rec;
    expect(out.ok).toBe(false);
    expect(labelOf('hire_two_developers')).toBe('Hire a pair of developers');
  });
});
