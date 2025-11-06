import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isFeatureEnabled, getAllFeatureFlags } from '../../src/utils/feature-flags.js';

describe('Feature Flags', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all feature flag env vars before each test
    delete process.env.ENABLE_GROUNDING;
    delete process.env.ENABLE_CRITIQUE;
    delete process.env.ENABLE_CLARIFIER;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe('isFeatureEnabled', () => {
    it('returns default value when no env var or request flag is set', () => {
      expect(isFeatureEnabled('grounding')).toBe(false); // default is false for safety
      expect(isFeatureEnabled('critique')).toBe(true);
      expect(isFeatureEnabled('clarifier')).toBe(true);
    });

    it('respects environment variable when set to true', () => {
      process.env.ENABLE_GROUNDING = 'true';
      expect(isFeatureEnabled('grounding')).toBe(true);
    });

    it('respects environment variable when set to false', () => {
      process.env.ENABLE_GROUNDING = 'false';
      expect(isFeatureEnabled('grounding')).toBe(false);
    });

    it('treats "1" as true', () => {
      process.env.ENABLE_GROUNDING = '1';
      expect(isFeatureEnabled('grounding')).toBe(true);
    });

    it('treats any other value as false', () => {
      process.env.ENABLE_GROUNDING = '0';
      expect(isFeatureEnabled('grounding')).toBe(false);

      process.env.ENABLE_GROUNDING = 'yes';
      expect(isFeatureEnabled('grounding')).toBe(false);
    });

    it('per-request flag overrides environment variable', () => {
      process.env.ENABLE_GROUNDING = 'false';

      const requestFlags = { grounding: true };
      expect(isFeatureEnabled('grounding', requestFlags)).toBe(true);
    });

    it('per-request flag can disable when env enables', () => {
      process.env.ENABLE_GROUNDING = 'true';

      const requestFlags = { grounding: false };
      expect(isFeatureEnabled('grounding', requestFlags)).toBe(false);
    });

    it('per-request flag only affects specified feature', () => {
      process.env.ENABLE_GROUNDING = 'false';
      process.env.ENABLE_CRITIQUE = 'true';

      const requestFlags = { grounding: true }; // Only override grounding

      expect(isFeatureEnabled('grounding', requestFlags)).toBe(true);
      expect(isFeatureEnabled('critique', requestFlags)).toBe(true); // Uses env
    });

    it('ignores unrecognized keys in request flags', () => {
      const requestFlags = { unknown_flag: true, grounding: false };
      expect(isFeatureEnabled('grounding', requestFlags)).toBe(false);
    });
  });

  describe('getAllFeatureFlags', () => {
    it('returns all feature flags with default values', () => {
      const flags = getAllFeatureFlags();

      expect(flags).toEqual({
        grounding: false,  // Conservative default for production safety
        critique: true,
        clarifier: true
      });
    });

    it('returns all feature flags with environment values', () => {
      process.env.ENABLE_GROUNDING = 'false';
      process.env.ENABLE_CRITIQUE = 'true';
      process.env.ENABLE_CLARIFIER = 'false';

      const flags = getAllFeatureFlags();

      expect(flags).toEqual({
        grounding: false,
        critique: true,
        clarifier: false
      });
    });

    it('applies request flag overrides to all flags', () => {
      process.env.ENABLE_GROUNDING = 'true';
      process.env.ENABLE_CRITIQUE = 'true';

      const requestFlags = { grounding: false, clarifier: false };
      const flags = getAllFeatureFlags(requestFlags);

      expect(flags).toEqual({
        grounding: false, // overridden
        critique: true,   // from env
        clarifier: false  // overridden
      });
    });
  });

  describe('Integration with routes', () => {
    it('grounding is disabled when env flag is false', () => {
      process.env.ENABLE_GROUNDING = 'false';
      expect(isFeatureEnabled('grounding')).toBe(false);
    });

    it('grounding can be re-enabled per-request', () => {
      process.env.ENABLE_GROUNDING = 'false';

      const requestFlags = { grounding: true };
      expect(isFeatureEnabled('grounding', requestFlags)).toBe(true);
    });
  });
});
