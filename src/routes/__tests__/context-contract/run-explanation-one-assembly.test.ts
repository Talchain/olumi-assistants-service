import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { capture, captureDir, findState, expected, keysDeep, object, valueAt, seedOf, type Turn, type Witness } from './provider-harness.js';

describe('Explain uses the canonical assembly (serialized provider bytes)', () => {
  it.each<Turn>(['Run-explanation', 'ordinary-converse', 'tool-continuation'])(
    'S4: %s receives the answer-first coaching direction once, with the record’s factual limits', async turn => {
      const w = await capture(turn, 'run2');
      for (const c of w.calls) {
        // The full serialized request actually sent: S1 (#3272) carries the Run instruction as its own input item.
        const sent = String(c.sentBody);
        expect(sent.split('Lead with the supported current finding or precise limitation')).toHaveLength(2);
        expect(sent).toContain('Do not make edit history the default headline.');
        expect(sent).not.toContain('If that record names a change or cannot establish what changed, lead once');
        expect(sent).toContain('Keep each endpoint’s Run, scope and qualifications');
        expect(sent).not.toContain('Lead with the current supported finding, then explain the recorded change');
        const record = object(findState(c.payloads).rerun_record);
        expect(record.code_line).toBeDefined();
        expect(record.use).toContain('Never say nothing changed when code_line names a change.');
        expect(record.use).toContain('Unless attribution_case is C1_attributable, never say which change caused the difference.');
      }
    }, 60000);

  it('S3: the selected Run evidence reaches the serialized interpreter body; absent history is not filled from the graph', async () => {
    const w = await capture('Run-explanation', 'run2', { readSnapshot: async snapshot => {
      const g = object(snapshot.graph), nodes = Array.isArray(g.nodes) ? g.nodes.map(object) : [];
      const goal = nodes.find(n => n.kind === 'goal')!;
      return { ...snapshot, analysis_run_evidence: { run_id: object(object(snapshot.canonical_analysis_view).run).run_id,
        input_snapshot: { snapshot_version: 1, sent_digest: 'a'.repeat(64), goal: { node_id: goal.id, target_raw: goal.goal_threshold_raw,
          unit: goal.goal_threshold_unit, frame: goal.goal_threshold_frame }, options: [], factors: [] },
        occurrence: { fact_row_id: 'S3-selected-row', evaluated_scenario_revision: expected.synthetic_run_revision } } };
    } });
    const q = object(object(findState(w.calls[0].payloads).run_facts).question);
    expect(q.run_id).toBe(w.seed.captured_execution_run_id);
    expect(q.evaluated_scenario_revision).toBe(expected.synthetic_run_revision);
    expect(q.fact_row_id).toBe('S3-selected-row');
    expect(q.asked).toBeNull();
    // C2: the same existing licence permits the displayed chance; this cannot recover missing historical inputs.
    expect(object(q.scope)).toMatchObject({ can_show_goal_chance: true, reasons: ['static_scope_not_declared_by_licence'] });
    expect(object(q.evidence).missing).toContain('historical_model_at_evaluated_revision');
    expect(w.calls[0].sentBody).toContain('S3-selected-row');
  }, 60000);


  it('run2 Explain minus its licensed section equals ordinary converse state', async () => {
    const ordinary = await capture('ordinary-converse', 'run2');
    const explain = await capture('Run-explanation', 'run2');
    const ordinaryState = findState(ordinary.calls[0].payloads);
    expect(Object.keys(ordinaryState).length, 'ordinary state decoded').toBeGreaterThan(0);
    for (const c of explain.calls) {
      const { run_explanation: section, ...base } = findState(c.payloads);
      expect(base).toEqual(ordinaryState);
      expect(Object.keys(object(section)).sort()).toEqual(['claim_permissions', 'leading_option_id', 'warning_codes']);
      expect(object(section).leading_option_id).toBe(explain.seed.snapshot.analysis_result.leading_option_id);
      expect(object(section).claim_permissions).toEqual(object(ordinaryState.analysis).claim_permissions);
      expect(c.body.instructions).toBeDefined();
    }
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
    // §(ad) S4: horizon removed from the current graph — this row's claim is not about time (the reload contract).
    // One current graph serves both the read and the turn's snapshot.
    const graph = structuredClone(snapshot.graph) as { nodes?: Array<Record<string, unknown>> };
    for (const node of graph.nodes ?? []) if (node.kind === 'goal') { delete node.goal_horizon_months; delete node.goal_deadline_as_stated; }
    const saved = await readScenarioAnalysis({ scenarioId: seed.scenario_id, graph,
      requestId: 's8-reload', analysisInvalidatedAt: null });
    expect(runExplanationChip(seed.scenario_id, { graphHash: seed.revision,
      analysisState: saved.analysis_state, analysisResult: saved.analysis_result })?.id).toBe(seed.captured_run_reference);
    return { ...snapshot, graph, ...saved };
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

const refusal = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js', async original => {
  const actual = await original<typeof import('../../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js')>();
  return { ...actual, createAgentCapabilities: (...args: Parameters<typeof actual.createAgentCapabilities>) => {
    const caps = actual.createAgentCapabilities(...args);
    const read = caps.getCanonicalState;
    caps.getCanonicalState = (ctx, options) => refusal.enabled && options?.section === 'run_explanation'
      ? Promise.resolve({ ok: false, mutated: false, refusal: 'not_found' }) : read(ctx, options);
    return caps;
  } };
});

describe('Explain scoped assembly safety', () => {
  it('refused canonical read makes zero provider calls, like an unmatched Explain', async () => {
    refusal.enabled = true;
    try {
      const w = await capture('Run-explanation', 'run2', { expectedProviderCalls: 0 });
      expect(w.calls).toHaveLength(0);
      expect(object(w.response.narration).status).toBe('stale');
    } finally { refusal.enabled = false; }
  },60000);
  it('measured comparison sensitivity preserves the exact factor and its own range provenance', async () => {
    const w = await capture('Run-explanation', 'run2', { readSnapshot: async snapshot => {
      const e = snapshot.analysis_result.enrichment;
      e.factor_evppi = [{ factor_id: 'monthly_pro_churn', evppi: 0.5, status: 'resolved', spread_source: 'template' }];
      e.factor_sensitivity = [{ factor_id: 'monthly_pro_churn', factor_label: 'Monthly Pro churn' }];
      return snapshot;
    } });
    for (const c of w.calls) {
      expect(object(object(findState(c.payloads).run_explanation).decision_sensitivity)).toEqual({
        status: 'measured', most_sensitive: { factor_id: 'monthly_pro_churn', label: 'Monthly Pro churn', range: 'olumi_assumed' },
        say: 'Within the range Olumi assumed for Monthly Pro churn, Monthly Pro churn could change how the options compare. Do you know Monthly Pro churn more precisely?',
      });
      expect(keysDeep(c.payloads)).not.toContain('factor_evppi');
    }
  },60000);
  it('Explain instruction bytes retain the canonical sha256', async () => {
    const w = await capture('Run-explanation','run2');
    expect(createHash('sha256').update(String(w.calls[0].body.instructions)).digest('hex'))
      // G (12 Oct, AIE #94 6133027121): the selected-Run scope line and its range/headline/ranking edits: 39,550 → 39,914 bytes
      // (+364, the selected-coach delta). Reversing exactly those edits on the SENT instructions reproduces fb8392d6….
      // PROMPT 28 (AIE one-pass packet 94ad9c8f…): the coach prompt's packet edits plus P16 (rerun) and P17 (Interpreter v0.2):
      // 39,914 → 36,786 bytes. Captured from the SENT body against staging's; only `instructions` differs, by those sentences.
      // #2994 AMEND (AIE Q2/Q3/C5, rulings 1ad7f7b2…): 36,786 → 36,964 bytes. Captured from the SENT body against the previous
      // head's (which reproduces 111192bc…); every changed leaf is exactly the five AIE constants, nothing else.
      // BYPASS1: the AIE's Q4 host entry only: 36,964 → 38,001 bytes (captured against staging's body; the tool-less Explain
      // carries no stated-figure rule).
      // T2A5 (#3002, AIE T2A5): the AIE's coach sentence only: 38,001 → 38,008 bytes. The previous head's (staging 14b1e544) SENT
      // instructions reproduce 22670bbd…; replacing exactly the AIE's three texts with staging's on the SENT body gives them.
      // USER VOCABULARY (Paul, 14 Oct; CLAUDE.md §3): the coach template's VOCABULARY section and three phrases only:
      // 38,008 → 38,583 bytes (+575). Captured from the SENT body against staging 687c0d50's; reversing exactly those edits
      // on the SENT body reproduces staging's body byte for byte.
      // OLUMI'S PURPOSE (DL 14 Oct; Paul via the DL): the purpose block first in the host's part (+1,721) and the template's
      // leader sentence (+201): 38,583 → 40,505 bytes. Captured from the SENT body against staging d529a94e's (which
      // reproduces 0755d398…); removing exactly the block and reversing that sentence gives staging's body byte for byte.
      // C0 (AIE packet AIE-GENERATION-COACHING-CANDIDATE-20261015-v1, ADOPTED 15 Oct 00:34Z): the whole Interpreter v0.2 block is the
      // packet's replacement: 40,544 → 40,783 bytes. Captured from the SENT body; replacing exactly the replacement with the old
      // block on it gives 48037ea4…, which is staging 75fc1a95's own SENT body (staging already reads 48037ea4 against the
      // stale 1f004bc6 pin above: that move is not C0's, and C0 adds only its own block on top of it).
      // S10 fix 1 + the AIE's EXACT links sentence (#94 6181933060, links' vocabulary per 6182232796): the host contract's links
      // clause only: 40,783 → 40,922 bytes (+139). Captured from the SENT body: staging's reproduces d6ce2c69… and 40,783 bytes, and with
      // exactly that clause swapped equals this head's byte for byte.
      // B1 buddy repair: standing safeguards prefix restored; consolidated RUN_FACTS_USE kept once.
      // AIE-04: the exact disclosure/comparison rules below, prefix safeguards retained.
      // B2: evaluated-question scope sentence only; SENT instructions reverse byte-for-byte to AIE-04.
      // S4: two competing finding-first copies removed; record-first ordering owned once by RUN_FACTS_USE.
      // AIE current-finding-first replacement; duplicate rerun-plan instruction retired, factual context retained.
      // AIE current-qualification clarification replaces the earlier B coaching addition in the same RUN_FACTS_USE.
      // S4 current-card ownership + stored dependency instruction: 47919 UTF-8 bytes from actual SENT.
      // All9 request hashes reverse to HEAD by replacing ONLY RUN_FACTS_USE (including nested JSON carriers).
      // This instruction hash and the run-facts full literal are the other2 pins; all11 need Claude challenge.
      // Current qualifications, tool constraints, numbers and negative assertions remain; generated quality is unverified.
      // AIE robustness sentence (AIE-RUN-ROBUSTNESS-SEMANTIC-INSTRUCTION-20261018-v1, sha256 2bb83b6d…) in RUN_FACTS_USE: the SENT
      // instructions minus exactly that sentence reproduce 851e5abd… byte for byte; nothing else in the body differs.
      // PROMPT-INT coach currentness (#3423, merged at 7d052e5d; fix-forward of its one NEW CI red): the coach template's TRUTH,
      // REASONING, AUTHORSHIP and CALCULATION BOUNDARY sentences only: 49,310 → 50,626 bytes. Captured from the SENT body; swapping
      // back exactly the template text reproduces 52520051… and 49,310 bytes.
      // REFUSAL WORDS (AIE bb91dcdd): the coach template's AGENCY sentence and host #9/#25/#42 only: 50,626 → 50,951 bytes,
      // re-derived from the SENT body; swapping back exactly that template and host text reproduces e68f11f7….
      .toBe('2ce31441b3d5728dc0eb56973b8920e430702d672b2ecd8fdb6770c301f83bb8');
  },60000);
});

describe('Explain on a contract-valid Run row with no option label', () => {
  it('a saved option row carrying only option_id still explains (no alias dereference throw)', async () => {
    const w = await capture('Run-explanation', 'run2', { readSnapshot: async snapshot => {
      const rows = (snapshot.analysis_result.enrichment as { option_comparison?: Record<string, unknown>[] }).option_comparison ?? [];
      expect(rows.length, 'fixture has option rows').toBeGreaterThan(0);
      for (const row of rows) { delete row.option_label; delete row.label; }
      return snapshot;
    } });
    expect(w.calls).toHaveLength(1);
    expect(object(w.response).assistant_text ?? object(w.response).narration).toBeDefined();
  }, 60000);
});
