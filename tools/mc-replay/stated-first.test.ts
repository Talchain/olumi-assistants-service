import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildModelFromRecords } from '../../src/orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { replayRecordSet } from '../../src/cee/draft/records/replay.js';
import { buildSentenceInventory } from '../../src/cee/draft/records/sentence-pass.js';
import { SYN, synMain, synPass } from '../../src/cee/draft/records/__tests__/fixtures/sentence-pass-syn.js';
import type { CallStructuredModel } from '../../src/orchestrator-v5/agent-lane/runtime/build-model.js';
import { parseCeilingPass, statedFirstCalls, statedFirstRecords, type CeilingRecord } from './stated-first.js';

const scenario = '22222222-2222-4222-8222-222222222222';
const call = (data: unknown, delayed = false): CallStructuredModel => async () => {
  if (delayed) await new Promise(resolve => setTimeout(resolve, 5));
  return { text: typeof data === 'string' ? data : JSON.stringify(data), status: 'completed' };
};
function harness() {
  const registered: unknown[] = [];
  return { registered, dispatch: async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered.push(body); return { status: 200, json: { model_version: 1 } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [], edges: [] } } };
    throw new Error(`unexpected local dispatch ${path}`);
  } };
}
const brief = 'We have 50 subscribers. Reach at least 2,000 subscribers. We could launch at £49 a month or keep the current plans. The launch would win 150 new subscribers, between 80 and 250.';
function typed(): CeilingRecord[] {
  const inv = buildSentenceInventory(brief);
  const f = (literal: string) => inv.figures.find(x => x.literal === literal)!.id;
  return [
    { sentence: 1, role: 'figure', figure: f('50'), quantity_of: f('50'), value: 50, value_literal: '50', unit: 'subscribers', unit_literals: ['subscribers'] },
    { sentence: 2, role: 'goal', figure: f('2,000'), quantity_of: f('2,000'), value: 2000, value_literal: '2,000', unit: 'subscribers', unit_literals: ['subscribers'], direction: 'floor', direction_literal: 'at least' },
    { sentence: 3, role: 'option_setting', source_literal: 'launch at £49 a month', figure: f('£49'), quantity_of: f('£49'), value: 49, value_literal: '£49', unit: '£/month', unit_literals: ['£49', 'a month'], setting: 'sets_to' },
    { sentence: 3, role: 'option', source_literal: 'keep the current plans', is_baseline: true },
    { sentence: 4, role: 'option_effect', unit: 'subscribers', unit_literals: ['subscribers'], option_effect: {
      option_sentence: 3, option_literal: 'launch at £49 a month', quantity_figure: f('50'), value: 150, value_literal: '150', setting: 'change_by',
      range: { low: 80, high: 250, low_literal: '80', high_literal: '250', meaning: 'min_max' } } },
  ];
}

