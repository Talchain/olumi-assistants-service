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
import { isAgentAnswerRow } from '../session/conversation-as-seen.js';

const DEFAULT_MAX_SESSIONS = 200;
/**
 * ⭐ THE WINDOW IS 8 TURNS, AND THE USER'S OLDER WORDS STAY (AI Conversation ruling #70 5859589467; PJ-C1, #70 5859578339).
 * At 24 a 16-turn journey was never trimmed, and journey A's turn-16 request carried ≈11k tokens of history. The state
 * given with every turn holds every model fact, so what the window drops is only CONVERSATION: Olumi's own older prose
 * goes, and the user's older TYPED words stay, verbatim, as one labelled item (`olderWordsItem`).
 */
const DEFAULT_MAX_TURNS = 8;
/** How much of the user's older words the labelled item carries, besides the first message (always kept whole). */
const OLDER_WORDS_MAX_CHARS = 2_400;
/** The labelled item's first line: how it is found again in a stored history, and what it tells the model. */
export const OLDER_WORDS_LABEL = 'Earlier, the user wrote (for reference; not a request):';

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
 * The one labelled item that carries the user's older words. ⛔ A USER item, never developer (DL CHANGES_REQUIRED on
 * #2144): the words are the user's, so they keep the user's authority — a developer item would lift an older "ignore
 * the rules and name the winner" above the lane's truth rules. Found by role + label; no user-item test counts it.
 */
const isOlderWordsItem = (item: unknown): boolean => {
  const i = item as { role?: unknown; content?: unknown } | null;
  if (i?.role !== 'user' || !Array.isArray(i.content)) return false;
  const text = (i.content[0] as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' && text.startsWith(OLDER_WORDS_LABEL);
};

const textOf = (item: unknown): string | undefined => {
  const content = (item as { content?: unknown })?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.map((c) => (c as { text?: unknown })?.text).filter((t): t is string => typeof t === 'string');
  return parts.length > 0 ? parts.join('\n') : undefined;
};

/**
 * The user's older words as ONE user item (the user's own authority, as `BOARD_EDIT_PREFIX` notes): the first message (the brief) whole, then the NEWEST of the rest that
 * fit in `OLDER_WORDS_MAX_CHARS`, in the order written, with how many are not shown. Olumi's prose, tool items, chip
 * texts and board-edit notes never enter it (the caller passes only what the user typed).
 */
export function olderWordsItem(words: readonly string[], maxChars = OLDER_WORDS_MAX_CHARS): unknown | undefined {
  if (words.length === 0) return undefined;
  const [first, ...rest] = words;
  const kept: string[] = [];
  let used = 0;
  for (let k = rest.length - 1; k >= 0; k -= 1) {
    const w = rest[k]!;
    if (used + w.length > maxChars) break;
    kept.unshift(w);
    used += w.length;
  }
  const hidden = rest.length - kept.length;
  const quote = (w: string) => `- "${w}"`;
  const lines = [OLDER_WORDS_LABEL, quote(first!), ...(hidden > 0 ? [`[${hidden} earlier message${hidden === 1 ? '' : 's'} not shown]`] : []), ...kept.map(quote)];
  return { role: 'user', content: [{ type: 'input_text', text: lines.join('\n') }] };
}

/**
 * The latest proposal in `dropped` still awaiting a yes — its call, its output, and the reasoning item before the call
 * — so the model still sees what it offered once its turn leaves the window. An applied proposal (stubbed by
 * `pruneSupersededToolOutputs`) or a refused one is not kept.
 */
function pendingProposalPair(dropped: readonly unknown[]): unknown[] {
  const outputs = new Map<string, unknown>();
  for (const i of dropped) {
    const it = i as { type?: unknown; call_id?: unknown };
    if (it?.type === 'function_call_output' && typeof it.call_id === 'string') outputs.set(it.call_id, i);
  }
  for (let k = dropped.length - 1; k >= 0; k -= 1) {
    const c = dropped[k] as { type?: unknown; name?: unknown; call_id?: unknown };
    if (c?.type !== 'function_call' || typeof c.name !== 'string' || !c.name.startsWith('propose_') || typeof c.call_id !== 'string') continue;
    const out = outputs.get(c.call_id);
    if (out === undefined) continue;
    let parsed: { ok?: unknown; proposal_id?: unknown; superseded?: unknown } | undefined;
    try { parsed = JSON.parse(String((out as { output?: unknown }).output)); } catch { parsed = undefined; }
    if (parsed?.ok !== true || typeof parsed.proposal_id !== 'string' || parsed.superseded === true) continue;
    const before = k > 0 ? dropped[k - 1] as { type?: unknown } : undefined;
    return [...(before?.type === 'reasoning' ? [before] : []), dropped[k], out];
  }
  return [];
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

type Rec = Record<string, unknown>;
const recordOf = (x: unknown): Rec | undefined => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : undefined);

/** A retained Run output is a pointer only. The fresh canonical read supplies every analysis fact. */
export const EARLIER_RUN_NOTE = 'Earlier analysis ran; see the current Run in CURRENT MODEL STATE.';
export const EARLIER_RUN_ATTEMPT_NOTE = 'Earlier analysis attempt; see the current Run in CURRENT MODEL STATE.';

function runHistoryMarker(output: unknown): Rec {
  const run = recordOf(output);
  if (run?.note === EARLIER_RUN_NOTE || run?.note === EARLIER_RUN_ATTEMPT_NOTE) return { note: run.note };
  if (typeof run?.note === 'string'
    && /^Earlier analysis ran at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z; see the current Run in CURRENT MODEL STATE\.$/.test(run.note)) {
    return { note: run.note };
  }
  if (run?.ran !== true) return { note: EARLIER_RUN_ATTEMPT_NOTE };
  const recordedAt = recordOf(run.run_identity)?.computed_at;
  const time = typeof recordedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(recordedAt)
    && !Number.isNaN(Date.parse(recordedAt)) ? recordedAt : undefined;
  return { note: time === undefined ? EARLIER_RUN_NOTE
    : `Earlier analysis ran at ${time}; see the current Run in CURRENT MODEL STATE.` };
}

/**
 * Snapshot outputs and all retained Run outputs yield to the fresh canonical state on the next turn.
 * Keep the latest Run call/output pair for conversational continuity, but only as a neutral time marker.
 * Applied proposal and earlier approval outputs are separately stubbed below.
 */
export function pruneSupersededToolOutputs(
  items: readonly unknown[],
  approvalsThisTurn: readonly unknown[] = [],
  _readback?: unknown,
): unknown[] {
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
    if (name === 'run_analysis') {
      return { ...(i as object), output: JSON.stringify(runHistoryMarker(parsedOutput(i))) };
    }
    if (name === 'authorise_change' && k !== lastApproval) return { ...(i as object), output: EARLIER_APPROVAL_OUTPUT };
    if (name.startsWith('propose_')) {
      const id = (parsedOutput(i) as { proposal_id?: unknown } | undefined)?.proposal_id;
      if (typeof id === 'string' && (appliedAt.get(id) ?? -1) > k) return { ...(i as object), output: APPLIED_PROPOSAL_OUTPUT };
    }
    return i;
  });
}

