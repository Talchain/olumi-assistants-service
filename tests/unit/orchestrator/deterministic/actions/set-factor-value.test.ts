/**
 * Unit tests for set_factor_value currency handling (P0.2).
 *
 * Two paths must honour the user's stated currency:
 *   1. LLM passes `unit` in tool params (e.g. "$", "USD") → use it.
 *   2. LLM omits `unit` but the user message contains a currency symbol
 *      (e.g. "$100,000") → recover from ctx.user_currency_hint.
 *
 * In both paths, if the user currency differs from the graph node's stored
 * currency, we honour the user and log `v4.set_factor_value_currency_mismatch`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { setFactorValueAction } from "../../../../../src/orchestrator/deterministic/actions/set-factor-value.js";
import { log } from "../../../../../src/utils/telemetry.js";
import type { DeterministicTurnContext } from "../../../../../src/orchestrator/deterministic/types.js";

const warnSpy = vi.mocked(log.warn);

beforeEach(() => {
  warnSpy.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────

function makeContext(overrides: {
  nodeUnit?: string | undefined;
  userCurrencyHint?: string | null;
} = {}): DeterministicTurnContext {
  return {
    stage: 'ideate',
    entities: {
      nodes: new Map([
        ['fac_ad_spend', {
          id: 'fac_ad_spend',
          label: 'Advertising Spend',
          kind: 'factor',
          aliases: [],
          is_action_target: false,
          unit: overrides.nodeUnit,
        }],
      ]),
      edges: [],
      option_ids: [],
      goal_id: null,
    } as unknown as DeterministicTurnContext['entities'],
    graph_summary: { node_count: 1, edge_count: 0, option_count: 0, goal_label: null, option_labels: [], missing_structural: [] } as unknown as DeterministicTurnContext['graph_summary'],
    analysis_summary: null,
    capabilities: {} as DeterministicTurnContext['capabilities'],
    blockers: [],
    signals: { close_call: false, dominant_factor: null, default_value_count: 0, weak_edges: [], high_uncertainty_factors: [] } as unknown as DeterministicTurnContext['signals'],
    conversation: { turn_count: 1, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null } as unknown as DeterministicTurnContext['conversation'],
    eligible_actions: [],
    disambiguation_hints: [],
    graph: { nodes: [], edges: [] } as unknown as DeterministicTurnContext['graph'],
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'test',
    analysis_inputs: null,
    user_currency_hint: overrides.userCurrencyHint ?? null,
  } as DeterministicTurnContext;
}

// ─────────────────────────────────────────────────────────────────────────
// Path 1: unit passed by tool params
// ─────────────────────────────────────────────────────────────────────────

describe("set_factor_value — unit from tool params", () => {
  it("honours params.unit = '$' when node has no unit", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 100000, unit: '$' },
      ctx,
    );
    expect(result.operations).toBeDefined();
    const op = result.operations![0];
    expect((op.value as Record<string, unknown>).observed_state).toMatchObject({
      value: 100000,
      unit: 'USD',
    });
    expect(result.assistantText).toContain('100000 USD');
  });

  it("honours params.unit = 'USD' directly (ISO code)", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 50000, unit: 'USD' },
      ctx,
    );
    const op = result.operations![0];
    expect((op.value as Record<string, unknown>).observed_state).toMatchObject({ unit: 'USD' });
  });

  it("overrides node GBP with user-stated $ from tool params", async () => {
    const ctx = makeContext({ nodeUnit: 'GBP' });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 100000, unit: '$' },
      ctx,
    );
    const op = result.operations![0];
    expect((op.value as Record<string, unknown>).observed_state).toMatchObject({ unit: 'USD' });
    expect(warnSpy).toHaveBeenCalled();
    const mismatchCall = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.set_factor_value_currency_mismatch',
    );
    expect(mismatchCall).toBeDefined();
    expect((mismatchCall![0] as { source: string }).source).toBe('param');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Path 2: unit omitted, currency detected in user message
// ─────────────────────────────────────────────────────────────────────────

describe("set_factor_value — unit omitted, user currency from message", () => {
  it("recovers $ from user_currency_hint when params.unit is absent", async () => {
    const ctx = makeContext({ nodeUnit: 'GBP', userCurrencyHint: 'USD' });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 100000 },
      ctx,
    );
    const op = result.operations![0];
    expect((op.value as Record<string, unknown>).observed_state).toMatchObject({
      value: 100000,
      unit: 'USD',
    });
    expect(result.assistantText).toContain('100000 USD');
    expect(result.assistantText).not.toContain('GBP');
  });

  it("logs currency mismatch telemetry with source=message when hint drives override", async () => {
    const ctx = makeContext({ nodeUnit: 'GBP', userCurrencyHint: 'USD' });
    await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 100000 },
      ctx,
    );
    const mismatchCall = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.set_factor_value_currency_mismatch',
    );
    expect(mismatchCall).toBeDefined();
    const payload = mismatchCall![0] as Record<string, unknown>;
    expect(payload.source).toBe('message');
    expect(payload.message_currency).toBe('USD');
    expect(payload.node_unit).toBe('GBP');
  });

  it("falls back to node unit when both params and hint are absent", async () => {
    const ctx = makeContext({ nodeUnit: 'GBP', userCurrencyHint: null });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 100000 },
      ctx,
    );
    const op = result.operations![0];
    expect((op.value as Record<string, unknown>).observed_state).toMatchObject({ unit: 'GBP' });
    // No mismatch warning when there's no user-stated currency to conflict.
    const mismatchCall = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.set_factor_value_currency_mismatch',
    );
    expect(mismatchCall).toBeUndefined();
  });

  it("does not log mismatch when user and node agree", async () => {
    const ctx = makeContext({ nodeUnit: 'USD', userCurrencyHint: 'USD' });
    await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 100000 },
      ctx,
    );
    const mismatchCall = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.set_factor_value_currency_mismatch',
    );
    expect(mismatchCall).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Precedence ordering
// ─────────────────────────────────────────────────────────────────────────

describe("set_factor_value — currency precedence", () => {
  it("prefers params.unit over user message hint when both present and different", async () => {
    const ctx = makeContext({ nodeUnit: 'GBP', userCurrencyHint: 'EUR' });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 100000, unit: '$' },
      ctx,
    );
    const op = result.operations![0];
    expect((op.value as Record<string, unknown>).observed_state).toMatchObject({ unit: 'USD' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// display_value branch coverage (Fix 1 — Pattern A follow-up)
//
// computeDisplayValue in set-factor-value.ts renders:
//   - unitless 0-1 factor (no unit OR unit === 'scale') → qualitative band
//   - any real unit (£, $, %, months, etc.) → "${value} ${unit}"
//   - out-of-range unitless → "${value}" raw
// The qualitative path is the only one that fires v4.display_value_qualitative.
// ─────────────────────────────────────────────────────────────────────────

describe("set_factor_value — display_value branch coverage", () => {
  const debugSpy = vi.mocked(log.debug);

  beforeEach(() => {
    debugSpy.mockClear();
  });

  it("unitless 0-1 value produces a qualitative band and logs v4.display_value_qualitative", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 0.25 },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('low');
    expect(result.assistantText).toContain('low');
    expect(result.assistantText).not.toContain('0.25');

    const qualitativeLog = debugSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.display_value_qualitative',
    );
    expect(qualitativeLog).toBeDefined();
    expect((qualitativeLog![0] as { band?: string }).band).toBe('low');
  });

  it("unit='scale' is treated as unitless and maps to a qualitative band", async () => {
    const ctx = makeContext({ nodeUnit: 'scale' });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 0.8 },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('very high');
    expect(result.assistantText).not.toContain('0.8');
  });

  it("percentage (real unit) keeps numeric formatting, does NOT emit qualitative telemetry", async () => {
    const ctx = makeContext({ nodeUnit: '%' });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 3, unit: '%' },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('3 %');
    expect(result.assistantText).toContain('3 %');
    const qualitativeLog = debugSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.display_value_qualitative',
    );
    expect(qualitativeLog).toBeUndefined();
  });

  it("currency (real unit) keeps numeric+unit form", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 75000, unit: 'GBP' },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('75000 GBP');
  });

  it("out-of-range unitless numeric (>1) is rendered raw, not qualitative", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 150000 },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('150000');
    const qualitativeLog = debugSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.display_value_qualitative',
    );
    expect(qualitativeLog).toBeUndefined();
  });

  it("boundary: value === 0 with no unit maps to 'low' (inclusive of lower band edge)", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 0 },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('low');
  });

  it("boundary: value === 1 with no unit maps to 'very high' (inclusive of upper band edge)", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 1 },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('very high');
  });
});
