import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { capture, captureDir, findState, expected, keysDeep, object, valueAt, seedOf, type Turn, type Witness } from './provider-harness.js';

describe('Explain uses the canonical assembly (serialized provider bytes)', () => {
  it('run2 Explain carries exactly the canonical state ordinary converse carries', async () => {
    const ordinary = await capture('ordinary-converse', 'run2');
    const explain = await capture('Run-explanation', 'run2');
    const ordinaryState = findState(ordinary.calls[0].payloads);
    expect(Object.keys(ordinaryState).length, 'ordinary state decoded').toBeGreaterThan(0);
    for (const c of explain.calls) expect(findState(c.payloads)).toEqual(ordinaryState);
  }, 60000);
  it('run2 Explain excludes raw claims and enrichment', async () => {
    const w = await capture('Run-explanation', 'run2');
    for (const c of w.calls) {
      const keys = keysDeep(c.payloads);
      for (const key of ['decision_brief', 'headline_banded', 'analysis_summary', 'dominant_factor', 'win_probabilities', 'p_win_sensitivity', 'enrichment', 'robustness_caveat', 'conditional_winners']) expect.soft(keys, key).not.toContain(key);
      for (const text of ['100-point advantage', 'clearly ahead', 'held up']) expect.soft(JSON.stringify(c.payloads)).not.toContain(text);
    }
  }, 60000);
  it('run2 Explain retains the exact licensed chance, driver and reference', async () => {
    const w = await capture('Run-explanation', 'run2');
    for (const c of w.calls) {
      expect(valueAt(c.payloads, 'goal_chance_display').map(v => object(v)[expected.option_id])).toContain(expected.chance_display);
      expect(valueAt(c.payloads, 'goal_chance_driver_display').map(v => object(v)[expected.option_id])).toContain(expected.driver_sentence);
      const refs = valueAt(c.payloads, 'selected_run_reference');
      expect(refs.length).toBeGreaterThan(0);
      expect(refs).toEqual(refs.map(() => w.seed.captured_run_reference));
    }
  }, 60000);
  it('stale Explain makes zero provider calls', async () => {
    const w = await capture('Run-explanation', 'stale');
    expect(w.calls).toHaveLength(0);
    expect(object(w.response.narration).status).toBe('stale');
  }, 60000);
});

// Reload is local to this file: the default harness/storage and parity fixture stay unchanged.
const absentKeys = ['decision_brief', 'headline_banded', 'analysis_summary', 'dominant_factor',
  'win_probabilities', 'p_win_sensitivity', 'enrichment', 'robustness_caveat', 'conditional_winners'];
const absentStrings = ['100-point advantage', 'clearly ahead', 'held up'];
const reloadMemo = new Map<Turn, Promise<Witness>>();
function reload(turn: Turn): Promise<Witness> {
  let pending = reloadMemo.get(turn);
  if (pending) return pending;
  const seed = seedOf('run2');
  const result = seed.snapshot.analysis_result;
  const fact = RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: { scenario_id: seed.scenario_id, run_id: seed.captured_execution_run_id,
      graph_hash_at_run: seed.revision, computed_at: seed.computed_at,
      leading_option_id: result.leading_option_id, summary: result.summary,
      win_probabilities: result.win_probabilities, enrichment: result.enrichment,
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'not_applicable' } } });
  expect(fact.result.enrichment).toEqual(result.enrichment); // Verbatim captured enrichment, including unsafe prose.
  const rowId = '22222222-2222-4222-8222-222222222222';
  const identified = { fact, fact_row_id: '33333333-3333-4333-8333-333333333333', fact_created_at: seed.computed_at };
  const read = <T>(value: T) => vi.fn(async () => structuredClone(value));
  const storage = {
    readRecent: read([{ id: rowId, scenario_id: seed.scenario_id, turn_id: rowId, turn_class: 'handler',
      handler_id: 'run_analysis', request_hash: `sha256:${'a'.repeat(64)}`, created_at: seed.computed_at,
      user_message: null, assistant_message: null }]),
    readFactsFor: read([fact]),
    readFactsWithTurnFor: read([{ ...identified, turn_id: rowId }]),
    readScenarioRunAnalysisFactsFor: read({ facts: [identified], total_count: 1 }),
  };
  pending = capture(turn, 'run2', { storage, readSnapshot: async snapshot => {
    // Exercise the real saved-fact selector/read assembler, instead of returning the captured analysis packet.
    const { readScenarioAnalysis } = await import('../../scenario-graph-analysis-read.js');
    const { runExplanationChip } = await import('../../../orchestrator-v5/agent-lane/run-explanation.js');
    const saved = await readScenarioAnalysis({ scenarioId: seed.scenario_id, graph: snapshot.graph,
      requestId: 's8-reload', analysisInvalidatedAt: null });
    expect(runExplanationChip(seed.scenario_id, { graphHash: seed.revision,
      analysisState: saved.analysis_state, analysisResult: saved.analysis_result })?.id).toBe(seed.captured_run_reference);
    return { ...snapshot, ...saved };
  } }).then(w => {
    expect(storage.readScenarioRunAnalysisFactsFor).toHaveBeenCalled();
    expect(storage.readFactsWithTurnFor).toHaveBeenCalledWith([rowId]);
    if (captureDir !== undefined) {
      const dir = `${captureDir}/provider/${turn}/reload`;
      mkdirSync(dir, { recursive: true });
      w.calls.forEach((c, i) => writeFileSync(`${dir}/${i + 1}.sentBody.json`, c.sentBody));
    }
    return w;
  });
  reloadMemo.set(turn, pending);
  return pending;
}

