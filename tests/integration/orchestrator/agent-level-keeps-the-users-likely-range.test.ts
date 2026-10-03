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
const TYPED = { range_meaning: 'likely_range', range_user_stated: true, most_likely_stated: true } as const;

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

  async function proposeAndApprove(level: Record<string, unknown>, text = TEXT) {
    const read = async () => ({ status: 200, json: { graph: persisted, graph_hash: currentHash() } });
    const caps = createAgentCapabilities(read as never, new ProposalStore(), undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-agent'),
    });
    const ctx = { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: text };
    const proposed = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: LIFT, factor_label: 'Migration downtime', unit: 'days', basis: 'the user', user_stated: true, ...level },
    ] } as never);
    if (proposed.ok !== true) return { proposed, out: undefined };
    const out = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    return { proposed, out };
  }

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
  ])('REFUSED, nothing proposed: %s', async (_n, level, text) => {
    const { proposed } = await proposeAndApprove(level, text);
    expect(proposed.ok).toBe(false);
    expect(JSON.stringify(proposed)).toMatch(/likely range/i);
    expect(rows.size).toBe(0);
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

  // SCI-TEMPORAL (DL #85 5963038431 / 5963160109): decided by the TYPED args. A range sent WITHOUT `most_likely_stated`
  // (the plain answer to B6's ask, "likely between 5 and 20 days") has no most likely figure of the user's, so no level
  // beside it is recorded as theirs — not an end, not a middle; the refusal asks for that figure (never the range again).
  const SPAN_ONLY = 'For Lift-and-shift, migration downtime is likely between 5 and 20 days.';
  const RANGE_ONLY = { range_meaning: 'likely_range', range_user_stated: true } as const;
  it.each([5, 20])('RED: a range sent with no separate typed level never stores its end (%s days) as the user\'s level', async (end) => {
    const { proposed } = await proposeAndApprove({ value: end, likely_low: 5, likely_high: 20, ...RANGE_ONLY }, SPAN_ONLY);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(false);
    expect(rows.size).toBe(0);
    expect(liftCell().range).toBeUndefined();
  });
  it('RED: a range-only answer is refused with the question that unblocks it (their most likely figure)', async () => {
    const { proposed } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...RANGE_ONLY }, SPAN_ONLY);
    expect(proposed.ok).toBe(false);
    expect(JSON.stringify(proposed)).toMatch(/most likely figure/);
  });
  it('CONTROL (DL): a SEPARATE typed level equal to an end ("5–20 days, most likely 5 days" → value 5, most_likely_stated) is admitted as the user\'s', async () => {
    const { proposed, out } = await proposeAndApprove({ value: 5, likely_low: 5, likely_high: 20, ...TYPED },
      'For Lift-and-shift, migration downtime is likely 5–20 days, most likely 5 days.');
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(liftCell()).toMatchObject({ raw_value: 5, source: 'user_specified', range: { low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' } });
  });

  it('CONTROL: a level with no range is written exactly as before (no `range` key)', async () => {
    const { out } = await proposeAndApprove({ value: 10 });
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(Object.hasOwn(liftCell(), 'range')).toBe(false);
  });
});
