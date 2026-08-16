import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  store: null as unknown,
}));

vi.mock('../../src/prompts/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/prompts/index.js')>();
  return {
    ...actual,
    getPromptStore: () => routeState.store,
    isPromptStoreHealthy: () => true,
  };
});

vi.mock('../../src/middleware/admin-auth.js', () => ({
  AdminAuthTelemetryEvents: {},
  verifyAdminKey: () => true,
  getActorFromRequest: () => 'route-test-admin',
}));

describe('governed Supabase observation routes', () => {
  let app: FastifyInstance;
  let GovernedPromptStore: typeof import('../../src/prompts/stores/governed.js').GovernedPromptStore;
  let SupabasePromptStore: typeof import('../../src/prompts/stores/supabase.js').SupabasePromptStore;
  let FilePromptStore: typeof import('../../src/prompts/stores/file.js').FilePromptStore;
  let getGovernedPromptObservationCapability: typeof import('../../src/prompts/stores/governed.js').getGovernedPromptObservationCapability;

  beforeAll(async () => {
    vi.stubEnv('PROMPTS_ENABLED', 'true');
    vi.stubEnv('LLM_PROVIDER', 'fixtures');

    const configModule = await import('../../src/config/index.js');
    configModule._resetConfigCache();

    ({ GovernedPromptStore, getGovernedPromptObservationCapability } =
      await import('../../src/prompts/stores/governed.js'));
    ({ SupabasePromptStore } = await import(
      '../../src/prompts/stores/supabase.js'
    ));
    ({ FilePromptStore } = await import('../../src/prompts/stores/file.js'));

    const fastify = (await import('fastify')).default;
    const { adminPromptRoutes } = await import(
      '../../src/routes/admin.prompts.js'
    );
    app = fastify();
    await app.register(adminPromptRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    const configModule = await import('../../src/config/index.js');
    configModule._resetConfigCache();
  });

  it('routes list/get/add/delete through only the frozen governed capability', async () => {
    const backend = new SupabasePromptStore({
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
    });
    const getObservations = vi
      .spyOn(backend, 'getObservations')
      .mockImplementation(async (promptId, version) => ({
        observations: [
          {
            id: version ? 'version-observation' : 'prompt-observation',
            promptId,
            version: version ?? 1,
            observationType: 'note',
            content: 'Observed',
          },
        ],
        averageRating: null,
        totalCount: 1,
      }));
    const addObservation = vi
      .spyOn(backend, 'addObservation')
      .mockImplementation(async (observation) => ({
        id: 'added-observation',
        ...observation,
        createdAt: '2026-08-15T00:00:00.000Z',
      }));
    const deleteObservation = vi
      .spyOn(backend, 'deleteObservation')
      .mockResolvedValue(undefined);

    const governed = new GovernedPromptStore(backend);
    routeState.store = governed;

    const capability = getGovernedPromptObservationCapability(governed);
    expect(capability).not.toBeNull();
    expect(Object.isFrozen(capability)).toBe(true);
    expect(Object.keys(capability!).sort()).toEqual([
      'addObservation',
      'deleteObservation',
      'getObservationVersion',
      'listObservations',
    ]);
    expect(capability).not.toHaveProperty('create');
    expect(capability).not.toHaveProperty('update');

    const listResponse = await app.inject({
      method: 'GET',
      url: '/admin/prompts/prompt-1/observations',
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({ totalCount: 1 });
    expect(getObservations).toHaveBeenNthCalledWith(1, 'prompt-1');

    const getResponse = await app.inject({
      method: 'GET',
      url: '/admin/prompts/prompt-1/versions/2/observations',
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().observations[0]).toMatchObject({
      id: 'version-observation',
      version: 2,
    });
    expect(getObservations).toHaveBeenNthCalledWith(2, 'prompt-1', 2);

    const addResponse = await app.inject({
      method: 'POST',
      url: '/admin/prompts/prompt-1/observations',
      payload: {
        version: 2,
        observationType: 'note',
        content: 'Observed',
      },
    });
    expect(addResponse.statusCode).toBe(201);
    expect(addResponse.json()).toMatchObject({
      id: 'added-observation',
      promptId: 'prompt-1',
      version: 2,
      createdBy: 'route-test-admin',
    });
    expect(addObservation).toHaveBeenCalledWith({
      promptId: 'prompt-1',
      version: 2,
      observationType: 'note',
      content: 'Observed',
      rating: undefined,
      payloadHash: undefined,
      createdBy: 'route-test-admin',
    });

    const observationId = '6ee1ba7f-bf7b-4a51-985d-b1118e265304';
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/admin/prompts/prompt-1/observations/${observationId}`,
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(deleteObservation).toHaveBeenCalledWith(observationId);
  });

  it('returns 501 for governed non-Supabase stores and rejects raw backends', async () => {
    routeState.store = new GovernedPromptStore(new FilePromptStore());
    const nonSupabaseRequests = [
      {
        method: 'GET' as const,
        url: '/admin/prompts/prompt-1/observations',
      },
      {
        method: 'GET' as const,
        url: '/admin/prompts/prompt-1/versions/2/observations',
      },
      {
        method: 'POST' as const,
        url: '/admin/prompts/prompt-1/observations',
        payload: {
          version: 2,
          observationType: 'note',
          content: 'Observed',
        },
      },
      {
        method: 'DELETE' as const,
        url:
          '/admin/prompts/prompt-1/observations/' +
          '6ee1ba7f-bf7b-4a51-985d-b1118e265304',
      },
    ];
    for (const request of nonSupabaseRequests) {
      const response = await app.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(501);
    }

    const rawSupabase = new SupabasePromptStore({
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
    });
    routeState.store = rawSupabase;
    expect(getGovernedPromptObservationCapability(rawSupabase)).toBeNull();
    const rawBackend = await app.inject({
      method: 'GET',
      url: '/admin/prompts/prompt-1/observations',
    });
    expect(rawBackend.statusCode).toBe(501);
  });
});
