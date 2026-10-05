/**
 * Codex R1 F1 (PR #2573 @ 5d35e906; DL ruling: FREEZE). The Anthropic route's grammar is unchanged from staging, so its
 * records compile must stay the one that grammar was built for. Replaying the ORIGINAL served natural-effects fixture
 * (`stated-natural-effects.test.ts` at staging 890923c9, before v-next enriched it with fields Anthropic cannot emit)
 * through the REAL `draftGraphWithAnthropic`, SDK mocked, must keep what staging kept: six sized natural effects, the
 * £120,000 goal baseline and the 80–250 subscriber range. Pointing anthropic.ts back at the live (v-next) records
 * modules turns this row RED: six effects → zero, and the baseline and range are lost.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveNotModelledManifest } from '../../../cee/context-integrity/not-modelled-manifest.js';
import { deriveNotModelledManifest as stagingManifest } from '../../../cee/draft/records-v25/not-modelled-manifest.js';
import { statedEffectFiguresMatch } from '../../../cee/provenance/stated-effect.js';
import { statedEffectQuoteMatches as stagingFiguresMatch } from '../../../cee/draft/records-v25/stated-effect.js';

const h = vi.hoisted(() => ({ payload: { text: '' }, bodies: [] as unknown[] }));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (body: Record<string, unknown>) => {
        h.bodies.push(body);
        const payload = h.payload.text;
        return {
          async *[Symbol.asyncIterator]() { yield { type: 'content_block_delta', delta: { type: 'text_delta', text: payload } }; },
          async finalMessage() { return { content: [{ type: 'text', text: payload }], usage: { input_tokens: 100, output_tokens: 50 }, stop_reason: 'end_turn' }; },
        };
      },
    };
  }
  return { default: MockAnthropic };
});

// Byte-for-byte the brief and record set of `stated-natural-effects.test.ts` at staging 890923c9 (the served form).
const BRIEF =
  "We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. " +
  "Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. " +
  "Goal: reach at least £150,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month " +
  "to monthly recurring revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each lost customer " +
  "removes £300 a month of monthly recurring revenue. The starter tier would win about 150 new subscribers, between 80 and 250. " +
  "Each starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in support. " +
  "Keeping pricing as it is adds nothing.";
const SERVED_RECORDS = {
  stated_items: [
    { kind: "goal", source_quote: "Goal: reach at least £150,000 monthly recurring revenue within 9 months.", value: 150000, baseline: 120000, unit: "£/month", role: "target" },
    { kind: "option", source_quote: "raise prices by 10%" },
    { kind: "option", source_quote: "launch a starter tier at £49 a month" },
    { kind: "option", source_quote: "keep pricing as it is" },
    { kind: "figure", source_quote: "The starter tier would win about 150 new subscribers, between 80 and 250.", value: 150, unit: "subscribers", role: "baseline" },
    { kind: "figure", source_quote: "Each 1% price rise loses about 2 customers, between 1 and 4.", value: 2, baseline: 2, unit: "customers", role: "baseline" },
    { kind: "cause", source_quote: "each 1% price rise adds £1,200 a month to monthly recurring revenue before churn." },
    { kind: "cause", source_quote: "Each 1% price rise loses about 2 customers, between 1 and 4." },
    { kind: "cause", source_quote: "Each lost customer removes £300 a month of monthly recurring revenue." },
    { kind: "cause", source_quote: "Each starter subscriber adds £49 a month to monthly recurring revenue." },
    { kind: "cause", source_quote: "Each starter subscriber costs about £6 a month in support." },
  ],
  claims: [
    { claim_kind: "factor", label: "Price rise", value: 0.1, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "factor", label: "Starter tier subscribers", value: 150, unit: "subscribers", value_scale: "raw_count" },
    { claim_kind: "outcome", label: "Monthly recurring revenue", value: 120000, unit: "£/month" },
    { claim_kind: "outcome", label: "Monthly support cost", value: 0, unit: "£/month" },
    { claim_kind: "causal_link", label: "price rise → MRR", from_claim: 0, to_claim: 2, effect: "positive", effect_detail: { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" }, basis: [6] },
    { claim_kind: "causal_link", label: "subscribers → MRR", from_claim: 1, to_claim: 2, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscribers" }, basis: [9] },
    { claim_kind: "causal_link", label: "price rise → goal", from_claim: 0, to_stated: 0, effect: "positive", effect_detail: { amount: 1200, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "%" }, basis: [6] },
    { claim_kind: "causal_link", label: "subscribers → goal", from_claim: 1, to_stated: 0, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [9] },
    { claim_kind: "causal_link", label: "stated subscribers → goal", from_stated: 4, to_stated: 0, effect: "positive", effect_detail: { amount: 49, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [4, 9] },
    { claim_kind: "causal_link", label: "raise → price", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 0.1, basis: [0] },
    { claim_kind: "causal_link", label: "starter → subscribers", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 150, basis: [4] },
    { claim_kind: "causal_link", label: "keep → subscribers", from_stated: 3, to_claim: 1, effect: "positive", sets_to: 0, basis: [3] },
    { claim_kind: "causal_link", label: "lost customers → MRR", from_claim: 14, to_claim: 2, effect: "negative", effect_detail: { amount: -300, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "customer" }, basis: [8] },
    { claim_kind: "causal_link", label: "subscribers → support", from_claim: 1, to_claim: 3, effect: "negative", effect_detail: { amount: -6, amount_unit: "£/month", per_source_change: 1, per_source_change_unit: "subscriber" }, basis: [10] },
    { claim_kind: "factor", label: "Customers lost to price rise", value: 2, unit: "customers", value_scale: "raw_count" },
    { claim_kind: "causal_link", label: "price rise → lost customers", from_claim: 0, to_claim: 14, effect: "negative", effect_detail: { amount: -2, amount_unit: "customers", per_source_change: 1, per_source_change_unit: "%" }, basis: [7] },
    { claim_kind: "causal_link", label: "MRR → goal", from_claim: 2, to_stated: 0, effect: "positive" },
  ],
};

type AnyNode = Record<string, any>;
let draftGraphWithAnthropic: typeof import('../anthropic.js').draftGraphWithAnthropic;
const prior: Record<string, string | undefined> = {};
beforeAll(async () => {
  for (const k of ['ANTHROPIC_API_KEY', 'CEE_ANTHROPIC_STRUCTURED_OUTPUTS']) prior[k] = process.env[k];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-records-v25';
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import('../anthropic.js'));
});
afterAll(async () => {
  for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

describe('F1 the Anthropic route compiles the served fixture as staging did (records-v25 freeze)', () => {
  it('six sized natural effects, the £120,000 goal baseline and the 80–250 range survive the real adapter', async () => {
    h.payload.text = JSON.stringify(SERVED_RECORDS);
    const result = await draftGraphWithAnthropic({ brief: BRIEF, docs: [], seed: 1, model: 'claude-sonnet-4-6' }, { timeoutMs: 120_000, forceDefault: true });
    expect(h.bodies.length, 'the mock never ran').toBeGreaterThanOrEqual(1);
    const graph = (result as { graph: { nodes: AnyNode[]; edges: AnyNode[] } }).graph;
    const natural = graph.edges.map(e => e.provenance?.natural_effect).filter((x): x is AnyNode => x !== undefined);
    // The adapter's later passes reorder edges, so the six are compared as a multiset.
    const key = (x: unknown[]) => JSON.stringify(x);
    expect.soft(natural.map(e => [e.amount, e.amount_unit, e.per_source_change, e.per_source_change_unit]).map(key).sort()).toEqual([
      [1200, '£/month', 1, '%'], [49, '£/month', 1, 'subscribers'], [49, '£/month', 1, 'subscribers'],
      [-300, '£/month', 1, 'customers'], [-6, '£/month', 1, 'subscribers'], [-2, 'customers', 1, '%'],
    ].map(key).sort());
    const goal = graph.nodes.find(n => n.kind === 'goal');
    expect.soft(goal?.goal_baseline_raw).toBe(120000);
    const starter = graph.nodes.find(n => String(n.label).includes('starter tier would win'));
    expect.soft(starter?.observed_state).toMatchObject({ value: 0.75, raw_value: 150, baseline: 150, range: { min: 80, max: 250 } });
  });
});

describe('Codex R2 F3: the LIVE cold reader reads the frozen compile\'s natural effects as staging\'s reader did', () => {
  it('R3-3 replaying the served fixture, £1,200 and £49 are in_model under the live manifest, exactly as under staging\'s', async () => {
    h.payload.text = JSON.stringify(SERVED_RECORDS);
    const result = await draftGraphWithAnthropic({ brief: BRIEF, docs: [], seed: 1, model: 'claude-sonnet-4-6' }, { timeoutMs: 120_000, forceDefault: true });
    const graph = (result as { graph: { nodes: AnyNode[]; edges: AnyNode[] } }).graph;
    // Positive control: these carriers are the frozen compile's, with no records-only stated_relationship.
    const carriers = graph.edges.filter(e => e.provenance?.natural_effect !== undefined);
    expect(carriers.length).toBeGreaterThan(0);
    expect(carriers.every(e => e.provenance.stated_relationship === undefined)).toBe(true);
    // The live figure check these carriers now take agrees with staging's on every served carrier.
    for (const e of carriers) {
      const n = e.provenance.natural_effect;
      const d = { amount: n.amount, amount_unit: n.amount_unit, per_source_change: n.per_source_change, per_source_change_unit: n.per_source_change_unit };
      expect(statedEffectFiguresMatch(e.provenance.quote, d), e.provenance.quote).toBe(stagingFiguresMatch(e.provenance.quote, d));
    }
    const verdict = (m: ReturnType<typeof deriveNotModelledManifest>, literal: string) => m.quantities?.items.find(i => i.literal === literal)?.verdict;
    const live = deriveNotModelledManifest(BRIEF, graph), staging = stagingManifest(BRIEF, graph);
    for (const literal of ['£1,200', '£49']) {
      expect(verdict(staging, literal), `staging ${literal}`).toBe('in_model');
      expect(verdict(live, literal), `live ${literal}`).toBe('in_model');
    }
  });
});
