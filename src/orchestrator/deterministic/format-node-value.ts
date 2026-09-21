/**
 * Node Value Formatting Utility
 *
 * Bridges the deterministic pipeline's entity data to the display-value
 * synthesis pipeline in `src/cee/factor-extraction/display-value.ts`.
 *
 * Deterministic handlers have access to `EntityEntry` (value, unit, cap)
 * and optionally the raw graph node (which carries `raw_value` in
 * `data` or `observed_state`). This module converts those shapes into
 * `DisplayValueInput` and delegates to `synthesiseDisplayValue`.
 *
 * Returns a human-readable string or `undefined` when the input is
 * insufficient. Never throws.
 */

import {
  synthesiseDisplayValue,
  type DisplayValueInput,
} from "../../cee/factor-extraction/display-value.js";

// ============================================================================
// Types
// ============================================================================

/** Minimal node shape available from EntityEntry or graph node. */
export interface NodeValueData {
  /** Normalised value (0-1 or 0-100). */
  value?: number;
  /** Unit string (e.g. "£", "%", "months", "scale"). */
  unit?: string;
  /** Normalisation cap. */
  cap?: number;
  /** Pre-normalisation raw value (from graph node data/observed_state). */
  raw_value?: number;
  /** Factor kind (e.g. "factor", "risk", "outcome"). */
  kind?: string;
}

// ============================================================================
// Main utility
// ============================================================================

/**
 * Format a node's current value for user-facing display.
 *
 * Delegates to `synthesiseDisplayValue` which handles currency shorthand,
 * percentages, time units, qualitative bands, and plain numbers.
 *
 * @param data - Node value metadata (typically from EntityEntry + graph node)
 * @returns Human-readable value string, or `undefined` if insufficient data
 */
export function formatNodeValue(data: NodeValueData): string | undefined {
  const input: DisplayValueInput = {
    value: data.value,
    unit: data.unit,
    cap: data.cap,
    raw_value: data.raw_value,
    // 'factor' and 'risk' both benefit from qualitative bands when unitless
    factor_type: data.kind === 'factor' || data.kind === 'risk' ? 'factor' : undefined,
  };
  return synthesiseDisplayValue(input);
}

/**
 * Extract raw_value from a graph node's `data` or `observed_state`.
 * Returns `undefined` if neither path yields a number.
 */
export function extractRawValue(graphNode: unknown): number | undefined {
  if (!graphNode || typeof graphNode !== 'object') return undefined;
  const node = graphNode as Record<string, unknown>;

  // data.raw_value (primary path)
  const data = node.data as Record<string, unknown> | undefined;
  if (data?.raw_value != null && typeof data.raw_value === 'number') {
    return data.raw_value;
  }

  // observed_state.raw_value (alternative path)
  const observed = node.observed_state as Record<string, unknown> | undefined;
  if (observed?.raw_value != null && typeof observed.raw_value === 'number') {
    return observed.raw_value;
  }

  return undefined;
}
