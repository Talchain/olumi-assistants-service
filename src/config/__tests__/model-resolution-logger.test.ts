import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ModelRoutingSnapshot } from '../../adapters/llm/model-routing-report.js';

const info = vi.fn();
const warn = vi.fn();
vi.mock('../../utils/telemetry.js', () => ({ log: { info, warn } }));

const { logResolvedTaskModels } = await import('../model-resolution-logger.js');

const snapshot: ModelRoutingSnapshot = {
  default_provider: 'anthropic',
  tasks: [
    {
      task: 'draft_graph',
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      availability: 'registry_enabled',
      registry_model_id: 'claude-sonnet-5',
      executable: true,
      has_executable_path: true,
      lifecycle_state: 'executable_route',
      runtime_availability: 'available',
      source: 'default',
      source_key: 'TASK_MODEL_DEFAULTS.draft_graph',
    },
    {
      task: 'repair_graph',
      model: 'gpt-4.1',
      provider: 'openai',
      availability: 'explicit_alias',
      registry_model_id: 'gpt-4.1-2025-04-14',
      executable: false,
      has_executable_path: false,
      lifecycle_state: 'inert_compatibility',
      runtime_availability: 'not_executable',
      source: 'env_override',
      source_key: 'CEE_MODEL_REPAIR',
    },
    {
      task: 'm2_graph_review',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      availability: 'registry_enabled',
      registry_model_id: 'claude-sonnet-4-6',
      executable: false,
      has_executable_path: true,
      lifecycle_state: 'feature_gated_default_off',
      runtime_availability: 'feature_gated_default_off',
      source: 'default',
      source_key: 'TASK_MODEL_DEFAULTS.m2_graph_review',
    },
    {
      task: 'critique_graph',
      model: 'gpt-5.2',
      provider: 'openai',
      availability: 'configuration_error',
      registry_model_id: 'gpt-5.2',
      configuration_error: {
        code: 'MODEL_PROVIDER_MISMATCH',
        message: 'unsupported provider',
      },
      executable: true,
      has_executable_path: true,
      lifecycle_state: 'executable_route',
      runtime_availability: 'available',
      source: 'default',
      source_key: 'TASK_MODEL_DEFAULTS.critique_graph',
    },
  ],
};

describe('logResolvedTaskModels', () => {
  beforeEach(() => {
    info.mockClear();
    warn.mockClear();
  });

  it('logs only an available, valid executable path as effective', () => {
    logResolvedTaskModels(snapshot);

    const effective = info.mock.calls
      .filter(([fields]) => fields.event === 'model.task_resolved')
      .map(([fields]) => fields.task);
    expect(effective).toEqual(['draft_graph']);

    const notEffective = info.mock.calls
      .filter(([fields]) => fields.event === 'model.task_not_effective')
      .map(([fields]) => fields.task);
    expect(notEffective).toEqual([
      'repair_graph',
      'm2_graph_review',
      'critique_graph',
    ]);
  });

  it('preserves the complete lifecycle/config-error evidence in status logs', () => {
    logResolvedTaskModels(snapshot);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'model.task_not_effective',
        task: 'critique_graph',
        configuration_error: expect.objectContaining({
          code: 'MODEL_PROVIDER_MISMATCH',
        }),
      }),
      'Task model is not currently effective',
    );
  });

  it('warns only for an effective checked-in default', () => {
    logResolvedTaskModels(snapshot);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'model.default_fallback',
        task: 'draft_graph',
        source_key: 'TASK_MODEL_DEFAULTS.draft_graph',
      }),
      expect.stringContaining('serving checked-in default'),
    );
  });

  it('takes a resolved snapshot and contains no parallel CEE_MODEL_TASK authority', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const loggerSource = readFileSync(
      `${root}/config/model-resolution-logger.ts`,
      'utf8',
    );
    const reportSource = readFileSync(
      `${root}/adapters/llm/model-routing-report.ts`,
      'utf8',
    );
    expect(loggerSource).not.toMatch(/config\.cee\.modelSelection|process\.env\.CEE_MODEL_TASK/);
    expect(reportSource).not.toMatch(/modelSelection\.taskModels/);
    expect(reportSource).toContain('Historical');
  });
});
