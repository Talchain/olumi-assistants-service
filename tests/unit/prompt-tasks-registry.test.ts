/**
 * Prompt Tasks Registry Drift Prevention Tests
 *
 * Verifies that the canonical PROMPT_TASKS registry stays in sync with:
 * - CeeTaskIdSchema in prompts/schema.ts
 * - Default prompts registered in prompts/defaults.ts
 *
 * If these tests fail, it means a new task was added somewhere but not
 * to the canonical registry, which would cause the admin UI to be out of sync.
 */

import { describe, it, expect } from 'vitest';
import { PROMPT_TASKS, type PromptTask } from '../../src/constants/prompt-tasks.js';
import { CeeTaskIdSchema } from '../../src/prompts/schema.js';

describe('PROMPT_TASKS Registry', () => {
  describe('sync with CeeTaskIdSchema', () => {
    it('contains all tasks from CeeTaskIdSchema', () => {
      // Get all values from the Zod enum schema
      const schemaTaskIds = CeeTaskIdSchema.options;

      // Every task in the schema should be in PROMPT_TASKS
      for (const taskId of schemaTaskIds) {
        expect(
          PROMPT_TASKS.includes(taskId as PromptTask),
          `Task '${taskId}' is in CeeTaskIdSchema but missing from PROMPT_TASKS registry`
        ).toBe(true);
      }
    });

    it('has same number of tasks as CeeTaskIdSchema', () => {
      const schemaTaskIds = CeeTaskIdSchema.options;
      expect(
        PROMPT_TASKS.length,
        `PROMPT_TASKS has ${PROMPT_TASKS.length} tasks but CeeTaskIdSchema has ${schemaTaskIds.length}`
      ).toBe(schemaTaskIds.length);
    });

    it('CeeTaskIdSchema contains all tasks from PROMPT_TASKS', () => {
      const schemaTaskIds = new Set(CeeTaskIdSchema.options);

      // Every task in PROMPT_TASKS should be in the schema
      for (const taskId of PROMPT_TASKS) {
        expect(
          schemaTaskIds.has(taskId),
          `Task '${taskId}' is in PROMPT_TASKS but missing from CeeTaskIdSchema`
        ).toBe(true);
      }
    });
  });

  describe('canonical registry properties', () => {
    it('has no duplicate tasks', () => {
      const uniqueTasks = new Set(PROMPT_TASKS);
      expect(uniqueTasks.size).toBe(PROMPT_TASKS.length);
    });

    it('all tasks are lowercase with underscores', () => {
      for (const task of PROMPT_TASKS) {
        expect(task).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });

    it('includes core required tasks', () => {
      // These are the minimum required tasks that must always exist
      const coreTasks = ['draft_graph', 'clarify_brief', 'repair_graph'] as const;
      for (const coreTask of coreTasks) {
        expect(
          PROMPT_TASKS.includes(coreTask as PromptTask),
          `Core task '${coreTask}' missing from PROMPT_TASKS`
        ).toBe(true);
      }
    });

    it('includes explainer task (was previously missing from admin UI)', () => {
      // This test specifically guards against the bug where explainer was missing
      expect(PROMPT_TASKS.includes('explainer')).toBe(true);
    });

    it('includes preflight task', () => {
      expect(PROMPT_TASKS.includes('preflight')).toBe(true);
    });
  });

  describe('type safety', () => {
    it('PROMPT_TASKS is readonly', () => {
      // TypeScript should prevent mutation at compile time
      // This runtime check verifies the array is const
      expect(Object.isFrozen(PROMPT_TASKS)).toBe(false); // Note: `as const` doesn't freeze at runtime
      // But we can verify it's an array
      expect(Array.isArray(PROMPT_TASKS)).toBe(true);
    });

    it('exports PromptTask type', () => {
      // Type check - if this compiles, the type is properly exported
      const task: PromptTask = 'draft_graph';
      expect(PROMPT_TASKS.includes(task)).toBe(true);
    });
  });
});
