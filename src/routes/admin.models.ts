/**
 * Admin Model Routing Routes
 *
 * Exposes the resolved model-per-task configuration so operators can see
 * exactly which model each task will use without digging through env vars.
 *
 * Resolution order mirrors each task's actual static runtime authority:
 *   1. CEE_MODEL_* env override, when that task has one
 *   2. checked-in task/dedicated default, when that task has one
 *   3. LLM_MODEL or the selected LLM_PROVIDER's adapter default for router
 *      tasks that intentionally have no checked-in task default
 *
 * Routes:
 * - GET /admin/models/routing  - Resolved model for every reported task authority
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyAdminKey } from '../middleware/admin-auth.js';
import {
  AI_TASK_LIFECYCLE,
  AUXILIARY_MODEL_DEFAULTS,
  EXECUTABLE_RUNTIME_TASKS,
  getAiTaskRuntimeAvailability,
  hasAiTaskExecutablePath,
  RUNTIME_AI_TASK_AUTHORITY,
  TASK_MODEL_DEFAULTS,
} from '../config/model-routing.js';
import type {
  CeeTask,
  ExecutableDedicatedRuntimeTask,
  ExecutableRuntimeTask,
} from '../config/model-routing.js';
import {
  ModelAssignmentError,
  requireModelAssignmentProvider,
  resolveModelAssignment,
  type ModelAssignmentAvailability,
  type ResolvedModelAssignment,
} from '../config/model-assignment.js';
import { config } from '../config/index.js';
import {
  PROVIDER_DEFAULT_MODELS,
  TASK_TO_CONFIG_KEY,
} from '../adapters/llm/router.js';

type ModelSource =
  | 'env_override'
  | 'default'
  | 'global_model'
  | 'provider_default';
type ReportedModelTask = CeeTask | ExecutableRuntimeTask;
type RouterFallbackRuntimeTask = Exclude<
  Exclude<ExecutableRuntimeTask, CeeTask>,
  ExecutableDedicatedRuntimeTask
>;
type ConfiguredProvider = keyof typeof PROVIDER_DEFAULT_MODELS;

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
  /** Exact environment, checked-in, global, or provider authority for `model`. */
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

interface RouterFallbackModelChain {
  readonly configuredModel?: () => string | undefined;
  readonly envKey?: string;
  readonly requiredProvider?: 'anthropic';
}

/**
 * Exact chains for executable router paths with no TASK_MODEL_DEFAULTS row.
 * The type is the exhaustiveness guard: a new non-default, non-dedicated
 * runtime path must declare its real static chain here.
 */
const ROUTER_FALLBACK_MODEL_CHAINS: Record<
  RouterFallbackRuntimeTask,
  RouterFallbackModelChain
> = {
  clarify_brief: {
    configuredModel: () => config.cee.models.clarification,
    envKey: 'CEE_MODEL_CLARIFICATION',
  },
  explain_diff: {
    // The fixture adapter has an implementation; real provider execution is
    // Anthropic-only until OpenAI implements explainDiff.
    requiredProvider: 'anthropic',
  },
};

/**
 * Resolve the effective LLM provider from config.
 * Returns 'openai' as the hard-coded default (matches router.ts DEFAULT_PROVIDER).
 */
function resolveConfiguredProvider(): ConfiguredProvider {
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
  fixtureExecution = false,
): TaskRouting {
  let assignment: ResolvedModelAssignment | undefined;
  try {
    assignment = resolveModelAssignment(model, { fixtures: fixtureExecution });
    if (requiredProvider && assignment.provider !== 'fixtures') {
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
  return task in DEDICATED_MODEL_CHAINS;
}

function isRouterFallbackTask(
  task: ReportedModelTask,
): task is RouterFallbackRuntimeTask {
  return task in ROUTER_FALLBACK_MODEL_CHAINS;
}

function isTaskWithCheckedInDefault(
  task: ReportedModelTask,
): task is CeeTask {
  return task in TASK_MODEL_DEFAULTS;
}

function resolveRouterFallbackRouting(
  task: RouterFallbackRuntimeTask,
): TaskRouting {
  const chain = ROUTER_FALLBACK_MODEL_CHAINS[task];
  const configuredProvider = resolveConfiguredProvider();
  let configuredModel: string | undefined;
  if (chain.configuredModel) {
    try {
      configuredModel = chain.configuredModel();
    } catch {
      configuredModel = undefined;
    }
  }

  // This matches router getModelFromConfig(): empty is unset, while non-empty
  // whitespace reaches the shared resolver and fails as MODEL_ID_EMPTY.
  if (configuredModel && chain.envKey) {
    return routingFromAssignment(
      task,
      configuredModel,
      'env_override',
      chain.envKey,
      chain.requiredProvider,
      configuredProvider === 'fixtures',
    );
  }

  let globalModel: string | undefined;
  try {
    globalModel = config.llm.model;
  } catch {
    globalModel = undefined;
  }

  const explicitGlobalModel =
    globalModel && globalModel !== 'auto' ? globalModel : undefined;
  const model =
    explicitGlobalModel ?? PROVIDER_DEFAULT_MODELS[configuredProvider];

  return routingFromAssignment(
    task,
    model,
    explicitGlobalModel ? 'global_model' : 'provider_default',
    explicitGlobalModel
      ? 'LLM_MODEL'
      : `PROVIDER_DEFAULT_MODELS.${configuredProvider}`,
    chain.requiredProvider,
    configuredProvider === 'fixtures',
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

  if (isRouterFallbackTask(task)) {
    return resolveRouterFallbackRouting(task);
  }

  if (!isTaskWithCheckedInDefault(task)) {
    throw new Error(`No static model-routing authority for task '${task}'.`);
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
      ...EXECUTABLE_RUNTIME_TASKS,
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
