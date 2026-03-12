/**
 * Admin Model Routing Routes
 *
 * Exposes the resolved model-per-task configuration so operators can see
 * exactly which model each task will use without digging through env vars.
 *
 * Resolution order (mirrors router.ts getAdapter logic):
 *   1. CEE_MODEL_* env var override — always applied regardless of provider
 *   2. TASK_MODEL_DEFAULTS — only when task default's provider matches LLM_PROVIDER
 *      (mirrors router.ts:731–748: skips task default on provider mismatch)
 *   3. Skipped (provider mismatch) — model reported as null, resolution_note explains why
 *
 * Routes:
 * - GET /admin/models/routing  - Resolved model for every CeeTask
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyAdminKey } from '../middleware/admin-auth.js';
import { TASK_MODEL_DEFAULTS } from '../config/model-routing.js';
import type { CeeTask } from '../config/model-routing.js';
import { getModelProvider } from '../config/models.js';
import { config } from '../config/index.js';

/**
 * Map from CeeTask key → config.cee.models property name.
 * Kept in sync with TASK_TO_CONFIG_KEY in router.ts.
 */
const TASK_TO_CEE_MODEL_KEY: Partial<Record<CeeTask, keyof typeof config.cee.models>> = {
  draft_graph: 'draft',
  suggest_options: 'options',
  repair_graph: 'repair',
  clarification: 'clarification',
  critique_graph: 'critique',
  decision_review: 'decision_review',
  orchestrator: 'orchestrator',
  edit_graph: 'edit_graph',
};

type ModelSource = 'env_override' | 'default' | 'provider_mismatch';

interface TaskRouting {
  task: CeeTask;
  /** Resolved model ID, or null when task default was skipped due to provider mismatch */
  model: string | null;
  /** Provider derived from model registry, or the configured LLM_PROVIDER when model is null */
  provider: string;
  source: ModelSource;
  /** Human-readable explanation when source is 'provider_mismatch' */
  resolution_note?: string;
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
 * 2. TASK_MODEL_DEFAULTS — only when task default provider matches configured provider
 *    (mirrors router.ts:737–748 provider-mismatch guard)
 * 3. Provider mismatch — task default skipped; model is null
 *
 * Note: providers.json config-file overrides and request-time overrides are
 * not reflected here — those are per-request and not determinable statically.
 */
function resolveTaskModel(task: CeeTask, configuredProvider: string): TaskRouting {
  const ceeModelKey = TASK_TO_CEE_MODEL_KEY[task];

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

  // Step 2: TASK_MODEL_DEFAULTS — only if provider matches (mirrors router.ts:737–738)
  const taskDefault = TASK_MODEL_DEFAULTS[task];
  const taskDefaultProvider = getModelProvider(taskDefault);

  const providerMatches =
    configuredProvider === 'fixtures' ||
    !taskDefaultProvider ||
    taskDefaultProvider === configuredProvider;

  if (providerMatches) {
    const provider = taskDefaultProvider ?? configuredProvider;
    return { task, model: taskDefault, provider, source: 'default' };
  }

  // Step 3: Provider mismatch — task default skipped, runtime will use LLM_MODEL env fallback
  return {
    task,
    model: null,
    provider: configuredProvider,
    source: 'provider_mismatch',
    resolution_note: `Task default (${taskDefault}, ${taskDefaultProvider}) skipped: LLM_PROVIDER=${configuredProvider}. Runtime uses LLM_MODEL env fallback.`,
  };
}

/**
 * Admin model routing routes
 */
export async function adminModelRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/models/routing
   *
   * Returns the resolved model for every CeeTask along with provider and source.
   * Requires admin key (read permission is sufficient).
   *
   * Note: providers.json task overrides and per-request model overrides are not
   * reflected — those are dynamic. This endpoint shows the static default resolution.
   */
  app.get('/admin/models/routing', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const configuredProvider = resolveConfiguredProvider();
    const tasks = Object.keys(TASK_MODEL_DEFAULTS) as CeeTask[];
    const taskList = tasks.map((task) => resolveTaskModel(task, configuredProvider));

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
