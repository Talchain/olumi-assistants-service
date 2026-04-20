import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  run,
  WIRED_TARGETS,
  MODEL_CANONICAL_ALLOWLIST,
  validateTargetStrings,
  diffModelConfig,
  checkUrlAllowlist,
  type RunDeps,
  type RunOptions,
} from '../set-model-configs.js';
import type { ModelConfig, PromptDefinition } from '../../../src/prompts/schema.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makePrompt(
  id: string,
  modelConfig: ModelConfig | null | undefined = null,
): PromptDefinition {
  return {
    id,
    name: id,
    description: null,
    taskId: 'orchestrator',
    status: 'production',
    activeVersion: 1,
    stagingVersion: null,
    designVersion: null,
    modelConfig: modelConfig ?? undefined,
    tags: [],
    versions: [
      {
        version: 1,
        content: 'stub',
        variables: [],
        createdBy: null,
        createdAt: new Date().toISOString(),
        changeNote: null,
        contentHash: 'hash',
        requiresApproval: false,
        approvedBy: null,
        approvedAt: null,
        testCases: [],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as PromptDefinition;
}

function makeDeps(overrides?: Partial<RunDeps>): RunDeps & {
  mkdirCalls: string[];
  writeCalls: Array<{ path: string; content: string }>;
  stdoutLines: string[];
  stderrLines: string[];
  updateCalls: Array<{ id: string; request: { modelConfig?: ModelConfig } }>;
  storeMap: Map<string, PromptDefinition>;
} {
  const mkdirCalls: string[] = [];
  const writeCalls: Array<{ path: string; content: string }> = [];
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const updateCalls: Array<{ id: string; request: { modelConfig?: ModelConfig } }> = [];

  // Default: every wired target has null modelConfig in the store.
  const storeMap = new Map<string, PromptDefinition>();
  for (const t of WIRED_TARGETS) {
    storeMap.set(t.id, makePrompt(t.id, null));
  }

  const base: RunDeps = {
    store: {
      initialize: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(async (id: string) => storeMap.get(id) ?? null),
      update: vi.fn(async (id: string, request: { modelConfig?: ModelConfig }) => {
        updateCalls.push({ id, request });
        const existing = storeMap.get(id);
        if (existing && request.modelConfig) {
          storeMap.set(id, { ...existing, modelConfig: request.modelConfig });
        }
        return storeMap.get(id)!;
      }),
    },
    fs: {
      mkdirSync: vi.fn((p: string) => mkdirCalls.push(p)),
      writeFileSync: vi.fn((p: string, c: string) => writeCalls.push({ path: p, content: c })),
    },
    now: () => new Date('2026-04-20T12:00:00.000Z'),
    env: {
      SUPABASE_URL: 'https://myproj.supabase.co',
      SUPABASE_URL_STAGING: 'https://myproj.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service_role_token',
    },
    stdout: (line: string) => stdoutLines.push(line),
    stderr: (line: string) => stderrLines.push(line),
  };

  return Object.assign(
    {
      mkdirCalls,
      writeCalls,
      stdoutLines,
      stderrLines,
      updateCalls,
      storeMap,
    },
    base,
    overrides ?? {},
  ) as RunDeps & {
    mkdirCalls: string[];
    writeCalls: Array<{ path: string; content: string }>;
    stdoutLines: string[];
    stderrLines: string[];
    updateCalls: Array<{ id: string; request: { modelConfig?: ModelConfig } }>;
    storeMap: Map<string, PromptDefinition>;
  };
}

const baseOpts: RunOptions = { target: 'staging', execute: false, verbose: false };

// ── Tests ───────────────────────────────────────────────────────────────

describe('set-model-configs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateTargetStrings', () => {
    it('passes when all strings are in the allowlist', () => {
      const v = validateTargetStrings(WIRED_TARGETS, MODEL_CANONICAL_ALLOWLIST);
      expect(v).toEqual([]);
    });

    it('rejects strings outside the allowlist', () => {
      const rogue = [
        { id: 't1', staging: 'gpt-3.5-turbo', production: 'claude-sonnet-4-6' },
      ];
      const v = validateTargetStrings(rogue, MODEL_CANONICAL_ALLOWLIST);
      expect(v).toHaveLength(1);
      expect(v[0]).toContain('gpt-3.5-turbo');
    });
  });

  describe('diffModelConfig', () => {
    it('returns update when current is null', () => {
      expect(diffModelConfig(null, { staging: 'a', production: 'b' })).toBe('update');
    });
    it('returns match when both fields equal', () => {
      expect(
        diffModelConfig({ staging: 'a', production: 'b' }, { staging: 'a', production: 'b' }),
      ).toBe('match');
    });
    it('returns update when staging differs', () => {
      expect(
        diffModelConfig({ staging: 'x', production: 'b' }, { staging: 'a', production: 'b' }),
      ).toBe('update');
    });
  });

  describe('checkUrlAllowlist', () => {
    it('rejects missing SUPABASE_URL', () => {
      const r = checkUrlAllowlist('staging', {});
      expect('error' in r).toBe(true);
    });
    it('rejects non-supabase.co hosts', () => {
      const r = checkUrlAllowlist('staging', { SUPABASE_URL: 'https://example.com' });
      expect('error' in r).toBe(true);
    });
    it('rejects URL mismatch with target-specific env var', () => {
      const r = checkUrlAllowlist('staging', {
        SUPABASE_URL: 'https://a.supabase.co',
        SUPABASE_URL_STAGING: 'https://b.supabase.co',
      });
      expect('error' in r).toBe(true);
      if ('error' in r) expect(r.error).toContain('mismatch');
    });
    it('rejects when SUPABASE_URL_STAGING is not set (strict guard)', () => {
      const r = checkUrlAllowlist('staging', { SUPABASE_URL: 'https://a.supabase.co' });
      expect('error' in r).toBe(true);
      if ('error' in r) expect(r.error).toContain('SUPABASE_URL_STAGING');
    });
    it('rejects when SUPABASE_URL_PRODUCTION is not set (strict guard)', () => {
      const r = checkUrlAllowlist('production', { SUPABASE_URL: 'https://a.supabase.co' });
      expect('error' in r).toBe(true);
      if ('error' in r) expect(r.error).toContain('SUPABASE_URL_PRODUCTION');
    });
    it('accepts matching URL', () => {
      const r = checkUrlAllowlist('staging', {
        SUPABASE_URL: 'https://a.supabase.co',
        SUPABASE_URL_STAGING: 'https://a.supabase.co',
      });
      expect('host' in r).toBe(true);
      if ('host' in r) expect(r.host).toBe('a.supabase.co');
    });
  });

  describe('flag validation', () => {
    it('refuses to run without --target flag', async () => {
      const deps = makeDeps();
      const result = await run({ execute: false, verbose: false }, deps);
      expect(result.exitCode).toBe(2);
      expect(deps.stderrLines.join('\n')).toContain('--target');
    });

    it('refuses invalid --target value', async () => {
      const deps = makeDeps();
      const result = await run(
        { target: 'prod' as unknown as 'production', execute: false, verbose: false },
        deps,
      );
      expect(result.exitCode).toBe(2);
    });

    it('refuses when SUPABASE_URL host does not end with .supabase.co', async () => {
      const deps = makeDeps({
        env: {
          SUPABASE_URL: 'https://example.com',
          SUPABASE_SERVICE_ROLE_KEY: 'k',
        },
      });
      const result = await run(baseOpts, deps);
      expect(result.exitCode).toBe(1);
      expect(deps.storeMap.size).toBe(WIRED_TARGETS.length); // no mutations
      expect((deps.store.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('refuses when SUPABASE_URL does not match SUPABASE_URL_STAGING', async () => {
      const deps = makeDeps({
        env: {
          SUPABASE_URL: 'https://a.supabase.co',
          SUPABASE_URL_STAGING: 'https://b.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'k',
        },
      });
      const result = await run(baseOpts, deps);
      expect(result.exitCode).toBe(1);
      expect((deps.store.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('refuses when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
      const deps = makeDeps({
        env: { SUPABASE_URL: 'https://a.supabase.co', SUPABASE_URL_STAGING: 'https://a.supabase.co' },
      });
      const result = await run(baseOpts, deps);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('dry-run', () => {
    it('does not call store.update', async () => {
      const deps = makeDeps();
      const result = await run(baseOpts, deps);
      expect(result.exitCode).toBe(0);
      expect((deps.store.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('writes before-snapshot and rollback files', async () => {
      const deps = makeDeps();
      await run(baseOpts, deps);
      const paths = deps.writeCalls.map((w) => w.path);
      expect(paths.some((p) => p.includes('model-config-before-staging-'))).toBe(true);
      expect(paths.some((p) => p.includes('model-config-rollback-staging-'))).toBe(true);
    });

    it('reports 9 UPDATE rows when store has no prior config', async () => {
      const deps = makeDeps();
      await run(baseOpts, deps);
      const updateRows = deps.stdoutLines.filter((l) => l.includes(' | UPDATE'));
      expect(updateRows).toHaveLength(WIRED_TARGETS.length);
    });
  });

  describe('execute mode', () => {
    it('calls store.update for each wired task with correct values when all differ', async () => {
      const deps = makeDeps();
      const result = await run({ ...baseOpts, execute: true }, deps);
      expect(result.exitCode).toBe(0);
      expect(result.updated).toBe(WIRED_TARGETS.length);
      expect(result.failed).toBe(0);
      expect(deps.updateCalls).toHaveLength(WIRED_TARGETS.length);
      for (const t of WIRED_TARGETS) {
        const call = deps.updateCalls.find((c) => c.id === t.id);
        expect(call).toBeDefined();
        expect(call!.request.modelConfig).toEqual({
          staging: t.staging,
          production: t.production,
        });
      }
    });

    it('skips tasks where current modelConfig already matches target', async () => {
      const deps = makeDeps();
      // Pre-set 3 tasks to target values.
      const preset = WIRED_TARGETS.slice(0, 3);
      for (const t of preset) {
        deps.storeMap.set(
          t.id,
          makePrompt(t.id, { staging: t.staging, production: t.production }),
        );
      }
      const result = await run({ ...baseOpts, execute: true }, deps);
      expect(result.skipped).toBe(3);
      expect(result.updated).toBe(WIRED_TARGETS.length - 3);
      expect(deps.updateCalls).toHaveLength(WIRED_TARGETS.length - 3);
    });

    it('is idempotent: second run with all matching calls store.update zero times', async () => {
      const deps = makeDeps();
      // Seed all tasks with target values.
      for (const t of WIRED_TARGETS) {
        deps.storeMap.set(
          t.id,
          makePrompt(t.id, { staging: t.staging, production: t.production }),
        );
      }
      const result = await run({ ...baseOpts, execute: true }, deps);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(WIRED_TARGETS.length);
      expect(deps.updateCalls).toHaveLength(0);
    });

    it('unwired task ids never appear in update calls', async () => {
      const deps = makeDeps();
      await run({ ...baseOpts, execute: true }, deps);
      const unwired = ['bias_check_default', 'critique_graph_default', 'suggest_options_default'];
      for (const u of unwired) {
        expect(deps.updateCalls.find((c) => c.id === u)).toBeUndefined();
      }
    });

    it('writes snapshot AND rollback before any store.update call (hard prerequisite)', async () => {
      const deps = makeDeps();
      // Capture the order of fs writes vs store.update calls.
      const events: string[] = [];
      deps.fs.writeFileSync = vi.fn((p: string, _c: string) => {
        events.push(`write:${p.split('/').pop()}`);
      }) as unknown as RunDeps['fs']['writeFileSync'];
      deps.store.update = vi.fn(async (id: string) => {
        events.push(`update:${id}`);
        return makePrompt(id);
      }) as unknown as RunDeps['store']['update'];
      await run({ ...baseOpts, execute: true }, deps);
      const firstUpdateIdx = events.findIndex((e) => e.startsWith('update:'));
      const beforeSnap = events.findIndex((e) => e.includes('model-config-before-'));
      const rollbackSnap = events.findIndex((e) => e.includes('model-config-rollback-'));
      expect(beforeSnap).toBeGreaterThanOrEqual(0);
      expect(rollbackSnap).toBeGreaterThanOrEqual(0);
      expect(beforeSnap).toBeLessThan(firstUpdateIdx);
      expect(rollbackSnap).toBeLessThan(firstUpdateIdx);
    });

    it('aborts before any store.update when snapshot write fails', async () => {
      const deps = makeDeps();
      deps.fs.writeFileSync = vi.fn(() => {
        throw new Error('disk full');
      }) as unknown as RunDeps['fs']['writeFileSync'];
      const result = await run({ ...baseOpts, execute: true }, deps);
      expect(result.exitCode).toBe(1);
      expect((deps.store.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('continues loop on per-task failure and reports failed count', async () => {
      const deps = makeDeps();
      let call = 0;
      deps.store.update = vi.fn(async (id: string, req: { modelConfig?: ModelConfig }) => {
        call += 1;
        if (call === 2) throw new Error('transient');
        deps.updateCalls.push({ id, request: req });
        return makePrompt(id);
      }) as unknown as RunDeps['store']['update'];
      const result = await run({ ...baseOpts, execute: true }, deps);
      expect(result.failed).toBe(1);
      expect(result.exitCode).toBe(1);
      expect(result.updated).toBe(WIRED_TARGETS.length - 1);
    });

    it('hard-errors when a wired prompt is missing from the store', async () => {
      const deps = makeDeps();
      deps.storeMap.delete('draft_graph_default');
      const result = await run({ ...baseOpts, execute: true }, deps);
      expect(result.exitCode).toBe(1);
      expect(deps.stderrLines.join('\n')).toContain('draft_graph_default');
      expect((deps.store.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });
  });

  describe('allowlist integrity', () => {
    it('WIRED_TARGETS is exactly the nine expected task ids', () => {
      const ids = WIRED_TARGETS.map((t) => t.id);
      expect(ids).toEqual([
        'orchestrator_default',
        'draft_graph_default',
        'edit_graph_default',
        'repair_graph_default',
        'decision_review_default',
        'explainer_default',
        'validate_graph_default',
        'repair_edit_graph_default',
        'clarify_brief_default',
      ]);
    });

    it('MODEL_CANONICAL_ALLOWLIST contains only the two brief-approved model strings', () => {
      expect(MODEL_CANONICAL_ALLOWLIST).toEqual(['claude-sonnet-4-6', 'gpt-4.1-2025-04-14']);
    });
  });
});
