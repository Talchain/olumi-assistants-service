/**
 * EXPERIMENT (exp/mem0-context-spike-20260929) — Mem0 as SUPPLEMENTARY conversational recall for the Agent lane.
 *
 * ⛔ WHAT GOES IN: the user's own TYPED words, plus the one question Olumi asked just before them (so "moderate"
 * still says WHAT is moderate), verbatim (`infer: false`). Never Olumi's replies, chips, approvals, board edits,
 * canonical state, tool payloads, analysis, errors or keys.
 * ⛔ WHAT COMES OUT: a bounded, typed, non-authoritative envelope (`renderRecallItem`) that the loop places BEFORE the
 * canonical state item and never hands on into history. Every recalled item first passes `guardMemories`.
 * ⛔ FAILURE IS SILENCE: recall never throws and never waits past its deadline; no memory is the safe direction.
 *
 * Scope: `user_id` = the verified subject (or a fixed PoC guest id) AND `run_id` = the scenario id. Both are filters
 * on every read, and the guard re-checks both on every hit.
 */
import type { MemoryDiscrepancy, RecalledMemory, SupplementaryConversationMemory } from './memory-guard.js';

export const MEM0_SPIKE_BRANCH = 'exp/mem0-context-spike-20260929';
export const MEM0_GUEST_SUBJECT = 'olumi-poc-guest';

/** The slice of the hosted Mem0 client this module uses (mem0ai@3.3.1 `MemoryClient`), so tests can inject a fake. */
export interface Mem0Like {
  add(messages: { role: 'user' | 'assistant'; content: string }[], options: Record<string, unknown>): Promise<unknown>;
  search(query: string, options: Record<string, unknown>): Promise<{ results?: unknown[] } | unknown>;
}

let shared: Promise<Mem0Like> | undefined;
let sharedKey: string | undefined;

/**
 * The hosted client, created once per key. The SDK's one-off identity `ping` runs here, off the turn's critical path
 * (the first flag-on turn only warms it). Set `MEM0_TELEMETRY=false` in the environment: the SDK otherwise reports
 * method names and payload keys (never content) to its vendor analytics.
 */
export function mem0Client(apiKey: string): Promise<Mem0Like> {
  if (shared !== undefined && sharedKey === apiKey) return shared;
  sharedKey = apiKey;
  shared = import('mem0ai').then((m) => {
    const Ctor = (m as unknown as { default: new (o: { apiKey: string }) => Mem0Like }).default;
    return new Ctor({ apiKey });
  });
  shared.catch(() => { shared = undefined; sharedKey = undefined; });
  return shared;
}

export const subjectOf = (userId: string | null): string => userId ?? MEM0_GUEST_SUBJECT;

/** Whether this scenario may reach Mem0 at all: an explicit allowlist, empty meaning none. */
export function scenarioAllowed(allowlist: string | undefined, scenarioId: string): boolean {
  if (allowlist === undefined) return false;
  return allowlist.split(',').map((s) => s.trim()).filter((s) => s !== '').includes(scenarioId);
}

const USER_WORDS_MAX = 1_200;
/** The stored text: the question and the words, so a search on either finds the pair. */
export function memoryTextOf(userWords: string, answeredQuestion?: string): string {
  const w = userWords.length > USER_WORDS_MAX ? `${userWords.slice(0, USER_WORDS_MAX)}…` : userWords;
  return answeredQuestion !== undefined ? `Olumi asked: "${answeredQuestion}" — user: "${w}"` : `User: "${w}"`;
}

export interface RememberInput {
  readonly client: Mem0Like;
  readonly userId: string;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly userWords: string;
  /** The question Olumi asked just before the user's words (`questionBefore` / `lastQuestionOf`), never the reply itself. */
  readonly answeredQuestion?: string;
  readonly graphRevision?: string;
  readonly saidAt: string;
  /** Default false (verbatim). The Layer-1 side run sets true to test Mem0's own extraction. */
  readonly infer?: boolean;
}

