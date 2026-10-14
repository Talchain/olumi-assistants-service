/**
 * VERBATIM from DecisionGuideAI `src/canvas/conversation/narrationTurn.ts` at staging d605824e9ddac82766fe8baf12654facfa2fcdad
 * (extracted by script, never retyped): the UI's rule for a Run turn's `narration`. `useConversation.ts` sets the latest
 * run key only from `namesALatestRun`, then drops the WHOLE assistant message when `isForeignExplanation` holds.
 */
export const NARRATION_STATUSES = ['pending', 'ready', 'stale', 'unavailable'] as const
export type NarrationStatus = (typeof NARRATION_STATUSES)[number]

export interface TurnNarration {
  readonly status: NarrationStatus
  readonly runKey: string
}

export function namesALatestRun(n: TurnNarration | null): n is TurnNarration {
  return n !== null && (n.status === 'pending' || n.status === 'unavailable')
}

export function isForeignExplanation(n: TurnNarration | null, latestRunKey: string | null): boolean {
  return n !== null && n.status === 'ready' && n.runKey !== latestRunKey
}