describe('CEILING (self-authored) stated-first harness rows', () => {
  it('(a) mode off returns today’s exact transport objects and byte-identical build/registration', async () => {
    const main = call(synMain(), true), pass = call({ records: synPass() });
    const wrapped = statedFirstCalls(false, SYN, main, pass);
    expect(wrapped.main).toBe(main); expect(wrapped.sentencePass).toBe(pass);
    const a = harness(), b = harness();
    const before = await buildModelFromRecords(scenario, SYN, a.dispatch as never, main, undefined, undefined, pass);
    const after = await buildModelFromRecords(scenario, SYN, b.dispatch as never, wrapped.main, undefined, undefined, wrapped.sentencePass);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(JSON.stringify(b.registered)).toBe(JSON.stringify(a.registered));
  });
  it('(b) drops all main stated items, preserves claims byte-for-byte, and has no main-shape dependence', async () => {
    const claims = [{ claim_kind: 'factor' as const, label: 'Unsupported sentinel', quantity: 0, value: 987654321, basis: [0] }];
    const old = { stated_items: [{ kind: 'figure' as const, source_quote: 'MAIN ONLY SENTINEL' }], claims };
    const a = statedFirstRecords(brief, old, typed());
    const b = statedFirstRecords(brief, { stated_items: [], claims }, typed());
    expect(JSON.stringify(a.claims)).toBe(JSON.stringify(claims));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.stated_items)).not.toContain('MAIN ONLY SENTINEL');
    const c = statedFirstCalls(true, brief, call(old, true), call({ records: typed() }));
    await c.sentencePass({} as never);
    const out = await c.main({} as never);
    expect(JSON.parse(out.text)).toEqual(a);
    expect(c.receipt()).toMatchObject({ main_stated_dropped: 1, claims_kept: 1, claims_byte_identical: true });
  });
  it('(c) retained unsupported claims cannot turn a sentinel into stated authority', async () => {
    const claims = [{ claim_kind: 'factor' as const, label: 'Unsupported sentinel', quantity: 0, value: 987654321, basis: [0] }];
    const records = statedFirstRecords(brief, { stated_items: [], claims }, typed());
    const plain = statedFirstRecords(brief, { stated_items: [], claims: [] }, typed());
    expect(JSON.stringify(records.stated_items)).toBe(JSON.stringify(plain.stated_items));
    const compiled = await replayRecordSet(records, { brief });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.detail);
    expect(JSON.stringify(compiled.projection.stated_dispositions)).not.toContain('987654321');
    expect(compiled.records.claims[0]).toMatchObject({ value: 987654321, quantity: 0, basis: [0] });
    for (const node of compiled.projection.graph.nodes) {
      for (const detail of Object.values(node.data?.intervention_details ?? {}) as Record<string, unknown>[]) {
        if (detail.source === 'brief_extraction') expect(JSON.stringify(detail)).not.toContain('987654321');
      }
    }
    for (const node of compiled.projection.graph.nodes) if (JSON.stringify(node).includes('987654321')) {
      expect(node.provenance?.provenance_class).not.toBe('user_stated');
      expect(node.observed_state?.source).not.toBe('brief_extraction');
    }
  });
  it('the existing quote validator refuses a pass literal/value contradiction', async () => {
    const pass = typed(); pass[4]!.option_effect!.value = 151;
    const c = await replayRecordSet(statedFirstRecords(brief, { stated_items: [], claims: [] }, pass), { brief });
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error(c.detail);
    expect(c.projection.stated_dispositions).toContainEqual(expect.objectContaining({ stated_index: 4, disposition: 'rejected' }));
    expect(c.projection.graph.nodes.filter(n => n.kind === 'option').every(n => !Object.values(n.data?.raw_interventions ?? {}).includes(201))).toBe(true);
  });
  it('an absent pass leaves mode-on main bytes unchanged', async () => {
    const old = synMain(), main = call(old), c = statedFirstCalls(true, SYN, main, call(''));
    await c.sentencePass({} as never);
    expect(await c.main({} as never)).toEqual(await main({} as never));
    expect(c.receipt()).toBeUndefined();
  });
  it('a present empty pass drops the main stated set rather than filling it', () => {
    expect(statedFirstRecords(brief, synMain(), []).stated_items).toEqual([]);
  });
  it('the existing strict pass null convention remains supported', () => {
    const record = typed()[0]!;
    expect(parseCeilingPass(JSON.stringify({ records: [{ ...record, relationship: null, option_effect: null, source_literal: null, range: null }] })))
      .toEqual([record]);
  });
  it('figureless typed references use only exact pass declarations and preserve unsupported endpoints', async () => {
    const pass = parseCeilingPass(JSON.stringify({ records: [
      { sentence: 4, role: 'context', figure: 'unresolved', kind: 'change_quantity', source_literal: 'new subscribers', quantity_label: 'new subscribers', unit: 'subscribers', unit_literals: ['subscribers'] },
      { sentence: 4, role: 'cause', relationship: { from_figure: { sentence: 4, literal: 'new subscribers' }, to_figure: 'unresolved', amount: 150, amount_literal: '150' } },
    ] }));
    const records = statedFirstRecords(brief, { stated_items: [], claims: [] }, pass);
    expect(records.stated_items[1]!.relationship).toBe('unresolved');
    expect(records.stated_items[0]).toMatchObject({ kind: 'change_quantity', quantity: 0 });
    const compiled = await replayRecordSet(records, { brief });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.detail);
    expect(compiled.projection.dropped).toContainEqual(expect.objectContaining({ stated_index: 1, reason: 'link_unresolved', unresolved_field: 'relationship' }));
  });
  it('(d) CEILING (self-authored) sealed row replays pass-only authority; stated-first-off mutant is RED', () => {
    const root = '/private/tmp/mc-codex-stated-first';
    const file = join(tmpdir(), 'mc-stated-first-ceiling-row.json');
    const source = '/Users/paulslee/Documents/GitHub/output/olumi-aie-eval-executor-20261003/drafting-extraction-20261004';
    execFileSync(process.execPath, ['--import', './node_modules/tsx/dist/loader.mjs', 'tools/mc-replay/replay-records.ts', '--mode', 'replay',
      '--brief', `${source}/live-draws-20261004/sealed.txt`, '--bank', `${source}/vnext-5x3-unresolved-20261005/bank`, '--draw', '1', '--out', file],
    { cwd: process.cwd(), env: { ...process.env, MC_STATED_FIRST: '1', MC_PASS_FIXTURE: `${root}/ceiling/sealed.json`,
      VITE_SUPABASE_URL: 'http://localhost', VITE_SUPABASE_ANON_KEY: 'dummy' }, stdio: 'pipe', timeout: 60000 });
    const row = JSON.parse(readFileSync(file, 'utf8'));
    expect(row.harness.provider_calls).toBe(0);
    expect(row.build_result.ok).toBe(true);
    const oracle = spawnSync('python3', ['/Users/paulslee/Documents/GitHub/output/model-construction-20261004/oracle.py', file], { encoding: 'utf8' });
    const results = oracle.stdout.split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));
    expect(results[0]?.verdict).toBe('PASS');
    expect(oracle.status).toBe(0);
    expect(row.harness.ceiling_stated_first).toMatchObject({ mode: 'stated-first', claims_byte_identical: true });
  }, 60000);
});
