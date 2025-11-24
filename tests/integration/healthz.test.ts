import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { getAdapter } from '../../src/adapters/llm/router.js';
import { getAllFeatureFlags } from '../../src/utils/feature-flags.js';
import { SERVICE_VERSION } from '../../src/version.js';

describe('GET /healthz', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();

    // Replicate the healthz endpoint from server.ts (including cee.timeouts)
    app.get("/healthz", async () => {
      const adapter = getAdapter();
      const ceeRateDefault = 5;
      const resolveCeeRate = (raw: string | undefined): number => {
        const parsed = raw === undefined ? NaN : Number(raw);
        return parsed || ceeRateDefault;
      };
      const ceeConfig = {
        draft_graph: {
          feature_version: process.env.CEE_DRAFT_FEATURE_VERSION || "draft-model-1.0.0",
          rate_limit_rpm: resolveCeeRate(process.env.CEE_DRAFT_RATE_LIMIT_RPM),
        },
        options: {
          feature_version: process.env.CEE_OPTIONS_FEATURE_VERSION || "options-1.0.0",
          rate_limit_rpm: resolveCeeRate(process.env.CEE_OPTIONS_RATE_LIMIT_RPM),
        },
        bias_check: {
          feature_version: process.env.CEE_BIAS_CHECK_FEATURE_VERSION || "bias-check-1.0.0",
          rate_limit_rpm: resolveCeeRate(process.env.CEE_BIAS_CHECK_RATE_LIMIT_RPM),
        },
        evidence_helper: {
          feature_version:
            process.env.CEE_EVIDENCE_HELPER_FEATURE_VERSION || "evidence-helper-1.0.0",
          rate_limit_rpm: resolveCeeRate(process.env.CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM),
        },
        sensitivity_coach: {
          feature_version:
            process.env.CEE_SENSITIVITY_COACH_FEATURE_VERSION || "sensitivity-coach-1.0.0",
          rate_limit_rpm: resolveCeeRate(process.env.CEE_SENSITIVITY_COACH_RATE_LIMIT_RPM),
        },
        team_perspectives: {
          feature_version:
            process.env.CEE_TEAM_PERSPECTIVES_FEATURE_VERSION || "team-perspectives-1.0.0",
          rate_limit_rpm: resolveCeeRate(process.env.CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM),
        },
        explain_graph: {
          feature_version:
            process.env.CEE_EXPLAIN_FEATURE_VERSION || "explain-model-1.0.0",
          rate_limit_rpm: resolveCeeRate(process.env.CEE_EXPLAIN_RATE_LIMIT_RPM),
        },
      };

      return {
        ok: true,
        service: "assistants",
        version: SERVICE_VERSION,
        provider: adapter.name,
        model: adapter.model,
        limits_source: process.env.ENGINE_BASE_URL ? "engine" : "config",
        feature_flags: getAllFeatureFlags(),
        cee: {
          diagnostics_enabled: process.env.CEE_DIAGNOSTICS_ENABLED === "true",
          config: ceeConfig,
          timeouts: {
            route_ms: 115000,
            http_client_ms: 110000,
            retry_delay_ms: 800,
          },
        },
      };
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with service health status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.ok).toBe(true);
    expect(body.service).toBe('assistants');
  });

  it('includes version information', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    const body = JSON.parse(response.body);
    expect(body.version).toBe(SERVICE_VERSION);
    expect(typeof body.version).toBe('string');
  });

  it('includes LLM provider configuration', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    const body = JSON.parse(response.body);
    expect(body.provider).toBeDefined();
    expect(body.model).toBeDefined();
    expect(['openai', 'anthropic', 'fixtures']).toContain(body.provider);
  });

  it('includes limits source', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    const body = JSON.parse(response.body);
    expect(body.limits_source).toBeDefined();
    expect(['engine', 'config']).toContain(body.limits_source);
  });

  it('includes feature flags with correct structure', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    const body = JSON.parse(response.body);
    expect(body.feature_flags).toBeDefined();
    expect(typeof body.feature_flags).toBe('object');

    // Verify all expected flags are present
    expect(body.feature_flags).toHaveProperty('grounding');
    expect(body.feature_flags).toHaveProperty('critique');
    expect(body.feature_flags).toHaveProperty('clarifier');

    // Verify all flag values are booleans
    expect(typeof body.feature_flags.grounding).toBe('boolean');
    expect(typeof body.feature_flags.critique).toBe('boolean');
    expect(typeof body.feature_flags.clarifier).toBe('boolean');
  });

  it('feature flags match getAllFeatureFlags() output', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    const body = JSON.parse(response.body);
    const expectedFlags = getAllFeatureFlags();

    expect(body.feature_flags).toEqual(expectedFlags);
  });

  it('returns consistent response structure', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    const body = JSON.parse(response.body);

    // Verify all required fields are present
    expect(body).toHaveProperty('ok');
    expect(body).toHaveProperty('service');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('provider');
    expect(body).toHaveProperty('model');
    expect(body).toHaveProperty('limits_source');
    expect(body).toHaveProperty('feature_flags');
  });

  it('includes CEE status summary', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('cee');
    expect(typeof body.cee).toBe('object');
    expect(body.cee).toHaveProperty('diagnostics_enabled');
    expect(body.cee).toHaveProperty('config');

    const config = body.cee.config;
    expect(typeof config).toBe('object');
    expect(config).toHaveProperty('draft_graph');
    expect(config).toHaveProperty('options');
    expect(config).toHaveProperty('bias_check');
  });

  it('includes CEE timeout configuration', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/healthz'
    });

    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('cee');
    expect(body.cee).toHaveProperty('timeouts');

    const timeouts = body.cee.timeouts;
    expect(typeof timeouts).toBe('object');
    expect(timeouts).toHaveProperty('route_ms');
    expect(timeouts).toHaveProperty('http_client_ms');
    expect(timeouts).toHaveProperty('retry_delay_ms');
    expect(typeof timeouts.route_ms).toBe('number');
    expect(typeof timeouts.http_client_ms).toBe('number');
    expect(typeof timeouts.retry_delay_ms).toBe('number');
  });
});
