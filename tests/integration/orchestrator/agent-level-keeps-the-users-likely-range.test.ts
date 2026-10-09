/**
 * TEMPORAL producer — the user's LIKELY RANGE for what an option sets survives propose → ONE approval → the REAL
 * in-process door (`commitOptionLevelsInProcess`) → the persisted cell, as THEIRS.
 *
 * The ask is B6's (MG SUCCESSOR #2384, AIQ 5916187873): "What's each option's likely range for ‘Migration downtime’?".
 * Only "likely range" wording licenses the quartile reading (R3 #75 5914230653), so the cell records
 * `{low, high, meaning: 'likely_range', source: 'user_specified'}` beside the user's figure; the persisted form's gate
 * (`intervention-range.ts`) and the analysis hash then see it.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '88888888-8888-4888-8888-888888888888';
const LIFT = 'Lift-and-shift';
const REPLATFORM = 'Re-platform';
const TEXT = 'For Lift-and-shift, migration downtime is likely between 5 and 20 days, most likely 10 days.';
/** The typed reading the Agent sends with a range: a plain LIKELY range, given by the user. */
const TYPED = { range_meaning: 'likely_range', range_user_stated: true } as const;

function servedGraph() {
  return projectGraphForPersistence({
    ...GraphV3.parse({
      nodes: [
        { id: 'goal_cost', kind: 'goal', label: 'Annual cost', goal_threshold: 0.1 },
        {
          id: 'opt_lift', kind: 'option', label: LIFT,
          interventions: { fac_downtime: { value: 0.3, source: 'cee_hypothesis', target_match: { node_id: 'fac_downtime', match_type: 'exact_id', confidence: 'high' } } },
        },
        { id: 'opt_replatform', kind: 'option', label: REPLATFORM, interventions: {} },
        { id: 'fac_training', kind: 'factor', label: 'Training time', observed_state: { value: 0.1, raw_value: 4, cap: 40, unit: 'days', source: 'user_override' } },
        { id: 'fac_downtime', kind: 'factor', label: 'Migration downtime', observed_state: { value: 0, raw_value: 0, cap: 40, unit: 'days', source: 'user_override' } },
      ],
      edges: [['opt_lift', 'fac_downtime'], ['fac_downtime', 'goal_cost'], ['fac_training', 'goal_cost']]
        .map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
    }),
    options: [] as Array<Record<string, unknown>>,
  });
}

let persisted: unknown = servedGraph();
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-09-30T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-30T00:00:00.000Z', fact }));
    }),
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

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

const currentHash = (): string => {
  const h = computeAnalysisAffectingGraphHash(persisted as never);
  if (h === null) throw new Error('fixture must have an analysis-affecting hash');
  return h;
};

type Cell = Record<string, unknown>;
const liftCell = (): Cell => ((persisted as { nodes: { id: string; interventions?: Record<string, Cell> }[] })
  .nodes.find((n) => n.id === 'opt_lift')!.interventions!.fac_downtime!);

