/**
 * Adapter-free model/provider resolution for the shared LLM router.
 *
 * This module owns precedence and capability validation only. It performs no
 * file, adapter, cache or network work, so runtime execution and admin status
 * can consume the same deterministic plan without admin constructing an
 * adapter or maintaining a second approximation of router behaviour.
 */

import {
  ModelAssignmentError,
  resolveModelAssignment,
  type ResolvedModelAssignment,
} from '../../config/model-assignment.js';
import { requireTaskModelAssignmentCapability } from '../../config/model-routing.js';
import {
  getModelBlockReason,
  isModelClientAllowed,
} from '../../config/models.js';

export type RouterProvider = 'anthropic' | 'openai' | 'fixtures';

export interface ProviderConfig {
  readonly defaults?: {
    readonly provider: RouterProvider;
    readonly model?: string;
  };
  readonly overrides?: Readonly<
    Record<
      string,
      {
        readonly provider: RouterProvider;
        readonly model?: string;
      }
    >
  >;
}

export type RouterResolutionSource =
  | 'per_call'
  | 'store_model_config'
  | 'env_var'
  | 'task_default'
  | 'providers_json'
  | 'llm_model_fallback';

export interface RouterResolutionInput {
  readonly task?: string;
  readonly modelOverride?: string;
  readonly origin?: 'per_call' | 'store_model_config';
  readonly failoverProviders?: readonly string[];
  readonly providersConfig?: ProviderConfig | null;
  readonly configuredProvider: RouterProvider;
  readonly globalModel?: string;
  readonly configuredTaskModel?: string;
  readonly configuredTaskModelSourceKey?: string;
  readonly taskDefault?: string;
  readonly taskDefaultSourceKey?: string;
  readonly providerDefaultModels: Readonly<Record<RouterProvider, string>>;
  readonly clientBlockedModels: readonly string[];
}

export interface RejectedFailoverProvider {
  readonly provider: string;
  readonly error: ModelAssignmentError;
}

export interface RouterFailoverAttempt {
  readonly requestedProviders: readonly string[];
  readonly acceptedAssignments: readonly ResolvedModelAssignment[];
  readonly rejectedProviders: readonly RejectedFailoverProvider[];
  readonly active: boolean;
}

interface RouterResolutionBase {
  readonly task?: string;
  readonly modelOverride?: string;
  readonly resolutionSource: RouterResolutionSource;
  readonly sourceKey: string;
  readonly failoverAttempt?: RouterFailoverAttempt;
}

export interface RouterSingleResolutionPlan extends RouterResolutionBase {
  readonly kind: 'single';
  readonly assignment: ResolvedModelAssignment;
}

export interface RouterFailoverResolutionPlan extends RouterResolutionBase {
  readonly kind: 'failover';
  readonly assignments: readonly ResolvedModelAssignment[];
}

export interface RouterResolutionFailure extends RouterResolutionBase {
  readonly kind: 'configuration_error';
  readonly model: string;
  readonly assignment?: ResolvedModelAssignment;
  readonly error: ModelAssignmentError;
}

export type RouterResolutionOutcome =
  | RouterSingleResolutionPlan
  | RouterFailoverResolutionPlan
  | RouterResolutionFailure;

function isRouterProvider(
  provider: string,
  providerDefaults: Readonly<Record<RouterProvider, string>>,
): provider is RouterProvider {
  return provider in providerDefaults;
}

function invalidProviderError(
  provider: string,
  model: string | undefined,
): ModelAssignmentError {
  return new ModelAssignmentError(
    'MODEL_PROVIDER_MISMATCH',
    model ?? '',
    `Configured provider '${provider}' is not a registered router provider.`,
  );
}

function resolveCandidate(
  task: string | undefined,
  provider: string,
  model: string | undefined,
  providerDefaults: Readonly<Record<RouterProvider, string>>,
):
  | { readonly assignment: ResolvedModelAssignment }
  | {
      readonly error: ModelAssignmentError;
      readonly assignment?: ResolvedModelAssignment;
    } {
  if (!isRouterProvider(provider, providerDefaults)) {
    return { error: invalidProviderError(provider, model) };
  }

  let assignment: ResolvedModelAssignment | undefined;
  try {
    assignment = resolveModelAssignment(model ?? providerDefaults[provider], {
      fixtures: provider === 'fixtures',
    });
    assignment = requireTaskModelAssignmentCapability(task, assignment);
    return { assignment };
  } catch (error) {
    if (!(error instanceof ModelAssignmentError)) throw error;
    return { error, assignment };
  }
}

function resolveFailoverAttempt(
  input: RouterResolutionInput,
): RouterFailoverAttempt | undefined {
  const requestedProviders = input.failoverProviders;
  if (!requestedProviders || requestedProviders.length === 0) return undefined;

  if (requestedProviders.length < 2) {
    return {
      requestedProviders: [...requestedProviders],
      acceptedAssignments: [],
      rejectedProviders: [],
      active: false,
    };
  }

  const acceptedAssignments: ResolvedModelAssignment[] = [];
  const rejectedProviders: RejectedFailoverProvider[] = [];
  for (const provider of requestedProviders) {
    const candidate = resolveCandidate(
      input.task,
      provider,
      undefined,
      input.providerDefaultModels,
    );
    if ('assignment' in candidate && !('error' in candidate)) {
      acceptedAssignments.push(candidate.assignment);
    } else {
      rejectedProviders.push({ provider, error: candidate.error });
    }
  }

  return {
    requestedProviders: [...requestedProviders],
    acceptedAssignments,
    rejectedProviders,
    active: acceptedAssignments.length >= 2,
  };
}

