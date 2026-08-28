/**
 * One fail-closed companion-status/value gate for producer enrichment fields.
 *
 * A present `<field>_status` is authoritative: only `computed` licenses the
 * value. Legacy payloads with no status must satisfy the field's strict value
 * shape. Keeping this in a pure leaf lets both Phase 3 projection and final
 * wire licensing ask the same question without a compose/coaching cycle.
 */

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const COMPANION_VALUE_SCHEMAS: Readonly<
  Record<string, (value: unknown) => boolean>
> = Object.freeze({
  confidence_tier: (value) =>
    typeof value === 'string' && value.trim().length > 0,
  factor_sensitivity: (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => {
      const record = readRecord(row);
      return (
        record !== null &&
        typeof record.factor_id === 'string' &&
        record.factor_id.length > 0
      );
    }),
  robustness: (value) => {
    const record = readRecord(value);
    return record !== null && Object.keys(record).length > 0;
  },
});

export function deriveCompanionValueClaimSafe(
  enrichmentValue: unknown,
  field: string,
): boolean {
  const enrichment = readRecord(enrichmentValue);
  if (enrichment === null) return false;
  const status = enrichment[`${field}_status`];
  if (status !== undefined) return status === 'computed';
  const validate = COMPANION_VALUE_SCHEMAS[field];
  return validate !== undefined && validate(enrichment[field]);
}
