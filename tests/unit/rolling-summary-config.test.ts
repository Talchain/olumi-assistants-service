/**
 * Context Architecture v2 — S4 rolling summary: config flag + model default.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { _resetConfigCache, config } from '../../src/config/index.js';
import {
  resolveSummaryModel,
  SUMMARISER_SYSTEM_PROMPT,
} from '../../src/orchestrator-v5/rolling-summary/summariser.js';
import { DEFAULT_SUMMARY_MODEL } from '../../src/orchestrator-v5/rolling-summary/summary-types.js';

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

function withEnv(env: Record<string, string | undefined>): void {
  vi.stubEnv('OLUMI_ENV', 'staging');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? '');
  _resetConfigCache();
}

describe('CEE_ROLLING_SUMMARY two-stage flag', () => {
  it('defaults to off when unset', () => {
    withEnv({ CEE_ROLLING_SUMMARY: undefined });
    expect(config.features.rollingSummary).toBe('off');
  });

  it('accepts maintain and inject', () => {
    withEnv({ CEE_ROLLING_SUMMARY: 'maintain' });
    expect(config.features.rollingSummary).toBe('maintain');
    withEnv({ CEE_ROLLING_SUMMARY: 'inject' });
    expect(config.features.rollingSummary).toBe('inject');
  });

  it('falls back to off for unrecognised values', () => {
    withEnv({ CEE_ROLLING_SUMMARY: 'on' });
    expect(config.features.rollingSummary).toBe('off');
  });
});

describe('summariser model selection', () => {
  it('defaults to the haiku-class model when CEE_MODEL_SUMMARY is unset', () => {
    withEnv({ CEE_MODEL_SUMMARY: undefined });
    expect(resolveSummaryModel()).toBe(DEFAULT_SUMMARY_MODEL);
    expect(DEFAULT_SUMMARY_MODEL).toMatch(/haiku/);
  });

  it('honours a CEE_MODEL_SUMMARY override', () => {
    withEnv({ CEE_MODEL_SUMMARY: 'claude-x-haiku-test' });
    expect(resolveSummaryModel()).toBe('claude-x-haiku-test');
  });

  it('the summariser prompt is code-defined and forbids raw numerics (Doctrine P)', () => {
    expect(SUMMARISER_SYSTEM_PROMPT).toContain('DECISION FRAME:');
    expect(SUMMARISER_SYSTEM_PROMPT).toContain('CONSTRAINTS & PREFERENCES:');
    expect(SUMMARISER_SYSTEM_PROMPT).toMatch(/do not include probabilities|no.*numeric|Do NOT include/i);
  });
});
