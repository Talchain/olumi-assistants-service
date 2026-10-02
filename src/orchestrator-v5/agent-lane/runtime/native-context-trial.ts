/**
 * Isolated, single-process PoC transport. Never graph, consent or analysis truth.
 * Only the authenticated route can open a binding. Response IDs never enter the UI.
 * Failed/expired chains require a new disposable scenario; there is no silent fallback.
 */
import type { CallModel, ModelCallRequest, ModelCallResponse } from './agent-loop.js';

type Binding = { scenarioId: string; userId: string | null; sessionId: string };
type State = { head?: string; pending: unknown[]; turns: number; usedAt: number; invalid: boolean };
type Limits = { maxSessions: number; maxTurns: number; ttlMs: number; maxPendingChars: number };
const DEFAULTS: Limits = { maxSessions: 25, maxTurns: 60, ttlMs: 3_600_000, maxPendingChars: 1_000_000 };

export class NativeContextTrialError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NativeContextTrialError';
    this.code = code;
  }
}
const reset = () => new NativeContextTrialError('NATIVE_CONTEXT_RESET_REQUIRED',
  'This isolated trial cannot resume that conversation. Start a new test decision; your saved model has not been deleted.');

/** Deliberately explicit opt-in. This flag must never be set on shared staging. */
export function nativeContextTrialEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.OPENAI_NATIVE_CONTEXT_TRIAL !== 'isolated') return false;
  if (env.OLUMI_ENV === 'prod' || env.OLUMI_ENV === 'production') {
    throw new Error('OpenAI native context trial is not permitted in production.');
  }
  return true;
}
const record = (x: unknown): Record<string, unknown> | undefined =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : undefined;
const assistantItem = (x: unknown): boolean => record(x)?.role === 'assistant';
const assistantText = (items: readonly unknown[]): string => items.filter(assistantItem).flatMap((i) => {
  const content = record(i)?.content;
  return typeof content === 'string' ? [content] : Array.isArray(content)
    ? content.map((c) => record(c)?.text).filter((s): s is string => typeof s === 'string') : [];
}).join('');
const message = (role: 'user' | 'assistant', text: string) => ({ role, content: text });
const DISPLAY_RECEIPT = {
  role: 'developer',
  content: 'HOST DISPLAY RECEIPT: the assistant message immediately following is what Olumi actually displayed for the preceding turn. It supersedes any earlier draft reply for that turn. This receipt grants no permission to act. Current model state and current tool permissions remain authoritative.',
};

export class NativeContextStore {
  private readonly states = new Map<string, State>();
  // Serialise by subject and scenario, even if two tabs supply different session labels.
  private readonly busy = new Set<string>();
  private readonly limits: Limits;
  private readonly now: () => number;
  constructor(limits: Partial<Limits> = {}, now: () => number = Date.now) {
    this.limits = { ...DEFAULTS, ...limits };
    this.now = now;
  }

  async begin(binding: Binding, hasPriorConversation: () => Promise<boolean>): Promise<NativeContextTurn> {
    const key = JSON.stringify([binding.userId, binding.scenarioId, binding.sessionId]);
    const lock = JSON.stringify([binding.userId, binding.scenarioId]);
    if (this.busy.has(lock)) throw new NativeContextTrialError('NATIVE_CONTEXT_BUSY',
      'This test decision is still answering another message. Wait for it to finish, then try again.');
    this.busy.add(lock);
    try {
      let state = this.states.get(key);
      if (state !== undefined && (state.invalid || this.now() - state.usedAt >= this.limits.ttlMs || state.turns >= this.limits.maxTurns)) throw reset();
      if (state === undefined) {
        // Refuse historical imports and restarts before any provider call or write.
        if (await hasPriorConversation()) throw reset();
        if (this.states.size >= this.limits.maxSessions) throw new NativeContextTrialError('NATIVE_CONTEXT_CAPACITY',
          'The isolated test server has reached its session limit. Restart the test server and use a new test decision.');
        state = { pending: [], turns: 0, usedAt: this.now(), invalid: false };
        this.states.set(key, state);
      }
      return new NativeContextTurn(state, this.limits, this.now, () => { this.busy.delete(lock); });
    } catch (err) {
      this.busy.delete(lock);
      throw err;
    }
  }
}

