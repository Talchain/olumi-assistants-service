/**
 * RULE (e) (Science GO, 5 Oct; Lead brief, verbatim conditions), through the REAL `buildModelFromRecords`. Records are
 * AUTHORED over the sealed brief already in this repo (no held-out text), in the shape the live 4×5 drafter emitted.
 *   (e1) an unquantified invented claim on an option→goal path the user's SIZED stated causes already join is set aside
 *        (`superseded_by_stated_path`, with `restore`); with the stated cause unsized the claim stays.
 *   (e2) an invented root factor with no level reaching the goal is removed, disclosed and asked about ("What is <label>
 *        today?"), at most 3 asks ordered by option→goal paths; a USER-stated unlevelled root keeps the gate-2 rule.
 */
import { describe, expect, it } from 'vitest';
import { BRIEF } from './sealed-fixture.js';
import { buildModelFromRecords } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { targetTestabilityOf } from '../../../../../orchestrator-v5/admission/target-testability.js';
import { assessCanonicalAnalysisReadiness } from '../../../../../orchestrator/tools/analysis-ready-helper.js';
import type { DraftRecordSet } from '../../grammar.js';

type Json = Record<string, any>;
const GOAL = 'reach at least £150,000 monthly recurring revenue within 9 months';
const LOSS = 'Each lost customer removes £300 a month of monthly recurring revenue.';
const CHURN = 'Each 1% price rise loses about 2 customers, between 1 and 4.';
const SUPPORT = 'Each starter subscriber costs about £6 a month in support.';
const SUBSCRIPTION = 'Each starter subscriber adds £49 a month to monthly recurring revenue.';
const GROSS = 'each 1% price rise adds £1,200 a month to monthly recurring revenue before churn';
const STARTER_WIN = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const INVENTED = 'Net MRR Change';

/** The user's stated path, typed: price option (its own quantity) → customers → MRR (declared by the baseline figure). */
function statedPath(): DraftRecordSet {
  return {
    stated_items: [
      /* 0 */ { kind: 'figure', source_quote: '£120,000 monthly recurring revenue', value: 120000, value_literal: '£120,000', unit_literals: ['£', 'monthly recurring revenue'], quantity: 0, unit: '£/month', role: 'baseline', value_scale: 'raw_count' },
      /* 1 */ { kind: 'goal', source_quote: GOAL, value: 150000, value_literal: '£150,000', unit_literals: ['£', 'monthly recurring revenue'], quantity: 0, baseline_ref: 0, horizon_months: 9, horizon_ref: 2, direction_literal: 'at least', unit: '£/month', role: 'target', value_scale: 'raw_count', direction: 'floor' },
      /* 2 */ { kind: 'figure', source_quote: 'within 9 months', value: 9, value_literal: '9', unit_literals: ['months'], quantity: 2, unit: 'months', role: 'context', value_scale: 'raw_count' },
      /* 3 */ { kind: 'figure', source_quote: '400 customers', value: 400, value_literal: '400', unit_literals: ['customers'], quantity: 3, unit: 'customers', role: 'baseline', value_scale: 'raw_count' },
      /* 4 */ { kind: 'option', source_quote: 'raise prices by 10%', quantity: 4, value: 0.1, value_literal: '10%', unit: '%', value_scale: 'unit_interval', is_baseline: false },
      /* 5 */ { kind: 'option', source_quote: 'launch a starter tier at £49 a month', is_baseline: false },
      /* 6 */ { kind: 'option', source_quote: 'keep pricing as it is', is_baseline: true },
      /* 7 */ { kind: 'cause', source_quote: CHURN, relationship: { from_quantity: 4, to_quantity: 3, amount: -2, amount_literal: '2 customers', per_source_change: 0.01, per_source_literal: '1%' } },
      /* 8 */ { kind: 'cause', source_quote: LOSS, relationship: { from_quantity: 3, to_quantity: 0, amount: -300, amount_literal: '£300', per_source_change: 1, per_source_literal: 'Each lost customer' } },
    ],
    claims: [],
  };
}
/** The drafter's collapsed invention on the SAME option → goal: an unquantified factor the option is linked through. */
const INVENTED_OUTCOME = 'MRR Target Progress';
function withInvention(records = statedPath()): DraftRecordSet {
  const at = records.claims.length;
  records.claims.push(
    { claim_kind: 'factor', label: INVENTED, basis: [7, 8] },
    { claim_kind: 'outcome', label: INVENTED_OUTCOME, basis: [1] },
    { claim_kind: 'causal_link', label: 'Price increase produces net MRR change', basis: [4, 7, 8], from_stated: 4, to_claim: at, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Net MRR change improves target progress', from_claim: at, to_claim: at + 1, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Target progress moves the goal', from_claim: at + 1, to_stated: 1, effect: 'positive' },
  );
  return records;
}

