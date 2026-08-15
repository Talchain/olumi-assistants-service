/**
 * One validated model → provider assignment seam.
 *
 * A model is callable only when it is either an enabled exact registry entry
 * or an explicitly declared provider alias below. Unknown strings never borrow
 * LLM_PROVIDER and never use a name-pattern heuristic to guess a provider.
 */

import { MODEL_REGISTRY, type ModelConfig, type ModelProvider } from './models.js';
import {
  EXPLICIT_MODEL_ALIASES,
  type ExplicitModelAlias,
} from './model-aliases.js';

export { EXPLICIT_MODEL_ALIASES } from './model-aliases.js';
export type ModelAssignmentAvailability =
  | 'registry_enabled'
  | 'explicit_alias'
  | 'fixture_only';

export interface ResolvedModelAssignment {
  /** Exact id sent to the provider. Aliases are deliberately not rewritten. */
  readonly model: string;
  /** Runtime adapter provider. */
  readonly provider: ModelProvider | 'fixtures';
  /** Provider declared by the registry (also present for fixture execution). */
  readonly declaredProvider: ModelProvider | null;
  /** Exact registry row that validates the id or its explicit alias target. */
  readonly registryModelId: string | null;
  /** This is configuration availability, not a claim about a remote API. */
  readonly availability: ModelAssignmentAvailability;
  readonly config: ModelConfig | null;
}

export type ModelAssignmentErrorCode =
  | 'MODEL_ID_EMPTY'
  | 'MODEL_NOT_REGISTERED'
  | 'MODEL_DISABLED'
  | 'MODEL_ALIAS_TARGET_INVALID'
  | 'MODEL_CLIENT_BLOCKED';

export class ModelAssignmentError extends Error {
  readonly name = 'ModelAssignmentError';

  constructor(
    readonly code: ModelAssignmentErrorCode,
    readonly model: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ResolveModelAssignmentOptions {
  /** Fixtures execute no remote model; unknown ids are safe only in this mode. */
  readonly fixtures?: boolean;
}

function enabledConfig(model: string): ModelConfig | null {
  return MODEL_REGISTRY[model] ?? null;
}

export function resolveModelAssignment(
  modelId: string,
  options: ResolveModelAssignmentOptions = {},
): ResolvedModelAssignment {
  const model = modelId.trim();
  if (model.length === 0) {
    throw new ModelAssignmentError(
      'MODEL_ID_EMPTY',
      modelId,
      'Model id is empty; configure an exact registered model or explicit alias.',
    );
  }

  const exact = enabledConfig(model);
  if (exact) {
    if (!exact.enabled) {
      throw new ModelAssignmentError(
        'MODEL_DISABLED',
        model,
        `Model '${model}' is registered but disabled.`,
      );
    }
    return {
      model,
      provider: options.fixtures ? 'fixtures' : exact.provider,
      declaredProvider: exact.provider,
      registryModelId: exact.id,
      availability: options.fixtures ? 'fixture_only' : 'registry_enabled',
      config: exact,
    };
  }

  const aliasTarget = EXPLICIT_MODEL_ALIASES[model as ExplicitModelAlias];
  if (aliasTarget) {
    const target = enabledConfig(aliasTarget);
    if (!target || !target.enabled) {
      throw new ModelAssignmentError(
        'MODEL_ALIAS_TARGET_INVALID',
        model,
        `Explicit model alias '${model}' targets unavailable registry row '${aliasTarget}'.`,
      );
    }
    return {
      model,
      provider: options.fixtures ? 'fixtures' : target.provider,
      declaredProvider: target.provider,
      registryModelId: target.id,
      availability: options.fixtures ? 'fixture_only' : 'explicit_alias',
      config: target,
    };
  }

  if (options.fixtures) {
    return {
      model,
      provider: 'fixtures',
      declaredProvider: null,
      registryModelId: null,
      availability: 'fixture_only',
      config: null,
    };
  }

  throw new ModelAssignmentError(
    'MODEL_NOT_REGISTERED',
    model,
    `Model '${model}' is neither an enabled registry entry nor an explicit alias.`,
  );
}
