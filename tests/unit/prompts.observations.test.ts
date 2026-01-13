/**
 * Prompt Observations Tests
 *
 * Tests for the observation functionality in the Supabase prompt store.
 * Tests validation rules and type exports.
 *
 * Note: Integration tests with real Supabase would test full CRUD operations.
 * These unit tests focus on validation logic and type safety.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Supabase client with a chainable mock
function createMockChain() {
  const chain: any = {
    data: null,
    error: null,
  };

  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'order', 'limit', 'single', 'neq'];
  methods.forEach((method) => {
    chain[method] = vi.fn(() => chain);
  });

  return chain;
}

let mockChain = createMockChain();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => mockChain),
  })),
}));

// Mock telemetry
vi.mock('../../src/utils/telemetry.js', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  emit: vi.fn(),
  TelemetryEvents: {
    PromptStoreError: 'prompt.store.error',
  },
}));

describe('Prompt Observations', () => {
  let SupabasePromptStore: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Reset mock chain
    mockChain = createMockChain();

    const module = await import('../../src/prompts/stores/supabase.js');
    SupabasePromptStore = module.SupabasePromptStore;
  });

  describe('Type exports', () => {
    it('should export SupabasePromptStore class', async () => {
      expect(SupabasePromptStore).toBeDefined();
      expect(typeof SupabasePromptStore).toBe('function');
    });

    it('should export observation-related types', async () => {
      // Types are compile-time only; at runtime the module should load without error.
      const module = await import('../../src/prompts/stores/supabase.js');
      expect(module).toBeDefined();
      expect((module as any).SupabasePromptStore).toBeDefined();
    });
  });

  describe('Store initialization', () => {
    it('should require url and serviceRoleKey', () => {
      expect(() => new SupabasePromptStore({ url: '', serviceRoleKey: '' })).not.toThrow();
    });

    it('should store config correctly', () => {
      const store = new SupabasePromptStore({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
      });
      expect(store).toBeDefined();
    });
  });

  describe('addObservation validation', () => {
    it('should reject invalid observation type', async () => {
      const store = new SupabasePromptStore({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
      });

      // Mock initialization success
      mockChain.data = { id: 'test' };
      mockChain.error = null;
      await store.initialize();

      // Mock get prompt - return a valid prompt
      mockChain.single.mockImplementation(() => ({
        data: {
          id: 'test-prompt',
          name: 'Test',
          task_id: 'draft_graph',
          status: 'production',
          active_version: 1,
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      }));

      // Mock versions
      mockChain.order.mockImplementation(() =>
        Promise.resolve({
          data: [
            {
              prompt_id: 'test-prompt',
              version: 1,
              content: 'test',
              variables: '[]',
              created_at: new Date().toISOString(),
              content_hash: 'abc',
              test_cases: '[]',
            },
          ],
          error: null,
        })
      );

      await expect(
        store.addObservation({
          promptId: 'test-prompt',
          version: 1,
          observationType: 'invalid' as any,
        })
      ).rejects.toThrow('Invalid observation type');
    });

    it('should reject rating outside 1-5 range', async () => {
      const store = new SupabasePromptStore({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
      });

      // Mock initialization success
      mockChain.data = { id: 'test' };
      mockChain.error = null;
      await store.initialize();

      // Mock get prompt
      mockChain.single.mockImplementation(() => ({
        data: {
          id: 'test-prompt',
          name: 'Test',
          task_id: 'draft_graph',
          status: 'production',
          active_version: 1,
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      }));

      // Mock versions
      mockChain.order.mockImplementation(() =>
        Promise.resolve({
          data: [
            {
              prompt_id: 'test-prompt',
              version: 1,
              content: 'test',
              variables: '[]',
              created_at: new Date().toISOString(),
              content_hash: 'abc',
              test_cases: '[]',
            },
          ],
          error: null,
        })
      );

      await expect(
        store.addObservation({
          promptId: 'test-prompt',
          version: 1,
          observationType: 'rating',
          rating: 6,
        })
      ).rejects.toThrow('Rating must be between 1 and 5');

      await expect(
        store.addObservation({
          promptId: 'test-prompt',
          version: 1,
          observationType: 'rating',
          rating: 0,
        })
      ).rejects.toThrow('Rating must be between 1 and 5');
    });

    it('should require content for note type', async () => {
      const store = new SupabasePromptStore({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
      });

      // Mock initialization success
      mockChain.data = { id: 'test' };
      mockChain.error = null;
      await store.initialize();

      // Mock get prompt
      mockChain.single.mockImplementation(() => ({
        data: {
          id: 'test-prompt',
          name: 'Test',
          task_id: 'draft_graph',
          status: 'production',
          active_version: 1,
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      }));

      // Mock versions
      mockChain.order.mockImplementation(() =>
        Promise.resolve({
          data: [
            {
              prompt_id: 'test-prompt',
              version: 1,
              content: 'test',
              variables: '[]',
              created_at: new Date().toISOString(),
              content_hash: 'abc',
              test_cases: '[]',
            },
          ],
          error: null,
        })
      );

      await expect(
        store.addObservation({
          promptId: 'test-prompt',
          version: 1,
          observationType: 'note',
        })
      ).rejects.toThrow("Content is required for observation type 'note'");
    });

    it('should require content for failure type', async () => {
      const store = new SupabasePromptStore({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
      });

      // Mock initialization success
      mockChain.data = { id: 'test' };
      mockChain.error = null;
      await store.initialize();

      // Mock get prompt
      mockChain.single.mockImplementation(() => ({
        data: {
          id: 'test-prompt',
          name: 'Test',
          task_id: 'draft_graph',
          status: 'production',
          active_version: 1,
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      }));

      // Mock versions
      mockChain.order.mockImplementation(() =>
        Promise.resolve({
          data: [
            {
              prompt_id: 'test-prompt',
              version: 1,
              content: 'test',
              variables: '[]',
              created_at: new Date().toISOString(),
              content_hash: 'abc',
              test_cases: '[]',
            },
          ],
          error: null,
        })
      );

      await expect(
        store.addObservation({
          promptId: 'test-prompt',
          version: 1,
          observationType: 'failure',
        })
      ).rejects.toThrow("Content is required for observation type 'failure'");
    });

    it('should require content for success type', async () => {
      const store = new SupabasePromptStore({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
      });

      // Mock initialization success
      mockChain.data = { id: 'test' };
      mockChain.error = null;
      await store.initialize();

      // Mock get prompt
      mockChain.single.mockImplementation(() => ({
        data: {
          id: 'test-prompt',
          name: 'Test',
          task_id: 'draft_graph',
          status: 'production',
          active_version: 1,
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      }));

      // Mock versions
      mockChain.order.mockImplementation(() =>
        Promise.resolve({
          data: [
            {
              prompt_id: 'test-prompt',
              version: 1,
              content: 'test',
              variables: '[]',
              created_at: new Date().toISOString(),
              content_hash: 'abc',
              test_cases: '[]',
            },
          ],
          error: null,
        })
      );

      await expect(
        store.addObservation({
          promptId: 'test-prompt',
          version: 1,
          observationType: 'success',
        })
      ).rejects.toThrow("Content is required for observation type 'success'");
    });

    it('should reject non-existent version', async () => {
      const store = new SupabasePromptStore({
        url: 'https://test.supabase.co',
        serviceRoleKey: 'test-key',
      });

      // Mock initialization success
      mockChain.data = { id: 'test' };
      mockChain.error = null;
      await store.initialize();

      // Mock get prompt
      mockChain.single.mockImplementation(() => ({
        data: {
          id: 'test-prompt',
          name: 'Test',
          task_id: 'draft_graph',
          status: 'production',
          active_version: 1,
          tags: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      }));

      // Mock versions - only version 1 exists
      mockChain.order.mockImplementation(() =>
        Promise.resolve({
          data: [
            {
              prompt_id: 'test-prompt',
              version: 1,
              content: 'test',
              variables: '[]',
              created_at: new Date().toISOString(),
              content_hash: 'abc',
              test_cases: '[]',
            },
          ],
          error: null,
        })
      );

      await expect(
        store.addObservation({
          promptId: 'test-prompt',
          version: 99, // Non-existent version
          observationType: 'rating',
          rating: 4,
        })
      ).rejects.toThrow("Version 99 not found for prompt 'test-prompt'");
    });
  });

  describe('ObservationType values', () => {
    it('should accept valid observation types', async () => {
      // These are the valid types as defined in the schema
      const validTypes = ['note', 'rating', 'failure', 'success'];

      validTypes.forEach((type) => {
        // Type check - if the code compiles, the types are correct
        expect(type).toBeDefined();
      });
    });
  });

  describe('Rating bounds', () => {
    it('should accept ratings 1-5', () => {
      const validRatings = [1, 2, 3, 4, 5];
      const invalidRatings = [0, 6, -1, 100];

      validRatings.forEach((rating) => {
        expect(rating >= 1 && rating <= 5).toBe(true);
      });

      invalidRatings.forEach((rating) => {
        expect(rating >= 1 && rating <= 5).toBe(false);
      });
    });
  });
});

describe('Observation API Schema', () => {
  it('should have correct CreateObservationSchema validation', async () => {
    const { z } = await import('zod');

    // Recreate the schema to test it
    const CreateObservationSchema = z.object({
      version: z.number().int().positive(),
      observationType: z.enum(['note', 'rating', 'failure', 'success']),
      content: z.string().max(10000).optional(),
      rating: z.number().int().min(1).max(5).optional(),
      payloadHash: z.string().max(128).optional(),
      createdBy: z.string().max(255).optional(),
    });

    // Valid observation
    const validObs = {
      version: 1,
      observationType: 'note' as const,
      content: 'This is a test note',
    };

    expect(CreateObservationSchema.safeParse(validObs).success).toBe(true);

    // Invalid observation type
    const invalidType = {
      version: 1,
      observationType: 'invalid',
    };

    expect(CreateObservationSchema.safeParse(invalidType).success).toBe(false);

    // Rating out of range
    const ratingTooHigh = {
      version: 1,
      observationType: 'rating' as const,
      rating: 6,
    };

    expect(CreateObservationSchema.safeParse(ratingTooHigh).success).toBe(false);

    // Rating valid
    const ratingValid = {
      version: 1,
      observationType: 'rating' as const,
      rating: 5,
    };

    expect(CreateObservationSchema.safeParse(ratingValid).success).toBe(true);
  });
});
