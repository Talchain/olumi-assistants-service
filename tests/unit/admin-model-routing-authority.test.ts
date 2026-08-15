import { afterEach, describe, expect, it } from 'vitest';
import { _resetConfigCache } from '../../src/config/index.js';
import { RUNTIME_AI_TASK_AUTHORITY } from '../../src/config/model-routing.js';
import { resolveTaskRouting } from '../../src/routes/admin.models.js';

const MANAGED_ENV = [
  'CEE_MODEL_SUMMARY',
  'CEE_MODEL_DECISION_REVIEW_HAIKU',
];

afterEach(() => {
  for (const key of MANAGED_ENV) delete process.env[key];
  _resetConfigCache();
});

describe('admin dedicated model-routing authority', () => {
  it('reports valid explicit overrides with exact served model bytes and sources', () => {
    process.env.CEE_MODEL_SUMMARY = 'claude-sonnet-4-6';
    process.env.CEE_MODEL_DECISION_REVIEW_HAIKU = 'claude-sonnet-4-20250514';
    _resetConfigCache();

    expect(resolveTaskRouting('rolling_summary')).toMatchObject({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      availability: 'registry_enabled',
      registry_model_id: 'claude-sonnet-4-6',
      source: 'env_override',
      source_key: 'CEE_MODEL_SUMMARY',
      executable: true,
      has_executable_path: true,
      runtime_availability: 'available',
    });
    expect(resolveTaskRouting('decision_review_decompose')).toMatchObject({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      availability: 'registry_enabled',
      registry_model_id: 'claude-sonnet-4-20250514',
      source: 'env_override',
      source_key: 'CEE_MODEL_DECISION_REVIEW_HAIKU',
      executable: false,
      has_executable_path: true,
      runtime_availability: 'feature_gated_default_off',
    });
  });

  it('matches both runtime chains by treating whitespace overrides as unset', () => {
    process.env.CEE_MODEL_SUMMARY = '   ';
    process.env.CEE_MODEL_DECISION_REVIEW_HAIKU = '\t';
    _resetConfigCache();

    expect(resolveTaskRouting('rolling_summary')).toMatchObject({
      model: RUNTIME_AI_TASK_AUTHORITY.rolling_summary.checkedInModel,
      source: 'default',
      source_key: 'DEFAULT_SUMMARY_MODEL',
    });
    expect(resolveTaskRouting('decision_review_decompose')).toMatchObject({
      model:
        RUNTIME_AI_TASK_AUTHORITY.decision_review_decompose.checkedInModel,
      source: 'default',
      source_key: 'DEFAULT_DECOMPOSE_MODEL',
    });
  });

  it('surfaces a cross-provider dedicated override as the same typed configuration error as the network boundary', () => {
    process.env.CEE_MODEL_SUMMARY = 'gpt-4.1';
    _resetConfigCache();

    expect(resolveTaskRouting('rolling_summary')).toMatchObject({
      model: 'gpt-4.1',
      provider: 'openai',
      availability: 'configuration_error',
      registry_model_id: 'gpt-4.1-2025-04-14',
      source: 'env_override',
      source_key: 'CEE_MODEL_SUMMARY',
      configuration_error: {
        code: 'MODEL_PROVIDER_MISMATCH',
        message:
          "Model 'gpt-4.1' resolves to provider 'openai', so it cannot be sent through the Anthropic client.",
      },
    });
  });

  it('surfaces unknown and disabled dedicated overrides without inventing a provider', () => {
    process.env.CEE_MODEL_SUMMARY = 'claude-future-unregistered';
    process.env.CEE_MODEL_DECISION_REVIEW_HAIKU = 'test-disabled-model';
    _resetConfigCache();

    expect(resolveTaskRouting('rolling_summary')).toMatchObject({
      model: 'claude-future-unregistered',
      provider: 'unresolved',
      availability: 'configuration_error',
      registry_model_id: null,
      configuration_error: { code: 'MODEL_NOT_REGISTERED' },
    });
    expect(resolveTaskRouting('decision_review_decompose')).toMatchObject({
      model: 'test-disabled-model',
      provider: 'unresolved',
      availability: 'configuration_error',
      registry_model_id: null,
      configuration_error: { code: 'MODEL_DISABLED' },
    });
  });
});
