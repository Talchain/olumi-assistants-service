import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

const TEST_KEY = 'test-admin-key-abc';

// Mock config -- minimal shape for verifyAdminKey and route internals
const mockConfig = {
  cee: { turnDebugEnabled: true },
  prompts: {
    adminApiKey: TEST_KEY,
    adminApiKeyRead: undefined,
    adminAllowedIPs: '',
  },
  server: {},
};

vi.mock('../../config/index.js', () => ({ config: mockConfig }));

// Mock telemetry to silence log output in tests
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
  hashIP: () => 'hashed-ip',
}));

// Mock hash utility
vi.mock('../../utils/hash.js', () => ({
  safeEqual: (a: string, b: string) => a === b,
}));

const { storeTurnDebug, clearTurnDebugStore } = await import('../../orchestrator-v5/debug/turn-debug-store.js');
const { adminTurnDebugRoutes } = await import('../admin.v1.turn-debug.js');

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(adminTurnDebugRoutes);
  return app;
}

const BASE_ENTRY = {
  turn_id: 'turn-abc',
  session_id: 'sess-1',
  stored_at: Date.now(),
  cqe: {
    parsed_quantities: [],
    patterns_matched: ['P1'],
    timeout: false,
    degraded: false,
    compromise_match_count: 0,
    duration_ms: 12,
    message_too_long: false,
    word_range_missed: false,
  },
};

describe('GET /admin/v1/turn-debug/:turn_id', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    clearTurnDebugStore();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 when X-Admin-Key header is absent', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/v1/turn-debug/turn-abc' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('returns 401 when X-Admin-Key is invalid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/turn-debug/turn-abc',
      headers: { 'x-admin-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('returns 200 with full entry when found', async () => {
    storeTurnDebug(BASE_ENTRY);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/turn-debug/turn-abc',
      headers: { 'x-admin-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.turn_id).toBe('turn-abc');
    expect(body.session_id).toBe('sess-1');
    expect(body.cqe.patterns_matched).toStrictEqual(['P1']);
    expect(res.headers['x-ttl-expires-at']).toBeDefined();
  });

  it('returns 404 when turn_id not in store', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/turn-debug/unknown-turn',
      headers: { 'x-admin-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });

  it('returns 410 when entry has expired', async () => {
    storeTurnDebug({ ...BASE_ENTRY, stored_at: Date.now() - 2 * 60 * 60 * 1000 });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/turn-debug/turn-abc',
      headers: { 'x-admin-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: 'expired' });
  });
});

describe('GET /admin/v1/turn-debug-stats', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    clearTurnDebugStore();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/v1/turn-debug-stats' });
    expect(res.statusCode).toBe(401);
  });

  it('returns store occupancy with valid key', async () => {
    storeTurnDebug(BASE_ENTRY);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/turn-debug-stats',
      headers: { 'x-admin-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.store_size).toBe(1);
    expect(body.max_entries).toBe(500);
  });
});
