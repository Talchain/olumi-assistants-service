import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';

const TEST_KEY = 'test-admin-key-xyz';
const TMP_DIR = join(tmpdir(), 'routing-log-route-tests');
const LOG_PATH = join(TMP_DIR, 'test.jsonl');

const mockConfig = {
  prompts: {
    adminApiKey: TEST_KEY,
    adminApiKeyRead: undefined,
    adminAllowedIPs: '',
  },
  server: {},
};

vi.mock('../../config/index.js', () => ({ config: mockConfig }));

vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
  hashIP: () => 'hashed-ip',
}));

vi.mock('../../utils/hash.js', () => ({
  safeEqual: (a: string, b: string) => a === b,
}));

// Mock the reader to control return values in route-level tests
vi.mock('../../orchestrator-v5/routing/routing-log-reader.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../orchestrator-v5/routing/routing-log-reader.js')>();
  return {
    readRoutingLogEntry: vi.fn(real.readRoutingLogEntry),
  };
});

const { readRoutingLogEntry: mockReader } = await import('../../orchestrator-v5/routing/routing-log-reader.js') as {
  readRoutingLogEntry: ReturnType<typeof vi.fn>;
};

const { adminRoutingLogRoutes } = await import('../admin.v1.routing-log.js');

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(adminRoutingLogRoutes);
  return app;
}

const SAMPLE_RECORD = {
  turn_id: 'turn-xyz',
  scenario_id: 'sess-1',
  stage: 'ideate',
  intent_class: 'execute',
  handler_id: 'add_node',
  coaching_mode: null,
  resolution_status: 'resolved',
  routing_error_cause: null,
  validation_error_code: null,
  compound_detected: false,
  compound_pattern_matched: null,
  raw_user_message: 'add a factor',
  sonnet_text: null,
  sonnet_text_hash: null,
  redacted: false,
  created_at: new Date().toISOString(),
  label_tier: 'unreviewed',
  graph_node_count: 2,
  graph_edge_count: 1,
  graph_hash: 'abc',
  graph_mapped_nodes: 2,
  graph_dropped_by_unknown_kind: 0,
  graph_dropped_by_missing_id: 0,
  graph_lookup_outcome: 'ok',
  cqe_message_length: 10,
  cqe_result_count: 0,
  cqe_match_count: 0,
  cqe_compromise_match_count: 0,
  cqe_patterns_matched: [],
  cqe_duration_ms: 5,
  cqe_timeout: false,
  cqe_message_too_long: false,
  cqe_word_range_missed: false,
  cqe_ambiguous_phrasing_detected: false,
};

describe('GET /admin/v1/routing-log/:turn_id', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    app = buildApp();
    await mkdir(TMP_DIR, { recursive: true });
    vi.mocked(mockReader).mockReset();
  });

  afterEach(async () => {
    await app.close();
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  it('returns 401 when X-Admin-Key header is absent', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/v1/routing-log/turn-xyz' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('returns 401 when X-Admin-Key is invalid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/routing-log/turn-xyz',
      headers: { 'x-admin-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with the matching record', async () => {
    vi.mocked(mockReader).mockResolvedValue(SAMPLE_RECORD as never);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/routing-log/turn-xyz',
      headers: { 'x-admin-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().turn_id).toBe('turn-xyz');
  });

  it('returns 404 when turn_id is not in the log', async () => {
    vi.mocked(mockReader).mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/routing-log/unknown-turn',
      headers: { 'x-admin-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });

  it('returns 410 when the log file is absent', async () => {
    vi.mocked(mockReader).mockResolvedValue('file_absent');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/routing-log/turn-xyz',
      headers: { 'x-admin-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: 'file_absent' });
  });

  it('returns 500 when an I/O read error occurs', async () => {
    vi.mocked(mockReader).mockResolvedValue('read_error');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/routing-log/turn-xyz',
      headers: { 'x-admin-key': TEST_KEY },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'read_error' });
  });
});

