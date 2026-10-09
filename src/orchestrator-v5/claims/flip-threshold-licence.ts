import { readTopLevelFlipRows, readFlipClaimPosture } from '../context/flip-threshold-rows.js';

export function hasMeasuredFlipThresholdFor(enrichment: Record<string, unknown>, subjectFactorId: string | null): boolean {
  return subjectFactorId !== null && enrichment.flip_thresholds_status !== 'unavailable'
    && readTopLevelFlipRows(enrichment).some(row => row.kind === 'flip_pair' && row.factor_id === subjectFactorId);
}

export function hasAttestedNoFlipForRun(enrichment: Record<string, unknown>): boolean {
  return enrichment.flip_thresholds_status !== 'unavailable' && readFlipClaimPosture(enrichment) === 'attested_no_flip';
}

export function hasAttestedNoFlipForFactor(enrichment: Record<string, unknown>, subjectFactorId: string | null): boolean {
  return subjectFactorId !== null && enrichment.flip_thresholds_status !== 'unavailable'
    && readTopLevelFlipRows(enrichment).some(row => row.factor_id === subjectFactorId && row.kind === 'attested_no_flip');
}

export function hasMeasuredFlipToOptionFor(enrichment: Record<string, unknown>, subjectFactorId: string, targetOptionId: string): boolean {
  return hasMeasuredFlipThresholdFor(enrichment, subjectFactorId)
    && readTopLevelFlipRows(enrichment).some(row => row.kind === 'flip_pair'
      && row.factor_id === subjectFactorId && row.alternative_winner_id === targetOptionId);
}
