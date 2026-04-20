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
const mockLog = {
  info: vi.fn((obj: Record<string, unknown>, msg: string) => {
    logInfoCalls.push({ obj, msg });
  }),
};

vi.mock('../../config/index.js', () => ({ config: mockConfig }));
vi.mock('../../utils/telemetry.js', () => ({ log: mockLog }));

const { logResolvedTaskModels } = await import('../model-resolution-logger.js');

const ALL_TASKS = [
  'clarification', 'preflight', 'draft_graph', 'edit_graph', 'bias_check',
  'evidence_helper', 'sensitivity_coach', 'options', 'suggest_options',
  'explainer', 'orchestrator', 'repair_graph', 'critique_graph', 'decision_review',
] as const;

describe('logResolvedTaskModels', () => {
  beforeEach(() => {
    logInfoCalls.length = 0;
    mockLog.info.mockClear();
    mockConfig.cee.models = {};
    mockConfig.cee.modelSelection.taskModels = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits exactly one log line per CeeTask (Gate 6)', () => {
    logResolvedTaskModels();
    const taskLines = logInfoCalls.filter((c) => c.obj['event'] === 'model.task_resolved');
    expect(taskLines).toHaveLength(14); // 14 CeeTasks
  });

  it('emits one caveat note line before task lines', () => {
    logResolvedTaskModels();
    expect(logInfoCalls[0].obj['event']).toBe('model.startup_resolution_note');
  });

  it('covers all 14 CeeTask values', () => {
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
});
