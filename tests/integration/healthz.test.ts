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

    // Replicate the healthz endpoint from server.ts
    app.get("/healthz", async () => {
      const adapter = getAdapter();
      return {
        ok: true,
        service: "assistants",
        version: SERVICE_VERSION,
        provider: adapter.name,
        model: adapter.model,
        limits_source: process.env.ENGINE_BASE_URL ? "engine" : "config",
        feature_flags: getAllFeatureFlags()
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
});
