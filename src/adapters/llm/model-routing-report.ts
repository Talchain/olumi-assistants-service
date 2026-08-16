/**
 * Adapter-free reporting projection for model routing.
 *
 * Runtime routing, startup diagnostics and the admin status route all consume
 * this seam. It constructs no adapter and performs no network work. Historical
 * `CEE_MODEL_TASK_*` inventory is deliberately absent because it has no
 * executable router consumer.
 *
 * Authority disposition:
 * - KEEP: the shared runtime router, registry and full admin status rows.
 * - REPLACE: startup's former parallel resolver and hand-built server map.
 * - QUARANTINE: historical `CEE_MODEL_TASK_*` keys as inert boot inventory.
 * - REMOVE: serving precedence/claims from that inert tier and from non-live
 *   compatibility, gated and configuration-error rows.
 */

import {
  AI_TASK_LIFECYCLE,
  AUXILIARY_MODEL_DEFAULTS,
  EXECUTABLE_RUNTIME_TASKS,
  getAiTaskRuntimeAvailability,
  hasAiTaskExecutablePath,
  RUNTIME_AI_TASK_AUTHORITY,
  TASK_MODEL_DEFAULTS,
} from '../../config/model-routing.js';
import type {
  CeeTask,
  ExecutableDedicatedRuntimeTask,
  ExecutableRuntimeTask,
} from '../../config/model-routing.js';
import {
  ModelAssignmentError,
  requireModelAssignmentProvider,
  resolveModelAssignment,
  type ModelAssignmentAvailability,
  type ResolvedModelAssignment,
} from '../../config/model-assignment.js';
import { config } from '../../config/index.js';
import { resolveConfiguredRouterPlan } from './router.js';
import type {
  RouterResolutionOutcome,
  RouterResolutionSource,
} from './router-resolution.js';

export type ModelRoutingSource =
  | 'env_override'
  | 'default'
  | 'global_model'
  | 'provider_default'
  | 'providers_config'
  | 'failover'
  | 'per_call'
  | 'store_model_config';
export type ReportedModelTask = CeeTask | ExecutableRuntimeTask;
export type ConfiguredProvider = 'anthropic' | 'openai' | 'fixtures';

export interface ReportedFailoverAssignment {
  model: string;
  provider: string;
  availability: ModelAssignmentAvailability;
  registry_model_id: string | null;
}

export interface TaskRouting {
  task: ReportedModelTask;
  model: string;
  provider: string;
  availability: ModelAssignmentAvailability | 'configuration_error';
  registry_model_id: string | null;
  configuration_error?: { code: string; message: string };
  executable: boolean;
  has_executable_path: boolean;
  lifecycle_state: string;
  runtime_availability:
    | 'available'
    | 'feature_gated_default_off'
    | 'not_executable';
  source: ModelRoutingSource;
  source_key: string;
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

export function resolveConfiguredProvider(): ConfiguredProvider {
  try {
    return config.llm.provider || 'openai';
  } catch {
    return 'openai';
  }
}

function routingFromAssignment(
  task: ReportedModelTask,
  model: string,
  source: ModelRoutingSource,
  sourceKey: string,
  requiredProvider?: 'anthropic',
  fixtureExecution = false,
): TaskRouting {
  let assignment: ResolvedModelAssignment | undefined;
  try {
    assignment = resolveModelAssignment(model, { fixtures: fixtureExecution });
    if (requiredProvider && assignment.provider !== 'fixtures') {
      assignment = requireModelAssignmentProvider(assignment, requiredProvider);
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
      configuration_error: { code: error.code, message: error.message },
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
): ModelRoutingSource {
  if (failover) return 'failover';
  switch (source) {
    case 'per_call': return 'per_call';
    case 'store_model_config': return 'store_model_config';
    case 'env_var': return 'env_override';
    case 'task_default': return 'default';
    case 'providers_json': return 'providers_config';
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

/** Complete reporting set: compatibility rows plus every executable path. */
export function getReportedModelTasks(): readonly ReportedModelTask[] {
  return [...new Set<ReportedModelTask>([
    ...(Object.keys(TASK_MODEL_DEFAULTS) as CeeTask[]),
    ...EXECUTABLE_RUNTIME_TASKS,
  ])];
}

export interface ModelRoutingSnapshot {
  readonly tasks: readonly TaskRouting[];
  readonly default_provider: ConfiguredProvider;
}

export function resolveModelRoutingSnapshot(): ModelRoutingSnapshot {
  return {
    tasks: getReportedModelTasks().map((task) => resolveTaskRouting(task)),
    default_provider: resolveConfiguredProvider(),
  };
}

/**
 * Current effective serving projection for startup health. Static-but-gated,
 * inert/display rows and configuration errors remain visible in the full
 * snapshot but must never be presented as effective live assignments.
 */
export function buildEffectiveTaskModels(
  snapshot: ModelRoutingSnapshot,
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    snapshot.tasks
      .filter((row) =>
        row.has_executable_path &&
        row.runtime_availability === 'available' &&
        row.availability !== 'configuration_error')
      .map((row) => [row.task, row.model]),
  ));
}
