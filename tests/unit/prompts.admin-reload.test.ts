/**
 * Reload roundtrip — POST /admin/prompts/reload must clear the adapter
 * cache so the next getSystemPrompt() call re-reads from the underlying
 * source, AND must rebuild the routing snapshot.
 *
 * This test intentionally exercises the public route surface (auth-checked)
 * to lock the contract end-to-end. The route is wired without server boot
 * by mounting `adminPromptStatusRoutes` onto a fresh Fastify instance.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import { adminPromptStatusRoutes } from '../../src/routes/admin.prompts.status.js';
import {
  getSystemPrompt,
  invalidatePromptCache,
} from '../../src/adapters/llm/prompt-loader.js';
import {
  __resetRoutingPromptSnapshotForTests,
  ensureRoutingPromptSnapshot,
} from '../../src/orchestrator-v5/routing/prompt-loader.js';
import { __resetPromptsReadyCacheForTests } from '../../src/prompts/readiness.js';
import { STATUS_KEYS } from '../../src/prompts/tracked.js';

beforeAll(() => {
  registerAllDefaultPrompts();
  // Configure an admin key for the test. The middleware reads from
  // config.prompts.adminApiKey at call time; we set the env var that the
  // config layer reads from.
   
  process.env.ADMIN_API_KEY = 'test-admin-key';
});

beforeEach(() => {
  invalidatePromptCache();
  __resetRoutingPromptSnapshotForTests();
  __resetPromptsReadyCacheForTests();
});

describe('POST /admin/prompts/reload', () => {
  it('rejects requests without admin key', async () => {
    const app = Fastify();
    await adminPromptStatusRoutes(app);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/prompts/reload',
    });
    expect([401, 403, 503]).toContain(res.statusCode);
    await app.close();
  });

  it('returns reload_ok=true and per-key rows in the public vocabulary', async () => {
    const app = Fastify();
    await adminPromptStatusRoutes(app);

    // Warm the adapter cache + routing snapshot first.
    await getSystemPrompt('edit_graph');
    await ensureRoutingPromptSnapshot();

    const res = await app.inject({
      method: 'POST',
      url: '/admin/prompts/reload',
      headers: { 'x-admin-key': 'test-admin-key' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      reload_ok: boolean;
      snapshot_error: string | null;
      keys: Array<{
        key: string;
        source: string;
        version: string | null;
        content_hash: string | null;
        sent_hash?: string;
      }>;
    };
    expect(body.reload_ok).toBe(true);
    expect(body.snapshot_error).toBeNull();
    // DERIVED, not a literal. This used to assert `5` — a third copy of the
    // hand-listed tracked-key set, which meant widening the reported estate
    // read as a regression instead of as the fix. The route's job is to report
    // exactly the derived reporting set, so that is what is asserted.
    expect(body.keys.map((r) => r.key).sort()).toEqual([...STATUS_KEYS].sort());
    for (const row of body.keys) {
      expect(['pms', 'default']).toContain(row.source);
      expect(row.version).toBeTruthy();
      // content_hash is null only on error rows; we expect none here.
      expect(row.content_hash).toMatch(/^[0-9a-f]{16}$/);
    }
    const routing = body.keys.find((r) => r.key === 'routing');
    expect(routing).toBeDefined();
    expect(routing!.sent_hash).toMatch(/^[0-9a-f]{16}$/);
    await app.close();
  });

  it('clears the adapter cache so the next getSystemPrompt re-resolves', async () => {
    const app = Fastify();
    await adminPromptStatusRoutes(app);

    // Cold call populates the cache.
    const before = await getSystemPrompt('edit_graph');
    expect(before.length).toBeGreaterThan(0);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/prompts/reload',
      headers: { 'x-admin-key': 'test-admin-key' },
    });
    expect(res.statusCode).toBe(200);

    // After reload, the cache layer was invalidated. The default content is
    // identical (no store change happened), but the cache miss is a behaviour
    // we can verify by checking the adapter's cache snapshot. We do that
    // indirectly: a second call after reload should still return the same
    // content (the source of truth is unchanged) — what we are guarding is
    // that the call succeeded at all (i.e. reload didn't break loading).
    const after = await getSystemPrompt('edit_graph');
    expect(after).toBe(before);
    await app.close();
  });

  it('a rate-limited request returns 429, not 500', async () => {
    // The adversarial review of #753 proved empirically that every admin
    // errorResponseBuilder in this repo omits `statusCode`, so @fastify/rate-limit
    // (which reads it off the error object, index.js:31-35) fell through to 500.
    // The new 20/15-min cap on /admin/prompts/inventory makes that
    // misdiagnosis-fuel likely to actually fire, so the builder in THIS plugin
    // now sets it. The repo-wide sweep of the sibling builders is rowed.
    //
    // ⚠ ROADMAP 2.181 — that diagnosis was INCOMPLETE, and this test could not
    // see the remainder. `statusCode` on a plain object is read only by
    // Fastify's DEFAULT error handler — which is what this bare `Fastify()`
    // harness uses. The REAL server installs a custom `setErrorHandler` that
    // derives the status from the error.v1 code, and it received the plain
    // object as an *unknown error type*: this route still answered 500 live.
    // The builder now returns a real `RateLimitedError` (@fastify/rate-limit
    // THROWS the builder's return value, index.js:333), which is correct under
    // BOTH handlers. The body asserted below is therefore Fastify's default
    // serialisation of that Error — a harness artefact; on the real server the
    // central handler turns the same Error into `error.v1`/`RATE_LIMITED`,
    // which is asserted end-to-end in
    // tests/integration/global-rate-limit-429.test.ts.
    const app = Fastify();
    await adminPromptStatusRoutes(app);

    let limited: { statusCode: number; body: string } | null = null;
    for (let i = 0; i < 40; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/prompts/inventory',
        headers: { 'x-admin-key': 'test-admin-key' },
      });
      if (res.statusCode !== 200) {
        limited = { statusCode: res.statusCode, body: res.body };
        break;
      }
    }

    // Positive control: assert the cap actually FIRED before asserting its
    // status code, or the assertion below passes by never being reached.
    expect(limited, 'the 20/15-min cap never fired — the assertion below would be vacuous').not.toBeNull();
    expect(limited!.statusCode, `got ${limited!.statusCode}: ${limited!.body}`).toBe(429);
    expect(JSON.parse(limited!.body).message).toBe(
      'Too many requests. Please try again later.',
    );
    await app.close();
  });

  it('roundtrip: store mutation is visible to the next getSystemPrompt() after reload', async () => {
    // The full chain is getSystemPrompt → adapter cache → loadPrompt →
    // getPromptStore().getCompiled(). The loader binds `getPromptStore`
    // at import time, so vi.spyOn on the namespace doesn't redirect that
    // binding. Workaround: stub at the `loadPrompt` level on the prompts
    // index module. This exercises the adapter's full cache-miss path,
    // including the timeout race and `loaded.source === 'store'` branch
    // that writes to `promptCache`. We do NOT short-circuit
    // `getSystemPrompt`'s logic — only the loader's downstream call.
    const indexModule = await import('../../src/prompts/index.js');
    const loaderModule = await import('../../src/prompts/loader.js');
    invalidatePromptCache();
    const ORIGINAL = await getSystemPrompt('edit_graph');
    const MUTATED_A = `<<MUTATED-A>>\n${ORIGINAL}`;
    const MUTATED_B = `<<MUTATED-B>>\n${ORIGINAL}`;

    let phase: 'A' | 'B' = 'A';
    const enabledSpy = vi
      .spyOn(loaderModule, 'isPromptManagementEnabled')
      .mockReturnValue(true);
    const loadSpy = vi
      .spyOn(indexModule, 'loadPrompt')
      .mockImplementation(async (taskId) => {
        if (taskId === 'edit_graph') {
          return {
            content: phase === 'A' ? MUTATED_A : MUTATED_B,
            source: 'store',
            promptId: 'edit_graph_default',
            version: phase === 'A' ? 1 : 2,
          };
        }
        return loaderModule.loadPrompt(taskId);
      });

    try {
      invalidatePromptCache();
      // First call: adapter cache miss → loadPrompt stub returns phase A.
      // Adapter writes the result into its cache.
      const first = await getSystemPrompt('edit_graph');
      expect(first.startsWith('<<MUTATED-A>>')).toBe(true);

      // Second call without reload: adapter cache is warm with phase A
      // content. Phase has advanced but the cache shields us — this
      // verifies the adapter cache is sitting between us and the source.
      phase = 'B';
      const cached = await getSystemPrompt('edit_graph');
      expect(cached.startsWith('<<MUTATED-A>>')).toBe(true);

      // Reload: must invalidate the adapter cache layer (and repository
      // cache, and routing snapshot). The next getSystemPrompt() call
      // re-enters loadPrompt → stub → phase B.
      const app = Fastify();
      await adminPromptStatusRoutes(app);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/prompts/reload',
        headers: { 'x-admin-key': 'test-admin-key' },
      });
      expect(res.statusCode).toBe(200);

      const afterReload = await getSystemPrompt('edit_graph');
      expect(afterReload.startsWith('<<MUTATED-B>>')).toBe(true);
      await app.close();
    } finally {
      loadSpy.mockRestore();
      enabledSpy.mockRestore();
      invalidatePromptCache();
    }
  });
});
