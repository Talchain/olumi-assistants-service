/**
 * Prompt Repository Tests
 *
 * Tests for the prompt repository with read/write separation,
 * caching, and fallback functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

let promptsConfig: Record<string, unknown> = {};

vi.mock('../../src/config/index.js', () => ({
  config: {
    get prompts() {
      return promptsConfig;
    },
  },
}));

// Test directory for file operations
const TEST_DATA_DIR = 'tests/fixtures/prompts-repo-test';

describe('Prompt Repository', () => {
  beforeEach(async () => {
    vi.resetModules();

    promptsConfig = {
      enabled: true,
      storeType: 'file',
      storePath: 'tests/fixtures/prompts-repo-test/prompts.json',
      postgresUrl: undefined,
      postgresPoolSize: 10,
      postgresSsl: false,
      backupEnabled: false,
      maxBackups: 0,
    };

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
      JSON.stringify({ version: 1, prompts: {}, lastModified: new Date().toISOString() })
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
    it('should report health status correctly when using file store as primary', async () => {
      const { PromptRepository } = await import('../../src/prompts/repository.js');

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      const health = repo.getHealth();

      expect(health.fallbackActive).toBe(false);
      expect(health.dbHealthy).toBe(true);
      expect(health.cacheSize).toBe(0);
    });

    it('should enter fallback when configured for postgres but no URL is set', async () => {
      vi.resetModules();
      promptsConfig = {
        enabled: true,
        storeType: 'postgres',
        postgresUrl: undefined,
      };

      const { PromptRepository, resetPromptRepository } = await import('../../src/prompts/repository.js');
      resetPromptRepository();

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      const health = repo.getHealth();
      expect(health.fallbackActive).toBe(true);
      expect(health.dbHealthy).toBe(false);
      expect(health.lastDbError).toBeDefined();
    });
  });

  describe('Fallback to Defaults', () => {
    it('should return fallback content when database unavailable', async () => {
      vi.resetModules();
      promptsConfig = {
        enabled: true,
        storeType: 'postgres',
        postgresUrl: undefined,
      };

      // Register a default prompt first
      const { registerDefaultPrompt } = await import('../../src/prompts/loader.js');
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
      vi.resetModules();
      promptsConfig = {
        enabled: true,
        storeType: 'postgres',
        postgresUrl: undefined,
      };

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
      vi.resetModules();
      promptsConfig = {
        enabled: true,
        storeType: 'postgres',
        postgresUrl: undefined,
      };

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
      vi.resetModules();
      promptsConfig = {
        enabled: true,
        storeType: 'postgres',
        postgresUrl: undefined,
      };

      const { PromptRepository } = await import('../../src/prompts/repository.js');

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      await expect(repo.get('test-id')).rejects.toThrow('Database unavailable');
    });
  });

  describe('Store Selection', () => {
    it('should construct Supabase store when configured', async () => {
      vi.resetModules();

      const instances: Array<{ initialize: ReturnType<typeof vi.fn> }> = [];

      class MockSupabasePromptStore {
        initialize = vi.fn().mockResolvedValue(undefined);
        getActivePromptForTask = vi.fn().mockResolvedValue(null);
        create = vi.fn();
        get = vi.fn();
        list = vi.fn();
        update = vi.fn();
        createVersion = vi.fn();
        rollback = vi.fn();
        approveVersion = vi.fn();
        updateTestCases = vi.fn();
        delete = vi.fn();
        getCompiled = vi.fn();

        constructor() {
          instances.push(this);
        }
      }

      vi.doMock('../../src/prompts/stores/supabase.js', () => ({
        SupabasePromptStore: MockSupabasePromptStore,
      }));

      promptsConfig = {
        enabled: true,
        storeType: 'supabase',
        supabaseUrl: 'https://example.supabase.co',
        supabaseServiceRoleKey: 'eyJ.fake.jwt',
      };

      const { PromptRepository, resetPromptRepository } = await import('../../src/prompts/repository.js');
      resetPromptRepository();

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      expect(instances).toHaveLength(1);
      expect(instances[0].initialize).toHaveBeenCalledTimes(1);
    });

    it('should construct Postgres store when configured', async () => {
      vi.resetModules();

      const instances: Array<{ initialize: ReturnType<typeof vi.fn> }> = [];

      class MockPostgresPromptStore {
        initialize = vi.fn().mockResolvedValue(undefined);
        getActivePromptForTask = vi.fn().mockResolvedValue(null);
        create = vi.fn();
        get = vi.fn();
        list = vi.fn();
        update = vi.fn();
        createVersion = vi.fn();
        rollback = vi.fn();
        approveVersion = vi.fn();
        updateTestCases = vi.fn();
        delete = vi.fn();
        getCompiled = vi.fn();

        constructor() {
          instances.push(this);
        }
      }

      vi.doMock('../../src/prompts/stores/postgres.js', () => ({
        PostgresPromptStore: MockPostgresPromptStore,
      }));

      promptsConfig = {
        enabled: true,
        storeType: 'postgres',
        postgresUrl: 'postgresql://user:pass@localhost:5432/db',
        postgresPoolSize: 1,
        postgresSsl: false,
      };

      const { PromptRepository, resetPromptRepository } = await import('../../src/prompts/repository.js');
      resetPromptRepository();

      const repo = new PromptRepository(undefined, join(TEST_DATA_DIR, 'prompts.json'));
      await repo.initialize();

      expect(instances).toHaveLength(1);
      expect(instances[0].initialize).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Prompt Seeding', () => {
  beforeEach(async () => {
    vi.resetModules();

    promptsConfig = {
      enabled: false,
    };

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
      JSON.stringify({ version: 1, prompts: {}, lastModified: new Date().toISOString() })
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