async function build(records: DraftRecordSet): Promise<{ result: Json; body: Json }> {
  let body: Json | undefined;
  const result: Json = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', BRIEF,
    async (path, b) => { if (path.endsWith('/register')) { body = b as Json; return { status: 200, json: { model_version: 1 } }; } return { status: 200, json: { graph: { nodes: [], edges: [] } } }; },
    async () => ({ text: JSON.stringify(records), status: 'completed' }));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { result, body: body! };
}
const labelled = (body: Json, label: string): Json | undefined => (body.graph.nodes as Json[]).find(n => n.label === label);
const aside = (result: Json, reason: string): Json[] => (result.not_represented as Json[]).filter(d => d.reason === reason);

describe('rule (e1): an unquantified invented claim on a path the user\'s SIZED stated causes join is set aside', () => {
  it('stated sized → the claim leaves the graph, is disclosed by name with what re-adds it, and the goal is testable', async () => {
    const { result, body } = await build(withInvention());
    expect(labelled(body, INVENTED)).toBeUndefined();
    expect(labelled(body, INVENTED_OUTCOME)).toBeUndefined();
    const rows = aside(result, 'superseded_by_stated_path');
    expect(rows.map(r => r.label).sort()).toEqual([INVENTED, INVENTED_OUTCOME].sort());
    const row = rows.find(r => r.label === INVENTED)!;
    expect(row).toMatchObject({ claim_kind: 'factor', restore: { node: { label: INVENTED } } });
    expect(row.restore.edges.length).toBeGreaterThanOrEqual(2);
    expect(row.restore.edges.every((e: Json) => e.from === row.node_id || e.to === row.node_id)).toBe(true);
    expect(JSON.stringify(body.graph)).not.toContain(INVENTED);
    expect(targetTestabilityOf(body.graph)).toMatchObject({ kind: 'testable' });
  });
  it('CONTRAST an invented claim WITH magnitude evidence on the same path (it carries the sized stated cause) stays', async () => {
    const records = withInvention();
    records.claims.push({ claim_kind: 'outcome', label: 'Monthly recurring revenue', quantity: 0 },
      { claim_kind: 'causal_link', label: 'Same revenue quantity', from_claim: records.claims.length, to_stated: 1, effect: 'positive' });
    const { result, body } = await build(records);
    const carrier = labelled(body, 'Monthly recurring revenue');
    expect(carrier).toBeDefined();
    expect((body.graph.edges as Json[]).some(e => e.to === carrier!.id && e.provenance?.natural_effect !== undefined)).toBe(true);
    expect(aside(result, 'superseded_by_stated_path').map(r => r.label)).not.toContain('Monthly recurring revenue');
    expect(labelled(body, INVENTED)).toBeUndefined();
  });
  it('CONTRAST stated unsized (the loss cause carries no amount) → the invented claim stays, nothing is set aside', async () => {
    const records = withInvention();
    delete records.stated_items[8]!.relationship!.amount;
    delete records.stated_items[8]!.relationship!.amount_literal;
    const { result, body } = await build(records);
    expect(aside(result, 'superseded_by_stated_path')).toEqual([]);
    // The invented OUTCOME (not a root factor) stays; the unlevelled invented ROOT factor is (e2)'s, not (e1)'s.
    expect(labelled(body, INVENTED_OUTCOME)).toBeDefined();
    expect(aside(result, 'invented_root_level_unknown').map(r => r.label)).toEqual([INVENTED]);
  });
});

