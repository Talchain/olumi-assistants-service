/**
 * ISL Config Unit Tests
 *
 * Verifies parseTimeout, parseMaxRetries, causalValidationEnabled, and getISLConfig.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Only import pure helper functions statically - config-dependent functions use dynamic imports
import { parseTimeout, parseMaxRetries } from '../../src/adapters/isl/config.js';
import { logger } from '../../src/utils/simple-logger.js';

describe('ISL config helpers', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.CEE_CAUSAL_VALIDATION_ENABLED;
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_TIMEOUT_MS;
    delete process.env.ISL_MAX_RETRIES;
    delete process.env.BASE_URL;
    vi.restoreAllMocks();
    // Reset config cache AFTER vi.resetModules, using dynamic import
    const { _resetConfigCache: resetCache } = await import('../../src/config/index.js');
    resetCache();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    const { _resetConfigCache: resetCache } = await import('../../src/config/index.js');
    resetCache();
  });

  describe('parseTimeout', () => {
    it('returns default when env value is undefined', () => {
      expect(parseTimeout(undefined, 5000)).toBe(5000);
    });

    it('falls back to default and logs when value is invalid or non-positive', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      expect(parseTimeout('0', 4000)).toBe(4000);
      expect(parseTimeout('-10', 4000)).toBe(4000);
      expect(parseTimeout('not-a-number', 4000)).toBe(4000);

      const calls = warnSpy.mock.calls.filter(
        (call) => (call[0] as any)?.event === 'isl.config.invalid_timeout',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('clamps timeout to [100, 30000] ms', () => {
      expect(parseTimeout('50', 5000)).toBe(100);
      expect(parseTimeout('999999', 5000)).toBe(30000);
      expect(parseTimeout('2000', 5000)).toBe(2000);
    });
  });

  describe('parseMaxRetries', () => {
    it('returns default when env value is undefined', () => {
      expect(parseMaxRetries(undefined, 1)).toBe(1);
    });

    it('falls back to default and logs when value is invalid or negative', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      expect(parseMaxRetries('-1', 2)).toBe(2);
      expect(parseMaxRetries('not-a-number', 2)).toBe(2);

      const calls = warnSpy.mock.calls.filter(
        (call) => (call[0] as any)?.event === 'isl.config.invalid_max_retries',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('clamps retries to [0, 5]', () => {
      expect(parseMaxRetries('0', 1)).toBe(0);
      expect(parseMaxRetries('10', 1)).toBe(5);
      expect(parseMaxRetries('3', 1)).toBe(3);
    });
  });

  describe('causalValidationEnabled', () => {
    it('returns false when flag is undefined', async () => {
      const { causalValidationEnabled: isEnabled } = await import('../../src/adapters/isl/config.js');
      expect(isEnabled()).toBe(false);
    });

    it('accepts "true" as enabled value', async () => {
      process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
      const { causalValidationEnabled: isEnabled } = await import('../../src/adapters/isl/config.js');
      expect(isEnabled()).toBe(true);
    });

    it('accepts "1" as enabled value', async () => {
      process.env.CEE_CAUSAL_VALIDATION_ENABLED = '1';
      const { causalValidationEnabled: isEnabled } = await import('../../src/adapters/isl/config.js');
      expect(isEnabled()).toBe(true);
    });

    it('treats "false" as disabled', async () => {
      process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'false';
      const { causalValidationEnabled: isEnabled } = await import('../../src/adapters/isl/config.js');
      expect(isEnabled()).toBe(false);
    });

    it('treats "0" as disabled', async () => {
      process.env.CEE_CAUSAL_VALIDATION_ENABLED = '0';
      const { causalValidationEnabled: isEnabled } = await import('../../src/adapters/isl/config.js');
      expect(isEnabled()).toBe(false);
    });
  });

  describe('getISLConfig', () => {
    it('returns defaults when ISL is not configured', async () => {
      const { getISLConfig: getConfig } = await import('../../src/adapters/isl/config.js');
      const cfg = getConfig();

      expect(cfg.enabled).toBe(false);
      expect(cfg.configured).toBe(false);
      expect(cfg.baseUrl).toBeUndefined();
      expect(cfg.timeout).toBe(5000);
      expect(cfg.maxRetries).toBe(1);
    });

    it('reflects base URL and enabled flag when configured', async () => {
      process.env.CEE_CAUSAL_VALIDATION_ENABLED = '1';
      process.env.ISL_BASE_URL = 'http://localhost:8888';
      process.env.ISL_TIMEOUT_MS = '8000';
      process.env.ISL_MAX_RETRIES = '3';

      const { getISLConfig: getConfig } = await import('../../src/adapters/isl/config.js');
      const cfg = getConfig();

      expect(cfg.enabled).toBe(true);
      expect(cfg.configured).toBe(true);
      expect(cfg.baseUrl).toBe('http://localhost:8888');
      expect(cfg.timeout).toBe(8000);
      expect(cfg.maxRetries).toBe(3);
    });

    it('applies clamping and defaults for invalid timeout and retries', async () => {
      process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
      process.env.ISL_BASE_URL = 'http://localhost:8888';
      process.env.ISL_TIMEOUT_MS = '999999'; // too large -> clamp to 30000
      process.env.ISL_MAX_RETRIES = '-1';    // negative -> fallback to default 1

      const { getISLConfig: getConfig } = await import('../../src/adapters/isl/config.js');
      const cfg = getConfig();

      expect(cfg.enabled).toBe(true);
      expect(cfg.configured).toBe(true);
      expect(cfg.timeout).toBe(30000);
      expect(cfg.maxRetries).toBe(1);
    });
  });
});
