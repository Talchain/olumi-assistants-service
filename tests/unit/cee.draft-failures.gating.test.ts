import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { _resetConfigCache } from '../../src/config/index.js';

// Mock Supabase persistence to observe what would be stored
const { persistMock } = vi.hoisted(() => ({
  persistMock: vi.fn().mockResolvedValue({ failureBundleId: 'fail_123' }),
}));

vi.mock('../../src/cee/draft-failures/store.js', () => ({
  persistDraftFailureBundle: persistMock,
  listDraftFailureBundles: vi.fn(),
  getDraftFailureBundleById: vi.fn(),
  startDraftFailureRetentionJob: vi.fn(),
}));

import { build } from '../../src/server.js';

describe('CEE draft failures unsafe gating', () => {
  beforeEach(() => {
    _resetConfigCache();
    persistMock.mockClear();
    // Must be re-stubbed because afterEach uses vi.unstubAllEnvs()
    vi.stubEnv('LLM_PROVIDER', 'fixtures');
    vi.stubEnv('ASSIST_API_KEYS', 'cee-key-1');
    vi.stubEnv('ADMIN_API_KEY', 'admin-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not enable include_debug nor unsafe_capture without unsafe=1 + X-Admin-Key', async () => {
    const app = await build();
    await app.ready();

    // Force failure by stripping option kind in pipeline (dev/test header is supported)
    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/draft-graph?schema=v1',
      headers: {
        'X-Olumi-Assist-Key': 'cee-key-1',
        'X-Debug-Force-Missing-Kinds': 'option',
      },
      payload: {
        brief: 'A sufficiently long decision brief to trigger fixtures adapter and then forced failure.',
        include_debug: true,
        flags: { unsafe_capture: true },
      },
    });

    // 422 Unprocessable Entity: validation failed (correct syntax, invalid semantics)
    expect(res.statusCode).toBe(422);
    expect(persistMock).toHaveBeenCalledTimes(1);

    const call = persistMock.mock.calls[0]?.[0] as any;
    expect(call.unsafeCaptureEnabled).toBe(false);
    expect(call.rawLLMOutput).toBeUndefined();
    expect(call.rawLLMText).toBeUndefined();
    expect(call.brief).toBeUndefined();
    expect(call.briefPreview).toBeUndefined();

    await app.close();
  });

  it('enables unsafe_capture only when unsafe=1 and X-Admin-Key is valid', async () => {
    const app = await build();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/assist/v1/draft-graph?schema=v1&unsafe=1',
      headers: {
        'X-Olumi-Assist-Key': 'cee-key-1',
        'X-Admin-Key': 'admin-key',
        'X-Debug-Force-Missing-Kinds': 'option',
      },
      payload: {
        brief: 'A sufficiently long decision brief to trigger fixtures adapter and then forced failure.',
        include_debug: true,
      },
    });

    // 422 Unprocessable Entity: validation failed (correct syntax, invalid semantics)
    expect(res.statusCode).toBe(422);
    expect(persistMock).toHaveBeenCalledTimes(1);

    const call = persistMock.mock.calls[0]?.[0] as any;
    expect(call.unsafeCaptureEnabled).toBe(true);
    expect(call.briefPreview).toBeDefined();

    await app.close();
  });
});
