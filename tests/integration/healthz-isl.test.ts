/**
 * /healthz ISL Integration Tests
 *
 * Verifies that the real server's /healthz endpoint exposes the ISL section
 * correctly, using the centralized ISL config (getISLConfig).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Use fixtures provider so no real LLM keys are required
vi.stubEnv('LLM_PROVIDER', 'fixtures');

import { build } from '../../src/server.js';
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe('GET /healthz (ISL integration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    // Clear ISL-related env vars between tests
    delete process.env.CEE_CAUSAL_VALIDATION_ENABLED;
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_TIMEOUT_MS;
    delete process.env.ISL_MAX_RETRIES;
    // Reset config cache so changes to env vars take effect
    const { _resetConfigCache } = await import('../../src/config/index.js');
    _resetConfigCache();
  });

  it('reports ISL disabled and defaults when not configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body).toHaveProperty('isl');
    const isl = body.isl;

    expect(isl.enabled).toBe(false);
    expect(isl.configured).toBe(false);
    expect(isl.base_url).toBeUndefined();
    expect(typeof isl.timeout_ms).toBe('number');
    expect(typeof isl.max_retries).toBe('number');

    // Defaults from getISLConfig: 5000ms timeout, 1 retry
    expect(isl.timeout_ms).toBe(5000);
    expect(isl.max_retries).toBe(1);

    // Config sources should indicate defaults
    expect(isl.config_sources).toEqual({
      timeout: 'default',
      max_retries: 'default',
    });
  });

  it('reports ISL configuration when enabled with base URL and custom timeout/retries', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = '1';
    process.env.ISL_BASE_URL = 'http://isl.internal:8080';
    process.env.ISL_TIMEOUT_MS = '8000';
    process.env.ISL_MAX_RETRIES = '3';

    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    const isl = body.isl;
    expect(isl.enabled).toBe(true);
    expect(isl.configured).toBe(true);

    // Base URL should be masked (port/credentials hidden)
    expect(isl.base_url).toBe('http://isl.internal:***');

    expect(isl.timeout_ms).toBe(8000);
    expect(isl.max_retries).toBe(3);

    // Config sources should indicate env
    expect(isl.config_sources).toEqual({
      timeout: 'env',
      max_retries: 'env',
    });
  });

  it('applies clamping/defaults for invalid timeout and retries and exposes them in /healthz', async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:9999';
    process.env.ISL_TIMEOUT_MS = '999999'; // too large -> clamp to 30000
    process.env.ISL_MAX_RETRIES = '-5';    // negative -> fallback to default 1

    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    const isl = body.isl;
    expect(isl.enabled).toBe(true);
    expect(isl.configured).toBe(true);

    // Values should match getISLConfig output
    expect(isl.timeout_ms).toBe(30000);
    expect(isl.max_retries).toBe(1);

    // Config sources should indicate clamped/default
    expect(isl.config_sources).toEqual({
      timeout: 'clamped',     // Value was clamped from 999999 to 30000
      max_retries: 'default', // Invalid -5 fell back to default 1
    });
  });
});
