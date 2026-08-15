/**
 * Admin Model Routing Routes
 *
 * Exposes the resolved model-per-task configuration so operators can see
 * exactly which model each task will use without digging through env vars.
 *
 * Router rows consume the same adapter-free plan as runtime: active failover,
 * providers config, CEE_MODEL_*, task defaults, and global/provider fallback.
 * Dedicated extraction and direct-Anthropic rows retain their own explicit
 * chains because they do not execute through the router.
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
  resolveConfiguredRouterPlan,
} from '../adapters/llm/router.js';
import type {
  RouterResolutionOutcome,
  RouterResolutionSource,
} from '../adapters/llm/router-resolution.js';

type ModelSource =
  | 'env_override'
  | 'default'
  | 'global_model'
  | 'provider_default'
  | 'providers_config'
  | 'failover'
  | 'per_call'
  | 'store_model_config';
type ReportedModelTask = CeeTask | ExecutableRuntimeTask;
type ConfiguredProvider = 'anthropic' | 'openai' | 'fixtures';

interface ReportedFailoverAssignment {
  model: string;
  provider: string;
  availability: ModelAssignmentAvailability;
  registry_model_id: string | null;
}

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
  /** Ordered providers/models attempted by the active failover wrapper. */
  failover_chain?: ReportedFailoverAssignment[];
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
function resolveConfiguredProvider(): ConfiguredProvider {
  try {
    return config.llm.provider || 'openai';
  } catch {
    return 'openai';
  }
}

/** Resolve one dedicated (non-router) model authority. */
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

function routerModelSource(
  source: RouterResolutionSource,
  sourceKey: string,
  failover: boolean,
): ModelSource {
  if (failover) return 'failover';
  switch (source) {
    case 'per_call':
      return 'per_call';
    case 'store_model_config':
      return 'store_model_config';
    case 'env_var':
      return 'env_override';
    case 'task_default':
      return 'default';
    case 'providers_json':
      return 'providers_config';
    case 'llm_model_fallback':
      return sourceKey === 'LLM_MODEL' ? 'global_model' : 'provider_default';
  }
}

function routingFromRouterOutcome(
  task: ReportedModelTask,
  outcome: RouterResolutionOutcome,
): TaskRouting {
  const lifecycle = {
    executable: AI_TASK_LIFECYCLE[task].executable,
    has_executable_path: hasAiTaskExecutablePath(task),
    lifecycle_state: AI_TASK_LIFECYCLE[task].state,
    runtime_availability: getAiTaskRuntimeAvailability(task),
  } as const;
  const source = routerModelSource(
    outcome.resolutionSource,
    outcome.sourceKey,
    outcome.kind === 'failover',
  );

  if (outcome.kind === 'configuration_error') {
    return {
      task,
      model: outcome.model,
      provider: outcome.assignment?.provider ?? 'unresolved',
      availability: 'configuration_error',
      registry_model_id: outcome.assignment?.registryModelId ?? null,
      configuration_error: {
        code: outcome.error.code,
        message: outcome.error.message,
      },
      ...lifecycle,
      source,
      source_key: outcome.sourceKey,
    };
  }

  if (outcome.kind === 'failover') {
    const primary = outcome.assignments[0]!;
    return {
      task,
      model: primary.model,
      provider: primary.provider,
      availability: primary.availability,
      registry_model_id: primary.registryModelId,
      ...lifecycle,
      source,
      source_key: outcome.sourceKey,
      failover_chain: outcome.assignments.map((assignment) => ({
        model: assignment.model,
        provider: assignment.provider,
        availability: assignment.availability,
        registry_model_id: assignment.registryModelId,
      })),
    };
  }

  return {
    task,
    model: outcome.assignment.model,
    provider: outcome.assignment.provider,
    availability: outcome.assignment.availability,
    registry_model_id: outcome.assignment.registryModelId,
    ...lifecycle,
    source,
    source_key: outcome.sourceKey,
  };
}

/** Exact reporting resolution for one static task authority. */
export function resolveTaskRouting(task: ReportedModelTask): TaskRouting {
  if (isExecutableDedicatedTask(task)) {
    const chain = DEDICATED_MODEL_CHAINS[task];
    const fixtureExecution =
      task === 'extraction' && resolveConfiguredProvider() === 'fixtures';
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
        fixtureExecution,
      );
    }
    return routingFromAssignment(
      task,
      chain.defaultModel,
      'default',
      chain.defaultKey,
      chain.requiredProvider,
      fixtureExecution,
    );
  }

  return routingFromRouterOutcome(task, resolveConfiguredRouterPlan(task));
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
   * The current providers config and failover policy are reflected. Per-call
   * and prompt-store overrides remain request-specific and therefore are not
   * represented by this no-request status endpoint.
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
