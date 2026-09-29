/**
 * Tests for Prompt Activation Guard
 *
 * Verifies that:
 * - When guard is enabled (default), automated migration creates a version but does NOT activate it
 * - When guard is disabled, old behavior is preserved (version created AND activated)
 * - When hashes match, no version is created at all (early exit)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mutable state (accessible inside vi.mock factories) ---
const { mockLog, mockEmit, mockRepo, state, MOCK_HASH_DEFAULT } = vi.hoisted(() => {
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const mockEmit = vi.fn();
  const mockRepo = {
    getHealth: vi.fn(),
    seedDefaults: vi.fn(),
    warmCache: vi.fn(),
    get: vi.fn(),
    createVersion: vi.fn(),
    update: vi.fn(),
  };
  const state = {
    promptsConfig: {} as Record<string, unknown>,
    promptsEnabled: true,
    shouldUseStagingResult: true,
  };
  const MOCK_HASH_DEFAULT = 'abc123def456';
  return { mockLog, mockEmit, mockRepo, state, MOCK_HASH_DEFAULT };
});

vi.mock('../../src/utils/telemetry.js', () => ({
  log: mockLog,
  emit: mockEmit,
  TelemetryEvents: {
    PromptActivationBlocked: 'prompt.activation.blocked',
    PromptStagingActivated: 'prompt.staging.activated',
  },
}));

vi.mock('../../src/config/index.js', () => ({
  config: new Proxy({}, {
    get(_target, prop) {
      if (prop === 'prompts') {
        return { enabled: state.promptsEnabled, ...state.promptsConfig };
      }
      return undefined;
    },
  }),
  shouldUseStagingPrompts: () => state.shouldUseStagingResult,
}));

vi.mock('../../src/prompts/repository.js', () => ({
  getPromptRepository: () => mockRepo,
  initializePromptRepository: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/prompts/defaults.js', () => ({
  registerAllDefaultPrompts: vi.fn(),
}));

vi.mock('../../src/prompts/loader.js', () => ({
  getDefaultPrompts: () => ({ orchestrator: 'mock orchestrator prompt content v28' }),
}));

vi.mock('../../src/prompts/schema.js', () => ({
  computeContentHash: (content: string) => {
    if (content === 'mock orchestrator prompt content v28') return MOCK_HASH_DEFAULT;
    return 'xyz789000111';
  },
}));

// --- Import after mocks ---
import { initializeAndSeedPrompts } from '../../src/prompts/seed.js';

describe('Prompt Activation Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.promptsConfig = {};
    state.promptsEnabled = true;
    state.shouldUseStagingResult = true;
    mockRepo.getHealth.mockReturnValue({ dbHealthy: true, fallbackActive: false, cooldownRemaining: 0, cacheSize: 0 });
    mockRepo.seedDefaults.mockResolvedValue({ seeded: 0, skipped: 0 });
    mockRepo.warmCache.mockResolvedValue(undefined);
  });

  describe('auto-migrate disabled (default)', () => {
    it('does not run migration at all when autoMigrateEnabled is false (default)', async () => {
      // autoMigrateEnabled defaults to false — no config override needed
      const result = await initializeAndSeedPrompts();

      expect(result.success).toBe(true);
      expect(mockRepo.get).not.toHaveBeenCalled();
      expect(mockRepo.createVersion).not.toHaveBeenCalled();
    });
  });

  describe('guard enabled (default), auto-migrate on', () => {
    it('creates version but does NOT activate it', async () => {
      state.promptsConfig = { autoMigrateEnabled: true };

      // Existing prompt in store with a different staging version hash
      mockRepo.get.mockResolvedValue({
        taskId: 'orchestrator',
        stagingVersion: 3,
        activeVersion: 2,
        versions: [
          { version: 2, contentHash: 'old_active_hash' },
          { version: 3, contentHash: 'old_staging_hash' },
        ],
      });

      // createVersion returns updated prompt with new version
      mockRepo.createVersion.mockResolvedValue({
        taskId: 'orchestrator',
        versions: [
          { version: 2, contentHash: 'old_active_hash' },
          { version: 3, contentHash: 'old_staging_hash' },
          { version: 4, contentHash: MOCK_HASH_DEFAULT },
        ],
      });

      const result = await initializeAndSeedPrompts();

      expect(result.success).toBe(true);

      // Version was created
      expect(mockRepo.createVersion).toHaveBeenCalledWith('orchestrator_default', {
        content: 'mock orchestrator prompt content v28',
        createdBy: 'system-migration',
        changeNote: 'Auto-migrated orchestrator prompt from registered default (cf-v28)',
      });

      // Activation was NOT called
      expect(mockRepo.update).not.toHaveBeenCalledWith(
        'orchestrator_default',
        expect.objectContaining({ stagingVersion: expect.any(Number) }),
      );

      // Blocked event emitted
      expect(mockEmit).toHaveBeenCalledWith('prompt.activation.blocked', {
        author: 'system-migration',
        prompt_id: 'orchestrator_default',
        version: 4,
        target_environment: 'staging',
        reason: 'automated_activation_not_permitted',
        hash: MOCK_HASH_DEFAULT.slice(0, 16),
      });

      // Startup-visible log emitted
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'prompt.activation.blocked' }),
        expect.stringContaining('Prompt activation guard enabled'),
      );
    });
  });

  describe('guard disabled, auto-migrate on', () => {
    it('creates version AND activates it (old behavior)', async () => {
      state.promptsConfig = { activationGuardEnabled: false, autoMigrateEnabled: true };

      mockRepo.get.mockResolvedValue({
        taskId: 'orchestrator',
        stagingVersion: 3,
        activeVersion: 2,
        versions: [
          { version: 2, contentHash: 'old_active_hash' },
          { version: 3, contentHash: 'old_staging_hash' },
        ],
      });

      mockRepo.createVersion.mockResolvedValue({
        taskId: 'orchestrator',
        versions: [
          { version: 2, contentHash: 'old_active_hash' },
          { version: 3, contentHash: 'old_staging_hash' },
          { version: 4, contentHash: MOCK_HASH_DEFAULT },
        ],
      });

      mockRepo.update.mockResolvedValue({});

      const result = await initializeAndSeedPrompts();

      expect(result.success).toBe(true);

      // Version was created
      expect(mockRepo.createVersion).toHaveBeenCalled();

      // Activation WAS called
      expect(mockRepo.update).toHaveBeenCalledWith('orchestrator_default', { stagingVersion: 4 });

      // No blocked event
      expect(mockEmit).not.toHaveBeenCalledWith(
        'prompt.activation.blocked',
        expect.anything(),
      );
    });
  });

  describe('hash match (early exit), auto-migrate on', () => {
    it('does not create version when staging hash matches default', async () => {
      state.promptsConfig = { autoMigrateEnabled: true };

      mockRepo.get.mockResolvedValue({
        taskId: 'orchestrator',
        stagingVersion: 3,
        activeVersion: 2,
        versions: [
          { version: 2, contentHash: 'old_active_hash' },
          { version: 3, contentHash: MOCK_HASH_DEFAULT }, // matches default
        ],
      });

      const result = await initializeAndSeedPrompts();

      expect(result.success).toBe(true);

      // Neither createVersion nor update was called
      expect(mockRepo.createVersion).not.toHaveBeenCalled();
      expect(mockRepo.update).not.toHaveBeenCalledWith(
        'orchestrator_default',
        expect.objectContaining({ stagingVersion: expect.any(Number) }),
      );

      // No blocked event
      expect(mockEmit).not.toHaveBeenCalledWith(
        'prompt.activation.blocked',
        expect.anything(),
      );
    });

    it('does not create version when active hash matches default', async () => {
      state.promptsConfig = { autoMigrateEnabled: true };

      mockRepo.get.mockResolvedValue({
        taskId: 'orchestrator',
        stagingVersion: undefined,
        activeVersion: 2,
        versions: [
          { version: 2, contentHash: MOCK_HASH_DEFAULT }, // active matches default
        ],
      });

      const result = await initializeAndSeedPrompts();

      expect(result.success).toBe(true);
      expect(mockRepo.createVersion).not.toHaveBeenCalled();
    });

    it('does not create version when an unactivated version matches default hash', async () => {
      state.promptsConfig = { autoMigrateEnabled: true };

      // v4 was created by a previous auto-migration but never activated (guard blocked it).
      // Staging (v3) and active (v2) have different hashes — but v4 already matches.
      mockRepo.get.mockResolvedValue({
        taskId: 'orchestrator',
        stagingVersion: 3,
        activeVersion: 2,
        versions: [
          { version: 2, contentHash: 'old_active_hash' },
          { version: 3, contentHash: 'old_staging_hash' },
          { version: 4, contentHash: MOCK_HASH_DEFAULT }, // unactivated, matches default
        ],
      });

      const result = await initializeAndSeedPrompts();

      expect(result.success).toBe(true);
      expect(mockRepo.createVersion).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalledWith(
        'prompt.activation.blocked',
        expect.anything(),
      );
    });
  });

  describe('non-staging mode', () => {
    it('does not run migration at all when not in staging mode', async () => {
      state.shouldUseStagingResult = false;

      const result = await initializeAndSeedPrompts();

      expect(result.success).toBe(true);
      // get() should not be called for orchestrator migration
      expect(mockRepo.get).not.toHaveBeenCalled();
      expect(mockRepo.createVersion).not.toHaveBeenCalled();
    });
  });
});
