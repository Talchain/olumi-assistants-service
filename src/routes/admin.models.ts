/**
 * Admin Model Routing Routes
 *
 * Exposes the resolved model-per-task configuration so operators can see
 * exactly which model each task will use without digging through env vars.
 *
 * Resolution order (mirrors router.ts getAdapter logic):
 *   1. CEE_MODEL_* env var override — always applied regardless of provider
 *   2. checked-in task default — always applied; provider follows the winning model
 *
 * Routes:
 * - GET /admin/models/routing  - Resolved model for every live task assignment
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyAdminKey } from '../middleware/admin-auth.js';
import { AUXILIARY_MODEL_DEFAULTS, TASK_MODEL_DEFAULTS } from '../config/model-routing.js';
import type { AuxiliaryModelTask, CeeTask } from '../config/model-routing.js';
import { getModelProvider } from '../config/models.js';
import { config } from '../config/index.js';
import { TASK_TO_CONFIG_KEY } from '../adapters/llm/router.js';

type ModelSource = 'env_override' | 'default';

interface TaskRouting {
  task: CeeTask | AuxiliaryModelTask;
  /** Resolved model ID. */
  model: string;
  /** Provider derived from the winning model. */
  provider: string;
  source: ModelSource;
}

/**
 * Resolve the effective LLM provider from config.
 * Returns 'openai' as the hard-coded default (matches router.ts DEFAULT_PROVIDER).
 */
function resolveConfiguredProvider(): string {
  try {
    return config.llm.provider || 'openai';
  } catch {
    return 'openai';
  }
}

/**
 * Resolve the model and source for a single task.
 *
 * Replicates router.ts getAdapter() precedence for the task default path:
 * 1. CEE_MODEL_* env override — unconditionally applied (no provider check)
 * 2. TASK_MODEL_DEFAULTS — unconditionally applied; provider is derived from
 *    the model registry, exactly as the router's provider reconciliation does
 *
 * Note: providers.json config-file overrides and request-time overrides are
 * not reflected here — those are per-request and not determinable statically.
 */
function resolveTaskRouting(task: CeeTask | AuxiliaryModelTask): TaskRouting {
  // Consume the router's table directly. The former local copy omitted the
  // live validation and gated M2 tasks while claiming to mirror runtime.
  const ceeModelKey = task === 'extraction' ? 'extraction' : TASK_TO_CONFIG_KEY[task];

  // Step 1: CEE_MODEL_* env var override — applied unconditionally
  if (ceeModelKey) {
    try {
      const envModel = config.cee.models[ceeModelKey];
      if (envModel) {
        const provider = getModelProvider(envModel) ?? 'unknown';
        return { task, model: envModel, provider, source: 'env_override' };
      }
    } catch {
      // Config unavailable — fall through
    }
  }

  // Step 2: TASK_MODEL_DEFAULTS. LLM_PROVIDER is a lower-precedence fallback,
  // not permission to discard a cross-provider task assignment.
  const taskDefault = task === 'extraction'
    ? AUXILIARY_MODEL_DEFAULTS.extraction
    : TASK_MODEL_DEFAULTS[task];
  return {
    task,
    model: taskDefault,
    provider: getModelProvider(taskDefault) ?? 'unknown',
    source: 'default',
  };
}

/**
 * Admin model routing routes
 */
export async function adminModelRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/models/routing
   *
   * Returns the resolved model for every routed or dedicated-adapter task along
   * with provider and source.
   * Requires admin key (read permission is sufficient).
   *
   * Note: providers.json task overrides and per-request model overrides are not
   * reflected — those are dynamic. This endpoint shows the static default resolution.
   */
  app.get('/admin/models/routing', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const configuredProvider = resolveConfiguredProvider();
    const tasks: Array<CeeTask | AuxiliaryModelTask> = [
      ...(Object.keys(TASK_MODEL_DEFAULTS) as CeeTask[]),
      ...(Object.keys(AUXILIARY_MODEL_DEFAULTS) as AuxiliaryModelTask[]),
    ];
    const taskList = tasks.map((task) => resolveTaskRouting(task));

    return reply
      .header('Cache-Control', 'no-store')
      .status(200)
      .send({
        tasks: taskList,
        default_provider: configuredProvider,
        timestamp: new Date().toISOString(),
      });
  });
}
