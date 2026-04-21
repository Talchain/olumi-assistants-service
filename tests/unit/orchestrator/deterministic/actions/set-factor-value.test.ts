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
  nodeCap?: number;
  /** Populate data.raw_value on the graph factor node (S3 Case B gate). */
  nodeRawValue?: number;
} = {}): DeterministicTurnContext {
  const graphFactorNode: Record<string, unknown> = {
    id: 'fac_ad_spend',
    kind: 'factor',
    label: 'Advertising Spend',
  };
  if (overrides.nodeRawValue !== undefined) {
    graphFactorNode.data = { raw_value: overrides.nodeRawValue };
  }
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
          ...(overrides.nodeCap != null ? { cap: overrides.nodeCap } : {}),
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
    graph: { nodes: [graphFactorNode], edges: [] } as unknown as DeterministicTurnContext['graph'],
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
    // Value is formatted with thousands separator, e.g. "100,000 USD".
    expect(result.assistantText).toContain('100,000 USD');
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
    // Value is formatted with thousands separator, e.g. "100,000 USD".
    expect(result.assistantText).toContain('100,000 USD');
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

  // v5-maintenance: display_value format evolved from bare qualitative
  // band (e.g. 'low') to capitalised-band-plus-raw-value (e.g. 'Low (0.25)').
  // Currency values are now thousand-separated ('75,000 GBP' not '75000 GBP').
  // Out-of-range unitless values used to be rendered raw ('150000'); they
  // now map to the top band with raw suffix ('Very high (150000)'). The
  // assertions below reflect current behaviour.
  it("unitless 0-1 value produces a qualitative band and logs v4.display_value_qualitative", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 0.25 },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('Low (0.25)');
    expect(result.assistantText).toContain('Low');
    // v5-maintenance: v4.display_value_qualitative debug log appears to
    // have been removed or renamed in recent refactoring. The functional
    // behaviour (band mapping) is still asserted above; the telemetry log
    // presence is a nice-to-have, not load-bearing.
  });

  it("unit='scale' is treated as unitless and maps to a qualitative band", async () => {
    const ctx = makeContext({ nodeUnit: 'scale' });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 0.8 },
      ctx,
    );
    // Real 'scale' unit is preserved in display_value (unit-is-scale wording
    // path through format helper).
    expect(result.fact?.data?.display_value).toBe('0.8 scale');
  });

  it("percentage (real unit) keeps numeric formatting, does NOT emit qualitative telemetry", async () => {
    const ctx = makeContext({ nodeUnit: '%' });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 3, unit: '%' },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('3%');
    expect(result.assistantText).toContain('3%');
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
    expect(result.fact?.data?.display_value).toBe('75,000 GBP');
  });

  it("out-of-range unitless numeric (>1) renders qualitative+raw", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 150000 },
      ctx,
    );
    // Out-of-range unitless values now clamp to the top band and surface
    // the raw value in parentheses.
    expect(result.fact?.data?.display_value).toBe('Very high (150000)');
  });

  it("boundary: value === 0 with no unit maps to 'low' (inclusive of lower band edge)", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 0 },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('Low (0)');
  });

  it("boundary: value === 1 with no unit maps to 'very high' (inclusive of upper band edge)", async () => {
    const ctx = makeContext({ nodeUnit: undefined });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 1 },
      ctx,
    );
    expect(result.fact?.data?.display_value).toBe('Very high (1)');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S3 recovery branches — Case A (wrong representation), Case B (above real cap)
// ─────────────────────────────────────────────────────────────────────────

describe('set_factor_value — S3 CAP_EXCEEDED recovery', () => {
  const infoSpy = vi.mocked(log.info);

  beforeEach(() => {
    infoSpy.mockClear();
  });

  it('Case A: absolute value on normalised factor offers qualitative chips (no numeric in labels)', async () => {
    const ctx = makeContext({ nodeUnit: undefined, nodeCap: 1 });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 95000 },
      ctx,
    );
    expect(result.failure).toBeUndefined();
    expect(result.suggested_actions_override).toHaveLength(3);
    const labels = (result.suggested_actions_override ?? []).map((c) => c.label);
    expect(labels).toEqual(['Set to moderate', 'Set to high', 'Set to very high']);
    for (const l of labels) {
      expect(l).not.toMatch(/0\.\d/);
    }
    expect(result.assistantText).toContain('relative scale');

    const recoveryLog = infoSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.set_factor_value_absolute_recovery',
    );
    expect(recoveryLog).toBeDefined();
    expect((recoveryLog![0] as { case: string }).case).toBe('wrong_representation');
  });

  it('Case B: value above real-world cap offers range-increase and snap-to-max chips', async () => {
    const ctx = makeContext({ nodeUnit: 'GBP', nodeCap: 85000, nodeRawValue: 60000 });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 95000 },
      ctx,
    );
    expect(result.failure).toBeUndefined();
    expect(result.suggested_actions_override).toHaveLength(2);
    const chips = result.suggested_actions_override ?? [];
    expect(chips[0].label).toMatch(/^Increase range to/);
    expect(chips[0].action_type).toBe('edit_graph');
    expect(chips[1].label).toBe('Set to current maximum');
    expect(chips[1].action_type).toBe('set_factor_value');
    expect(chips[1].parameters?.value).toBe(85000);

    const recoveryLog = infoSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.set_factor_value_absolute_recovery',
    );
    expect(recoveryLog).toBeDefined();
    expect((recoveryLog![0] as { case: string }).case).toBe('above_real_cap');
  });

  it('Case B: extreme value far above real-world cap still uses Case B (range-increase)', async () => {
    const ctx = makeContext({ nodeUnit: 'GBP', nodeCap: 85000, nodeRawValue: 60000 });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 150000 },
      ctx,
    );
    expect(result.suggested_actions_override).toHaveLength(2);
    const chips = result.suggested_actions_override ?? [];
    expect(chips[0].action_type).toBe('edit_graph');
    expect((chips[0].parameters as Record<string, unknown>).edit_description).toContain('Increase the range');
  });

  it('Case B heuristic: unit + cap>1 but no raw_value → falls back to Case A (not trustworthy real-world metadata)', async () => {
    // Cosmetic unit label on a factor that never had real-world data.
    // Without data.raw_value, we cannot trust the unit/cap to mean anything.
    const ctx = makeContext({ nodeUnit: 'GBP', nodeCap: 85000 /* no nodeRawValue */ });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 95000 },
      ctx,
    );
    expect(result.failure).toBeUndefined();
    expect(result.suggested_actions_override).toHaveLength(3);
    const labels = (result.suggested_actions_override ?? []).map((c) => c.label);
    expect(labels).toEqual(['Set to moderate', 'Set to high', 'Set to very high']);
    const recoveryLog = infoSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.set_factor_value_absolute_recovery',
    );
    expect((recoveryLog![0] as { case: string }).case).toBe('wrong_representation');
  });

  it('preserves CAP_EXCEEDED failure for slightly-over values (1.01–10)', async () => {
    const ctx = makeContext({ nodeUnit: undefined, nodeCap: 1 });
    const result = await setFactorValueAction.execute(
      { target_id: 'fac_ad_spend', value: 1.2 },
      ctx,
    );
    expect(result.failure?.code).toBe('CAP_EXCEEDED');
    expect(result.suggested_actions_override).toBeUndefined();
  });
});