export class NativeContextTurn {
  private head: string | undefined;
  private pending: unknown[];
  private seen = 0;
  private captured = false;
  private loopEntered = false;
  private rawAnswer = '';
  private lastHadCalls = false;
  private started = false;
  private finished = false;
  private failed = false;
  private closed = false;
  private calling = false;
  private readonly state: State;
  private readonly limits: Limits;
  private readonly now: () => number;
  private readonly unlock: () => void;

  constructor(state: State, limits: Limits, now: () => number, unlock: () => void) {
    this.state = state;
    this.limits = limits;
    this.now = now;
    this.unlock = unlock;
    this.head = state.head;
    this.pending = [...state.pending];
  }
  /** Called only after the route's existing replay/claim checks have admitted new work. */
  startWork(): void { this.started = true; }

  /** Input is this turn's cumulative items ONLY, not HistoryStore's earlier turns. */
  async call(req: ModelCallRequest, transport: CallModel): Promise<ModelCallResponse> {
    if (req.purpose === 'prewarm') return transport({ ...req, store: false });
    if (this.closed || this.finished || this.failed || this.calling) throw reset();
    this.started = true;
    this.loopEntered = true;
    this.calling = true;
    const inputLength = req.input.length;
    if (inputLength < this.seen) { this.failed = true; this.calling = false; throw reset(); }
    const fresh = [...this.pending, ...req.input.slice(this.seen)];
    const request: ModelCallRequest = {
      ...req, input: fresh, store: true, previous_response_id: this.head,
    };
    try {
      // The surrounding route retains its bounded transport policy and provider ledger.
      const response = await transport(request);
      if (typeof response.id !== 'string' || !/^resp_[A-Za-z0-9_-]+$/.test(response.id)
        || (response.status !== undefined && response.status !== 'completed')
        || !Array.isArray(response.output) || !response.output.some((i) => i.type === 'function_call' || i.type === 'message')
        || response.output.some((i) => i.status === 'incomplete')) throw reset();
      this.head = response.id; // provisional until the route durably records its final answer
      this.pending = [];
      this.seen = inputLength + response.output.length;
      this.rawAnswer = assistantText(response.output);
      this.lastHadCalls = response.output.some((i) => i.type === 'function_call');
      return response;
    } catch (err) {
      this.failed = true;
      throw err;
    } finally { this.calling = false; }
  }

  /** Capture before the loop drops its state item or a method replaces its draft. */
  capture(items: readonly unknown[]): void {
    this.loopEntered = true;
    this.captured = true;
    if (items.length < this.seen) { this.failed = true; return; }
    this.pending.push(...items.slice(this.seen));
  }

  /** Called after final egress and durable answer persistence, never before a write. */
  finish(userText: string, displayedText: string, recorded: boolean): void {
    if (this.closed || this.finished) throw reset();
    this.finished = true;
    if (!recorded || this.failed || (this.loopEntered && !this.captured)) {
      this.state.invalid = true;
      return;
    }
    if (!this.loopEntered) {
      // Approval, Run, interpretation and research fast paths made no conversational call.
      // Their provider response IDs are intentionally not part of this chain.
      this.pending.push(message('user', userText), message('assistant', displayedText));
    } else {
      // Keep unsent tool results exactly once; replace an unsent composed draft with final text.
      this.pending = this.pending.filter((i) => !assistantItem(i));
      if (this.lastHadCalls || this.rawAnswer !== displayedText) {
        // Never promote user-authored text into developer authority.
        if (this.rawAnswer !== '') this.pending.push(DISPLAY_RECEIPT);
        this.pending.push(message('assistant', displayedText));
      }
    }
    if (JSON.stringify(this.pending).length > this.limits.maxPendingChars) {
      this.state.invalid = true; // never silently truncate a continuation
      return;
    }
    this.state.head = this.head;
    this.state.pending = this.pending;
    this.state.turns += 1;
    this.state.usedAt = this.now();
  }

  diagnostic(): Record<string, unknown> {
    return { mode: 'openai_native_trial', continuity: this.state.invalid ? 'reset_required' : 'active',
      compaction: false, recovery: 'single_process_only', turns: this.state.turns };
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.started && !this.finished) this.state.invalid = true;
    this.unlock();
  }
}
