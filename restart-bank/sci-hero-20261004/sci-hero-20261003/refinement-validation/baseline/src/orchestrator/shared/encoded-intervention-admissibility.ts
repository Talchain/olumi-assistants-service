/**
 * Singular admissibility authority for encoded categorical/boolean
 * interventions.
 *
 * PLoT's request-level normalisation gate can carry category codes faithfully
 * only while they remain inside [0,1]. Categorical schema values are integers;
 * booleans are exactly 0|1. In both cases the carrier must prove the exact raw
 * value -> code relationship with its own encoding map. Readiness and the PLoT
 * egress guard consume this same pure classification so a model cannot be
 * declared runnable by one boundary and refused (or corrupted) by the next.
 */

export type EncodedInterventionAdmissibility =
  | 'not_encoded'
  | 'admissible'
  | 'inadmissible';

type Dict = Record<string, unknown>;

function isRecord(value: unknown): value is Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Classify an intervention without mutating it.
 *
 * `not_encoded` means the carrier has no robust encoded-value signal and must
 * continue through the numeric scale path. A bare string `raw_value` is not a
 * signal by itself because numeric strings are valid magnitude evidence.
 */
export function classifyEncodedInterventionAdmissibility(
  intervention: unknown,
): EncodedInterventionAdmissibility {
  if (!isRecord(intervention)) return 'not_encoded';

  const valueType = intervention.value_type;
  const rawValue = intervention.raw_value;
  const hasEncodedSignal =
    valueType === 'categorical'
    || valueType === 'boolean'
    || intervention.encoding_map !== undefined
    || typeof rawValue === 'boolean';
  if (!hasEncodedSignal) return 'not_encoded';

  const value = intervention.value;
  const encodingMap = intervention.encoding_map;
  if (typeof value !== 'number' || !Number.isFinite(value) || !isRecord(encodingMap)) {
    return 'inadmissible';
  }

  const rawTypeMatches = valueType === 'categorical'
    ? typeof rawValue === 'string'
    : valueType === 'boolean'
      ? typeof rawValue === 'boolean'
      : false;
  if (!rawTypeMatches) return 'inadmissible';

  const rawKey = String(rawValue);
  if (!Object.prototype.hasOwnProperty.call(encodingMap, rawKey)) {
    return 'inadmissible';
  }
  const mappedValue = encodingMap[rawKey];
  if (typeof mappedValue !== 'number' || !Number.isFinite(mappedValue) || mappedValue !== value) {
    return 'inadmissible';
  }

  if (valueType === 'boolean') {
    return value === 0 || value === 1 ? 'admissible' : 'inadmissible';
  }
  return Number.isInteger(value) && value >= 0 && value <= 1
    ? 'admissible'
    : 'inadmissible';
}
