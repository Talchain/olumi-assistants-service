/**
 * TEMPORAL producer — the user's LIKELY RANGE for what an option sets survives propose → ONE approval → the REAL
 * in-process door (`commitOptionLevelsInProcess`) → the persisted cell, as THEIRS.
 *
 * The ask is B6's (MG SUCCESSOR #2384, AIQ 5916187873): "What's each option's likely range for ‘Migration downtime’?".
 * Only "likely range" wording licenses the quartile reading (R3 #75 5914230653), so the cell records
 * `{low, high, meaning: 'likely_range', source: 'user_specified'}` beside the user's figure; the persisted form's gate
 * (`intervention-range.ts`) and the analysis hash then see it.
 */
import { quoteOfFigure } from '../../../src/orchestrator-v5/agent-lane/stated-by-user.js';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { LIKELY_RANGE_LAW_NOTE, STATED_RANGE_CARD_CLOSING } from '../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { rangeLawAdopted, rangeLawSubject } from '../../../src/orchestrator-v5/intervention-range.js';
import { userStatementOnNode } from '../../../src/orchestrator-v5/statement-door/statements.js';
import { subjectKey } from '../../../src/orchestrator-v5/statement-door/subject.js';
import { rangeLawAdoption, rangeLawStatementOf } from '../../../src/orchestrator-v5/statement-door/fields/range-law.js';

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
    // ⭐ LEAN CORE (#3392, USER_QUOTE): the AI cites the user's sentence that writes the level's figure; none where it is unwritten.
    const cite = typeof level.value === 'number' && level.quote === undefined ? quoteOfFigure(level.value, String(level.unit ?? 'days'), text) : null;
    const levels = [{ option_label: LIFT, factor_label: 'Migration downtime', unit: 'days', basis: 'the user', user_stated: true, ...(cite !== null ? { quote: cite } : {}), ...level }];
    const before = JSON.stringify(persisted);
    const count = rows.size;
    const proposed = compound
      ? await caps.proposeStartingPoint(ctx, { assumptions: [{ user_stated: false, factor_label: 'Training time', value: 8, unit: 'days', basis: 'planning assumption' }], option_levels: levels } as never)
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
    if (level.range_user_stated === true) {
      // AIE 6183364243: a range the user meant otherwise is never asked back as a likely range; only an unusable likely range is.
      const meantOtherwise = typeof level.likely_low === 'number' && typeof level.likely_high === 'number'
        && level.likely_low > 0 && level.likely_high > level.likely_low && level.range_meaning !== 'likely_range';
      if (!meantOtherwise) expect(a.proposed.detail).toMatch(/ask the user to restate their likely range/i);
      else if (level.range_meaning === undefined) expect(a.proposed.detail).toMatch(/ask the user how they meant that range/i);
      else {
        expect(a.proposed.detail).toContain('do not ask them to restate it as a likely range');
        expect(a.proposed.detail).not.toMatch(/restate their likely range/i);
      }
    }
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
    // C2 (AIE 6180618773 row 2; template AIE 6184022140): the user's range as stated, then the equal-tail fit as Olumi's proposed approximation.
    expect(String(proposed.public_label)).toContain('Your stated range is 5 days to 20 days, with its qualification read as “likely”; any other '
      + 'qualifications or conditions in your words were not read. Olumi proposes an equal-tail approximation, about one chance in four below 5 days '
      + 'and one in four above 20 days, for this analysis');
    expect(String(proposed.public_label)).toContain('Your words did not specify those tail probabilities or how values are distributed.');
    // AIE 6184022140's closing, once: nothing is recorded until the press (the approval_required row above).
    expect(String(proposed.public_label).endsWith('Use this reading to record your original range as stated and adopt the shown Olumi approximation. '
      + 'You can change or reject it instead.')).toBe(true);
    expect(String(proposed.public_label)).not.toMatch(/remains recorded|no conditions recorded/i);
    // C2 join: the Agent is told the ends are the user's and the law Olumi's, beside the range it proposed.
    expect((proposed.interventions as Array<Record<string, unknown>>)[0]).toMatchObject({ likely_range: { low: 5, high: 20 }, likely_range_law: LIKELY_RANGE_LAW_NOTE });
    expect(String(proposed.public_label)).not.toMatch(/middle half/i);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size).toBe(1);
    const cell = liftCell();
    expect(cell, JSON.stringify(cell)).toMatchObject({ raw_value: 10, source: 'user_specified' });
    expect(cell.range).toEqual({ low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' });
    expect(currentHash()).not.toBe(before);
  });

  // ⭐ C2 (AIE 6184726873; DL 15 Oct): a chance resting on Olumi's equal-tail reading of the user's range is withheld until that
  // reading is adopted. The level card SHOWED the whole approximation, so its press adopts it, in the same ONE commit.
  const adoptionRecord = () => userStatementOnNode((persisted as { nodes: { id: string }[] }).nodes.find(n => n.id === 'fac_downtime'),
    subjectKey(rangeLawSubject('opt_lift', 'fac_downtime')));
  const adopted = (low = 5, high = 20): boolean => rangeLawAdopted(persisted, 'opt_lift', { factor_id: 'fac_downtime', low, high });

  it('RED: the press on the card that showed the approximation adopts it in the SAME commit, with the user\'s sentence and the exact ends', async () => {
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED });
    expect(String(proposed.public_label)).toContain(STATED_RANGE_CARD_CLOSING);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size).toBe(1);
    expect(liftCell().range).toEqual({ low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' });
    expect(adopted()).toBe(true);
    // Their words and the ends they gave; the law is Olumi's, attested beside them.
    expect(adoptionRecord()?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: TEXT, form: 'range', low: 5, high: 20, reading: 'olumi' })]);
    expect(adoptionRecord()?.attest).toEqual({ range_law: 'equal_tail', low: 5, high: 20 });
  });

  it('RED: words the figures cannot be found in ("five to twenty days") keep the user\'s whole message as the record\'s words', async () => {
    const said = 'For Lift-and-shift, migration downtime is 10 days most likely; my likely range runs from five to twenty days.';
    const { out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED }, said);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(adopted()).toBe(true);
    expect(adoptionRecord()?.statements[0]?.quote).toBe(said);
  });

  it('CONTRAST: the door writes an adoption only beside the level that writes those exact ends; otherwise nothing at all', async () => {
    const before = structuredClone(persisted);
    const statement = rangeLawStatementOf('opt_lift', 'fac_downtime', TEXT, 5, 20, 'days');
    const res = await commitOptionLevelsInProcess({ scenario_id: SCENARIO_ID, base_graph_hash: currentHash(), turn_id: 'c2-door-contrast',
      links: [], levels: [{ option_id: 'opt_lift', factor_id: 'fac_downtime', value: 0.25, raw_value: 10, cap: 40, unit: 'days',
        author: 'user_specified', likely_range: { low: 5, high: 25 } }],
      statement_record: [rangeLawAdoption(persisted, 'opt_lift', 'fac_downtime', [statement], 5, 20, '2026-10-15T00:00:00.000Z')!] } as never, 'req-agent');
    expect(res).toMatchObject({ status: 'refused', reason: 'range_law_without_its_level' });
    expect(rows.size).toBe(0);
    expect(persisted).toEqual(before);
  });

  it('RED: a ranged level proposed through the starting-point tool adopts it in its ONE commit too', async () => {
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED }, TEXT, true);
    expect(String(proposed.public_label)).toContain(STATED_RANGE_CARD_CLOSING);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size).toBe(1);
    expect(adopted()).toBe(true);
  });

  it('CONTRAST: a level with no range adopts nothing', async () => {
    const { out } = await proposeAndApprove({ value: 10 });
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(adoptionRecord()).toBeUndefined();
  });

  it('RED: the same range held but never adopted (recorded before the press adopted it) is proposed again, and its press adopts it', async () => {
    await proposeAndApprove({ value: 10 });
    liftCell().range = { low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' };
    expect(adopted()).toBe(false);
    const cell = structuredClone(liftCell());
    rows.clear();
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size).toBe(1);
    expect(adopted()).toBe(true);
    expect(liftCell()).toEqual(cell);
  });

  it('the merged B3 gap declaration and temporal reading use one stored approval and one write', async () => {
    const { proposed, out } = await proposeAndApprove({ value: 10, likely_low: 5, likely_high: 20, ...TYPED,
      unmodelled_mechanisms: ['supplier learning'] });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.public_label).toContain('supplier learning');
    expect(proposed.public_label).toContain('Your stated range is 5 days to 20 days,');
    expect(out?.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size).toBe(1);
    expect(liftCell().range).toEqual({ low: 5, high: 20, meaning: 'likely_range', source: 'user_specified' });
    // The compound press (levels with a gap declaration) adopts the shown approximation in the same ONE write.
    expect(adopted()).toBe(true);
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
    // ⛔ PL-0048 (1), #3392 (THE ONE RULE): a figure claimed as the user's that their words never write has no span to cite, so it is
    // unknown and nothing is prepared (was: relabelled and written as Olumi's). The range flag never changes that grounding.
    const before = structuredClone(liftCell());
    const omitted = await proposeAndApprove({ value: 30 }, text, compound);
    expect(omitted.proposed.ok, JSON.stringify(omitted)).toBe(false);
    const explicitFalse = await proposeAndApprove({ value: 30, range_user_stated: false }, text, compound);
    expect(explicitFalse.proposed, JSON.stringify(explicitFalse)).toMatchObject({ ok: false, refusal: omitted.proposed.refusal });
    expect(liftCell()).toEqual(before);
  });
});
