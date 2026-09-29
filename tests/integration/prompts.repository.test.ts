/**
 * Prompt Repository Integration Tests
 *
 * Tests for the prompt repository with PostgreSQL integration.
 * These tests require a PostgreSQL database to be available.
 *
 * To run with a real database, set:
 * PROMPTS_POSTGRES_URL=postgresql://user:pass@localhost:5432/test_db
 *
 * Without the env var, these tests will be skipped.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const POSTGRES_URL = process.env.PROMPTS_POSTGRES_URL;

describe.skipIf(!POSTGRES_URL)('Prompt Repository (PostgreSQL)', () => {
  let repo: Awaited<ReturnType<typeof import('../../src/prompts/repository.js').getPromptRepository>>;

  beforeAll(async () => {
    const { PromptRepository } = await import('../../src/prompts/repository.js');
    repo = new PromptRepository(POSTGRES_URL!);
    await repo.initialize();
  });

  beforeEach(async () => {
    // Clear cache before each test
    repo.invalidateCache();
  });

  it('should initialize with healthy database', () => {
    const health = repo.getHealth();
    expect(health.dbHealthy).toBe(true);
    expect(health.fallbackActive).toBe(false);
  });

  it('should create and retrieve a prompt', async () => {
    const testId = `test-prompt-${Date.now()}`;

    await repo.create({
      id: testId,
      name: 'Integration Test Prompt',
      taskId: 'draft_graph',
      content: 'This is a test prompt for integration testing.',
      variables: [],
      tags: ['integration-test'],
      createdBy: 'test-runner',
    });

    const result = await repo.get(testId);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(testId);
    expect(result?.name).toBe('Integration Test Prompt');
    expect(result?.taskId).toBe('draft_graph');
  });

  it('should list prompts by task', async () => {
    const prompts = await repo.list({ taskId: 'draft_graph' });
    expect(Array.isArray(prompts)).toBe(true);
  });

  it('should seed defaults non-destructively', async () => {
    // Register defaults first
    const { registerAllDefaultPrompts } = await import('../../src/prompts/defaults.js');
    registerAllDefaultPrompts();

    const result = await repo.seedDefaults();

    expect(result.seeded).toBeGreaterThanOrEqual(0);
    expect(result.skipped).toBeGreaterThanOrEqual(0);
    expect(result.seeded + result.skipped).toBeGreaterThan(0);
  });

  it('should cache prompts after first read', async () => {
    // Seed to ensure we have a production prompt
    const { registerAllDefaultPrompts } = await import('../../src/prompts/defaults.js');
    registerAllDefaultPrompts();
    await repo.seedDefaults();

    // First read - should hit database
    const result1 = await repo.getActivePrompt('draft_graph');
    expect(result1?.source).toBe('database');

    // Second read - should hit cache
    const result2 = await repo.getActivePrompt('draft_graph');
    expect(result2?.source).toBe('cache');
  });

  it('should invalidate cache after write', async () => {
    // Ensure cache is populated
    await repo.warmCache();

    const healthBefore = repo.getHealth();
    const cacheSizeBefore = healthBefore.cacheSize;

    // Invalidate specific task
    repo.invalidateCache('draft_graph');

    const healthAfter = repo.getHealth();
    expect(healthAfter.cacheSize).toBeLessThanOrEqual(cacheSizeBefore);
  });
});

// Smoke test that works without database
describe('Prompt Repository (No Database)', () => {
  it('should activate fallback when database unavailable', async () => {
    const { PromptRepository, resetPromptRepository } = await import('../../src/prompts/repository.js');
    resetPromptRepository();

    const repo = new PromptRepository('postgresql://invalid:invalid@localhost:9999/nonexistent');
    await repo.initialize();

    const health = repo.getHealth();
    expect(health.fallbackActive).toBe(true);
    expect(health.dbHealthy).toBe(false);
    expect(health.lastDbError).toBeDefined();
  });

  it('should fallback to defaults when database unavailable', async () => {
    const { registerDefaultPrompt } = await import('../../src/prompts/loader.js');
    registerDefaultPrompt('draft_graph', 'Fallback test content');

    const { PromptRepository, resetPromptRepository } = await import('../../src/prompts/repository.js');
    resetPromptRepository();

    const repo = new PromptRepository('postgresql://invalid:invalid@localhost:9999/nonexistent');
    await repo.initialize();

    const result = await repo.getActivePrompt('draft_graph');

    expect(result).not.toBeNull();
    expect(result?.source).toBe('fallback');
    expect(result?.content).toBe('Fallback test content');
  });
});
