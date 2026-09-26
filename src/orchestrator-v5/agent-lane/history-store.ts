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

/**
 * ⛔ A `function_call` WITH NO OUTPUT MAKES THE NEXT REQUEST FAIL OUTRIGHT, and
 * it fails forever, because the bad item stays in the stored history:
 *
 *   Error: openai_400: "No tool output found for function call call_NFIf…"
 *   POST /agent/v1/turn status=502 duration_ms=27505
 *
 * The cause was in the loop (it answered only the first of several parallel
 * calls) and is fixed there. This is the structural guard, so the invariant
 * does not depend on every future writer getting it right: a stored history is
 * VALID INPUT by construction, and one bad turn costs that turn instead of the
 * whole session.
 *
 * ⚠ It drops the CALL, never the output. An orphaned output is the API's other
 * rejection and dropping a call cannot create one, because the output is
 * removed with it.
 */
export function dropDanglingCalls(items: readonly unknown[]): unknown[] {
  const answered = new Set<string>();
  for (const i of items) {
    const it = i as { type?: string; call_id?: unknown };
    if (it?.type === 'function_call_output' && typeof it.call_id === 'string') answered.add(it.call_id);
  }
  return items.filter((i) => {
    const it = i as { type?: string; call_id?: unknown };
    if (it?.type !== 'function_call') return true;
    return typeof it.call_id === 'string' && answered.has(it.call_id);
  });
}

/**
 * ⛔ THE CONVERSATION OUTLIVES THE PROCESS; THE AGENT'S MEMORY OF IT DID NOT.
 *
 * The history above is in-process. cee-staging runs ONE instance (Render API,
 * 23 Sep: `numInstances: 1`, no autoscaling) and redeploys on EVERY merge to
 * `staging`; the store also evicts the oldest session past `maxSessions`. Either
 * way the browser still shows the whole conversation — it reads
 * `v5_conversation_turns` — while the Agent started from nothing, so "as I said
 * earlier…" met an Agent that had never heard it.
 *
 * So a session this process does not hold is seeded from the durable turns:
 * the user's and the Agent's TEXT, oldest first. Tool calls and their results
 * are not durable and are not reconstructed — the Agent re-reads the model
 * through its tools, which is the authoritative source anyway, and an old
 * proposal is not revived (the proposal store is in-process too, so
 * `get_canonical_state` truthfully shows nothing awaiting approval).
 */
export function historyFromDurableTurns(
  turns: readonly { user_message?: string | null; assistant_message?: string | null }[],
): unknown[] {
  const items: unknown[] = [];
  // `readRecent` returns newest first.
  for (const t of [...turns].reverse()) {
    if (typeof t.user_message === 'string' && t.user_message.trim().length > 0) {
      items.push({ role: 'user', content: [{ type: 'input_text', text: t.user_message }] });
    }
    if (typeof t.assistant_message === 'string' && t.assistant_message.trim().length > 0) {
      items.push({ role: 'assistant', content: t.assistant_message });
    }
  }
  return items;
}

/** Marks a board edit in the Agent's history: the user's own change, already applied — never a request to the Agent. */
export const BOARD_EDIT_PREFIX = '(Board edit \u2014 the user changed this directly on the canvas and Olumi has already applied it; it is not a request to you.)';

function isBoardEditNote(item: unknown): boolean {
  const content = (item as { content?: unknown })?.content;
  const first = Array.isArray(content) ? (content[0] as { text?: unknown } | undefined)?.text : content;
  return typeof first === 'string' && first.startsWith(BOARD_EDIT_PREFIX);
}

/**
 * True when the held history carries no user message of the conversation itself.
 *
 * ⛔ A BOARD-EDIT NOTE IS NOT CONVERSATION (preflight integration, #1733 × #1757). The
 * route records a forwarded canvas edit as a `role: 'user'` item starting with
 * BOARD_EDIT_PREFIX, so counting every user item meant a board edit made FIRST after
 * a restart suppressed the seeding, and the Agent forgot the conversation before the
 * deploy. Notes are ignored here; the seed goes ahead of them.
 */
export function needsDurableSeed(held: readonly unknown[]): boolean {
  return !held.some((i) => (i as { role?: unknown })?.role === 'user' && !isBoardEditNote(i));
}

/** How many typed messages a session keeps for grounding (`stated-by-user.ts`); board edits never count against it. */
const MAX_TYPED_WORDS = 40;

export class HistoryStore {
  private readonly items = new Map<string, unknown[]>();
  private readonly typed = new Map<string, string[]>();

  constructor(
    private readonly maxSessions = DEFAULT_MAX_SESSIONS,
    private readonly maxTurns = DEFAULT_MAX_TURNS,
  ) {}

  get(sessionId: string): unknown[] {
    return dropDanglingCalls(this.items.get(sessionId) ?? []);
  }

  /** Whether THIS process holds a history for the session (evicted or never seen → false). */
  has(sessionId: string): boolean {
    return this.items.has(sessionId);
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

  /** What the user TYPED in this session, as this process saw it — never a chip's text, a board-edit note or a reseeded row. */
  typedWords(sessionId: string): readonly string[] {
    return this.typed.get(sessionId) ?? [];
  }

  recordTyped(sessionId: string, text: string): void {
    if (text.trim() === '') return;
    const next = [...(this.typed.get(sessionId) ?? []), text].slice(-MAX_TYPED_WORDS);
    this.typed.delete(sessionId);
    if (this.typed.size >= this.maxSessions) {
      const oldest = this.typed.keys().next().value;
      if (oldest !== undefined) this.typed.delete(oldest);
    }
    this.typed.set(sessionId, next);
  }
}
