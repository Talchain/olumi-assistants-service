import { describe, it, expect } from 'vitest';
import { VALIDATION_CONSTANTS } from '../../../src/cee/validation-pipeline/constants.js';

describe('VALIDATION_CONSTANTS', () => {
  it('all boundary values are within expected numeric ranges', () => {
    // Strength bands increase monotonically
    expect(VALIDATION_CONSTANTS.STRENGTH_NEGLIGIBLE_MAX).toBeLessThan(VALIDATION_CONSTANTS.STRENGTH_WEAK_CORE_MIN);
    expect(VALIDATION_CONSTANTS.STRENGTH_WEAK_CORE_MIN).toBeLessThan(VALIDATION_CONSTANTS.STRENGTH_WEAK_CORE_MAX);
    expect(VALIDATION_CONSTANTS.STRENGTH_WEAK_CORE_MAX).toBeLessThan(VALIDATION_CONSTANTS.STRENGTH_MODERATE_CORE_MIN);
    expect(VALIDATION_CONSTANTS.STRENGTH_MODERATE_CORE_MIN).toBeLessThan(VALIDATION_CONSTANTS.STRENGTH_MODERATE_CORE_MAX);
    expect(VALIDATION_CONSTANTS.STRENGTH_MODERATE_CORE_MAX).toBeLessThan(VALIDATION_CONSTANTS.STRENGTH_STRONG_CORE_MIN);

    // Confidence bands increase monotonically
    expect(VALIDATION_CONSTANTS.CONFIDENCE_HIGH_MAX).toBeLessThan(VALIDATION_CONSTANTS.CONFIDENCE_MODERATE_MIN);
    expect(VALIDATION_CONSTANTS.CONFIDENCE_MODERATE_MIN).toBeLessThan(VALIDATION_CONSTANTS.CONFIDENCE_MODERATE_MAX);
    expect(VALIDATION_CONSTANTS.CONFIDENCE_MODERATE_MAX).toBeLessThan(VALIDATION_CONSTANTS.CONFIDENCE_LOW_MIN);

    // EP boundaries are in [0, 1] and increasing
    const [ep1, ep2, ep3] = VALIDATION_CONSTANTS.EP_BOUNDARIES;
    expect(ep1).toBeGreaterThan(0);
    expect(ep2).toBeGreaterThan(ep1);
    expect(ep3).toBeGreaterThan(ep2);
    expect(ep3).toBeLessThanOrEqual(1);

    // EP mid boundary is 0.70 (reverted from 0.75 per v1.4.1)
    expect(ep2).toBe(0.70);

    // Lint constants are sensible
    expect(VALIDATION_CONSTANTS.DOMAIN_PRIOR_EP_CAP).toBeLessThanOrEqual(1);
    expect(VALIDATION_CONSTANTS.WEAK_GUESS_EP_CAP).toBeLessThan(VALIDATION_CONSTANTS.DOMAIN_PRIOR_EP_CAP);
    expect(VALIDATION_CONSTANTS.WEAK_GUESS_STD_FLOOR).toBeGreaterThan(0);
    expect(VALIDATION_CONSTANTS.STD_CLAMP_RATIO).toBeGreaterThan(0);
    expect(VALIDATION_CONSTANTS.STD_CLAMP_RATIO).toBeLessThan(1);

    // Raw delta threshold is positive
    expect(VALIDATION_CONSTANTS.RAW_DELTA_THRESHOLD).toBeGreaterThan(0);

    // Extreme bias limit is positive
    expect(VALIDATION_CONSTANTS.EXTREME_BIAS_OFFSET_LIMIT).toBeGreaterThan(0);
  });
});
