/**
 * flattenInterventions — canonical normaliser from rich intervention shapes to
 * flat { factor_id: number } maps.
 *
 * Two callers today: run_analysis (PLoT expects flat numeric maps) and the V4
 * edit_graph adapter (intervention-preservation snapshots compare counts).
 *
 * Accepts:
 *   - bare numbers: { fac_x: 0.5 }
 *   - V3 rich shape: { fac_x: { value: 0.5, source?, target_match? } }
 *   - defensive nested: { fac_x: { value: { value: 0.5 } } } (one level deep)
 *
 * Throws OrchestratorError-compatible Error when a value is unresolvable — the
 * caller can choose to surface it as a structured failure or as a hard fail.
 */

import type { OrchestratorError } from "../types.js";

export function flattenInterventions(
  raw: Record<string, unknown> | null | undefined,
  optionId: string,
  optionIndex: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!raw) return result;

  for (const [factorId, value] of Object.entries(raw)) {
    result[factorId] = resolveInterventionValue(value, optionId, optionIndex, factorId);
  }

  return result;
}

function resolveInterventionValue(
  value: unknown,
  optionId: string,
  optionIndex: number,
  factorId: string,
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value != null && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value;
    if (typeof inner === 'number' && Number.isFinite(inner)) {
      return inner;
    }
    // Defensive: one level of nesting ({ value: { value: n } }) — observed
    // in a small number of legacy fixtures. Do not recurse further.
    if (inner != null && typeof inner === 'object' && 'value' in inner) {
      const deeper = (inner as { value: unknown }).value;
      if (typeof deeper === 'number' && Number.isFinite(deeper)) {
        return deeper;
      }
    }
  }

  throwInterventionError(optionId, optionIndex, factorId, value);
}

function throwInterventionError(
  optionId: string,
  optionIndex: number,
  factorId: string,
  value: unknown,
): never {
  const err: OrchestratorError = {
    code: 'INTERNAL_PAYLOAD_ERROR',
    message: `Cannot normalize intervention for option "${optionId}" (index ${optionIndex}), factor "${factorId}": expected number or { value: number }, got ${JSON.stringify(value)?.slice(0, 100)}`,
    tool: 'run_analysis',
    recoverable: false,
  };
  throw Object.assign(new Error(err.message), { orchestratorError: err });
}