/** Four invented, unlevelled roots, linked from 3, 2, 1 and 1 options, each reaching the goal; no stated path. */
function inventedRoots(): DraftRecordSet {
  const r = statedPath();
  r.stated_items[4] = { kind: 'option', source_quote: 'raise prices by 10%', is_baseline: false };
  r.stated_items.splice(7, 2);
  const roots = ['Pricing power', 'Market appetite', 'Brand pull', 'Sales capacity'];
  const fan: Record<string, number[]> = { 'Pricing power': [4, 5, 6], 'Market appetite': [4, 5], 'Brand pull': [5], 'Sales capacity': [6] };
  for (const label of roots) {
    const at = r.claims.length;
    r.claims.push({ claim_kind: 'factor', label });
    for (const option of fan[label]!) r.claims.push({ claim_kind: 'causal_link', label: `${option} moves ${label}`, from_stated: option, to_claim: at, effect: 'positive' });
    r.claims.push({ claim_kind: 'causal_link', label: `${label} moves the goal`, from_claim: at, to_stated: 1, effect: 'positive' });
  }
  return r;
}

describe('rule (e2): an invented root factor with no level that reaches the goal is removed, disclosed and asked', () => {
  it('removed with NO Olumi level, disclosed with restore, and asked "What is <label> today?"', async () => {
    const records = withInvention(statedPath());
    records.stated_items.splice(7, 2); // no stated path: (e1) cannot apply, the invented root stands alone
    const { result, body } = await build(records);
    expect(labelled(body, INVENTED)).toBeUndefined();
    expect(aside(result, 'invented_root_level_unknown')).toEqual([expect.objectContaining({ label: INVENTED, restore: expect.objectContaining({ node: expect.objectContaining({ label: INVENTED }) }) })]);
    expect(result.open_questions).toContain(`What is ${INVENTED} today?`);
    expect(JSON.stringify(body.graph)).not.toContain(INVENTED);
  });
  it('at most 3 asks, ordered by option→goal paths; the 4th root is in the disclosure only', async () => {
    const { result } = await build(inventedRoots());
    const asks = (result.open_questions as string[]).filter(q => q.startsWith('What is '));
    expect(asks).toEqual(['What is Pricing power today?', 'What is Market appetite today?', 'What is Brand pull today?']);
    expect(aside(result, 'invented_root_level_unknown').map(d => d.label).sort()).toEqual(['Brand pull', 'Market appetite', 'Pricing power', 'Sales capacity']);
  });
  it('CONTRAST a USER-stated unlevelled root stays on the graph under the gate-2 rule (MISSING_FACTOR_LEVEL asked there)', async () => {
    const records = statedPath();
    records.stated_items.splice(7, 2);
    records.stated_items.push({ kind: 'cause', source_quote: SUPPORT });
    records.claims.push({ claim_kind: 'causal_link', label: 'Support cost moves the goal', from_stated: 7, to_stated: 1, effect: 'negative' });
    const { result, body } = await build(records);
    const stated = (body.graph.nodes as Json[]).find(n => n.label === SUPPORT || n.provenance?.source_quote === SUPPORT);
    expect(stated).toBeDefined();
    expect(aside(result, 'invented_root_level_unknown')).toEqual([]);
    const gaps = assessCanonicalAnalysisReadiness(body.graph).blockingIssues.filter(i => i.code === 'MISSING_FACTOR_LEVEL');
    expect(gaps.map(i => i.factor_id)).toContain(stated!.id);
  });
});

/**
 * CR-E1 (MC review of d0bf0911): (e1)/(e2) removed nodes that CARRIED the user's own receipts on 3 of 20 live draws
 * (heldout1-d1 [0], heldout2-d4 [11], sealed-d5 [9] → carrier_removed). Science's (e2) is "ai_inferred roots with NO
 * user evidence". Each draw's SHAPE is distilled here onto the sealed brief's quotes only (no held-out text).
 */
