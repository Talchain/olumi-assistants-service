import { afterEach, describe, expect, it } from 'vitest';
import {
  ModelAssignmentError,
  resolveModelAssignment,
} from '../../src/config/model-assignment.js';
import { MODEL_REGISTRY } from '../../src/config/models.js';
import { TASK_MODEL_DEFAULTS } from '../../src/config/model-routing.js';
import {
  getAdapterWithResolution,
  resetAdapterCache,
} from '../../src/adapters/llm/router.js';
import { _resetConfigCache } from '../../src/config/index.js';

const MANAGED_ENV = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'CEE_MODEL_ORCHESTRATOR',
  'CEE_MODEL_DECISION_REVIEW',
];

afterEach(() => {
  for (const key of MANAGED_ENV) delete process.env[key];
  _resetConfigCache();
  resetAdapterCache();
});

describe('shared model assignment authority', () => {
  it('returns exact model, provider and checked-in availability for a registry row', () => {
    expect(resolveModelAssignment('claude-sonnet-5')).toMatchObject({
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      registryModelId: 'claude-sonnet-5',
      availability: 'registry_enabled',
    });
  });

  it('accepts only the explicit GPT-4.1 aliases and preserves the exact served id', () => {
    expect(resolveModelAssignment('gpt-4.1')).toMatchObject({
      model: 'gpt-4.1',
      provider: 'openai',
      registryModelId: 'gpt-4.1-2025-04-14',
      availability: 'explicit_alias',
    });
    expect(() => resolveModelAssignment('gpt-4.1-random-snapshot')).toThrowError(
      expect.objectContaining({ code: 'MODEL_NOT_REGISTERED' }),
    );
  });

  it('fails disabled, unknown and broken-alias configurations deliberately', () => {
    expect(() => resolveModelAssignment('test-disabled-model')).toThrowError(
      expect.objectContaining({ code: 'MODEL_DISABLED' }),
    );
    expect(() => resolveModelAssignment('claude-looking-but-unknown')).toThrowError(
      expect.objectContaining({ code: 'MODEL_NOT_REGISTERED' }),
    );

    const target = MODEL_REGISTRY['gpt-4.1-2025-04-14'];
    const previous = target.enabled;
    target.enabled = false;
    try {
      expect(() => resolveModelAssignment('gpt-4.1')).toThrowError(
        expect.objectContaining({ code: 'MODEL_ALIAS_TARGET_INVALID' }),
      );
    } finally {
      target.enabled = previous;
    }
  });

  it('allows arbitrary labels only for hermetic fixture execution', () => {
    expect(resolveModelAssignment('recorded-arm-b', { fixtures: true })).toMatchObject({
      model: 'recorded-arm-b',
      provider: 'fixtures',
      availability: 'fixture_only',
    });
    expect(() => resolveModelAssignment('recorded-arm-b')).toThrow(
      ModelAssignmentError,
    );
  });

  it('makes a cross-provider task default beat the lower-precedence global provider', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_MODEL = 'gpt-4o-mini';
    _resetConfigCache();

    const { adapter, resolution } = getAdapterWithResolution('orchestrator');

    expect(resolution).toMatchObject({
      resolved_model: TASK_MODEL_DEFAULTS.orchestrator,
      provider: 'anthropic',
      availability: 'registry_enabled',
      resolution_source: 'task_default',
    });
    expect(adapter.name).toBe('anthropic');
  });

  it('gives an explicit alias override precedence and changes provider from its validated assignment', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.LLM_MODEL = 'claude-sonnet-5';
    _resetConfigCache();

    const { adapter, resolution } = getAdapterWithResolution(
      'orchestrator',
      'gpt-4.1',
    );

    expect(resolution).toMatchObject({
      resolved_model: 'gpt-4.1',
      provider: 'openai',
      availability: 'explicit_alias',
      registry_model_id: 'gpt-4.1-2025-04-14',
      resolution_source: 'per_call',
    });
    expect(adapter.name).toBe('openai');
  });

  it('never lets an unknown override inherit the global provider', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.LLM_MODEL = 'claude-sonnet-5';
    _resetConfigCache();

    expect(() =>
      getAdapterWithResolution('orchestrator', 'claude-future-unregistered'),
    ).toThrowError(expect.objectContaining({ code: 'MODEL_NOT_REGISTERED' }));
  });
});
