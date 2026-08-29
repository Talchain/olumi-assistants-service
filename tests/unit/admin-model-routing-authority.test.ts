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

  // INVERTED. This test used to assert that critique_graph's checked-in default
  // was UNSERVICEABLE ("reports the unsupported critique default before runtime
  // without changing it"): the default was gpt-5.2, an OpenAI model, while the
  // task is provider-constrained to Anthropic/Fixtures, so it resolved to
  // MODEL_PROVIDER_MISMATCH and was absent from the effective task models. The
  // default is now an Anthropic model, so the task is serviceable with no env
  // override — and the assertion inverts with it. The unsupported-provider path
  // itself is still covered, by the env-override test immediately below.
  it('reports a serviceable critique default that needs no env override', () => {
    process.env.LLM_PROVIDER = 'openai';
    _resetConfigCache();

    expect(resolveTaskRouting('critique_graph')).toMatchObject({
      model: TASK_MODEL_DEFAULTS.critique_graph,
      provider: 'anthropic',
      availability: 'registry_enabled',
      registry_model_id: 'claude-sonnet-5',
      source: 'default',
      source_key: 'TASK_MODEL_DEFAULTS.critique_graph',
    });
    expect(
      buildEffectiveTaskModels(resolveModelRoutingSnapshot()),
    ).toHaveProperty('critique_graph');
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

  // ⚠ VEHICLE RETIRED, 2026-08-29 — READ THIS BEFORE LOOKING FOR A THIRD ONE.
  // This test demonstrated the providers_json rank through a task that had no
  // checked-in default. The vehicle decayed TWICE: explain_diff carried it
  // until explain_diff gained an Anthropic default, then clarify_brief carried
  // it until clarify_brief gained one. Every router-chain task now has a
  // checked-in default, so there is NO third vehicle — the rank is no longer
  // reachable through any real reported task.
  // The fall-through ranks (providers_json / LLM_MODEL / provider_default) are
  // now pinned directly, with `taskDefault: undefined` stated as an input, in
  // tests/unit/router-resolution-fallback-precedence.test.ts. That cannot decay.
  // What remains REACHABLE at this report layer, and is asserted here instead,
  // is the opposite direction: a real providers.json override must LOSE to the
  // checked-in task default.
  it('keeps a task on its checked-in default against a providers.json override', () => {
    const directory = mkdtempSync(join(tmpdir(), 'olumi-provider-routing-'));
    const configPath = join(directory, 'providers.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        overrides: {
          clarify_brief: { provider: 'openai', model: 'gpt-4o-mini' },
        },
      }),
    );

    try {
      process.env.PROVIDERS_CONFIG_PATH = configPath;
      process.env.LLM_PROVIDER = 'openai';
      _resetConfigCache();
      resetAdapterCache();

      expect(resolveTaskRouting('clarify_brief')).toMatchObject({
        model: TASK_MODEL_DEFAULTS.clarify_brief,
        provider: 'anthropic',
        availability: 'registry_enabled',
        source: 'default',
        source_key: 'TASK_MODEL_DEFAULTS.clarify_brief',
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

  // Retitled and inverted 2026-08-29. clarify_brief no longer "has no task
  // default to invent" — it has a real one, and task_default outranks both the
  // global model and the provider default. The fall-through behaviour this
  // covered now lives in router-resolution-fallback-precedence.test.ts.
  it('keeps clarify_brief on its checked-in default against a hostile global posture', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_MODEL = 'gpt-4o';
    _resetConfigCache();

    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: TASK_MODEL_DEFAULTS.clarify_brief,
      provider: 'anthropic',
      availability: 'registry_enabled',
      source: 'default',
      source_key: 'TASK_MODEL_DEFAULTS.clarify_brief',
      executable: true,
      has_executable_path: true,
      runtime_availability: 'available',
    });
    expect(buildEffectiveTaskModels(resolveModelRoutingSnapshot())).toMatchObject({
      clarify_brief: TASK_MODEL_DEFAULTS.clarify_brief,
    });
  });

  it('matches router empty-versus-whitespace clarification override semantics', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    process.env.CEE_MODEL_CLARIFICATION = '';
    _resetConfigCache();

    // EMPTY means UNSET, so it falls through the env rank. It now lands on the
    // checked-in task default rather than the provider default — which is the
    // whole point of the defaults map: a dropped env var is safe.
    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: TASK_MODEL_DEFAULTS.clarify_brief,
      source: 'default',
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

  // RETIRED 2026-08-29, same reason as the providers.json vehicle above: no
  // reported task falls through to global_model / provider_default any more.
  // Re-homed, un-decayable, at
  // tests/unit/router-resolution-fallback-precedence.test.ts.
  // What is asserted here instead is the report-layer invariant that replaces
  // it: EVERY reported router-chain task now resolves from an INTENDED rank
  // (a per-call/store override, an env pin, or a checked-in default) — never
  // by falling through to a provider default nobody chose. That is the defect
  // clarify_brief was the last instance of.
  it('leaves no reported router task resolving by unchosen fall-through', () => {
    delete process.env.LLM_MODEL;
    process.env.LLM_PROVIDER = 'openai';
    _resetConfigCache();
    resetAdapterCache();

    const fellThrough = resolveModelRoutingSnapshot()
      .tasks.filter((row) => row.source === 'provider_default')
      .map((row) => `${row.task} -> ${row.provider}/${row.model}`);

    expect(
      fellThrough,
      'These tasks resolve to a model nobody chose, by falling past every ' +
        'rank that expresses an intent. Give each a checked-in default in ' +
        'TASK_MODEL_DEFAULTS (src/config/model-routing.ts).',
    ).toEqual([]);
  });

  // The opposite-direction twin of the defect this lane closed: the checked-in
  // Anthropic default must win even under the most hostile global posture. This
  // is what makes explain_diff correct BY CONSTRUCTION rather than by luck of
  // deployment env — previously this exact posture produced
  // MODEL_PROVIDER_MISMATCH on gpt-4o-mini and the route returned HTTP 500.
  it('keeps explain_diff on its checked-in Anthropic default against a hostile global posture', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_MODEL = 'gpt-4o';
    _resetConfigCache();

    expect(resolveTaskRouting('explain_diff')).toMatchObject({
      model: TASK_MODEL_DEFAULTS.explain_diff,
      provider: 'anthropic',
      availability: 'registry_enabled',
      source: 'default',
      source_key: 'TASK_MODEL_DEFAULTS.explain_diff',
      executable: true,
      has_executable_path: true,
      runtime_availability: 'available',
    });
    expect(buildEffectiveTaskModels(resolveModelRoutingSnapshot())).toMatchObject({
      explain_diff: TASK_MODEL_DEFAULTS.explain_diff,
    });
  });

  // RETIRED 2026-08-29. No reported task reads the global model any more, so
  // an invalid global model cannot be surfaced through one. The property — an
  // unregistered model becomes a typed configuration error without
  // constructing an adapter — is preserved in TWO places that do not depend on
  // a task lacking a default: the CEE_MODEL_CLARIFICATION cases above
  // ('surfaces unknown and disabled clarification overrides as typed errors'),
  // and the global-model case in
  // tests/unit/router-resolution-fallback-precedence.test.ts.
});