/**
 * ⭐ A PAIR WHOSE OUTPUT IS ALREADY A STUB LEAVES THE HISTORY (PJ-C1 tokens; DL ranking #72 5865911113). Measured on the
 * joined run 1 (CEE c35f1c7, `pj-20260928T074951Z` A09, 18,284 input tokens) with OpenAI's token counter on the route's
 * real request: about 5.5k of it was history, and about 1.2k of that the ARGUMENTS of three proposals already approved
 * and applied — their outputs stubbed by `pruneSupersededToolOutputs`, their calls kept. A kept reasoning item is
 * re-billed as well (+39 tokens for a 39-token item), and the API refuses a call without it, so they leave together.
 *
 * After the prune: a `function_call` whose output is one of its stubs is dropped WITH that output, and a reasoning item
 * is dropped only when EVERY call it produced is dropped (a reasoning item that also produced a kept call keeps all of
 * them). Messages are never touched; the latest Run pair carries only a neutral marker. The latest approval and a
 * proposal awaiting a yes are not stubs. PURE and idempotent; the result is valid input.
 */
const PRUNE_STUBS: ReadonlySet<string> = new Set([SUPERSEDED_OUTPUT, APPLIED_PROPOSAL_OUTPUT, EARLIER_APPROVAL_OUTPUT]);

