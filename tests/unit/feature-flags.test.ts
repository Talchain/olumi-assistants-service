import { describe, it, expect, afterEach, vi } from 'vitest';
import { isFeatureEnabled, getAllFeatureFlags } from '../../src/utils/feature-flags.js';

describe('Feature Flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isFeatureEnabled', () => {
    it('returns default value when no env var or request flag is set', () => {
      expect(isFeatureEnabled('grounding')).toBe(false); // default is false for safety
      expect(isFeatureEnabled('critique')).toBe(true);
      expect(isFeatureEnabled('clarifier')).toBe(true);
    });

    it('respects environment variable when set to true', () => {
      vi.stubEnv('GROUNDING_ENABLED', 'true');
      expect(isFeatureEnabled('grounding')).toBe(true);
    });

    it('respects environment variable when set to false', () => {
      vi.stubEnv('GROUNDING_ENABLED', 'false');
      expect(isFeatureEnabled('grounding')).toBe(false);
    });

    it('treats "1" as true', () => {
      vi.stubEnv('GROUNDING_ENABLED', '1');
      expect(isFeatureEnabled('grounding')).toBe(true);
    });

    it('treats any other value as false', () => {
      vi.stubEnv('GROUNDING_ENABLED', '0');
      expect(isFeatureEnabled('grounding')).toBe(false);
    });

    it('per-request flag overrides environment variable', () => {
      vi.stubEnv('GROUNDING_ENABLED', 'false');

      const requestFlags = { grounding: true };
      expect(isFeatureEnabled('grounding', requestFlags)).toBe(true);
    });

    it('per-request flag can disable when env enables', () => {
      vi.stubEnv('GROUNDING_ENABLED', 'true');

      const requestFlags = { grounding: false };
      expect(isFeatureEnabled('grounding', requestFlags)).toBe(false);
    });

    it('per-request flag only affects specified feature', () => {
      vi.stubEnv('GROUNDING_ENABLED', 'false');
      vi.stubEnv('CRITIQUE_ENABLED', 'true');

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
      vi.stubEnv('GROUNDING_ENABLED', 'false');
      vi.stubEnv('CRITIQUE_ENABLED', 'true');
      vi.stubEnv('CLARIFIER_ENABLED', 'false');

      const flags = getAllFeatureFlags();

      expect(flags).toEqual({
        grounding: false,
        critique: true,
        clarifier: false
      });
    });

    it('applies request flag overrides to all flags', () => {
      vi.stubEnv('GROUNDING_ENABLED', 'true');
      vi.stubEnv('CRITIQUE_ENABLED', 'true');

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
      vi.stubEnv('GROUNDING_ENABLED', 'false');
      expect(isFeatureEnabled('grounding')).toBe(false);
    });

    it('grounding can be re-enabled per-request', () => {
      vi.stubEnv('GROUNDING_ENABLED', 'false');

      const requestFlags = { grounding: true };
      expect(isFeatureEnabled('grounding', requestFlags)).toBe(true);
    });
  });
});
