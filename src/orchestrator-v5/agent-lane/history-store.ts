/**
 * Conversation history, bounded in both directions.
 *
 * ⛔ FOUND IN SELF-REVIEW BEFORE DEPLOY. `SessionBindingRegistry` caps at 500
 * and `ProposalStore` at 200, and this — the store that grows FASTEST — was an
 * unbounded `Map`. Two different problems were hiding in it:
 *
 *   1. process memory grows with every scenario ever touched, for ever;
 *   2. worse, the whole history is replayed to the model on EVERY turn, so a
 *      long conversation costs linearly more tokens and time each turn and
 *      eventually exceeds the context window. That one is a user-visible
 *      failure, not just housekeeping.
 *
 * ⛔ TRIMMING MUST NOT BREAK THE PROTOCOL. The items are Responses-API items:
 * a `function_call` and its `function_call_output` are a PAIR, and a reasoning
 * item belongs with the call that follows it. Cutting at an arbitrary index can
 * orphan a `function_call_output`, which the API rejects. So the trim only ever
 * cuts at the start of a user message — a point where nothing is half-finished.
 */

const DEFAULT_MAX_SESSIONS = 200;
const DEFAULT_MAX_TURNS = 24;

const isUserMessage = (item: unknown): boolean =>
  typeof item === 'object' && item !== null && (item as { role?: unknown }).role === 'user';

/**
 * Keep the most recent `maxTurns` user messages and everything after each.
 * Returns the input unchanged when it is already within budget.
 */
export function trimToRecentTurns(items: readonly unknown[], maxTurns = DEFAULT_MAX_TURNS): unknown[] {
  const starts: number[] = [];
  for (let i = 0; i < items.length; i += 1) if (isUserMessage(items[i])) starts.push(i);
  if (starts.length <= maxTurns) return [...items];
  // Cut at a user-message boundary: never mid pair, never orphaning an output.
  return items.slice(starts[starts.length - maxTurns]);
}

export class HistoryStore {
  private readonly items = new Map<string, unknown[]>();

  constructor(
    private readonly maxSessions = DEFAULT_MAX_SESSIONS,
    private readonly maxTurns = DEFAULT_MAX_TURNS,
  ) {}

  get(sessionId: string): unknown[] {
    return this.items.get(sessionId) ?? [];
  }

  set(sessionId: string, next: readonly unknown[]): void {
    // Refresh recency: re-inserting moves it to the end of the Map's order.
    this.items.delete(sessionId);
    if (this.items.size >= this.maxSessions) {
      const oldest = this.items.keys().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
    this.items.set(sessionId, trimToRecentTurns(next, this.maxTurns));
  }

  get size(): number {
    return this.items.size;
  }
}