describe('saved Run reload: serialized provider contract', () => {
  for (const turn of ['Run-explanation', 'ordinary-converse'] as const) {
    it(`${turn}: reload excludes raw keys and prose`, async () => {
      const w = await reload(turn);
      for (const c of w.calls) {
        for (const key of absentKeys) expect.soft(keysDeep(c.payloads), key).not.toContain(key);
        for (const text of absentStrings) expect.soft(c.sentBody).not.toContain(text);
      }
    }, 60000);
    it(`${turn}: reload retains exact licensed chance and driver`, async () => {
      const w = await reload(turn);
      for (const c of w.calls) {
        expect(valueAt(c.payloads, 'goal_chance_display').map(v => object(v)[expected.option_id])).toContain(expected.chance_display);
        expect(valueAt(c.payloads, 'goal_chance_driver_display').map(v => object(v)[expected.option_id])).toContain(expected.driver_sentence);
        const refs = valueAt(c.payloads, 'selected_run_reference');
        expect(refs.length).toBeGreaterThan(0);
        expect(refs).toEqual(refs.map(() => w.seed.captured_run_reference));
      }
    }, 60000);
  }
  it('durable reseed carries only user/assistant text, never other columns containing an analysis block', async () => {
    const row = { id: '44444444-4444-4444-8444-444444444444', request_hash: `agent_turn:${'b'.repeat(64)}`,
      user_message: 'RELOAD_USER_TEXT', assistant_message: 'RELOAD_ASSISTANT_TEXT',
      blocks: [seedOf('run2').snapshot.analysis_result],
      analysis_result: { type: 'analysis_result', summary: 'DURABLE_ANALYSIS_ONLY_SENTINEL' },
      enrichment: seedOf('run2').snapshot.analysis_result.enrichment };
    const { historyFromDurableTurns } = await import('../../../orchestrator-v5/agent-lane/history-store.js');
    expect(historyFromDurableTurns([row])).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: row.user_message }] },
      { role: 'assistant', content: row.assistant_message },
    ]);
    const w = await capture('ordinary-converse', 'run2', { storage: {
      readRecent: vi.fn(async () => structuredClone([row])),
    } });
    for (const c of w.calls) {
      if (captureDir !== undefined) writeFileSync(`${captureDir}/durable-text.sentBody.json`, c.sentBody);
      expect(c.sentBody).toContain(row.user_message);
      expect(c.sentBody).toContain(row.assistant_message);
      expect(c.sentBody).not.toContain('DURABLE_ANALYSIS_ONLY_SENTINEL');
      for (const key of [...absentKeys, 'analysis_result', 'blocks']) expect.soft(keysDeep(c.payloads), key).not.toContain(key);
      for (const text of absentStrings) expect.soft(c.sentBody).not.toContain(text);
      const assistant = (c.body.input as { role?: string; content?: unknown }[]).filter(i => i.role === 'assistant');
      expect(assistant).toEqual([{ role: 'assistant', content: row.assistant_message }]);
    }
  }, 60000);
});