function failure(
  input: RouterResolutionInput,
  error: ModelAssignmentError,
  model: string,
  resolutionSource: RouterResolutionSource,
  sourceKey: string,
  assignment?: ResolvedModelAssignment,
  failoverAttempt?: RouterFailoverAttempt,
): RouterResolutionFailure {
  return {
    kind: 'configuration_error',
    task: input.task,
    modelOverride: input.modelOverride,
    model,
    assignment,
    error,
    resolutionSource,
    sourceKey,
    failoverAttempt,
  };
}

/** Resolve the exact router plan without constructing or calling an adapter. */
export function resolveRouterResolution(
  input: RouterResolutionInput,
): RouterResolutionOutcome {
  const failoverAttempt = resolveFailoverAttempt(input);
  if (failoverAttempt?.active) {
    return {
      kind: 'failover',
      task: input.task,
      modelOverride: input.modelOverride,
      assignments: failoverAttempt.acceptedAssignments,
      resolutionSource: 'llm_model_fallback',
      sourceKey: 'LLM_FAILOVER_PROVIDERS',
      failoverAttempt,
    };
  }

  let selectedProvider: string = input.configuredProvider;
  let selectedModel =
    input.globalModel && input.globalModel !== 'auto'
      ? input.globalModel
      : undefined;
  let resolutionSource: RouterResolutionSource = 'llm_model_fallback';
  let sourceKey = selectedModel
    ? 'LLM_MODEL'
    : `PROVIDER_DEFAULT_MODELS.${selectedProvider}`;

  const providerOverride =
    input.task && input.providersConfig?.overrides?.[input.task];
  if (providerOverride) {
    selectedProvider = providerOverride.provider;
    if (providerOverride.model) {
      selectedModel = providerOverride.model;
      resolutionSource = 'providers_json';
      sourceKey = `providers.json.overrides.${input.task}.model`;
    } else if (!selectedModel) {
      sourceKey = `PROVIDER_DEFAULT_MODELS.${selectedProvider}`;
    }
  } else if (input.providersConfig?.defaults) {
    selectedProvider = input.providersConfig.defaults.provider;
    if (input.providersConfig.defaults.model) {
      selectedModel = input.providersConfig.defaults.model;
      resolutionSource = 'providers_json';
      sourceKey = 'providers.json.defaults.model';
    } else if (!selectedModel) {
      sourceKey = `PROVIDER_DEFAULT_MODELS.${selectedProvider}`;
    }
  }

  if (input.modelOverride) {
    resolutionSource =
      input.origin === 'store_model_config' ? 'store_model_config' : 'per_call';
    sourceKey =
      input.origin === 'store_model_config'
        ? 'prompt.modelConfig'
        : 'request.modelOverride';

    const overrideCandidate = resolveCandidate(
      undefined,
      selectedProvider,
      input.modelOverride,
      input.providerDefaultModels,
    );
    if ('error' in overrideCandidate) {
      return failure(
        input,
        overrideCandidate.error,
        input.modelOverride,
        resolutionSource,
        sourceKey,
        overrideCandidate.assignment,
        failoverAttempt,
      );
    }

    if (
      overrideCandidate.assignment.provider !== 'fixtures' &&
      !isModelClientAllowed(input.modelOverride, [...input.clientBlockedModels])
    ) {
      const reason = getModelBlockReason(
        input.modelOverride,
        [...input.clientBlockedModels],
      );
      return failure(
        input,
        new ModelAssignmentError(
          'MODEL_CLIENT_BLOCKED',
          input.modelOverride,
          reason ?? `Model '${input.modelOverride}' is blocked for client use.`,
        ),
        input.modelOverride,
        resolutionSource,
        sourceKey,
        overrideCandidate.assignment,
        failoverAttempt,
      );
    }

    selectedModel = input.modelOverride;
  } else if (input.configuredTaskModel) {
    selectedModel = input.configuredTaskModel;
    resolutionSource = 'env_var';
    sourceKey = input.configuredTaskModelSourceKey ?? 'config.cee.models';
  } else if (input.taskDefault) {
    selectedModel = input.taskDefault;
    resolutionSource = 'task_default';
    sourceKey = input.taskDefaultSourceKey ?? 'TASK_MODEL_DEFAULTS';
  }

  if (!isRouterProvider(selectedProvider, input.providerDefaultModels)) {
    const error = invalidProviderError(selectedProvider, selectedModel);
    return failure(
      input,
      error,
      selectedModel ?? '',
      resolutionSource,
      sourceKey,
      undefined,
      failoverAttempt,
    );
  }

  const effectiveModel =
    selectedModel ?? input.providerDefaultModels[selectedProvider];
  if (!selectedModel) {
    resolutionSource = 'llm_model_fallback';
    sourceKey = `PROVIDER_DEFAULT_MODELS.${selectedProvider}`;
  }

  const candidate = resolveCandidate(
    input.task,
    selectedProvider,
    effectiveModel,
    input.providerDefaultModels,
  );
  if ('error' in candidate) {
    return failure(
      input,
      candidate.error,
      effectiveModel,
      resolutionSource,
      sourceKey,
      candidate.assignment,
      failoverAttempt,
    );
  }

  return {
    kind: 'single',
    task: input.task,
    modelOverride: input.modelOverride,
    assignment: candidate.assignment,
    resolutionSource,
    sourceKey,
    failoverAttempt,
  };
}