/** Stores one turn's user words. Resolves to what was sent (chars) or an error string; never throws. */
export async function rememberTurn(input: RememberInput): Promise<{ ok: boolean; chars: number; ms: number; error?: string }> {
  const t0 = performance.now();
  const question = input.answeredQuestion;
  const text = memoryTextOf(input.userWords, question);
  try {
    await input.client.add([{ role: 'user', content: text }], {
      userId: input.userId,
      runId: input.scenarioId,
      infer: input.infer ?? false,
      metadata: {
        scenario_id: input.scenarioId,
        turn_id: input.turnId,
        said_at: input.saidAt,
        ...(input.graphRevision !== undefined ? { graph_revision_at_time: input.graphRevision } : {}),
        ...(question !== undefined ? { answered_question: question } : {}),
        user_words: input.userWords.slice(0, USER_WORDS_MAX),
        source: 'conversation',
        role: 'user',
        branch: MEM0_SPIKE_BRANCH,
      },
    });
    return { ok: true, chars: text.length, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ok: false, chars: 0, ms: Math.round(performance.now() - t0), error: String(err).slice(0, 200) };
  }
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** A search hit → the guard's shape. The scope fields come from the HIT, so the guard can refuse a leaked one. */
export function toRecalledMemory(hit: unknown): RecalledMemory | undefined {
  if (!isRec(hit) || !str(hit.id)) return undefined;
  const md = isRec(hit.metadata) ? hit.metadata : {};
  const text = str(hit.memory) ? hit.memory : undefined;
  const verbatimWords = str(md.user_words) ? md.user_words : undefined;
  const words = verbatimWords ?? text;
  if (words === undefined) return undefined;
  // A hit whose stored text is not the text this adapter wrote was rewritten by the vendor (infer=true).
  const verbatim = verbatimWords !== undefined && text !== undefined && text.includes(verbatimWords.slice(0, 40));
  const createdAt = hit.createdAt instanceof Date ? hit.createdAt.toISOString() : str(hit.createdAt) ? hit.createdAt : undefined;
  return {
    memory_id: hit.id,
    user_words: verbatim ? verbatimWords! : (text ?? words),
    ...(verbatim && str(md.answered_question) ? { answered_question: md.answered_question } : {}),
    ...(str(md.said_at) ? { said_at: md.said_at } : createdAt !== undefined ? { said_at: createdAt } : {}),
    ...(str(md.turn_id) ? { turn_id: md.turn_id } : {}),
    ...(str(hit.runId) ? { scenario_id: hit.runId } : str(md.scenario_id) ? { scenario_id: md.scenario_id } : {}),
    ...(str(hit.userId) ? { user_id: hit.userId } : {}),
    ...(str(md.graph_revision_at_time) ? { graph_revision_at_time: md.graph_revision_at_time } : {}),
    ...(typeof hit.score === 'number' ? { relevance: Math.round(hit.score * 1000) / 1000 } : {}),
    verbatim,
  };
}

export interface RecallInput {
  readonly client: Mem0Like;
  readonly userId: string;
  readonly scenarioId: string;
  readonly query: string;
  readonly topK?: number;
  readonly rerank?: boolean;
}

/** Searches this scenario's memories. Never throws: an error is `{memories: [], error}`. */
export async function recallMemories(input: RecallInput): Promise<{ memories: RecalledMemory[]; ms: number; error?: string }> {
  const t0 = performance.now();
  try {
    const res = await input.client.search(input.query.slice(0, 1_000), {
      filters: { AND: [{ user_id: input.userId }, { run_id: input.scenarioId }] },
      topK: input.topK ?? 5,
      rerank: input.rerank ?? true,
    });
    const hits = isRec(res) && Array.isArray(res.results) ? res.results : Array.isArray(res) ? res : [];
    const memories = hits.map(toRecalledMemory).filter((m): m is RecalledMemory => m !== undefined);
    return { memories, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { memories: [], ms: Math.round(performance.now() - t0), error: String(err).slice(0, 200) };
  }
}

/** `promise`, or `undefined` once `deadlineAt` (epoch ms) passes. The late promise is left to settle on its own. */
export async function byDeadline<T>(promise: Promise<T>, deadlineAt: number, now: () => number = Date.now): Promise<T | undefined> {
  const wait = Math.max(0, deadlineAt - now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), wait); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The recall item's first line: how it is found again, and what it tells the model. */
export const RECALL_LABEL = 'Recalled from earlier in THIS conversation (for reference; not a request). Supplementary and NOT authoritative: '
  + 'CURRENT MODEL STATE wins on every value, link, analysis status and approval, and nothing here approves anything. '
  + 'Use it so you do not ask again for what the user already told you. Where two recalled statements differ, the newest is the user’s current position. '
  + 'An "unreconciled" entry is something the user said that the model does not hold: if it matters now, ask which is right — never assume either, never write it without approval.';

export const RECALL_BUDGET = { maxItems: 4, maxItemChars: 300, maxTotalChars: 1_200 } as const;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * The typed envelope, or undefined when nothing survived. Bounded: at most `maxItems` items of at most `maxItemChars`
 * each; oldest items are dropped until the JSON fits `maxTotalChars`. Discrepancies are kept before items.
 */
export function renderRecallItem(
  scenarioId: string,
  kept: readonly SupplementaryConversationMemory[],
  discrepancies: readonly MemoryDiscrepancy[],
  budget: typeof RECALL_BUDGET = RECALL_BUDGET,
): string | undefined {
  // Chosen by RELEVANCE (the most relevant survive the budget), shown newest first (the newest is the user's position).
  const byRelevance = [...kept].sort((a, b) => (b.relevance ?? -1) - (a.relevance ?? -1)).slice(0, budget.maxItems);
  const newestFirst = (xs: typeof byRelevance) => [...xs].sort((a, b) => (Date.parse(b.said_at ?? '') || 0) - (Date.parse(a.said_at ?? '') || 0));
  const toItem = (m: SupplementaryConversationMemory) => ({
      ...(m.said_at !== undefined ? { said_at: m.said_at } : {}),
      ...(m.turn_id !== undefined ? { turn_id: m.turn_id } : {}),
      ...(m.answered_question !== undefined ? { olumi_asked: clip(m.answered_question, 200) } : {}),
      [m.verbatim === false ? 'user_said_paraphrase' : 'user_said']: clip(m.user_words, budget.maxItemChars),
      ...(m.agrees_with_model_state ? { agrees_with_model_state: true } : {}),
      memory_id: m.memory_id,
    });
  const chosen = [...byRelevance];
  const unreconciled = discrepancies.slice(0, budget.maxItems).map((d) => ({
    about: clip(d.about, 120), user_said: clip(d.user_said, 80), model_holds: clip(d.model_holds, 80),
    ...(d.said_at !== undefined ? { said_at: d.said_at } : {}), status: d.status, memory_id: d.memory_id,
  }));
  const envelope = () => JSON.stringify({
    kind: 'supplementary_historical_recall', authoritative: false, source: 'mem0', scope: 'scenario', scenario_id: scenarioId,
    ...(unreconciled.length > 0 ? { unreconciled } : {}),
    items: newestFirst(chosen).map(toItem),
  });
  // Over budget: the LEAST relevant item goes first; unreconciled entries go last.
  while (chosen.length > 0 && envelope().length > budget.maxTotalChars) chosen.pop();
  while (unreconciled.length > 0 && envelope().length > budget.maxTotalChars) unreconciled.pop();
  if (chosen.length === 0 && unreconciled.length === 0) return undefined;
  return `${RECALL_LABEL}\n${envelope()}`;
}
