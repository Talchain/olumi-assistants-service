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
import {
  AI_TASK_LIFECYCLE,
  AUXILIARY_MODEL_DEFAULTS,
  EXECUTABLE_DEDICATED_RUNTIME_TASKS,
  getAiTaskRuntimeAvailability,
  hasAiTaskExecutablePath,
  RUNTIME_AI_TASK_AUTHORITY,
  TASK_MODEL_DEFAULTS,
} from '../config/model-routing.js';
import type {
  CeeTask,
  ExecutableDedicatedRuntimeTask,
} from '../config/model-routing.js';
import {
  ModelAssignmentError,
  requireModelAssignmentProvider,
  resolveModelAssignment,
  type ModelAssignmentAvailability,
  type ResolvedModelAssignment,
} from '../config/model-assignment.js';
import { config } from '../config/index.js';
import { TASK_TO_CONFIG_KEY } from '../adapters/llm/router.js';

type ModelSource = 'env_override' | 'default';
type ReportedModelTask = CeeTask | ExecutableDedicatedRuntimeTask;

interface TaskRouting {
  task: ReportedModelTask;
  /** Resolved model ID. */
  model: string;
  /** Provider derived from the winning model. */
  provider: string;
  availability: ModelAssignmentAvailability | 'configuration_error';
  registry_model_id: string | null;
  configuration_error?: {
    code: string;
    message: string;
  };
  executable: boolean;
  has_executable_path: boolean;
  lifecycle_state: string;
  /** Static executable path is separate from default-off feature gates. */
  runtime_availability:
    | 'available'
    | 'feature_gated_default_off'
    | 'not_executable';
  source: ModelSource;
  /** Exact env/default authority that supplied `model`. */
  source_key: string;
}

interface DedicatedModelChain {
  readonly configuredModel: () => string | undefined;
  readonly envKey: string;
  readonly defaultModel: string;
  readonly defaultKey: string;
  readonly whitespaceMeansUnset: boolean;
  readonly requiredProvider?: 'anthropic';
}

/**
 * Compile-time exhaustive over every executable dedicated runtime authority.
 * Adding another such row cannot silently disappear from the reporting route:
 * TypeScript requires its concrete resolution chain here, while the route's
 * task list is derived from the runtime map below.
 */
const DEDICATED_MODEL_CHAINS: Record<
  ExecutableDedicatedRuntimeTask,
  DedicatedModelChain
> = {
  extraction: {
    configuredModel: () => config.cee.models.extraction,
    envKey: 'CEE_MODEL_EXTRACTION',
    defaultModel: AUXILIARY_MODEL_DEFAULTS.extraction,
    defaultKey: 'AUXILIARY_MODEL_DEFAULTS.extraction',
    whitespaceMeansUnset: false,
  },
  rolling_summary: {
    configuredModel: () => config.cee.models.summary,
    envKey: 'CEE_MODEL_SUMMARY',
    defaultModel: RUNTIME_AI_TASK_AUTHORITY.rolling_summary.checkedInModel,
    defaultKey: 'DEFAULT_SUMMARY_MODEL',
    whitespaceMeansUnset: true,
    requiredProvider: 'anthropic',
  },
  decision_review_decompose: {
    configuredModel: () => config.cee.models.decision_review_haiku,
    envKey: 'CEE_MODEL_DECISION_REVIEW_HAIKU',
    defaultModel:
      RUNTIME_AI_TASK_AUTHORITY.decision_review_decompose.checkedInModel,
    defaultKey: 'DEFAULT_DECOMPOSE_MODEL',
    whitespaceMeansUnset: true,
    requiredProvider: 'anthropic',
  },
};

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
function routingFromAssignment(
  task: ReportedModelTask,
  model: string,
  source: ModelSource,
  sourceKey: string,
  requiredProvider?: 'anthropic',
): TaskRouting {
  let assignment: ResolvedModelAssignment | undefined;
  try {
    assignment = resolveModelAssignment(model);
    if (requiredProvider) {
      assignment = requireModelAssignmentProvider(
        assignment,
        requiredProvider,
      );
    }
    return {
      task,
      model: assignment.model,
      provider: assignment.provider,
      availability: assignment.availability,
      registry_model_id: assignment.registryModelId,
      executable: AI_TASK_LIFECYCLE[task].executable,
      has_executable_path: hasAiTaskExecutablePath(task),
      lifecycle_state: AI_TASK_LIFECYCLE[task].state,
      runtime_availability: getAiTaskRuntimeAvailability(task),
      source,
      source_key: sourceKey,
    };
  } catch (error) {
    if (!(error instanceof ModelAssignmentError)) throw error;
    return {
      task,
      model,
      provider: assignment?.provider ?? 'unresolved',
      availability: 'configuration_error',
      registry_model_id: assignment?.registryModelId ?? null,
      configuration_error: {
        code: error.code,
        message: error.message,
      },
      executable: AI_TASK_LIFECYCLE[task].executable,
      has_executable_path: hasAiTaskExecutablePath(task),
      lifecycle_state: AI_TASK_LIFECYCLE[task].state,
      runtime_availability: getAiTaskRuntimeAvailability(task),
      source,
      source_key: sourceKey,
    };
  }
}

