import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable mock config
const mockConfig = {
  cee: {
    models: {} as Record<string, string | undefined>,
    modelSelection: {
      taskModels: {} as Record<string, string | undefined>,
    },
  },
};

const logInfoCalls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
const logWarnCalls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
const mockLog = {
  info: vi.fn((obj: Record<string, unknown>, msg: string) => {
    logInfoCalls.push({ obj, msg });
  }),
  warn: vi.fn((obj: Record<string, unknown>, msg: string) => {
    logWarnCalls.push({ obj, msg });
  }),
};

vi.mock('../../config/index.js', () => ({ config: mockConfig }));
vi.mock('../../utils/telemetry.js', () => ({ log: mockLog }));

const { logResolvedTaskModels } = await import('../model-resolution-logger.js');
const { TASK_MODEL_DEFAULTS } = await import('../model-routing.js');

// DERIVED from TASK_MODEL_DEFAULTS, not re-listed (CLAUDE.md trap 12). The
// hand-typed version of this array was a mirror of the implementation's own
// `ALL_CEE_TASKS` and carried a hard-coded count in two assertions below; adding
// a task (ROADMAP 2.146 added `validate_graph`) broke both for no product reason
// while proving nothing about the product. What is actually worth pinning is the
// ONE non-mechanical property of the implementation's filter — that `routing` is
// excluded because its default is display-only — and that is asserted explicitly.
const EXPECTED_EXCLUDED_FROM_STARTUP_LOG = ['routing'] as const;
const ALL_TASKS = (Object.keys(TASK_MODEL_DEFAULTS) as string[]).filter(
  (t) => !(EXPECTED_EXCLUDED_FROM_STARTUP_LOG as readonly string[]).includes(t),
);