describe('the user\'s likely range for an option\'s level survives propose → approval → the real door → the persisted cell', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
  });
  beforeEach(() => {
    persisted = servedGraph();
    rows.clear();
  });

  async function proposeAndApprove(level: Record<string, unknown>, text = TEXT, compound = false, typedApproval = true) {
    const read = async () => ({ status: 200, json: { graph: persisted, graph_hash: currentHash() } });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(read as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-agent'),
    });
    const ctx = { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: text };
    const levels = [{ option_label: LIFT, factor_label: 'Migration downtime', unit: 'days', basis: 'the user', user_stated: true, ...level }];
    const before = JSON.stringify(persisted);
    const count = rows.size;
    const proposed = compound
      ? await caps.proposeStartingPoint(ctx, { assumptions: [{ factor_label: 'Training time', value: 8, unit: 'days', basis: 'planning assumption' }], option_levels: levels } as never)
      : await caps.proposeOptionInterventions(ctx, { interventions: levels } as never);
    expect(JSON.stringify(persisted)).toBe(before);
    expect(rows.size).toBe(count);
    const content = store.get(String(proposed.proposal_id));
    if (proposed.ok !== true) return { proposed, content, out: undefined };
    const out = await caps.authoriseChange({ ...ctx, ...(typedApproval ? { typed_approval_of: String(proposed.proposal_id) } : {}) },
      { proposal_id: String(proposed.proposal_id) });
    return { proposed, content, out };
  }

  async function rangeDifferential(level: Record<string, unknown>, text = TEXT, compound = false) {
    const initial = structuredClone(persisted);
    const input = structuredClone(level);
    const a = await proposeAndApprove(level, text, compound);
    expect(level).toEqual(input);
    expect(a.proposed.ranges_not_recorded).toHaveLength(1);
    expect(a.proposed.detail).toMatch(/likely range/i);
    if (level.range_user_stated === true) expect(a.proposed.detail).toMatch(/ask the user/i);
    const aCell = structuredClone(liftCell());
    expect(aCell.range).toEqual(((initial as { nodes: { id: string; interventions?: Record<string, Cell> }[] })
      .nodes.find(n => n.id === 'opt_lift')!.interventions!.fac_downtime!).range);
    const aWrites = rows.size;
    persisted = structuredClone(initial);
    rows.clear();
    const ordinary = Object.fromEntries(Object.entries(level).filter(([key]) =>
      !['likely_low', 'likely_high', 'range_meaning', 'range_user_stated'].includes(key)));
    const b = await proposeAndApprove(ordinary, text, compound);
    expect(a.proposed.ok).toBe(b.proposed.ok);
    // Real proposals are bound by the exact option::factor path, full value (including authorship), provenance and label.
    expect(a.content?.operations).toEqual(b.content?.operations);
    expect(a.content?.provenance).toEqual(b.content?.provenance);
    expect(a.content?.public_label).toEqual(b.content?.public_label);
    if (b.proposed.ok === true) {
      expect(a.content).toBeDefined();
      expect(a.content!.operations.filter(op => op.op === 'set_option_intervention').map(op => op.path))
        .toEqual(['opt_lift::fac_downtime']);
      expect(a.out?.ok, JSON.stringify(a.out)).toBe(true);
      expect(b.out?.ok, JSON.stringify(b.out)).toBe(true);
      expect(aCell).toEqual(liftCell());
      expect(Object.hasOwn(aCell, 'range')).toBe(false);
      expect(aWrites).toBe(1);
      expect(rows.size).toBe(1);
    } else {
      const { ranges_not_recorded: _ranges, detail, ...refusal } = a.proposed;
      const { detail: ordinaryDetail, ...ordinaryRefusal } = b.proposed;
      expect(refusal).toEqual(ordinaryRefusal);
      expect(String(detail)).toContain(String(ordinaryDetail));
      expect(a.content).toBeUndefined();
      expect(a.out).toBeUndefined();
      expect(aWrites).toBe(0);
      expect(rows.size).toBe(0);
      expect(persisted).toEqual(initial);
    }
    return a;
  }

  it.each([false, true])('a range cannot use ordinary approval; its exact typed card is required, compound=%s', async compound => {
    const before = structuredClone(persisted);
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED }, TEXT, compound, false);
    expect(proposed.ok).toBe(true);
    expect(out).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(rows.size).toBe(0);
    expect(persisted).toEqual(before);
  });

  it('RED: the persisted cell holds the user\'s 10 days AND their likely range 5–20, as theirs; ONE commit; the hash moves', async () => {
    const before = currentHash();
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    // What the user approves names the range AND how it is read (AIQ 5909998288 / 5914439702).
    expect(String(proposed.public_label)).toMatch(/likely between 5 days and 20 days \(read as the middle half of what.s likely\)/);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size).toBe(1);
    const cell = liftCell();
    expect(cell, JSON.stringify(cell)).toMatchObject({ raw_value: 10, source: 'user_specified' });
    expect(cell.range).toEqual({ low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' });
    expect(currentHash()).not.toBe(before);
  });

  it('the merged B3 gap declaration and temporal reading use one stored approval and one write', async () => {
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED,
      unmodelled_mechanisms: ['supplier learning'] });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.public_label).toContain('supplier learning');
    expect(proposed.public_label).toContain('likely between 5 days and 20 days');
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size).toBe(1);
    expect(liftCell().range).toEqual({ low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' });
    const option = (persisted as { nodes: Cell[] }).nodes.find(n => n.id === 'opt_lift')!;
    expect(option.unresolved_targets).toEqual(['supplier learning']);
    expect(option.user_questions).toEqual([expect.stringContaining('supplier learning')]);
  });

  it('RED: the range alone changes (same 10 days, a range added) → it is written, never "already set"', async () => {
    persisted = servedGraph();
    // First the level alone, then the range for the same level.
    await proposeAndApprove({ value: 10 });
    expect(liftCell().range).toBeUndefined();
    rows.clear();
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(liftCell().range).toEqual({ low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' });
  });

  it.each([[false, true], [false, false], [true, true], [true, false]])('capless opt_lift/fac_downtime retains raw/unit/range: compound=%s declaredUnit=%s', async (compound, declaredUnit) => {
    const factor = (persisted as { nodes: { id: string; observed_state?: Record<string, unknown> }[] })
      .nodes.find(n => n.id === 'fac_downtime')!;
    delete factor.observed_state!.cap;
    if (!declaredUnit) delete factor.observed_state!.unit;
    const { proposed, out } = await proposeAndApprove({ value: 0.5, likely_low: 0.2, likely_high: 0.8, ...TYPED },
      'For Lift-and-shift, migration downtime is likely between 0.2 and 0.8 days, most likely 0.5 days.', compound);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size).toBe(1);
    expect(liftCell()).toMatchObject({ value: 0.5, raw_value: 0.5, unit: 'days', source: 'user_specified',
      range: { low: 0.2, high: 0.8, meaning: 'likely_range', source: 'user_specified' } });
    expect(liftCell()).not.toHaveProperty('cap');
    const cold = GraphV3.parse(JSON.parse(JSON.stringify(persisted)));
    expect(cold.nodes.find(n => n.id === 'opt_lift')?.interventions?.fac_downtime).toEqual(liftCell());
    const other = (persisted as { nodes: { id: string; interventions?: Record<string, unknown> }[] })
      .nodes.find(n => n.id === 'opt_replatform')!;
    expect(other.interventions?.fac_downtime).toBeUndefined();
  });

  it.each(['10', 'ten'])('equivalent typed likely range is admitted and explicitly approved with most likely %s days', async (point) => {
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED },
      `For Lift-and-shift, migration downtime is likely between five and twenty days, most likely ${point} days.`);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(liftCell()).toMatchObject({ raw_value: 10, unit: 'days', range: { low: 5, high: 20, source: 'user_specified' } });
  });

  it('the dedicated approval preserves an identical stated range on a changed native quantity', async () => {
    await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED });
    const { proposed, out } = await proposeAndApprove({ value: 12, likely_low: 5, likely_high: 20, ...TYPED },
      'For Lift-and-shift, migration downtime is likely between 5 and 20 days, most likely 12 days.');
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(liftCell()).toMatchObject({ value: 0.3, raw_value: 12, range: { low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' } });
  });

  // Codex CR 5963331228 P1: the range is decided from TYPED arguments only (its meaning, that the user gave it, beside a
  // level they gave, the level inside it), never by parsing the user's words; the user then approves range AND reading.
  it.each([
    ['no range_user_stated (Olumi\'s range is never recorded as theirs)', { value: 10, likely_low: 5, likely_high: 20, range_meaning: 'likely_range' }, TEXT],
    ['range_user_stated false', { value: 10, likely_low: 5, likely_high: 20, range_meaning: 'likely_range', range_user_stated: false }, TEXT],
    ['a 95% confidence interval (range_meaning other; Codex CR)', { value: 10, likely_low: 5, likely_high: 20, range_meaning: 'other', range_user_stated: true },
      'For Lift-and-shift I am 95% confident migration downtime is between 5 and 20 days, most likely 10 days.'],
    ['a min–max (range_meaning min_max)', { value: 10, likely_low: 5, likely_high: 20, range_meaning: 'min_max', range_user_stated: true }, TEXT],
    ['a bound (range_meaning at_most)', { value: 10, likely_low: 5, likely_high: 20, range_meaning: 'at_most', range_user_stated: true }, TEXT],
    ['no range_meaning', { value: 10, likely_low: 5, likely_high: 20, range_user_stated: true }, TEXT],
    ['only one bound', { value: 10, likely_low: 5, ...TYPED }, TEXT],
    ['a low end that is not positive', { value: 10, likely_low: 0, likely_high: 20, ...TYPED }, TEXT],
    ['a figure outside its own range', { value: 30, likely_low: 5, likely_high: 20, ...TYPED }, 'Lift-and-shift: likely between 5 and 20 days, call it 30.'],
    ['a level that is not the user\'s (user_stated false)', { value: 10, likely_low: 5, likely_high: 20, ...TYPED, user_stated: false }, TEXT],
  ])('%s: the range is not recorded; the level follows ordinary grounding', async (_n, level, text) => {
    await rangeDifferential(level, text);
  });

  it('a user-stated reversed range: the range is not recorded; the level follows ordinary grounding and asks for restatement', async () => {
    const { proposed, content } = await rangeDifferential({ value: 10, likely_low: 20, likely_high: 5, ...TYPED });
    expect(proposed.detail).toMatch(/ask the user/i);
    expect(content!.operations[0].value).not.toHaveProperty('likely_range');
  });

  it('RED: a typed likely range is admitted however the user worded it (no wording door: "five to twenty days")', async () => {
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED },
      'For Lift-and-shift, migration downtime is 10 days most likely; my likely range runs from five to twenty days.');
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(liftCell().range).toEqual({ low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' });
  });

  // Codex CR 5963331228 P2: equal bounds with another meaning or author are a CHANGE, never "already set".
  it.each([
    ['stored as a min–max', { low: 5, high: 20, meaning: 'min_max', source: 'user_specified' }],
    ['stored as Olumi\'s', { low: 5, high: 20, meaning: 'likely_range', source: 'cee_hypothesis' }],
  ])('RED: the same 5–20 %s is rewritten as the user\'s likely range', async (_n, stored) => {
    await proposeAndApprove({ value: 10 });
    liftCell().range = stored;
    rows.clear();
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(liftCell().range).toEqual({ low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' });
  });
  it('CONTROL: the same complete likely range already stored is a repeat (nothing proposed)', async () => {
    await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED });
    rows.clear();
    const { proposed } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED });
    expect(proposed.ok).toBe(false);
    expect(rows.size).toBe(0);
  });

  it('CONTROL: a level with no range is written exactly as before (no `range` key)', async () => {
    const { out } = await proposeAndApprove({ value: 10 });
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(Object.hasOwn(liftCell(), 'range')).toBe(false);
  });

  it.each([false, true])('ordinary level: explicit false range flag equals omitted, compound=%s', async (compound) => {
    const text = 'For Lift-and-shift, migration downtime is 10 days.';
    const omitted = await proposeAndApprove({ value: 10 }, text, compound);
    expect(omitted.proposed.ok, JSON.stringify(omitted.proposed)).toBe(true);
    expect(omitted.out?.ok, JSON.stringify(omitted.out)).toBe(true);
    const expectedCell = JSON.parse(JSON.stringify(liftCell()));
    const expectedHash = currentHash();
    expect(Object.hasOwn(expectedCell, 'range')).toBe(false);
    expect(rows.size).toBe(1);

    persisted = servedGraph();
    rows.clear();
    const explicitFalse = await proposeAndApprove({ value: 10, range_user_stated: false }, text, compound);
    expect(explicitFalse.proposed.ok, JSON.stringify(explicitFalse.proposed)).toBe(true);
    expect(explicitFalse.out?.ok, JSON.stringify(explicitFalse.out)).toBe(true);
    expect(liftCell()).toEqual(expectedCell);
    expect(currentHash()).toBe(expectedHash);
    expect(rows.size).toBe(1);
  });

  it.each([
    [false, { value: 10, likely_low: 5, likely_high: 20, range_meaning: 'likely_range', range_user_stated: false }],
    [true, { value: 10, likely_low: 5, likely_high: 20, range_meaning: 'likely_range', range_user_stated: false }],
    [false, { value: 10, range_user_stated: true }],
    [true, { value: 10, range_user_stated: true }],
  ])('incomplete or unclaimed actual range: the range is not recorded; the level follows ordinary grounding, compound=%s level=%j', async (compound, level) => {
    await rangeDifferential(level, TEXT, compound);
  });

  it.each([false, true])('false range flag retains ordinary user-figure grounding, compound=%s', async (compound) => {
    const text = 'For Lift-and-shift, migration downtime is 10 days.';
    const omitted = await proposeAndApprove({ value: 30 }, text, compound);
    expect(omitted.out?.ok, JSON.stringify(omitted)).toBe(true);
    const expected = structuredClone(liftCell());
    expect(expected.source).not.toBe('user_specified');
    persisted = servedGraph();
    rows.clear();
    const explicitFalse = await proposeAndApprove({ value: 30, range_user_stated: false }, text, compound);
    expect(explicitFalse.out?.ok, JSON.stringify(explicitFalse)).toBe(true);
    expect(liftCell()).toEqual(expected);
  });
});
