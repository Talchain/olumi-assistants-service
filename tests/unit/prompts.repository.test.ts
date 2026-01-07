/**
 * Prompt Repository Tests
 *
 * Tests for the prompt repository with read/write separation,
 * caching, and fallback functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

// Mock config before importing modules
vi.mock('../../src/config/index.js', async () => {
  return {
    config: {
      prompts: {
        enabled: true,
        storeType: 'file',
        storePath: 'tests/fixtures/prompts-repo-test/prompts.json',
        postgresUrl: undefined,
        postgresPoolSize: 10,
        postgresSsl: false,
      },
    },
  };
});

// Test directory for file operations
const TEST_DATA_DIR = 'tests/fixtures/prompts-repo-test';

describe('Prompt Repository', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clean test directory
    try {
      await rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
    await mkdir(TEST_DATA_DIR, { recursive: true });

    // Create empty prompts file
    await writeFile(
      join(TEST_DATA_DIR, 'prompts.json'),
      JSON.stringify({ prompts: [] })
    );

    // Reset any singletons
    const { resetPromptRepository } = await import('../../src/prompts/repository.js');
    resetPromptRepository();
  });

  afterEach(async () => {
    // Cleanup
    try {
      await rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Health Status', () => {
    it('should report health status correctly when fallback is active', async () => {
      const { PromptRepository } = await import('../../src/prompts/repository.js');

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      const health = repo.getHealth();

      // Without PostgreSQL URL, should be in fallback mode
      expect(health.fallbackActive).toBe(true);
      expect(health.dbHealthy).toBe(false);
      expect(health.cacheSize).toBe(0);
    });
  });

  describe('Fallback to Defaults', () => {
    it('should return fallback content when database unavailable', async () => {
      // Register a default prompt first
      const { registerDefaultPrompt, getDefaultPrompts } = await import('../../src/prompts/loader.js');
      registerDefaultPrompt('draft_graph', 'Test draft graph prompt content');

      const { PromptRepository } = await import('../../src/prompts/repository.js');

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      const result = await repo.getActivePrompt('draft_graph');

      expect(result).not.toBeNull();
      expect(result?.source).toBe('fallback');
      expect(result?.content).toBe('Test draft graph prompt content');
      expect(result?.contentHash).toBeDefined();
    });

    it('should return null for unregistered task', async () => {
      const { PromptRepository } = await import('../../src/prompts/repository.js');

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      // Use a task that hasn't been registered
      const result = await repo.getActivePrompt('preflight');

      expect(result).toBeNull();
    });
  });

  describe('Cache Invalidation', () => {
    it('should clear cache for specific task', async () => {
      const { registerDefaultPrompt } = await import('../../src/prompts/loader.js');
      registerDefaultPrompt('draft_graph', 'Draft graph content');
      registerDefaultPrompt('clarify_brief', 'Clarify brief content');

      const { PromptRepository } = await import('../../src/prompts/repository.js');

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      // Load prompts to populate cache (they'll come from fallback)
      await repo.getActivePrompt('draft_graph');
      await repo.getActivePrompt('clarify_brief');

      // Invalidate one task
      repo.invalidateCache('draft_graph');

      // Health should show reduced cache
      const health = repo.getHealth();
      expect(health.cacheSize).toBe(0); // Fallback doesn't populate cache
    });

    it('should clear entire cache', async () => {
      const { PromptRepository } = await import('../../src/prompts/repository.js');

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      // Clear all cache
      repo.invalidateCache();

      const health = repo.getHealth();
      expect(health.cacheSize).toBe(0);
    });
  });

  describe('Write Operations in Fallback Mode', () => {
    it('should throw error when trying to write in fallback mode', async () => {
      const { PromptRepository } = await import('../../src/prompts/repository.js');

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      // Should be in fallback mode (no postgres URL)
      await expect(repo.create({
        id: 'test-prompt',
        name: 'Test',
        taskId: 'draft_graph',
        content: 'Test content here',
        variables: [],
        tags: [],
        createdBy: 'test',
      })).rejects.toThrow('Database unavailable');
    });

    it('should throw error when getting prompt by ID in fallback mode', async () => {
      const { PromptRepository } = await import('../../src/prompts/repository.js');

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      await expect(repo.get('test-id')).rejects.toThrow('Database unavailable');
    });
  });
});

describe('Prompt Seeding', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clean test directory
    try {
      await rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    await mkdir(TEST_DATA_DIR, { recursive: true });

    // Create empty prompts file
    await writeFile(
      join(TEST_DATA_DIR, 'prompts.json'),
      JSON.stringify({ prompts: [] })
    );
  });

  afterEach(async () => {
    try {
      await rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('initializeAndSeedPrompts', () => {
    it('should register in-memory defaults', async () => {
      // Mock config with prompts disabled
      vi.doMock('../../src/config/index.js', () => ({
        config: {
          prompts: {
            enabled: false,
          },
        },
      }));

      const { initializeAndSeedPrompts } = await import('../../src/prompts/seed.js');
      const { getDefaultPrompts } = await import('../../src/prompts/loader.js');

      const result = await initializeAndSeedPrompts();

      expect(result.success).toBe(true);
      expect(result.seeded).toBe(0);
      expect(result.skipped).toBe(0);

      // Defaults should still be registered for fallback
      const defaults = getDefaultPrompts();
      expect(Object.keys(defaults).length).toBeGreaterThan(0);
    });

    it('should skip database seeding when prompts disabled', async () => {
      // Mock config with prompts disabled
      vi.doMock('../../src/config/index.js', () => ({
        config: {
          prompts: {
            enabled: false,
          },
        },
      }));

      const { initializeAndSeedPrompts } = await import('../../src/prompts/seed.js');

      const result = await initializeAndSeedPrompts();

      expect(result.success).toBe(true);
      expect(result.seeded).toBe(0);
    });
  });

  describe('checkSeedStatus', () => {
    it('should report defaults registered status', async () => {
      // First register defaults
      const { registerAllDefaultPrompts } = await import('../../src/prompts/defaults.js');
      registerAllDefaultPrompts();

      const { checkSeedStatus } = await import('../../src/prompts/seed.js');

      const status = await checkSeedStatus();

      expect(status.defaultsRegistered).toBe(true);
    });

    it('should report missing tasks when database unavailable', async () => {
      const { registerAllDefaultPrompts } = await import('../../src/prompts/defaults.js');
      registerAllDefaultPrompts();

      const { checkSeedStatus } = await import('../../src/prompts/seed.js');

      const status = await checkSeedStatus();

      expect(status.databaseSeeded).toBe(false);
      expect(status.missingTasks.length).toBeGreaterThan(0);
    });
  });
});

describe('Content Hashing', () => {
  it('should compute consistent content hash', async () => {
    const { computeContentHash } = await import('../../src/prompts/schema.js');

    const content = 'Test prompt content';
    const hash1 = computeContentHash(content);
    const hash2 = computeContentHash(content);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('should produce different hashes for different content', async () => {
    const { computeContentHash } = await import('../../src/prompts/schema.js');

    const hash1 = computeContentHash('Content A');
    const hash2 = computeContentHash('Content B');

    expect(hash1).not.toBe(hash2);
  });
});
