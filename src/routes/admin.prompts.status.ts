/**
 * Admin Prompts Status + Inventory + Reload Routes
 *
 * GET  /admin/prompts/status — per-key resolution detail for the DERIVED
 *      reported prompt set (every live PMS prompt plus the gated-but-wired
 *      ones). Read-only admin auth.
 *
 *      This set used to be a HAND-LISTED five keys (`TRACKED_KEYS`), which
 *      duly went stale: `repair_edit_graph` is PMS-registered and
 *      live-callable and was invisible here. It is now derived — see
 *      `src/prompts/estate.ts`. Health GATING still uses the critical five;
 *      only REPORTING widened.
 *
 * GET  /admin/prompts/inventory — the one derivable answer to "how many
 *      prompts, which, what hash", covering BOTH halves of the estate (PMS
 *      rows and code constants) and reporting its own archive drift.
 *
 * POST /admin/prompts/reload — clears all cache layers (store, adapter,
 *      routing snapshot), re-warms the store cache, returns post-reload
 *      detail. Write admin auth. Per-instance only — multi-instance
 *      deployments must reload each instance or restart.
 *
 * Response vocabulary is the public {`pms`, `default`} surface. The routing
 * row carries an extra `sent_hash` (Anthropic cache-key hash) — documented
 * here as the one explicit per-key extension; no other key uses it.
 */

import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { verifyAdminKey } from '../middleware/admin-auth.js';
import {
  probeStatusPrompts,
  resetPromptsReadyCache,
  type PromptKeyStatus,
} from '../prompts/readiness.js';
import { buildPromptEstateInventory } from '../prompts/inventory.js';
import {
  ensureRoutingPromptSnapshot,
  refreshRoutingPromptSnapshot,
} from '../orchestrator-v5/routing/prompt-loader.js';
import { getPromptRepository } from '../prompts/repository.js';
import {
  invalidatePromptCache,
  warmPromptCacheFromStore,
} from '../adapters/llm/prompt-loader.js';

interface RoutingExtras {
  /** Optional Anthropic cache-key hash. Only present on the `routing` row. */
  sent_hash?: string;
}

type PromptKeyStatusWithExtras = PromptKeyStatus & RoutingExtras;

async function buildKeyRows(
  trigger: 'status' | 'reload',
): Promise<PromptKeyStatusWithExtras[]> {
  const statuses = await probeStatusPrompts(trigger);
  let sent_hash: string | undefined;
  try {
    // Pass the route trigger through to the snapshot accessor so the
    // cache-hit telemetry it emits doesn't masquerade as runtime traffic.
    const snapshot = await ensureRoutingPromptSnapshot(trigger);
    sent_hash = snapshot.sent_hash;
  } catch {
    // Snapshot not buildable (file missing or PMS unreachable + no default).
    // The routing row's `error` field already explains the failure; leave
    // sent_hash undefined.
  }
  return statuses.map((s) =>
    s.key === 'routing' && sent_hash != null ? { ...s, sent_hash } : s,
  );
}

export async function adminPromptStatusRoutes(app: FastifyInstance): Promise<void> {
  // Rate limiting, matching the sibling admin plugins (admin.prompts.ts,
  // admin.v1.turn-debug.ts, admin.v1.routing-log.ts, admin.v1.draft-failures.ts):
  // 100 requests / 15 min per admin-key+IP.
  //
  // This plugin previously had NONE — the global limiter in server.ts covered
  // it, but nothing scoped these authorization-performing routes the way every
  // other admin plugin is scoped. CodeQL's js/missing-rate-limiting flagged the
  // gap when /admin/prompts/inventory was added; the honest fix is to close it
  // for the whole plugin rather than for the one new route.
  await app.register(rateLimit, {
    max: 100,
    timeWindow: 15 * 60 * 1000,
    keyGenerator: (request) => {
      const adminKey = (request.headers['x-admin-key'] as string) ?? '';
      return `prompt_status:${adminKey.slice(0, 8)}:${request.ip}`;
    },
    errorResponseBuilder: () => ({
      // statusCode is LOAD-BEARING. @fastify/rate-limit reads it off the error
      // object to set the response status; the sibling admin plugins all omit
      // it, so their limit hits return 500 instead of 429 — proven empirically
      // in the #753 adversarial review. Fixed here; the repo-wide sweep of the
      // other builders is rowed.
      statusCode: 429,
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again later.',
    }),
  });

  app.get('/admin/prompts/status', async (request, reply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;
    const keys = await buildKeyRows('status');
    return reply.code(200).send({ keys });
  });

  /**
   * GET /admin/prompts/inventory — the whole estate in one derivable answer.
   *
   * Read-only admin auth, same as /status. Deliberately a separate route so
   * /status keeps its exact `{ keys: [...] }` shape for existing consumers.
   */
  app.get(
    '/admin/prompts/inventory',
    {
      // Tighter than the plugin-wide limiter above: this is the only route in
      // the file that reads the prompt STORE (`store.list()` for the archive
      // -drift measurement), so it is the only one whose cost scales with the
      // estate rather than with in-memory state.
      config: { rateLimit: { max: 20, timeWindow: 15 * 60 * 1000 } },
    },
    async (request, reply) => {
      if (!verifyAdminKey(request, reply, 'read')) return;
      const inventory = await buildPromptEstateInventory();
      return reply.code(200).send(inventory);
    },
  );

  app.post('/admin/prompts/reload', async (request, reply) => {
    if (!verifyAdminKey(request, reply, 'write')) return;

    // 1. Store layer.
    try {
      getPromptRepository().invalidateCache();
    } catch {
      // No-op if repository unavailable — adapter cache invalidation below
      // still helps.
    }

    // 2. Adapter layer.
    invalidatePromptCache();

    // 3. Routing snapshot.
    let snapshotError: string | null = null;
    try {
      await refreshRoutingPromptSnapshot();
    } catch (err) {
      snapshotError = err instanceof Error ? err.message : String(err);
    }

    // 4. Re-warm store cache for tracked keys.
    try {
      await warmPromptCacheFromStore();
    } catch {
      // warm failure is non-fatal — defaults still resolve.
    }

    // 5. /healthz cache: drop so the next probe re-evaluates.
    resetPromptsReadyCache();

    // 6. Post-reload detail — same vocabulary as /status.
    const keys = await buildKeyRows('reload');

    return reply.code(200).send({
      reload_ok: snapshotError === null,
      snapshot_error: snapshotError,
      keys,
    });
  });
}
