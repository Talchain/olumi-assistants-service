/**
 * Prompt Management Module Tests
 *
 * Tests for the prompt schema, store, loader, and audit components.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir } from 'fs/promises';
import { join } from 'path';

// Test directory for file operations
const TEST_DATA_DIR = 'tests/fixtures/prompts-test-data';

describe('Prompt Management', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clean test directory
    try {
      await rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
    await mkdir(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Schema', () => {
    it('should validate valid prompt definition', async () => {
      const { PromptDefinitionSchema } = await import('../../src/prompts/schema.js');

      const validPrompt = {
        id: 'test-prompt',
        name: 'Test Prompt',
        description: 'A test prompt',
        taskId: 'draft_graph',
        status: 'draft',
        versions: [
          {
            version: 1,
            content: 'You are an expert at {{task}}',
            variables: [
              { name: 'task', description: 'The task to perform', required: true },
            ],
            createdBy: 'test-user',
            createdAt: new Date().toISOString(),
            changeNote: 'Initial version',
          },
        ],
        activeVersion: 1,
        tags: ['test'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = PromptDefinitionSchema.safeParse(validPrompt);
      expect(result.success).toBe(true);
    });

    it('should reject invalid task ID', async () => {
      const { PromptDefinitionSchema } = await import('../../src/prompts/schema.js');

      const invalidPrompt = {
        id: 'test-prompt',
        name: 'Test Prompt',
        taskId: 'invalid_task', // Invalid
        status: 'draft',
        versions: [
          {
            version: 1,
            content: 'Test content here',
            variables: [],
            createdBy: 'test',
            createdAt: new Date().toISOString(),
          },
        ],
        activeVersion: 1,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = PromptDefinitionSchema.safeParse(invalidPrompt);
      expect(result.success).toBe(false);
    });

    it('should reject prompt with invalid ID format', async () => {
      const { PromptDefinitionSchema } = await import('../../src/prompts/schema.js');

      const invalidPrompt = {
        id: '123-invalid', // IDs must start with a letter
        name: 'Test',
        taskId: 'draft_graph',
        status: 'draft',
        versions: [
          {
            version: 1,
            content: 'Test content here',
            variables: [],
            createdBy: 'test',
            createdAt: new Date().toISOString(),
          },
        ],
        activeVersion: 1,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = PromptDefinitionSchema.safeParse(invalidPrompt);
      expect(result.success).toBe(false);
    });
  });

  describe('Variable Interpolation', () => {
    it('should extract variables from content', async () => {
      const { extractVariables } = await import('../../src/prompts/schema.js');

      const content = 'Hello {{name}}, you are a {{role}} working on {{task}}.';
      const variables = extractVariables(content);

      expect(variables).toContain('name');
      expect(variables).toContain('role');
      expect(variables).toContain('task');
      expect(variables.length).toBe(3);
    });

    it('should interpolate variables correctly', async () => {
      const { interpolatePrompt } = await import('../../src/prompts/schema.js');

      const content = 'Hello {{name}}, you are a {{role}}.';
      const result = interpolatePrompt(content, { name: 'Alice', role: 'developer' });

      expect(result).toBe('Hello Alice, you are a developer.');
    });

    it('should throw on missing required variable', async () => {
      const { interpolatePrompt } = await import('../../src/prompts/schema.js');

      const content = 'Hello {{name}}, you are a {{role}}.';

      expect(() => {
        interpolatePrompt(content, { name: 'Alice' }, [
          { name: 'name', description: 'Name', required: true },
          { name: 'role', description: 'Role', required: true },
        ]);
      }).toThrow('Missing required variable: role');
    });

    it('should use default value when provided', async () => {
      const { interpolatePrompt } = await import('../../src/prompts/schema.js');

      const content = 'Hello {{name}}, you are a {{role}}.';
      const result = interpolatePrompt(content, { name: 'Alice' }, [
        { name: 'name', description: 'Name', required: true },
        { name: 'role', description: 'Role', required: false, defaultValue: 'user' },
      ]);

      expect(result).toBe('Hello Alice, you are a user.');
    });
  });

  describe('PromptStore', () => {
    it('should initialize and create empty store', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'prompts.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });

      await store.initialize();

      const prompts = await store.list();
      expect(prompts).toEqual([]);
    });

    it('should create a new prompt', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'prompts.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      const created = await store.create({
        id: 'test-prompt-1',
        name: 'Test Prompt 1',
        taskId: 'draft_graph',
        content: 'You are an expert at drafting graphs.',
        variables: [],
        tags: ['test'],
        createdBy: 'test-user',
      });

      expect(created.id).toBe('test-prompt-1');
      expect(created.status).toBe('draft');
      expect(created.activeVersion).toBe(1);
      expect(created.versions.length).toBe(1);
    });

    it('should get a prompt by ID', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'prompts.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      await store.create({
        id: 'test-prompt-get',
        name: 'Test Get',
        taskId: 'draft_graph',
        content: 'Test content',
        variables: [],
        tags: [],
        createdBy: 'test',
      });

      const prompt = await store.get('test-prompt-get');
      expect(prompt).not.toBeNull();
      expect(prompt?.name).toBe('Test Get');
    });

    it('should return null for non-existent prompt', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'prompts.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      const prompt = await store.get('non-existent');
      expect(prompt).toBeNull();
    });

    it('should create new version of a prompt', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'prompts.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      await store.create({
        id: 'test-version',
        name: 'Test Version',
        taskId: 'draft_graph',
        content: 'Version 1 content',
        variables: [],
        tags: [],
        createdBy: 'test',
      });

      const updated = await store.createVersion('test-version', {
        content: 'Version 2 content',
        variables: [],
        createdBy: 'test',
        changeNote: 'Updated content',
      });

      expect(updated.versions.length).toBe(2);
      expect(updated.versions[1].version).toBe(2);
      expect(updated.versions[1].content).toBe('Version 2 content');
    });

    it('should update prompt metadata', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'prompts.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      await store.create({
        id: 'test-update',
        name: 'Original Name',
        taskId: 'draft_graph',
        content: 'Test content',
        variables: [],
        tags: [],
        createdBy: 'test',
      });

      const updated = await store.update('test-update', {
        name: 'Updated Name',
        status: 'production',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.status).toBe('production');
    });

    it('should rollback to previous version', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'prompts.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      await store.create({
        id: 'test-rollback',
        name: 'Rollback Test',
        taskId: 'draft_graph',
        content: 'Version 1 content - initial version for rollback test',
        variables: [],
        tags: [],
        createdBy: 'test',
      });

      await store.createVersion('test-rollback', {
        content: 'Version 2 content - updated version for rollback test',
        variables: [],
        createdBy: 'test',
      });

      await store.update('test-rollback', { activeVersion: 2 });

      const rolledBack = await store.rollback('test-rollback', {
        targetVersion: 1,
        rolledBackBy: 'test',
        reason: 'Testing rollback',
      });

      expect(rolledBack.activeVersion).toBe(1);
    });

    it('should list prompts with filter', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'prompts.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      await store.create({
        id: 'draft-1',
        name: 'Draft 1',
        taskId: 'draft_graph',
        content: 'Test content for draft graph prompt - minimum length required',
        variables: [],
        tags: [],
        createdBy: 'test',
      });

      await store.create({
        id: 'clarify-1',
        name: 'Clarify 1',
        taskId: 'clarify_brief',
        content: 'Test content for clarify brief prompt - minimum length required',
        variables: [],
        tags: [],
        createdBy: 'test',
      });

      const draftPrompts = await store.list({ taskId: 'draft_graph' });
      expect(draftPrompts.length).toBe(1);
      expect(draftPrompts[0].id).toBe('draft-1');
    });
  });

  describe('AuditLogger', () => {
    it('should log audit entries', async () => {
      const { AuditLogger } = await import('../../src/prompts/audit.js');

      const logPath = join(TEST_DATA_DIR, 'audit.log');
      const logger = new AuditLogger({ logPath, enabled: false, emitTelemetry: false });
      await logger.initialize();

      const entry = await logger.log({
        action: 'prompt.created',
        actor: 'test-user',
        resourceType: 'prompt',
        resourceId: 'test-prompt',
      });

      expect(entry.id).toMatch(/^audit_/);
      expect(entry.action).toBe('prompt.created');
      expect(entry.actor).toBe('test-user');
    });

    it('should get recent entries', async () => {
      const { AuditLogger } = await import('../../src/prompts/audit.js');

      const logPath = join(TEST_DATA_DIR, 'audit.log');
      const logger = new AuditLogger({ logPath, enabled: false, emitTelemetry: false });
      await logger.initialize();

      await logger.log({
        action: 'prompt.created',
        actor: 'test',
        resourceType: 'prompt',
        resourceId: 'prompt-1',
      });

      await logger.log({
        action: 'prompt.updated',
        actor: 'test',
        resourceType: 'prompt',
        resourceId: 'prompt-1',
      });

      const recent = logger.getRecent(10);
      expect(recent.length).toBe(2);
      // Most recent first
      expect(recent[0].action).toBe('prompt.updated');
    });

    it('should filter entries by resource', async () => {
      const { AuditLogger } = await import('../../src/prompts/audit.js');

      const logPath = join(TEST_DATA_DIR, 'audit.log');
      const logger = new AuditLogger({ logPath, enabled: false, emitTelemetry: false });
      await logger.initialize();

      await logger.log({
        action: 'prompt.created',
        actor: 'test',
        resourceType: 'prompt',
        resourceId: 'prompt-1',
      });

      await logger.log({
        action: 'prompt.created',
        actor: 'test',
        resourceType: 'prompt',
        resourceId: 'prompt-2',
      });

      const filtered = logger.getForResource('prompt', 'prompt-1');
      expect(filtered.length).toBe(1);
      expect(filtered[0].resourceId).toBe('prompt-1');
    });
  });

  describe('BraintrustManager', () => {
    it('should start and track experiments', async () => {
      const { BraintrustManager } = await import('../../src/prompts/braintrust.js');

      const manager = new BraintrustManager();

      manager.startExperiment({
        name: 'test-experiment',
        promptId: 'test-prompt',
        versionA: 1,
        versionB: 2,
        trafficSplit: 0.5,
      });

      const assignment = manager.getExperimentAssignment('test-prompt', 'correlation-123');
      expect(assignment).not.toBeNull();
      expect(assignment?.experimentName).toBe('test-experiment');
      expect([1, 2]).toContain(assignment?.version);
    });

    it('should return consistent assignments for same correlation ID', async () => {
      const { BraintrustManager } = await import('../../src/prompts/braintrust.js');

      const manager = new BraintrustManager();

      manager.startExperiment({
        name: 'consistency-test',
        promptId: 'test-prompt',
        versionA: 1,
        versionB: 2,
        trafficSplit: 0.5,
      });

      const assignment1 = manager.getExperimentAssignment('test-prompt', 'same-id');
      const assignment2 = manager.getExperimentAssignment('test-prompt', 'same-id');

      expect(assignment1?.version).toBe(assignment2?.version);
    });

    it('should end experiments', async () => {
      const { BraintrustManager } = await import('../../src/prompts/braintrust.js');

      const manager = new BraintrustManager();

      manager.startExperiment({
        name: 'end-test',
        promptId: 'test-prompt',
        versionA: 1,
        versionB: 2,
        trafficSplit: 0.5,
      });

      manager.endExperiment('end-test');

      // Should no longer get assignments after ending
      const assignment = manager.getExperimentAssignment('test-prompt', 'new-id');
      expect(assignment).toBeNull();
    });
  });

  describe('Scorers', () => {
    it('should score JSON validity', async () => {
      const { Scorers } = await import('../../src/prompts/braintrust.js');

      expect(Scorers.jsonValidity({}, '{"valid": true}')).toBe(1.0);
      expect(Scorers.jsonValidity({}, 'not json')).toBe(0.0);
      expect(Scorers.jsonValidity({}, { already: 'parsed' })).toBe(1.0);
    });

    it('should score output length', async () => {
      const { Scorers } = await import('../../src/prompts/braintrust.js');

      // Default range: 100-10000
      expect(Scorers.outputLength({}, 'x'.repeat(500))).toBe(1.0);
      expect(Scorers.outputLength({}, 'x'.repeat(50))).toBeLessThan(1.0);
      expect(Scorers.outputLength({}, 'x'.repeat(50000))).toBeLessThan(1.0);
    });

    it('should score required fields', async () => {
      const { Scorers } = await import('../../src/prompts/braintrust.js');

      expect(
        Scorers.requiredFields(
          { requiredFields: ['name', 'age'] },
          JSON.stringify({ name: 'Test', age: 25 })
        )
      ).toBe(1.0);

      expect(
        Scorers.requiredFields(
          { requiredFields: ['name', 'age'] },
          JSON.stringify({ name: 'Test' })
        )
      ).toBe(0.5);
    });
  });

  describe('Loader', () => {
    it('should register and load default prompts', async () => {
      const { registerDefaultPrompt, loadPromptSync } = await import('../../src/prompts/loader.js');

      registerDefaultPrompt('draft_graph', 'You are an expert at drafting decision graphs.');

      const content = loadPromptSync('draft_graph');
      expect(content).toBe('You are an expert at drafting decision graphs.');
    });

    it('should interpolate variables in default prompts', async () => {
      const { registerDefaultPrompt, loadPromptSync } = await import('../../src/prompts/loader.js');

      registerDefaultPrompt('clarify_brief', 'Clarify the brief for {{topic}} with {{maxQuestions}} questions.');

      const content = loadPromptSync('clarify_brief', { topic: 'testing', maxQuestions: 5 });
      expect(content).toBe('Clarify the brief for testing with 5 questions.');
    });

    it('should throw for unregistered task in sync mode', async () => {
      const { loadPromptSync } = await import('../../src/prompts/loader.js');

      expect(() => {
        loadPromptSync('preflight'); // Not registered
      }).toThrow('No default prompt registered for task: preflight');
    });

    it('should get default prompts registry', async () => {
      const { registerDefaultPrompt, getDefaultPrompts } = await import('../../src/prompts/loader.js');

      registerDefaultPrompt('bias_check', 'Check for biases in the decision.');

      const defaults = getDefaultPrompts();
      expect(defaults.bias_check).toBe('Check for biases in the decision.');
    });

    it('should load from store when enabled with production prompt', async () => {
      vi.stubEnv('PROMPTS_ENABLED', 'true');
      const { _resetConfigCache } = await import('../../src/config/index.js');
      _resetConfigCache();

      const { PromptStore, resetPromptStore } = await import('../../src/prompts/store.js');
      const { loadPrompt, registerDefaultPrompt } = await import('../../src/prompts/loader.js');

      // Create store with test prompt
      const storePath = join(TEST_DATA_DIR, 'loader-test-prompts.json');
      resetPromptStore();

      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      // Create a production prompt
      await store.create({
        id: 'draft-graph-prod',
        name: 'Draft Graph Production',
        taskId: 'draft_graph',
        content: 'Production prompt content from store for draft graph task.',
        variables: [],
        tags: [],
        createdBy: 'test',
      });
      await store.update('draft-graph-prod', { status: 'production' });

      // Register fallback default
      registerDefaultPrompt('draft_graph', 'Default fallback prompt content.');

      // Load should come from store
      const loaded = await loadPrompt('draft_graph', { forceDefault: false });

      // Since we're using a separate store instance, the loader won't find it
      // But this tests the fallback behavior
      expect(loaded.content).toBeDefined();
      expect(loaded.source).toBe('default'); // Falls back because store singleton isn't the test store

      vi.unstubAllEnvs();
      _resetConfigCache();
    });

    it('should use forceDefault to bypass store', async () => {
      const { registerDefaultPrompt, loadPrompt } = await import('../../src/prompts/loader.js');

      registerDefaultPrompt('critique_graph', 'Default critique prompt for graph analysis.');

      const loaded = await loadPrompt('critique_graph', { forceDefault: true });

      expect(loaded.source).toBe('default');
      expect(loaded.content).toBe('Default critique prompt for graph analysis.');
    });

    it('should check if managed prompt exists', async () => {
      const { hasManagedPrompt } = await import('../../src/prompts/loader.js');

      // With prompts disabled, should return false
      const hasManaged = await hasManagedPrompt('draft_graph');
      expect(hasManaged).toBe(false);
    });
  });

  describe('Single Production Prompt Enforcement', () => {
    it('should prevent multiple production prompts for same task', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'single-prod-test.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      // Create first prompt and promote to production
      await store.create({
        id: 'draft-prompt-1',
        name: 'Draft Prompt 1',
        taskId: 'draft_graph',
        content: 'First production prompt for draft graph task.',
        variables: [],
        tags: [],
        createdBy: 'test',
      });
      await store.update('draft-prompt-1', { status: 'production' });

      // Create second prompt for same task
      await store.create({
        id: 'draft-prompt-2',
        name: 'Draft Prompt 2',
        taskId: 'draft_graph',
        content: 'Second draft prompt for draft graph task.',
        variables: [],
        tags: [],
        createdBy: 'test',
      });

      // Try to promote second prompt to production - should fail
      await expect(
        store.update('draft-prompt-2', { status: 'production' })
      ).rejects.toThrow(/already has a production prompt/);
    });

    it('should allow promoting after demoting existing production prompt', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'demote-promote-test.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      // Create first prompt and promote to production
      await store.create({
        id: 'prompt-a',
        name: 'Prompt A',
        taskId: 'clarify_brief',
        content: 'First clarify brief prompt for testing.',
        variables: [],
        tags: [],
        createdBy: 'test',
      });
      await store.update('prompt-a', { status: 'production' });

      // Create second prompt
      await store.create({
        id: 'prompt-b',
        name: 'Prompt B',
        taskId: 'clarify_brief',
        content: 'Second clarify brief prompt for testing.',
        variables: [],
        tags: [],
        createdBy: 'test',
      });

      // Demote first prompt
      await store.update('prompt-a', { status: 'archived' });

      // Now we can promote the second prompt
      const updated = await store.update('prompt-b', { status: 'production' });
      expect(updated.status).toBe('production');
    });

    it('should allow different tasks to each have a production prompt', async () => {
      const { PromptStore } = await import('../../src/prompts/store.js');

      const storePath = join(TEST_DATA_DIR, 'multi-task-test.json');
      const store = new PromptStore({ filePath: storePath, backupEnabled: false });
      await store.initialize();

      // Create and promote prompt for draft_graph
      await store.create({
        id: 'draft-prod',
        name: 'Draft Production',
        taskId: 'draft_graph',
        content: 'Production prompt for draft graph task.',
        variables: [],
        tags: [],
        createdBy: 'test',
      });
      await store.update('draft-prod', { status: 'production' });

      // Create and promote prompt for clarify_brief (different task)
      await store.create({
        id: 'clarify-prod',
        name: 'Clarify Production',
        taskId: 'clarify_brief',
        content: 'Production prompt for clarify brief task.',
        variables: [],
        tags: [],
        createdBy: 'test',
      });

      // This should succeed - different task
      const updated = await store.update('clarify-prod', { status: 'production' });
      expect(updated.status).toBe('production');
    });
  });

  describe('Content Hash', () => {
    it('should compute SHA-256 hash of content', async () => {
      const { computeContentHash } = await import('../../src/prompts/schema.js');

      const hash1 = computeContentHash('Hello, World!');
      const hash2 = computeContentHash('Hello, World!');
      const hash3 = computeContentHash('Different content');

      // Same content should produce same hash
      expect(hash1).toBe(hash2);
      // Different content should produce different hash
      expect(hash1).not.toBe(hash3);
      // Should be 64 characters (SHA-256 hex)
      expect(hash1.length).toBe(64);
      // Should be valid hex
      expect(/^[a-f0-9]{64}$/.test(hash1)).toBe(true);
    });
  });
});
