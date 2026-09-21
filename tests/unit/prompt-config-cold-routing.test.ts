import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import {
  getSystemPromptMeta,
  getSystemPromptSnapshot,
  invalidatePromptCache,
} from '../../src/adapters/llm/prompt-loader.js';
import {
  getAdapterWithResolution,
  resetAdapterCache,
} from '../../src/adapters/llm/router.js';

const TASK_CASES = [
  {
    task: 'draft_graph',
    firstModel: 'claude-sonnet-4-6',
    secondModel: 'claude-sonnet-5',
  },
  {
    task: 'suggest_options',
    firstModel: 'gpt-4o-mini',
    secondModel: 'claude-sonnet-4-6',
  },
  {
    task: 'critique_graph',
    firstModel: 'claude-sonnet-4-6',
    secondModel: 'claude-sonnet-5',
  },
] as const;

beforeAll(() => registerAllDefaultPrompts());

afterEach(() => {
  invalidatePromptCache();
  resetAdapterCache();
  vi.restoreAllMocks();
});

describe('cold/post-invalidation prompt model pins', () => {
  for (const taskCase of TASK_CASES) {
    it(`${taskCase.task}: loads bytes and store pin before adapter selection on cold start and invalidation`, async () => {
      const promptIndex = await import('../../src/prompts/index.js');
      const promptLoader = await import('../../src/prompts/loader.js');
      let phase: 'first' | 'second' = 'first';

      vi.spyOn(promptLoader, 'isPromptManagementEnabled').mockReturnValue(true);
      vi.spyOn(promptIndex, 'loadPrompt').mockImplementation(async (taskId) => ({
        content: `${String(taskId)}:${phase}:served-bytes`,
        source: 'store',
        promptId: `${String(taskId)}_default`,
        version: phase === 'first' ? 1 : 2,
        modelConfig: {
          staging:
            phase === 'first' ? taskCase.firstModel : taskCase.secondModel,
          production:
            phase === 'first' ? taskCase.firstModel : taskCase.secondModel,
        },
      }));

      invalidatePromptCache(taskCase.task);
      const first = await getSystemPromptSnapshot(taskCase.task);
      const firstPin = first.meta.modelConfig?.production;
      expect(first.content).toBe(`${taskCase.task}:first:served-bytes`);
      expect(first.meta.prompt_hash).toBe(
        createHash('sha256').update(first.content).digest('hex'),
      );
      expect(firstPin).toBe(taskCase.firstModel);
      expect(
        getAdapterWithResolution(
          taskCase.task,
          firstPin,
          'store_model_config',
        ).resolution,
      ).toMatchObject({
        resolved_model: taskCase.firstModel,
        resolution_source: 'store_model_config',
      });

      first.meta.modelConfig!.production = 'test-disabled-model';
      expect(
        (await getSystemPromptSnapshot(taskCase.task)).meta.modelConfig
          ?.production,
      ).toBe(taskCase.firstModel);

      // A source change alone cannot split cached bytes from cached metadata.
      phase = 'second';
      const cached = await getSystemPromptSnapshot(taskCase.task);
      expect(cached.content).toBe(`${taskCase.task}:first:served-bytes`);
      expect(cached.meta.modelConfig?.production).toBe(taskCase.firstModel);

      invalidatePromptCache(taskCase.task);
      const second = await getSystemPromptSnapshot(taskCase.task);
      const secondPin = second.meta.modelConfig?.production;
      expect(second.content).toBe(`${taskCase.task}:second:served-bytes`);
      expect(second.meta.prompt_hash).toBe(
        createHash('sha256').update(second.content).digest('hex'),
      );
      expect(secondPin).toBe(taskCase.secondModel);
      expect(
        getAdapterWithResolution(
          taskCase.task,
          secondPin,
          'store_model_config',
        ).resolution,
      ).toMatchObject({
        resolved_model: taskCase.secondModel,
        resolution_source: 'store_model_config',
      });
    });
  }

  it('forceDefault returns default bytes and metadata even when a store pin is cached', async () => {
    const promptIndex = await import('../../src/prompts/index.js');
    const promptLoader = await import('../../src/prompts/loader.js');
    vi.spyOn(promptLoader, 'isPromptManagementEnabled').mockReturnValue(true);
    vi.spyOn(promptIndex, 'loadPrompt').mockResolvedValue({
      content: 'draft:store-served-bytes',
      source: 'store',
      promptId: 'draft_graph_default',
      version: 7,
      modelConfig: {
        staging: 'claude-sonnet-5',
        production: 'claude-sonnet-5',
      },
    });

    invalidatePromptCache('draft_graph');
    const cached = await getSystemPromptSnapshot('draft_graph');
    expect(cached.meta.source).toBe('store');
    expect(cached.meta.modelConfig?.production).toBe('claude-sonnet-5');

    const forcedDefault = await getSystemPromptSnapshot('draft_graph', {
      forceDefault: true,
    });
    expect(forcedDefault.content).not.toBe(cached.content);
    expect(forcedDefault.meta).toMatchObject({
      source: 'default',
      promptId: undefined,
      version: undefined,
      cache_status: 'miss',
      modelConfig: undefined,
    });
    expect(forcedDefault.meta.prompt_hash).toBe(
      createHash('sha256').update(forcedDefault.content).digest('hex'),
    );
  });

  it('keeps transient expiry fallback metadata attached to its default bytes', async () => {
    const promptIndex = await import('../../src/prompts/index.js');
    const promptLoader = await import('../../src/prompts/loader.js');
    let now = 1_000_000;
    let loadCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(promptLoader, 'isPromptManagementEnabled').mockReturnValue(true);
    vi.spyOn(promptIndex, 'loadPrompt').mockImplementation(async () => {
      loadCount += 1;
      if (loadCount === 1) {
        return {
          content: 'draft:store-before-expiry',
          source: 'store',
          promptId: 'draft_graph_default',
          version: 11,
          modelConfig: {
            staging: 'claude-sonnet-5',
            production: 'claude-sonnet-5',
          },
        };
      }
      throw new Error('transient store outage');
    });

    invalidatePromptCache('draft_graph');
    const store = await getSystemPromptSnapshot('draft_graph');
    expect(store.meta.modelConfig?.production).toBe('claude-sonnet-5');

    now += 901_000;
    const fallback = await getSystemPromptSnapshot('draft_graph');
    expect(fallback.content).not.toBe(store.content);
    expect(fallback.meta).toMatchObject({
      source: 'default',
      promptId: undefined,
      version: undefined,
      cache_status: 'miss',
      modelConfig: undefined,
    });
    expect(fallback.meta.prompt_hash).toBe(
      createHash('sha256').update(fallback.content).digest('hex'),
    );

    // The deliberately retained expired cache entry proves the snapshot did
    // not perform a second global-cache read and attach its stale store pin.
    expect(getSystemPromptMeta('draft_graph')).toMatchObject({
      source: 'store',
      cache_status: 'expired',
      modelConfig: { production: 'claude-sonnet-5' },
    });
  });

  it('critique_graph rejects a cold invalid OpenAI store pin before adapter/network use', async () => {
    const promptIndex = await import('../../src/prompts/index.js');
    const promptLoader = await import('../../src/prompts/loader.js');
    vi.spyOn(promptLoader, 'isPromptManagementEnabled').mockReturnValue(true);
    vi.spyOn(promptIndex, 'loadPrompt').mockResolvedValue({
      content: 'critique:served-bytes',
      source: 'store',
      promptId: 'critique_graph_default',
      version: 8,
      modelConfig: { staging: 'gpt-4o', production: 'gpt-4o' },
    });

    invalidatePromptCache('critique_graph');
    const snapshot = await getSystemPromptSnapshot('critique_graph');
    const pin = snapshot.meta.modelConfig?.production;

    expect(() =>
      getAdapterWithResolution('critique_graph', pin, 'store_model_config'),
    ).toThrowError(
      expect.objectContaining({
        code: 'MODEL_PROVIDER_MISMATCH',
        model: 'gpt-4o',
      }),
    );
  });
});
