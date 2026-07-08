/**
 * Pinned per-model pricing table — the equal-compute currency is USD.
 *
 * PROVENANCE (required by lane amendment 1):
 * - source: Anthropic published pricing, platform.claude.com/docs/en/pricing,
 *   as mirrored by the claude-api skill reference (skill cache date 2026-06-24).
 * - entered: MANUALLY, 2026-07-02. Not fetched at runtime.
 * - currency: USD per 1M tokens.
 * - staleness: any run started more than STALE_AFTER_DAYS after `as_of`
 *   carries a pricing-stale warning in preflight AND in the report.
 *
 * Cache pricing follows the published multipliers: reads 0.1x input,
 * 5-minute-TTL writes 1.25x input.
 */

export interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_5m_per_mtok: number;
}

export interface PricingTable {
  source: string;
  as_of: string; // ISO date
  entered: "manual" | "fetched";
  currency: "USD";
  stale_after_days: number;
  models: Record<string, ModelPricing>;
}

export const PRICING_TABLE: PricingTable = {
  source:
    "Anthropic published pricing (platform.claude.com/docs/en/pricing) via claude-api skill reference, cache date 2026-06-24",
  as_of: "2026-07-02",
  entered: "manual",
  currency: "USD",
  stale_after_days: 30,
  models: {
    // Claude Sonnet 5 — LIST price ($3/$15 per MTok). An introductory rate
    // ($2/$10) applies through 2026-08-31; we deliberately price at LIST so
    // equal-compute matching does not silently shift when the intro window
    // closes. Cache multipliers per the published 0.1x read / 1.25x write.
    "claude-sonnet-5": {
      input_per_mtok: 3.0,
      output_per_mtok: 15.0,
      cache_read_per_mtok: 0.3,
      cache_write_5m_per_mtok: 3.75,
    },
    "claude-sonnet-4-6": {
      input_per_mtok: 3.0,
      output_per_mtok: 15.0,
      cache_read_per_mtok: 0.3,
      cache_write_5m_per_mtok: 3.75,
    },
    "claude-opus-4-8": {
      input_per_mtok: 5.0,
      output_per_mtok: 25.0,
      cache_read_per_mtok: 0.5,
      cache_write_5m_per_mtok: 6.25,
    },
  },
};

export interface PricingStaleness {
  stale: boolean;
  age_days: number;
}

export function pricingStaleness(now: Date, table: PricingTable = PRICING_TABLE): PricingStaleness {
  const asOf = new Date(table.as_of + "T00:00:00Z").getTime();
  const ageDays = Math.floor((now.getTime() - asOf) / 86_400_000);
  return { stale: ageDays > table.stale_after_days, age_days: ageDays };
}

export interface TokenUsageLike {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * USD cost of one usage entry for one model. Unknown model IDs throw —
 * silent zero-cost pricing would corrupt equal-compute comparisons.
 */
export function costUsd(model: string, usage: TokenUsageLike, table: PricingTable = PRICING_TABLE): number {
  const pricing = table.models[model];
  if (!pricing) {
    throw new Error(`pricing: no pinned price for model "${model}" — refusing to price silently`);
  }
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (input * pricing.input_per_mtok +
      output * pricing.output_per_mtok +
      cacheRead * pricing.cache_read_per_mtok +
      cacheWrite * pricing.cache_write_5m_per_mtok) /
    1_000_000
  );
}

/** USD target -> output-token budget at a given model's output price. */
export function usdToOutputTokens(usdTarget: number, model: string, table: PricingTable = PRICING_TABLE): number {
  const pricing = table.models[model];
  if (!pricing) throw new Error(`pricing: no pinned price for model "${model}"`);
  return Math.floor((usdTarget / pricing.output_per_mtok) * 1_000_000);
}
