import { afterEach, describe, expect, it } from 'vitest';
import { _resetConfigCache } from '../../src/config/index.js';
import {
  RUNTIME_AI_TASK_AUTHORITY,
  TASK_MODEL_DEFAULTS,
  getDefaultModelForTask,
  isValidCeeTask,
} from '../../src/config/model-routing.js';
import { resolveModelAssignment } from '../../src/config/model-assignment.js';
import { resolveTaskRouting } from '../../src/routes/admin.models.js';
import {
  ROUTER_ENV_ONLY_TASKS,
  TASK_TO_CONFIG_KEY,
  resetAdapterCache,
} from '../../src/adapters/llm/router.js';

/**
 * clarify_brief is the FIRST reasoning step over the user's brief: every later
 * stage (draft, analysis, coaching) consumes its interpretation. Before this
 * pin it was absent from TASK_MODEL_DEFAULTS *and* from the deployed
 * CEE_MODEL_* env, so it fell past precedence ranks 3 and 4 onto the global
 * provider default — gpt-4o-mini on the deployed staging posture. Nobody chose
 * that model; it was the residue of a fall-through.
 *
 * The invariant below is written against the SPEC ("the upstream comprehension
 * step runs on the same tier already trusted for drafting"), not against the
 * literal string, so it keeps meaning if the drafting tier moves.
 */
const MANAGED_ENV = ['CEE_MODEL_CLARIFICATION', 'LLM_MODEL', 'LLM_PROVIDER'];

afterEach(() => {
  for (const key of MANAGED_ENV) delete process.env[key];
  _resetConfigCache();
  resetAdapterCache();
});

describe('clarify_brief checked-in model default', () => {
  it('is a first-class router task with a checked-in default', () => {
    expect(isValidCeeTask('clarify_brief')).toBe(true);
    expect(TASK_MODEL_DEFAULTS).toHaveProperty('clarify_brief');
    expect(getDefaultModelForTask('clarify_brief')).toBe('claude-sonnet-5');
  });

  it('runs the same tier already trusted for drafting (spec, not literal)', () => {
    expect(TASK_MODEL_DEFAULTS.clarify_brief).toBe(
      TASK_MODEL_DEFAULTS.draft_graph,
    );
  });

  it('resolves to a registered, enabled Anthropic model', () => {
    const assignment = resolveModelAssignment(
      TASK_MODEL_DEFAULTS.clarify_brief,
    );
    expect(assignment.provider).toBe('anthropic');
    expect(assignment.availability).toBe('registry_enabled');
  });

  it('is no longer declared env-only, and stays routed by the router', () => {
    expect(ROUTER_ENV_ONLY_TASKS).not.toContain('clarify_brief');
    // Still routed — the default must not have replaced the env route.
    expect(TASK_TO_CONFIG_KEY).toHaveProperty('clarify_brief');
    expect(TASK_TO_CONFIG_KEY.clarify_brief).toBe('clarification');
  });

  it('reports the checked-in default as its runtime model authority', () => {
    expect(RUNTIME_AI_TASK_AUTHORITY.clarify_brief).toMatchObject({
      modelAuthority: 'router_task_chain',
      checkedInModel: TASK_MODEL_DEFAULTS.clarify_brief,
    });
  });

  it('serves the task default when no CEE_MODEL_CLARIFICATION is set', () => {
    // The deployed staging posture: no env pin for this task.
    process.env.LLM_PROVIDER = 'openai';
    _resetConfigCache();
    resetAdapterCache();

    // Reporting vocabulary: the router's `task_default` rank surfaces as
    // source 'default' (model-routing-report.ts). source_key binds the row to
    // THIS task's default by identity, not just to some default.
    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      source: 'default',
      source_key: 'TASK_MODEL_DEFAULTS.clarify_brief',
      runtime_availability: 'available',
      executable: true,
    });
  });

  /**
   * OPPOSITE-DIRECTION TWIN. The row added is a DEFAULT (rank 4), not a
   * hardcode: an operator's CEE_MODEL_CLARIFICATION (rank 3) must still win.
   * Without this, a pin that silently stopped overriding would read green.
   */
  it('still yields to an explicit CEE_MODEL_CLARIFICATION override', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.CEE_MODEL_CLARIFICATION = 'gpt-4.1';
    _resetConfigCache();
    resetAdapterCache();

    expect(resolveTaskRouting('clarify_brief')).toMatchObject({
      model: 'gpt-4.1',
      provider: 'openai',
      source: 'env_override',
      source_key: 'CEE_MODEL_CLARIFICATION',
    });
  });
});