describe('logResolvedTaskModels', () => {
  beforeEach(() => {
    logInfoCalls.length = 0;
    logWarnCalls.length = 0;
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
    mockConfig.cee.models = {};
    mockConfig.cee.modelSelection.taskModels = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits exactly one log line per CeeTask (Gate 6)', () => {
    logResolvedTaskModels();
    const taskLines = logInfoCalls.filter((c) => c.obj['event'] === 'model.task_resolved');
    // EXACTLY one — count AND set, so a duplicate line cannot cancel out a
    // missing one (the old hard-coded count could not tell those apart either).
    expect(taskLines).toHaveLength(ALL_TASKS.length);
    expect([...taskLines.map((c) => c.obj['task'] as string)].sort()).toEqual(
      [...ALL_TASKS].sort(),
    );
  });

  it('excludes display-only tasks from the startup log (routing)', () => {
    // The one non-mechanical property of the implementation's ALL_CEE_TASKS
    // filter. Positive control: `routing` really does have a default that would
    // otherwise be logged, so this assertion can see the presence it denies.
    expect(Object.keys(TASK_MODEL_DEFAULTS)).toContain('routing');
    logResolvedTaskModels();
    const tasks = logInfoCalls
      .filter((c) => c.obj['event'] === 'model.task_resolved')
      .map((c) => c.obj['task'] as string);
    for (const excluded of EXPECTED_EXCLUDED_FROM_STARTUP_LOG) {
      expect(tasks).not.toContain(excluded);
    }
  });

  it('emits one caveat note line before task lines', () => {
    logResolvedTaskModels();
    expect(logInfoCalls[0].obj['event']).toBe('model.startup_resolution_note');
  });

  it('emits refined caveat wording naming per-request logs as source of truth', () => {
    logResolvedTaskModels();
    const note = logInfoCalls.find((c) => c.obj['event'] === 'model.startup_resolution_note');
    expect(note?.msg).toBe(
      'Startup values are advisory. Per-request logs are the source of truth for store overrides applied after boot.',
    );
  });

  it('covers every CeeTask value that is not display-only', () => {
    logResolvedTaskModels();
    const resolvedTasks = logInfoCalls
      .filter((c) => c.obj['event'] === 'model.task_resolved')
      .map((c) => c.obj['task'] as string);
    for (const task of ALL_TASKS) {
      expect(resolvedTasks).toContain(task);
    }
  });

  it('reports env_task_tier when CEE_MODEL_TASK_* is set', () => {
    mockConfig.cee.modelSelection.taskModels = { clarification: 'gpt-custom-task' };
    logResolvedTaskModels();
    const clarificationLine = logInfoCalls.find(
      (c) => c.obj['event'] === 'model.task_resolved' && c.obj['task'] === 'clarification',
    );
    expect(clarificationLine?.obj['source']).toBe('env_task_tier');
    expect(clarificationLine?.obj['model']).toBe('gpt-custom-task');
  });

  it('reports env_legacy_tier when CEE_MODEL_* (legacy) is set and task tier is absent', () => {
    mockConfig.cee.models = { draft: 'claude-sonnet-4-6' };
    logResolvedTaskModels();
    const draftLine = logInfoCalls.find(
      (c) => c.obj['event'] === 'model.task_resolved' && c.obj['task'] === 'draft_graph',
    );
    expect(draftLine?.obj['source']).toBe('env_legacy_tier');
    expect(draftLine?.obj['model']).toBe('claude-sonnet-4-6');
  });

  it('reports code_default when no env override is set', () => {
    logResolvedTaskModels();
    const orchLine = logInfoCalls.find(
      (c) => c.obj['event'] === 'model.task_resolved' && c.obj['task'] === 'orchestrator',
    );
    expect(orchLine?.obj['source']).toBe('code_default');
    expect(typeof orchLine?.obj['model']).toBe('string');
  });

  it('task tier takes precedence over legacy tier', () => {
    mockConfig.cee.models = { draft: 'gpt-legacy' };
    mockConfig.cee.modelSelection.taskModels = { draftGraph: 'gpt-task-tier' };
    logResolvedTaskModels();
    const draftLine = logInfoCalls.find(
      (c) => c.obj['event'] === 'model.task_resolved' && c.obj['task'] === 'draft_graph',
    );
    expect(draftLine?.obj['source']).toBe('env_task_tier');
    expect(draftLine?.obj['model']).toBe('gpt-task-tier');
  });

  describe('loud fallback WARN (dropped/unset CEE_MODEL_* visibility)', () => {
    it('WARNs for a legacy-mapped task running on the checked-in default', () => {
      // No env overrides set → orchestrator (legacy key 'orchestrator') falls to
      // its code default. That is the dropped-var signal.
      logResolvedTaskModels();
      const warn = logWarnCalls.find(
        (c) => c.obj['event'] === 'model.default_fallback' && c.obj['task'] === 'orchestrator',
      );
      expect(warn).toBeDefined();
      expect(warn?.obj['config_key']).toBe('orchestrator');
      expect(typeof warn?.obj['model']).toBe('string');
      // The task_resolved INFO line is still emitted alongside the WARN.
      const info = logInfoCalls.find(
        (c) => c.obj['event'] === 'model.task_resolved' && c.obj['task'] === 'orchestrator',
      );
      expect(info?.obj['source']).toBe('code_default');
    });

    it('does NOT WARN when the legacy CEE_MODEL_* override IS set', () => {
      mockConfig.cee.models = { orchestrator: 'claude-sonnet-5' };
      logResolvedTaskModels();
      const warn = logWarnCalls.find(
        (c) => c.obj['event'] === 'model.default_fallback' && c.obj['task'] === 'orchestrator',
      );
      expect(warn).toBeUndefined();
    });

    it('does NOT WARN for tasks with no CEE_MODEL_* mechanism (nothing to drop)', () => {
      // preflight has only a task-tier key and no legacy CEE_MODEL_* var — it
      // always serves its default by design, so it must not cry wolf.
      logResolvedTaskModels();
      const warn = logWarnCalls.find(
        (c) => c.obj['event'] === 'model.default_fallback' && c.obj['task'] === 'preflight',
      );
      expect(warn).toBeUndefined();
    });

    it('names task and model in every fallback WARN', () => {
      logResolvedTaskModels();
      const warns = logWarnCalls.filter((c) => c.obj['event'] === 'model.default_fallback');
      expect(warns.length).toBeGreaterThan(0);
      for (const w of warns) {
        expect(typeof w.obj['task']).toBe('string');
        expect(typeof w.obj['model']).toBe('string');
        expect(w.msg).toContain('CEE_MODEL_');
      }
    });
  });
});
