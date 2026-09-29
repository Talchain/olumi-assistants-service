/**
 * Process-local registry for checked-in prompt fallbacks.
 *
 * This leaf module is intentionally independent of the prompt loader/store so
 * both can inspect the same fallback bytes without creating a loader <-> store
 * import cycle. Registration still happens explicitly during server startup.
 */

import type { CeeTaskId } from './schema.js';

const defaultPrompts: Partial<Record<CeeTaskId, string>> = {};

export function registerDefaultPrompt(
  taskId: CeeTaskId,
  content: string,
): void {
  defaultPrompts[taskId] = content;
}

export function getRegisteredDefaultPrompt(
  taskId: string,
): string | undefined {
  return defaultPrompts[taskId as CeeTaskId];
}

export function getDefaultPrompts(): Partial<Record<CeeTaskId, string>> {
  return { ...defaultPrompts };
}