function isExecutableDedicatedTask(
  task: ReportedModelTask,
): task is ExecutableDedicatedRuntimeTask {
  return EXECUTABLE_DEDICATED_RUNTIME_TASKS.includes(
    task as ExecutableDedicatedRuntimeTask,
  );
}

/** Exact reporting resolution for one static task authority. */
export function resolveTaskRouting(task: ReportedModelTask): TaskRouting {
  if (isExecutableDedicatedTask(task)) {
    const chain = DEDICATED_MODEL_CHAINS[task];
    let configured: string | undefined;
    try {
      configured = chain.configuredModel();
    } catch {
      configured = undefined;
    }
    if (
      configured !== undefined &&
      (!chain.whitespaceMeansUnset || configured.trim().length > 0)
    ) {
      return routingFromAssignment(
        task,
        configured,
        'env_override',
        chain.envKey,
        chain.requiredProvider,
      );
    }
    return routingFromAssignment(
      task,
      chain.defaultModel,
      'default',
      chain.defaultKey,
      chain.requiredProvider,
    );
  }

  // Consume the router's table directly. The former local copy omitted the
  // live validation and gated M2 tasks while claiming to mirror runtime.
  const ceeModelKey = TASK_TO_CONFIG_KEY[task];

  // Step 1: CEE_MODEL_* env var override — applied unconditionally
  if (ceeModelKey) {
    try {
      const envModel = config.cee.models[ceeModelKey];
      if (envModel) {
        return routingFromAssignment(
          task,
          envModel,
          'env_override',
          `config.cee.models.${ceeModelKey}`,
        );
      }
    } catch {
      // Config unavailable — fall through
    }
  }

  // Step 2: TASK_MODEL_DEFAULTS. LLM_PROVIDER is a lower-precedence fallback,
  // not permission to discard a cross-provider task assignment.
  return routingFromAssignment(
    task,
    TASK_MODEL_DEFAULTS[task],
    'default',
    `TASK_MODEL_DEFAULTS.${task}`,
  );
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
    const tasks = [...new Set<ReportedModelTask>([
      ...(Object.keys(TASK_MODEL_DEFAULTS) as CeeTask[]),
      ...EXECUTABLE_DEDICATED_RUNTIME_TASKS,
    ])];
    const taskList = tasks.map((task) => resolveTaskRouting(task));

    return reply
      .header('Cache-Control', 'no-store')
      .status(200)
      .send({
        tasks: taskList,
        task_lifecycle: AI_TASK_LIFECYCLE,
        default_provider: configuredProvider,
        timestamp: new Date().toISOString(),
      });
  });
}
