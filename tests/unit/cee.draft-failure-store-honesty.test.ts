/**
 * P0c — THE DRAFT-FAILURE STORE MUST NOT ANSWER "NO" WHEN IT MEANS "I CANNOT LOOK".
 *
 * `/admin/v1/draft-failures` is the surface built to explain the draft-500 P0
 * (`NO_PATH_TO_GOAL` / `NO_EFFECT_PATH` at `deterministic_enforcement`). On the
 * deployed build it is unreadable, and the two ways it fails are DIFFERENT
 * failures that were sharing one silence (platform trap 21):
 *
 *   1. STORE NOT CONFIGURED — `getClient()` returns null when the prompts
 *      Supabase URL / service-role key are absent. The list endpoint then
 *      answered `200 { failures: [], total: 0 }` and the by-id endpoint
 *      answered `404 not_found`. Both are CLEAN, WELL-FORMED, ENTIRELY WRONG:
 *      a lane reading them concludes "no draft failures were recorded" from an
 *      instrument that never reached the table. This is the estate's most
 *      expensive defect class — an absence probe with no positive control —
 *      reached through a null client instead of through a bad grep.
 *
 *   2. STORE QUERY FAILED — a PostgREST error (the deployed symptom; the table
 *      is created by `migrations/003_create_cee_draft_failures.sql`, a legacy
 *      hand-run estate separate from `supabase/migrations/`) was rethrown as a
 *      bare `Error` into a route with no catch, producing an OPAQUE HTTP 500
 *      that names neither the store nor the reason.
 *
 * THE CONTRACT PINNED HERE: unavailability is reported as unavailability, with
 * the reason, and is never rendered as an empty result or a not-found. The
 * no-hiding ruling applied to a diagnostic surface — a caveated instrument
 * teaches the reader something true; a silent one teaches them a falsehood.
 *
 * ⚠ THE OPPOSITE-DIRECTION TWIN IS LOAD-BEARING (standing brief §3). A fix that
 * turns every empty answer into an error would trade a false negative for a
 * false alarm. The last two cases assert the other direction explicitly: a
 * REACHABLE store with no rows still answers `200` with an empty list, and a
 * REACHABLE store with no such id still answers `404`. Both must stay green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { _resetConfigCache } from '../../src/config/index.js';

const { listMock, getByIdMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getByIdMock: vi.fn(),
}));

vi.mock('../../src/cee/draft-failures/store.js', async (importOriginal) => {
  // `importOriginal` spread, never a hand-listed factory: a `vi.mock` factory
  // REPLACES the module, so a hand-list silently drops every export added
  // since it was written (platform trap 12 — the flags-mock allowlist that
  // killed 51 tests). Only the two functions under test are overridden; the
  // real `DraftFailureStoreUnavailableError` must come through, because the
  // route discriminates on it BY IDENTITY.
  const actual = await importOriginal<typeof import('../../src/cee/draft-failures/store.js')>();
  return {
    ...actual,
    listDraftFailureBundles: listMock,
    getDraftFailureBundleById: getByIdMock,
    startDraftFailureRetentionJob: vi.fn(),
  };
});

const { build } = await import('../../src/server.js');
const { DraftFailureStoreUnavailableError } = await import('../../src/cee/draft-failures/store.js');

const ADMIN_KEY = 'admin-key';
const BUNDLE_ID = '11111111-1111-4111-8111-111111111111';

describe('P0c — /admin/v1/draft-failures reports unavailability, never a false empty', () => {
  beforeEach(() => {
    _resetConfigCache();
    listMock.mockReset();
    getByIdMock.mockReset();
    vi.stubEnv('ADMIN_API_KEY', ADMIN_KEY);
    vi.stubEnv('LLM_PROVIDER', 'fixtures');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── DIRECTION 1: unavailable must READ unavailable ──────────────────────

  it('RED-FIRST: an UNCONFIGURED store answers 503 store_not_configured, not 200 with an empty list', async () => {
    listMock.mockRejectedValue(
      new DraftFailureStoreUnavailableError('store_not_configured'),
    );
    const app = await build();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/draft-failures',
      headers: { 'x-admin-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    // Bound by IDENTITY (the exact error and reason strings), never by a
    // "is it 2xx" predicate another failure could satisfy.
    expect(body.error).toBe('draft_failure_store_unavailable');
    expect(body.reason).toBe('store_not_configured');
    // The whole point: the caller must NOT be able to read this as "no failures".
    expect(body.failures).toBeUndefined();
    expect(body.total).toBeUndefined();

    await app.close();
  });

  it('RED-FIRST: a FAILING store query answers 503 store_query_failed with the cause, not an opaque 500', async () => {
    listMock.mockRejectedValue(
      new DraftFailureStoreUnavailableError(
        'store_query_failed',
        'relation "public.cee_draft_failures" does not exist',
      ),
    );
    const app = await build();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/draft-failures',
      headers: { 'x-admin-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error).toBe('draft_failure_store_unavailable');
    expect(body.reason).toBe('store_query_failed');
    expect(body.message).toContain('cee_draft_failures');

    await app.close();
  });

  it('RED-FIRST: an UNCONFIGURED store answers 503 on GET /:id, never 404 not_found', async () => {
    getByIdMock.mockRejectedValue(
      new DraftFailureStoreUnavailableError('store_not_configured'),
    );
    const app = await build();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/v1/draft-failures/${BUNDLE_ID}`,
      headers: { 'x-admin-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('draft_failure_store_unavailable');
    expect(res.json().reason).toBe('store_not_configured');

    await app.close();
  });

  // ── DIRECTION 2 (the twin): reachable-and-genuinely-empty must stay 200/404 ──

  it('OPPOSITE-DIRECTION TWIN: a REACHABLE store with no rows still answers 200 with an empty list', async () => {
    listMock.mockResolvedValue({ failures: [], total: 0 });
    const app = await build();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/draft-failures',
      headers: { 'x-admin-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().failures).toEqual([]);
    expect(res.json().total).toBe(0);

    await app.close();
  });

  it('OPPOSITE-DIRECTION TWIN: a REACHABLE store with no such id still answers 404 not_found', async () => {
    getByIdMock.mockResolvedValue(null);
    const app = await build();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/v1/draft-failures/${BUNDLE_ID}`,
      headers: { 'x-admin-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');

    await app.close();
  });

  it('OPPOSITE-DIRECTION TWIN: an unexpected non-store error is NOT laundered into 503', async () => {
    // The catch must discriminate BY IDENTITY on the store error, not swallow
    // every throw. A genuine internal bug must stay a 500 so it is investigated
    // rather than reported to on-call as a dependency outage.
    listMock.mockRejectedValue(new TypeError('cannot read properties of undefined'));
    const app = await build();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/v1/draft-failures',
      headers: { 'x-admin-key': ADMIN_KEY },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).not.toBe('draft_failure_store_unavailable');

    await app.close();
  });
});

describe('P0c — the store itself distinguishes "not configured" from "empty"', () => {
  beforeEach(() => {
    _resetConfigCache();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('RED-FIRST: listDraftFailureBundles THROWS when no Supabase client can be built', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    _resetConfigCache();

    const store = await vi.importActual<typeof import('../../src/cee/draft-failures/store.js')>(
      '../../src/cee/draft-failures/store.js',
    );

    await expect(store.listDraftFailureBundles({})).rejects.toBeInstanceOf(
      store.DraftFailureStoreUnavailableError,
    );
    await expect(store.listDraftFailureBundles({})).rejects.toMatchObject({
      reason: 'store_not_configured',
    });
  });

  it('RED-FIRST: getDraftFailureBundleById THROWS when no Supabase client can be built', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    _resetConfigCache();

    const store = await vi.importActual<typeof import('../../src/cee/draft-failures/store.js')>(
      '../../src/cee/draft-failures/store.js',
    );

    await expect(store.getDraftFailureBundleById(BUNDLE_ID)).rejects.toBeInstanceOf(
      store.DraftFailureStoreUnavailableError,
    );
  });
});
