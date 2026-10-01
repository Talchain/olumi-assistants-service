/** Read-only follow-up on the canonical reader's selected Run. No new Run or claim authority. */
import { trimToRecentTurns } from './history-store.js';
import { createHash } from 'node:crypto';
import type { SuggestedAction } from '../compose/types.js';
import { validateAnalysisRunFactIdentity } from '../context/analysis-interpretation-identity.js';

export const RUN_EXPLANATION_PREFIX = 'agent-explain-run:';
export const RUN_EXPLANATION_MESSAGE = 'Explain this result';
export const RUN_RESULT_READY_TEXT = 'Your results are ready. You can view them now or ask me to explain them.';
export const RUN_EXPLANATION_UNAVAILABLE_TEXT = 'I can’t explain that result as current. Check the current results before asking again. Nothing in your model changed.';

export interface RunExplanationRead {
  readonly graphHash?: string;
  readonly analysisState?: unknown;
  readonly analysisResult?: unknown;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function isRunExplanationChip(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(RUN_EXPLANATION_PREFIX);
}

/**
 * The reader already decided currentness and selected the result. Bind the control to its
 * existing fact tuple; a newer Run of the same graph has a different timestamp.
 * This id is a content reference, not an execution id, persistence id or permission grant.
 */
export function runExplanationChip(scenarioId: string, read: RunExplanationRead): SuggestedAction | null {
  const run = record(record(read.analysisState)?.run_state);
  const result = record(read.analysisResult);
  if (run?.kind !== 'complete_current' || result?.type !== 'analysis_result'
    || typeof read.graphHash !== 'string' || read.graphHash.length === 0) return null;
  const identity = validateAnalysisRunFactIdentity({
    scenario_id: scenarioId,
    graph_hash_at_run: result.computed_against_hash,
    computed_at: run.computed_at,
  });
  if (identity.status !== 'confirmed') return null;
  const digest = createHash('sha256').update(JSON.stringify({
    v: 1, run_fact: identity.identity,
  })).digest('hex').slice(0, 16);
  return { id: `${RUN_EXPLANATION_PREFIX}${digest}`, label: RUN_EXPLANATION_MESSAGE, message: RUN_EXPLANATION_MESSAGE };
}

export function runExplanationMatches(id: unknown, scenarioId: string, read: RunExplanationRead): boolean {
  const chip = runExplanationChip(scenarioId, read);
  return chip !== null && chip.id === id;
}

/** Conversation only: old tool results are not another source for this explanation. */
export function recentRunExplanationConversation(history: readonly unknown[]): unknown[] {
  return trimToRecentTurns(history, 3).flatMap((item) => {
    const value = record(item);
    return value?.role === 'user' || value?.role === 'assistant'
      ? [{ role: value.role, content: value.content }] : [];
  });
}
