import { describe, expect, it } from 'vitest';
import {
  resolveRouterResolution,
  type RouterResolutionInput,
} from '../../src/adapters/llm/router-resolution.js';
import { PROVIDER_DEFAULT_MODELS } from '../../src/adapters/llm/router.js';
import { TASK_MODEL_DEFAULTS } from '../../src/config/model-routing.js';

/**
 * The router's FALL-THROUGH precedence ranks — providers_json (5),
 * global LLM_MODEL and provider_default (6) — pinned at the pure resolution
 * function rather than through whichever task currently happens to lack a
 * checked-in default.
 *
 * WHY THIS FILE EXISTS (2026-08-29). These ranks used to be demonstrated in
 * admin-model-routing-authority.test.ts through a real task, and the vehicle
 * has now decayed TWICE: explain_diff carried it until explain_diff gained a
 * checked-in Anthropic default, then clarify_brief carried it until
 * clarify_brief gained one. Each time, giving a task the default it should
 * always have had silently hollowed out the precedence coverage, and the
 * coverage had to be re-homed by hand.
 *
 * That is the estate's "control pinned to whatever is current" decay pattern:
 * the reference moves, the control quietly stops discriminating, and nothing
 * goes red. `taskDefault: undefined` is stated DIRECTLY here, so no future
 * task default can hollow it out — and there is now no third vehicle to find,
 * because every router-chain task carries a checked-in default.
 *
 * Report-layer mapping (availability / registry_model_id / configuration_error)
 * stays covered in admin-model-routing-authority.test.ts through the
 * CEE_MODEL_CLARIFICATION env-override cases, which are unaffected.
 */
const BASE: RouterResolutionInput = {
  task: 'clarify_brief',
  configuredProvider: 'openai',
  providerDefaultModels: PROVIDER_DEFAULT_MODELS,
  clientBlockedModels: [],
  taskDefault: undefined,
};

function resolve(overrides: Partial<RouterResolutionInput> = {}) {
  return resolveRouterResolution({ ...BASE, ...overrides });
}

describe('router fall-through precedence with no checked-in task default', () => {
  it('falls to the configured provider default when nothing else is set', () => {
    const outcome = resolve();
    expect(outcome.kind).toBe('single');
    expect(outcome).toMatchObject({
      resolutionSource: 'llm_model_fallback',
      sourceKey: 'PROVIDER_DEFAULT_MODELS.openai',
    });
    if (outcome.kind !== 'single') throw new Error('expected single plan');
    // This is the exact resolution clarify_brief served on deployed staging
    // before it was given a default: an unchosen model, reached by falling
    // past every rank that expresses an intent.
    expect(outcome.assignment.model).toBe('gpt-4o-mini');
    expect(outcome.assignment.provider).toBe('openai');
  });

  it('prefers the global LLM_MODEL over the provider default', () => {
    const outcome = resolve({ globalModel: 'gpt-4o' });
    expect(outcome).toMatchObject({
      resolutionSource: 'llm_model_fallback',
      sourceKey: 'LLM_MODEL',
    });
    if (outcome.kind !== 'single') throw new Error('expected single plan');
    expect(outcome.assignment.model).toBe('gpt-4o');
  });

  it('treats the sentinel global model "auto" as unset', () => {
    expect(resolve({ globalModel: 'auto' })).toMatchObject({
      sourceKey: 'PROVIDER_DEFAULT_MODELS.openai',
    });
  });

  it('prefers a providers.json task override over the global model', () => {
    const outcome = resolve({
      globalModel: 'gpt-4o',
      providersConfig: {
        overrides: {
          clarify_brief: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        },
      },
    });
    expect(outcome).toMatchObject({
      resolutionSource: 'providers_json',
      sourceKey: 'providers.json.overrides.clarify_brief.model',
    });
    if (outcome.kind !== 'single') throw new Error('expected single plan');
    expect(outcome.assignment.model).toBe('claude-sonnet-4-6');
    expect(outcome.assignment.provider).toBe('anthropic');
  });

  it('uses providers.json defaults when the task has no override', () => {
    const outcome = resolve({
      providersConfig: {
        defaults: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      },
    });
    expect(outcome).toMatchObject({
      resolutionSource: 'providers_json',
      sourceKey: 'providers.json.defaults.model',
    });
    if (outcome.kind !== 'single') throw new Error('expected single plan');
    expect(outcome.assignment.model).toBe('claude-sonnet-4-20250514');
  });

  it('surfaces an unregistered global model as a typed configuration error', () => {
    const outcome = resolve({ globalModel: 'unregistered-model' });
    expect(outcome.kind).toBe('configuration_error');
    expect(outcome).toMatchObject({
      resolutionSource: 'llm_model_fallback',
      sourceKey: 'LLM_MODEL',
      model: 'unregistered-model',
    });
    if (outcome.kind !== 'configuration_error') {
      throw new Error('expected configuration_error');
    }
    expect(outcome.error.code).toBe('MODEL_NOT_REGISTERED');
  });

  /**
   * OPPOSITE-DIRECTION TWIN, and the property the whole change rests on: a
   * checked-in task default OUTRANKS every fall-through rank above. Without
   * this the file could pass while task defaults were being ignored entirely.
   */
  it('a checked-in task default outranks providers.json, LLM_MODEL and the provider default', () => {
    const outcome = resolve({
      globalModel: 'gpt-4o',
      providersConfig: {
        defaults: { provider: 'openai', model: 'gpt-4o' },
      },
      taskDefault: TASK_MODEL_DEFAULTS.clarify_brief,
      taskDefaultSourceKey: 'TASK_MODEL_DEFAULTS.clarify_brief',
    });
    expect(outcome).toMatchObject({
      resolutionSource: 'task_default',
      sourceKey: 'TASK_MODEL_DEFAULTS.clarify_brief',
    });
    if (outcome.kind !== 'single') throw new Error('expected single plan');
    expect(outcome.assignment.model).toBe('claude-sonnet-5');
    // Provider follows the winning model through MODEL_REGISTRY, so the task
    // default also decides the adapter — not the hostile global posture.
    expect(outcome.assignment.provider).toBe('anthropic');
  });

  it('still lets an explicit CEE_MODEL_* env value outrank the task default', () => {
    const outcome = resolve({
      configuredTaskModel: 'gpt-4.1-2025-04-14',
      configuredTaskModelSourceKey: 'CEE_MODEL_CLARIFICATION',
      taskDefault: TASK_MODEL_DEFAULTS.clarify_brief,
      taskDefaultSourceKey: 'TASK_MODEL_DEFAULTS.clarify_brief',
    });
    expect(outcome).toMatchObject({
      resolutionSource: 'env_var',
      sourceKey: 'CEE_MODEL_CLARIFICATION',
    });
    if (outcome.kind !== 'single') throw new Error('expected single plan');
    expect(outcome.assignment.model).toBe('gpt-4.1-2025-04-14');
  });
});