function baseItems(): DraftRecordSet['stated_items'] {
  const r = statedPath();
  return [r.stated_items[0]!, { ...r.stated_items[1]! }, r.stated_items[2]!];
}
/** heldout1-d1 shape: a baseline figure is carried as an option's setting on an invented, unlevelled root. */
function figureOnInventedRoot(): DraftRecordSet {
  const items = baseItems();
  items.push(statedPath().stated_items[3]!, { kind: 'option', source_quote: 'keep pricing as it is', is_baseline: true },
    { kind: 'option', source_quote: 'launch a starter tier at £49 a month', is_baseline: false });
  return { stated_items: items, claims: [
    { claim_kind: 'factor', label: 'Customer base', basis: [3], quantity: 3 },
    { claim_kind: 'outcome', label: 'Monthly revenue achieved', basis: [0, 1], quantity: 0 },
    { claim_kind: 'causal_link', label: 'Keeping pricing holds the customer base', basis: [3, 4], from_stated: 4, to_claim: 0, effect: 'positive', sets_to: 400 },
    { claim_kind: 'causal_link', label: 'Customers deliver revenue', from_claim: 0, to_claim: 1, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Revenue achieved reaches the goal', from_claim: 1, to_stated: 1, effect: 'positive' },
  ] };
}
/** heldout2-d4 shape: a sized stated cause whose FROM endpoint is an invented root on a context figure's quantity. */
function causeFromContextQuantityRoot(): DraftRecordSet {
  const items = baseItems();
  items.push({ kind: 'option', source_quote: 'launch a starter tier at £49 a month', is_baseline: false },
    { kind: 'figure', source_quote: STARTER_WIN, value: 150, value_literal: '150', unit_literals: ['subscribers'], quantity: 4, unit: 'subscribers', role: 'context', value_scale: 'raw_count' },
    { kind: 'cause', source_quote: SUBSCRIPTION, relationship: { from_quantity: 4, to_quantity: 0, amount: 49, amount_literal: '£49', per_source_change: 1, per_source_literal: 'Each starter subscriber' } });
  return { stated_items: items, claims: [
    { claim_kind: 'factor', label: 'Starter subscribers', basis: [4], quantity: 4 },
    { claim_kind: 'outcome', label: 'Monthly recurring revenue', quantity: 0 },
    // The option's setting on the root is Olumi's own number (120, no stated figure), so it is NOT a stated receipt:
    // the root carries the user's evidence ONLY through the stated cause's edge.
    { claim_kind: 'causal_link', label: 'The starter tier wins subscribers', basis: [3], from_stated: 3, to_claim: 0, effect: 'positive', sets_to: 120 },
    { claim_kind: 'causal_link', label: 'Subscribers add revenue', basis: [5], from_claim: 0, to_claim: 1, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Same revenue quantity', from_claim: 1, to_stated: 1, effect: 'positive' },
  ] };
}
/** sealed-d5 shape: a sized stated cause whose FROM endpoint is an invented root on the price option's own quantity. */
function causeFromOptionQuantityRoot(): DraftRecordSet {
  const items = baseItems();
  items.push({ kind: 'option', source_quote: 'raise prices by 10%', quantity: 3, value: 0.1, value_literal: '10%', unit: '%', value_scale: 'unit_interval', is_baseline: false },
    { kind: 'option', source_quote: 'keep pricing as it is', is_baseline: true },
    { kind: 'cause', source_quote: GROSS, relationship: { from_quantity: 3, to_quantity: 0, amount: 1200, amount_literal: '£1,200', per_source_change: 0.01, per_source_literal: '1%' } });
  return { stated_items: items, claims: [
    { claim_kind: 'factor', label: 'Price Increase', basis: [3, 5], quantity: 3 },
    { claim_kind: 'outcome', label: 'Monthly recurring revenue', quantity: 0 },
    { claim_kind: 'causal_link', label: 'Raising prices sets the price increase', basis: [3], from_stated: 3, to_claim: 0, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Price increases raise revenue', basis: [5], from_claim: 0, to_claim: 1, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Same revenue quantity', from_claim: 1, to_stated: 1, effect: 'positive' },
  ] };
}
const CR_E1 = [
  { shape: 'heldout1-d1: a figure carried as an option setting on the root', records: figureOnInventedRoot, index: 3, root: 'Customer base' },
  { shape: 'heldout2-d4: a stated cause drawn from the root (context-figure quantity)', records: causeFromContextQuantityRoot, index: 5, root: 'Starter subscribers' },
  { shape: 'sealed-d5: a stated cause drawn from the root (option-declared quantity)', records: causeFromOptionQuantityRoot, index: 5, root: 'Price Increase' },
];

describe('CR-E1: a node carrying ANY stated receipt is user evidence; neither (e1) nor (e2) removes it', () => {
  for (const { shape, records, index, root } of CR_E1) {
    it(`${shape}: the stated item stays carried and its carrier stays on the graph`, async () => {
      const { result, body } = await build(records());
      const row = (body.stated_dispositions as Json[]).find(d => d.stated_index === index)!;
      expect(row, JSON.stringify(row)).toMatchObject({ disposition: 'carried', location: { kind: shape.startsWith('heldout1') ? 'node' : 'edge' } });
      expect(labelled(body, root)).toBeDefined();
      expect([...aside(result, 'invented_root_level_unknown'), ...aside(result, 'superseded_by_stated_path')].map(d => d.label)).not.toContain(root);
    });
  }
  it('CONTRAST an unlevelled invented root carrying NO stated receipt is still removed (and asked)', async () => {
    const records = withInvention(statedPath());
    records.stated_items.splice(7, 2);
    const { result, body } = await build(records);
    expect(labelled(body, INVENTED)).toBeUndefined();
    expect(aside(result, 'invented_root_level_unknown').map(d => d.label)).toEqual([INVENTED]);
  });
});

/** Every node id `from` reaches along the registered graph's edges (options and the decision are never walked through). */
function reaches(body: Json, from: string, to: string): boolean {
  const kind = new Map((body.graph.nodes as Json[]).map(n => [n.id, n.kind]));
  const seen = new Set([from]); const stack = [from];
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (const e of body.graph.edges as Json[]) {
      if (e.from !== at || seen.has(e.to) || kind.get(e.to) === 'option' || kind.get(e.to) === 'decision') continue;
      if (e.to === to) return true;
      seen.add(e.to); stack.push(e.to);
    }
  }
  return false;
}

describe('Science merge condition (item 3): an option WITH a stated path keeps it after (e), by OPTION ID', () => {
  // Ids are the projector's content hashes for these quotes/quantities (`raise prices by 10%` → 4b7b0125; its lever
  // 67a2010a; "400 customers" 8cad8149; the goal-quantity outcome 8a21277c; the goal 876e0d81).
  const OPTION = '4b7b0125', GOAL_ID = '876e0d81';
  const STATED_PATH = [['4b7b0125', '67a2010a'], ['67a2010a', '8cad8149'], ['8cad8149', '8a21277c'], ['8a21277c', '876e0d81']] as const;
  it('the invented claim on its path is set aside; option 4b7b0125 still reaches the goal along its own sized stated path', async () => {
    const { result, body } = await build(withInvention());
    expect(aside(result, 'superseded_by_stated_path').map(d => d.label)).toContain(INVENTED);
    for (const [from, to] of STATED_PATH) {
      const edge = (body.graph.edges as Json[]).find(e => e.from === from && e.to === to);
      expect(edge, `${from}→${to}`).toBeDefined();
      if (from !== OPTION) expect(edge!.provenance?.natural_effect, `${from}→${to}`).toBeDefined();
    }
    expect(reaches(body, OPTION, GOAL_ID)).toBe(true);
  });
  it('CONTRAST (the 28 class): with no stated path, removing the invented root leaves option 4b7b0125 with no path (gate 1 v2 says so)', async () => {
    const records = withInvention(statedPath());
    records.stated_items.splice(7, 2);
    const { result, body } = await build(records);
    expect(aside(result, 'invented_root_level_unknown').map(d => d.label)).toEqual([INVENTED]);
    expect((body.graph.nodes as Json[]).some(n => n.id === OPTION)).toBe(true);
    expect(reaches(body, OPTION, GOAL_ID)).toBe(false);
  });
});