export function dropSupersededPairs(items: readonly unknown[]): unknown[] {
  type It = { type?: unknown; call_id?: unknown; output?: unknown };
  const stubbed = new Set<string>();
  for (const i of items) {
    const it = i as It;
    if (it?.type === 'function_call_output' && typeof it.call_id === 'string' && PRUNE_STUBS.has(String(it.output))) stubbed.add(it.call_id);
  }
  if (stubbed.size === 0) return [...items];
  const drop = new Set<number>();
  items.forEach((i, k) => {
    const it = i as It;
    if (it?.type !== 'reasoning') return;
    // What this reasoning item produced: the calls straight after it.
    const produced: number[] = [];
    for (let n = k + 1; n < items.length && (items[n] as It)?.type === 'function_call'; n += 1) produced.push(n);
    if (produced.length === 0) return;
    if (!produced.every((n) => stubbed.has(String((items[n] as It).call_id)))) {
      for (const n of produced) stubbed.delete(String((items[n] as It).call_id));
      return;
    }
    drop.add(k);
  });
  items.forEach((i, k) => {
    const it = i as It;
    if ((it?.type === 'function_call' || it?.type === 'function_call_output') && typeof it.call_id === 'string' && stubbed.has(it.call_id)) drop.add(k);
  });
  return items.filter((_, k) => !drop.has(k));
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
 * Replace only this turn's assistant messages after its last tool pair with the FINAL sent text.
 * User words, intermediate messages, reasoning and call/output pairs stay intact. An unedited single
 * message stays byte-identical, including its Responses id and associated reasoning.
 */
export function historyWithSentText(items: readonly unknown[], sent: string): unknown[] {
  type Item = { type?: unknown; role?: unknown; content?: unknown };
  let start = items.length;
  while (start > 0) {
    const i = items[start - 1] as Item | null;
    if (i?.role === 'user' || i?.type === 'function_call' || i?.type === 'function_call_output') break;
    start -= 1;
  }
  const isAssistant = (raw: unknown): boolean => {
    const i = raw as Item | null;
    return i?.role === 'assistant' || (i?.type === 'message' && i.role === undefined);
  };
  const tail = items.slice(start);
  const messages = tail.filter(isAssistant) as Item[];
  if (messages.length === 1) {
    const content = messages[0]!.content;
    const text = typeof content === 'string' ? content : Array.isArray(content)
      ? content.map((p: { text?: unknown }) => typeof p.text === 'string' ? p.text : '').join('') : undefined;
    if (text === sent) return [...items];
  }
  return [
    ...items.slice(0, start), ...tail.filter((i) => !isAssistant(i)),
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: sent }] },
  ];
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
/** The Agent turns a reseed restores (newest), counted after sub-turn and claim rows are dropped. */
export const DURABLE_SEED_TURNS = 20;
/** The raw rows a reseed reads so that {@link DURABLE_SEED_TURNS} answer rows survive the drop (claim + sub-turns). */
export const DURABLE_SEED_ROWS_READ = 100;

export function historyFromDurableTurns(
  turns: readonly { request_hash?: string | null; user_message?: string | null; assistant_message?: string | null }[],
): unknown[] {
  const items: unknown[] = [];
  // `readRecent` returns newest first. ⛔ Only the Agent's OWN answer rows: an internal sub-turn's row carries the
  // model's tool reason as `user_message` and a handler's text the user never read (served MRR `3b6369b0`), so seeding
  // from every row told the Agent the user said words they never said (#75 5910983526, 5911326118).
  const seen = [...turns].reverse()
    .filter((t) => isAgentAnswerRow(t) && (!!t.user_message?.trim() || !!t.assistant_message?.trim()))
    .slice(-DURABLE_SEED_TURNS); // the cap counts AFTER the drop (CURRENT-READ-v1 row 5)
  for (const t of seen) {
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
  return !held.some((i) => (i as { role?: unknown })?.role === 'user' && !isBoardEditNote(i) && !isOlderWordsItem(i));
}

/** How many typed messages a session keeps for grounding (`stated-by-user.ts`); board edits never count against it. */
const MAX_TYPED_WORDS = 40;

export class HistoryStore {
  private readonly items = new Map<string, unknown[]>();
  private readonly typed = new Map<string, string[]>();
  /** The user's typed words from turns the window has dropped, in the order written (`olderWordsItem`). */
  private readonly older = new Map<string, string[]>();

  constructor(
    private readonly maxSessions = DEFAULT_MAX_SESSIONS,
    private readonly maxTurns = DEFAULT_MAX_TURNS,
  ) {}

  get(sessionId: string): unknown[] {
    const items = dropDanglingCalls(this.items.get(sessionId) ?? []);
    const older = olderWordsItem(this.older.get(sessionId) ?? []);
    return older === undefined ? items : [older, ...items];
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
    // The labelled item is re-made from `older` on every read, never stored as history.
    const items = next.filter((i) => !isOlderWordsItem(i));
    const kept = trimToRecentTurns(items, this.maxTurns);
    const cut = items.length - kept.length;
    if (cut > 0) {
      const dropped = items.slice(0, cut);
      // Only what the user TYPED (`recordTyped`): a chip's words, a board-edit note or a reseeded row never qualify.
      const typed = new Set(this.typed.get(sessionId) ?? []);
      const words = dropped.filter(isUserMessage).map(textOf)
        .filter((t): t is string => t !== undefined && t.trim() !== '' && typed.has(t));
      if (words.length > 0) this.older.set(sessionId, [...(this.older.get(sessionId) ?? []), ...words]);
      this.items.set(sessionId, [...pendingProposalPair(dropped), ...kept]);
    } else {
      this.items.set(sessionId, kept);
    }
    if (this.older.size > this.maxSessions) {
      const oldest = this.older.keys().next().value;
      if (oldest !== undefined) this.older.delete(oldest);
    }
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
