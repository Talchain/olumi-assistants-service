import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetConfigCache } from '../../src/config/index.js';
import {
  EXECUTABLE_RUNTIME_TASKS,
  ROUTER_TASK_PROVIDER_CAPABILITIES,
  RUNTIME_AI_TASK_AUTHORITY,
  TASK_MODEL_DEFAULTS,
} from '../../src/config/model-routing.js';
import { resolveTaskRouting } from '../../src/routes/admin.models.js';
import {
  buildEffectiveTaskModels,
  getReportedModelTasks,
  resolveModelRoutingSnapshot,
} from '../../src/adapters/llm/model-routing-report.js';
import {
  PROVIDER_DEFAULT_MODELS,
  resetAdapterCache,
} from '../../src/adapters/llm/router.js';

const MANAGED_ENV = [
  'CEE_MODEL_SUMMARY',
  'CEE_MODEL_TASK_DRAFT_GRAPH',
  'CEE_MODEL_DECISION_REVIEW_HAIKU',
  'CEE_MODEL_CLARIFICATION',
  'CEE_MODEL_CRITIQUE',
  'CEE_MODEL_EXTRACTION',
  'LLM_FAILOVER_PROVIDERS',
  'LLM_MODEL',
  'LLM_PROVIDER',
  'PROVIDERS_CONFIG_PATH',
];

afterEach(() => {
  for (const key of MANAGED_ENV) delete process.env[key];
  _resetConfigCache();
  resetAdapterCache();
});

