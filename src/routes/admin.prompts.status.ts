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
  app.get('/admin/prompts/inventory', async (request, reply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;
    const inventory = await buildPromptEstateInventory();
    return reply.code(200).send(inventory);
  });

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
