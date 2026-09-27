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
/** What a superseded read or run output becomes in the history: small, and still a valid output for its call. */
export const SUPERSEDED_OUTPUT = JSON.stringify({ superseded: true, note: 'An earlier read. The current model state is given at the start of each turn.' });
/** Tools whose output is a snapshot of the model: every one is superseded by the state given with the next turn. */
const SNAPSHOT_TOOLS = new Set(['get_canonical_state', 'build_model_from_brief']);

/** What an APPLIED proposal's output becomes: the model now holds the change, and the state given with each turn shows it. */
export const APPLIED_PROPOSAL_OUTPUT = JSON.stringify({ superseded: true, note: 'A proposal since approved and applied. The current model state is given at the start of each turn.' });
/** What an earlier approval's output becomes once a later approval is in the history. */
export const EARLIER_APPROVAL_OUTPUT = JSON.stringify({ superseded: true, note: 'An earlier approval. The reply after it said what happened; the current model state is given at the start of each turn.' });

/**
 * The proposal a result says was applied IN FULL — `ProposalStore.markApplied`'s own condition — else undefined.
 *
 * ⛔ APPLIED, NOT MERELY ANSWERED. A refused approval (`superseded`, `not_applied`, `unknown_proposal`) leaves the
 * proposal listed as awaiting a yes, and the Agent may have to prepare it again from what it said; so does an approval
 * that landed only IN PART — `applied: true` with fewer levels or values recorded than requested, which is not marked
 * applied (agent-capabilities.ts :3139, :3704). Both keep their proposal verbatim. `already_applied` is applied.
 */
export function proposalAppliedBy(result: unknown): string | undefined {
  const r = result as { applied?: unknown; proposal_id?: unknown; requested_count?: unknown; recorded_count?: unknown; adopted_count?: unknown } | null;
  if (r === null || typeof r !== 'object' || r.applied !== true || typeof r.proposal_id !== 'string') return undefined;
  const landed = typeof r.recorded_count === 'number' ? r.recorded_count : typeof r.adopted_count === 'number' ? r.adopted_count : undefined;
  if (typeof r.requested_count === 'number' && landed !== undefined && landed < r.requested_count) return undefined;
  return r.proposal_id;
}

const parsedOutput = (item: unknown): unknown => {
  const output = (item as { output?: unknown }).output;
  if (typeof output !== 'string') return undefined;
  try { return JSON.parse(output); } catch { return undefined; }
};

/**
 * ⭐ A SUPERSEDED SNAPSHOT IS NOT KEPT (slice C1; P3A replay of Paul's transcript, 27 Sep). Each state read added
 * 2.5–3k tokens and each run 3.1–3.6k, all carried for 24 turns — 55k of a 62.7k request was old copies of the model.
 * Every state read and build result is replaced by a stub, and every run result but the LATEST (the one a follow-up
 * question is about). The call and its output stay paired — only the output's text changes — so the next request
 * stays valid input (see `dropDanglingCalls`).
 *
 * ⭐ NOR IS AN APPLIED PROPOSAL, OR AN EARLIER APPROVAL (DL scoreboard PJ-C1, token half). Served run
 * `pj-20260927T181846Z` (CEE 523e18d, journey A): the first model call of each turn read 15.4k → 18.3k → 20.3k →
 * 21.3k → 22.8k input tokens over ten turns of propose → approve, against a 15,000 cap. Each proposal's output —
 * 230–990 tokens by the served per-call deltas, 1.9–2.7k for journey A's four — rode in every request for 24 turns
 * after the change it described was applied and was already in the state given with each turn (`agent-loop.ts`,
 * CURRENT MODEL STATE). So:
 *   - a `propose_*` output is stubbed once a LATER approval applied that proposal in full (`proposalAppliedBy`);
 *     a proposal still awaiting a yes — never approved, refused, or part-applied — is kept byte for byte;
 *   - every `authorise_change` output but the LATEST is stubbed (the latest is what "what did that change?" is about).
 * Messages, calls and their arguments are never touched. MEASURED on a journey-A-shaped history (the served A02 run,
 * then 3 proposals and 3 approvals; `__tests__/fixtures/a-journey-history.ts`): 30,899 → 22,893 bytes (−25.9%, ≈2.0k
 * tokens) with typed approvals, 28,432 → 23,160 (−18.5%, ≈1.3k) with chip approvals. ⚠ NOT ENOUGH ON ITS OWN for the
 * 15,000 cap: by the served deltas it takes journey A's last request from 22,752 to ≈20.0–20.9k. The latest run (≈3.9k
 * tokens, kept by the rule above though every approval since has changed the model) is the next largest item.
 *
 * ⛔ THE APPROVE CHIP LEAVES NO RECORD IN THE HISTORY. Its fast path (agent-v1-turn.ts, FAST PATH 2) appends only the
 * chip's words and Olumi's status — no call, no proposal id — and every approval in that served run was a chip. So the
 * route also passes the turn's own approval results (`approvalsThisTurn`); being this turn's, they are later than
 * every output already in the history.
 */
export function pruneSupersededToolOutputs(items: readonly unknown[], approvalsThisTurn: readonly unknown[] = []): unknown[] {
  const nameOf = new Map<string, string>();
  for (const i of items) {
    const c = i as { type?: unknown; call_id?: unknown; name?: unknown };
    if (c?.type === 'function_call' && typeof c.call_id === 'string' && typeof c.name === 'string') nameOf.set(c.call_id, c.name);
  }
  const outputOf = (i: unknown): string | undefined => {
    const o = i as { type?: unknown; call_id?: unknown };
    return o?.type === 'function_call_output' && typeof o.call_id === 'string' ? nameOf.get(o.call_id) : undefined;
  };
  let lastRun = -1;
  let lastApproval = -1;
  /** Each applied proposal, with the position of the LAST approval that applied it (this turn's: after everything). */
  const appliedAt = new Map<string, number>();
  for (const r of approvalsThisTurn) {
    const id = proposalAppliedBy(r);
    if (id !== undefined) appliedAt.set(id, items.length);
  }
  items.forEach((i, k) => {
    const name = outputOf(i);
    if (name === 'run_analysis') lastRun = k;
    if (name !== 'authorise_change') return;
    lastApproval = k;
    const id = proposalAppliedBy(parsedOutput(i));
    if (id !== undefined && (appliedAt.get(id) ?? -1) < k) appliedAt.set(id, k);
  });
  return items.map((i, k) => {
    const name = outputOf(i);
    if (name === undefined) return i;
    if (SNAPSHOT_TOOLS.has(name) || (name === 'run_analysis' && k !== lastRun)) return { ...(i as object), output: SUPERSEDED_OUTPUT };
    if (name === 'authorise_change' && k !== lastApproval) return { ...(i as object), output: EARLIER_APPROVAL_OUTPUT };
    if (name.startsWith('propose_')) {
      const id = (parsedOutput(i) as { proposal_id?: unknown } | undefined)?.proposal_id;
      if (typeof id === 'string' && (appliedAt.get(id) ?? -1) > k) return { ...(i as object), output: APPLIED_PROPOSAL_OUTPUT };
    }
    return i;
  });
}

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