describe('admin runtime model-routing authority', () => {
  it('feeds admin/startup from one complete reporting projection', () => {
    const snapshot = resolveModelRoutingSnapshot();
    expect(snapshot.tasks.map((row) => row.task)).toEqual(getReportedModelTasks());
    for (const task of EXECUTABLE_RUNTIME_TASKS) {
      expect(snapshot.tasks.some((row) => row.task === task)).toBe(true);
    }

    const effective = buildEffectiveTaskModels(snapshot);
    expect(effective).not.toHaveProperty('repair_graph');
    expect(effective).not.toHaveProperty('m2_graph_review');
    expect(effective).not.toHaveProperty('decision_review_decompose');
    for (const row of snapshot.tasks) {
      if (row.availability === 'configuration_error') {
        expect(effective).not.toHaveProperty(row.task);
      }
    }
  });

  it('keeps CEE_MODEL_TASK_* as inert inventory with no serving precedence', () => {
    const before = resolveTaskRouting('draft_graph');
    process.env.CEE_MODEL_TASK_DRAFT_GRAPH = 'gpt-4o';
    _resetConfigCache();
    resetAdapterCache();
    const after = resolveTaskRouting('draft_graph');

    expect(after).toEqual(before);
    expect(after.source_key).not.toContain('CEE_MODEL_TASK');
  });

  it('wires both startup and admin to the shared adapter-free snapshot', () => {
    const server = readFileSync('src/server.ts', 'utf8');
    const adminRoute = readFileSync('src/routes/admin.models.ts', 'utf8');
    const report = readFileSync(
      'src/adapters/llm/model-routing-report.ts',
      'utf8',
    );

    expect(server).toContain('resolveModelRoutingSnapshot()');
    expect(server).toContain('buildEffectiveTaskModels(modelRoutingSnapshot)');
    expect(server).toContain('logResolvedTaskModels(modelRoutingSnapshot)');
    expect(server).not.toMatch(/const effectiveTaskModels\s*=\s*\{/);
    expect(adminRoute).toContain('resolveModelRoutingSnapshot()');
    expect(adminRoute).not.toContain('resolveConfiguredRouterPlan');
    expect(report).not.toMatch(/\bgetAdapter(?:WithResolution)?\s*\(/);
    expect(report).not.toMatch(/new\s+(?:Anthropic|OpenAI|Fixtures)Adapter/);
  });

  it('derives the complete static executable-path set from runtime authority', () => {
    expect(EXECUTABLE_RUNTIME_TASKS).toEqual(
      Object.entries(RUNTIME_AI_TASK_AUTHORITY)
        .filter(([, authority]) => authority.hasExecutablePath)
        .map(([task]) => task),
    );
    expect(EXECUTABLE_RUNTIME_TASKS).toContain('clarify_brief');
    expect(EXECUTABLE_RUNTIME_TASKS).toContain('explain_diff');
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES).toEqual({
      critique_graph: ['anthropic', 'fixtures'],
      explain_diff: ['anthropic', 'fixtures'],
    });
  });

  it('reports the unsupported critique default before runtime without changing it', () => {
    process.env.LLM_PROVIDER = 'openai';
    _resetConfigCache();

    expect(resolveTaskRouting('critique_graph')).toMatchObject({
      model: TASK_MODEL_DEFAULTS.critique_graph,
      provider: 'openai',
      availability: 'configuration_error',
      registry_model_id: 'gpt-5.2',
      source: 'default',
      source_key: 'TASK_MODEL_DEFAULTS.critique_graph',
      configuration_error: {
        code: 'MODEL_PROVIDER_MISMATCH',
      },
    });
    expect(
      buildEffectiveTaskModels(resolveModelRoutingSnapshot()),
    ).not.toHaveProperty('critique_graph');
  });

  it('reports critique env overrides through the shared provider capability', () => {
    process.env.CEE_MODEL_CRITIQUE = 'claude-sonnet-4-6';
    _resetConfigCache();

    expect(resolveTaskRouting('critique_graph')).toMatchObject({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      availability: 'registry_enabled',
      source: 'env_override',
      source_key: 'CEE_MODEL_CRITIQUE',
    });
    expect(buildEffectiveTaskModels(resolveModelRoutingSnapshot())).toMatchObject({
      critique_graph: 'claude-sonnet-4-6',
    });

    process.env.CEE_MODEL_CRITIQUE = 'gpt-4o';
    _resetConfigCache();

    expect(resolveTaskRouting('critique_graph')).toMatchObject({
      model: 'gpt-4o',
      provider: 'openai',
      availability: 'configuration_error',
      source: 'env_override',
      source_key: 'CEE_MODEL_CRITIQUE',
      configuration_error: { code: 'MODEL_PROVIDER_MISMATCH' },
    });
    expect(
      buildEffectiveTaskModels(resolveModelRoutingSnapshot()),
    ).not.toHaveProperty('critique_graph');
  });

  it('gives failover precedence and reports only task-capable members in order', () => {
    process.env.LLM_FAILOVER_PROVIDERS = 'openai,anthropic,fixtures';
    process.env.CEE_MODEL_CRITIQUE = 'gpt-4o';
    _resetConfigCache();

    expect(resolveTaskRouting('critique_graph')).toMatchObject({
      model: PROVIDER_DEFAULT_MODELS.anthropic,
      provider: 'anthropic',
      availability: 'registry_enabled',
      source: 'failover',
      source_key: 'LLM_FAILOVER_PROVIDERS',
      failover_chain: [
        {
          model: PROVIDER_DEFAULT_MODELS.anthropic,
          provider: 'anthropic',
          availability: 'registry_enabled',
        },
        {
          model: PROVIDER_DEFAULT_MODELS.fixtures,
          provider: 'fixtures',
          availability: 'fixture_only',
        },
      ],
    });
    expect(buildEffectiveTaskModels(resolveModelRoutingSnapshot())).toMatchObject({
      critique_graph: PROVIDER_DEFAULT_MODELS.anthropic,
    });
  });

  it('consumes the real providers config for router fallback tasks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'olumi-provider-routing-'));
    const configPath = join(directory, 'providers.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        overrides: {
          explain_diff: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
          },
        },
      }),
    );

    try {
      process.env.PROVIDERS_CONFIG_PATH = configPath;
      process.env.LLM_PROVIDER = 'openai';
      _resetConfigCache();
      resetAdapterCache();

      expect(resolveTaskRouting('explain_diff')).toMatchObject({
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        availability: 'registry_enabled',
        source: 'providers_config',
        source_key: 'providers.json.overrides.explain_diff.model',
      });

      writeFileSync(
        configPath,
        JSON.stringify({
          defaults: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
          },
        }),
      );
      _resetConfigCache();
      resetAdapterCache();

      expect(resolveTaskRouting('explain_diff')).toMatchObject({
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        availability: 'registry_enabled',
        source: 'providers_config',
        source_key: 'providers.json.defaults.model',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('applies fixtures only to router/extraction chains while direct Anthropic chains stay Anthropic', () => {
    process.env.LLM_PROVIDER = 'fixtures';
    _resetConfigCache();

    expect(resolveTaskRouting('critique_graph')).toMatchObject({
      model: TASK_MODEL_DEFAULTS.critique_graph,
      provider: 'fixtures',
      availability: 'fixture_only',
    });
    expect(resolveTaskRouting('extraction')).toMatchObject({
      provider: 'fixtures',
      availability: 'fixture_only',
    });
    expect(resolveTaskRouting('rolling_summary')).toMatchObject({
      provider: 'anthropic',
      availability: 'registry_enabled',
    });
    expect(resolveTaskRouting('decision_review_decompose')).toMatchObject({
      provider: 'anthropic',
      availability: 'registry_enabled',
    });
  });

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

  it('reports clarification override, alias identity, and exact authority', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.CEE_MODEL_CLARIFICATION = 'gpt-4.1';
    _resetConfigCache();

    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: 'gpt-4.1',
      provider: 'openai',
      availability: 'explicit_alias',
      registry_model_id: 'gpt-4.1-2025-04-14',
      source: 'env_override',
      source_key: 'CEE_MODEL_CLARIFICATION',
      executable: true,
      has_executable_path: true,
      runtime_availability: 'available',
    });
  });

  it('surfaces unknown and disabled clarification overrides as typed errors', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.CEE_MODEL_CLARIFICATION = 'unregistered-clarifier';
    _resetConfigCache();

    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: 'unregistered-clarifier',
      provider: 'unresolved',
      availability: 'configuration_error',
      registry_model_id: null,
      source: 'env_override',
      source_key: 'CEE_MODEL_CLARIFICATION',
      configuration_error: { code: 'MODEL_NOT_REGISTERED' },
    });

    process.env.CEE_MODEL_CLARIFICATION = 'test-disabled-model';
    _resetConfigCache();

    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: 'test-disabled-model',
      provider: 'unresolved',
      availability: 'configuration_error',
      registry_model_id: null,
      source: 'env_override',
      source_key: 'CEE_MODEL_CLARIFICATION',
      configuration_error: { code: 'MODEL_DISABLED' },
    });
  });

  it('reports clarification global-model and provider-default fallbacks without inventing a task default', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_MODEL = 'gpt-4o';
    _resetConfigCache();

    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: 'gpt-4o',
      provider: 'openai',
      availability: 'registry_enabled',
      source: 'global_model',
      source_key: 'LLM_MODEL',
    });

    process.env.LLM_PROVIDER = 'anthropic';
    delete process.env.LLM_MODEL;
    _resetConfigCache();

    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: PROVIDER_DEFAULT_MODELS.anthropic,
      provider: 'anthropic',
      availability: 'registry_enabled',
      source: 'provider_default',
      source_key: 'PROVIDER_DEFAULT_MODELS.anthropic',
    });
  });

  it('matches router empty-versus-whitespace clarification override semantics', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.CEE_MODEL_CLARIFICATION = '';
    _resetConfigCache();

    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: PROVIDER_DEFAULT_MODELS.anthropic,
      source: 'provider_default',
    });

    process.env.CEE_MODEL_CLARIFICATION = '   ';
    _resetConfigCache();

    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: '   ',
      availability: 'configuration_error',
      source: 'env_override',
      source_key: 'CEE_MODEL_CLARIFICATION',
      configuration_error: { code: 'MODEL_ID_EMPTY' },
    });
  });

  it('reports explain_diff global and provider fallbacks, including unsupported-provider configuration errors', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.LLM_MODEL = 'claude-sonnet-4-6';
    _resetConfigCache();

    expect(resolveTaskRouting('explain_diff')).toMatchObject({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      availability: 'registry_enabled',
      source: 'global_model',
      source_key: 'LLM_MODEL',
      executable: true,
      has_executable_path: true,
      runtime_availability: 'available',
    });

    delete process.env.LLM_MODEL;
    _resetConfigCache();

    expect(resolveTaskRouting('explain_diff')).toMatchObject({
      model: PROVIDER_DEFAULT_MODELS.anthropic,
      provider: 'anthropic',
      availability: 'registry_enabled',
      source: 'provider_default',
      source_key: 'PROVIDER_DEFAULT_MODELS.anthropic',
    });

    process.env.LLM_PROVIDER = 'openai';
    _resetConfigCache();

    expect(resolveTaskRouting('explain_diff')).toMatchObject({
      model: PROVIDER_DEFAULT_MODELS.openai,
      provider: 'openai',
      availability: 'configuration_error',
      registry_model_id: 'gpt-4o-mini',
      source: 'provider_default',
      source_key: 'PROVIDER_DEFAULT_MODELS.openai',
      configuration_error: { code: 'MODEL_PROVIDER_MISMATCH' },
    });
  });

  it('surfaces an invalid explain_diff global model without making an adapter call', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.LLM_MODEL = 'unregistered-explainer';
    _resetConfigCache();

    expect(resolveTaskRouting('explain_diff')).toMatchObject({
      model: 'unregistered-explainer',
      provider: 'unresolved',
      availability: 'configuration_error',
      registry_model_id: null,
      source: 'global_model',
      source_key: 'LLM_MODEL',
      configuration_error: { code: 'MODEL_NOT_REGISTERED' },
    });
  });
});
