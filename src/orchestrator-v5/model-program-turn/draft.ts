/**
 * THE CANONICAL DRAFTER (alpha): THE DRAFTING CALL + THE COMPILE/REPAIR LOOP.
 *
 * One strict structured call returns a CanonicalModel (S1's schema, `prompt.ts`), on the client CEE's core lane uses
 * (`ledgeredAgentsClient`: every attempt is a `_provider_calls` row), at the core budget's model with reasoning effort
 * MEDIUM. The draft is compiled; while it has errors, the compiler's own sentences go back to the SAME conversation (the
 * draft as the assistant's turn, the errors as the next user turn: phase 0b's repair shape), at most twice. Nothing here
 * edits the model: what compiles is the AI's own draft.
 */
import { streamedLedgeredResponse, type StreamedResponsesBody } from '../../adapters/llm/openai-agents-client.js';
import { coreBudget } from '../agent-lane/model-budgets.js';
import { agentRequestIdentity } from '../agent-lane/runtime/prompt-identity.js';
import { CanonicalModel, type CanonicalModelT } from '../model-program/canonical.js';
import { compile, compileJson, normalise, type CompileError, type CompileResult } from '../model-program/compile.js';
import { CANONICAL_JSON_SCHEMA, CANONICAL_SCHEMA_NAME, CanonicalUpdate, DRAFTING_INSTRUCTIONS, REPAIR_PREFIX, UPDATE_JSON_SCHEMA, UPDATE_PREFIX, UPDATE_REPAIR_PREFIX,
  type CanonicalUpdateT } from './prompt.js';

export const MAX_REPAIRS = 2;
export const DRAFT_REASONING_EFFORT = 'medium' as const;
/** Room for a whole canonical model plus its reasoning (phase 0b's largest draft used 11.7k of 16k on a smaller format). */
export const DRAFT_MAX_OUTPUT_TOKENS = 32_000;

export type InputMessage = { readonly role: 'user' | 'assistant'; readonly content: string };
export type CallOutput = { readonly text: string | null; readonly status: string | null; readonly incomplete: string | null; readonly usage: unknown };
/** One Responses call with the body as built here. Injectable, so a test can answer it without a network. */
export type ResponsesCall = (body: StreamedResponsesBody) => Promise<CallOutput>;

/**
 * A failed call's typed fields as the SDK's APIError carries them (HTTP status, error type, error code, the provider's request
 * id); null where the error has none (a plain Error). Never its message (OpenAI's can hold a masked key prefix or echo input),
 * headers or body (25 Oct 03:55Z: every first draft failed as "call failed: Error"; the cause, 429 insufficient_quota, was lost).
 */
export type ProviderError = { readonly status: number | null; readonly type: string | null; readonly code: string | null; readonly request_id: string | null };
const named = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
export function providerErrorOf(err: unknown): ProviderError {
  const e = (err !== null && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  return { status: typeof e['status'] === 'number' ? e['status'] : null, type: named(e['type']), code: named(e['code']), request_id: named(e['requestID']) };
}

export type DraftAttempt = {
  readonly attempt: number;
  /** The compiler's errors on this attempt's output; null when no model came back. */
  readonly errors: readonly CompileError[] | null;
  readonly failed?: string;
  /** On a call that threw: the provider's typed fields (`providerErrorOf`). */
  readonly provider_error?: ProviderError;
  readonly status: string | null;
  readonly usage: unknown;
  readonly ms: number;
};
export type DraftOutcome = {
  /** The last schema-valid draft (compiling or not), as the compiler read it when `interpret` (a first draft's saved form); null when no attempt returned one. */
  readonly model: CanonicalModelT | null;
  readonly compiled: CompileResult | null;
  readonly attempts: readonly DraftAttempt[];
};

/** The request body: fixed instructions and schema first (the cached prefix), then the conversation. An update's schema is its changes only. */
export function draftRequestBody(input: readonly InputMessage[], update = false): StreamedResponsesBody {
  return {
    model: coreBudget(DRAFT_REASONING_EFFORT).model,
    instructions: DRAFTING_INSTRUCTIONS,
    input: input.map((m) => ({ role: m.role, content: m.content })),
    reasoning: { effort: DRAFT_REASONING_EFFORT },
    max_output_tokens: DRAFT_MAX_OUTPUT_TOKENS,
    store: false,
    text: { format: { type: 'json_schema', name: CANONICAL_SCHEMA_NAME, strict: true, schema: update ? UPDATE_JSON_SCHEMA : CANONICAL_JSON_SCHEMA } },
  };
}

/** The repair turn: the compiler's sentences, one per line. */
export const repairMessage = (errors: readonly CompileError[], prefix = REPAIR_PREFIX): string => `${prefix}\n${errors.map((e) => `- ${e.message}`).join('\n')}`;

type Family = Exclude<keyof CanonicalModelT, 'version' | 'question' | 'period' | 'history'>;
const FAMILIES = Object.keys(CanonicalModel.shape).filter((k) => !['version', 'question', 'period', 'history'].includes(k)) as Family[];
/**
 * AN UPDATE, MERGED BY ID onto the saved model (DL 24 Oct, DoD-G classes 12 and 4): in each family a returned id replaces
 * that record where it stands, a new id is added after the saved ones, and an id in remove is deleted; every record not
 * returned is the saved one, exactly. The question and the time step change only when returned. A returned id given twice,
 * or moved to another family, is kept as returned, so the validator refuses it by name (`validatePostimage`).
 */
export function mergeUpdate(saved: CanonicalModelT, update: CanonicalUpdateT): CanonicalModelT {
  const gone = new Set(update.remove);
  const families = Object.fromEntries(FAMILIES.map((f) => {
    const [was, back] = [saved[f] as readonly { id: string }[], update[f] as readonly { id: string }[]];
    const ids = new Set(was.map((r) => r.id));
    return [f, [...was.filter((r) => !gone.has(r.id)).map((r) => back.find((x) => x.id === r.id) ?? r),
      ...back.filter((r, i) => !ids.has(r.id) || back.findIndex((x) => x.id === r.id) !== i)]];
  }));
  return { ...saved, ...families, question: update.question ?? saved.question, period: update.period ?? saved.period } as CanonicalModelT;
}
/**
 * An update read as a first draft is, only where it speaks (Codex BLOCK on #3740): `read` is the compiler's reading of the
 * merged model (`normalise`, the merged model its context); what the update returned, and what its options' inline values
 * become, take that reading, and every saved record it did not return stays exactly as saved, whatever its new context.
 */
export function readUpdate(saved: CanonicalModelT, update: CanonicalUpdateT, read: CanonicalModelT): CanonicalModelT {
  return { ...read, ...Object.fromEntries(FAMILIES.map((f) => {
    const back = new Set((update[f] as readonly { id: string }[]).map((r) => r.id));
    const was = new Map((saved[f] as readonly { id: string }[]).map((r) => [r.id, r] as const));
    return [f, (read[f] as readonly { id: string }[]).map((r) => (back.has(r.id) ? r : was.get(r.id) ?? r))];
  })) } as CanonicalModelT;
}

/** The ledgered client's Responses call, streamed (two unstreamed phase-0 calls were cut at 180 s); one per turn. */
export function ledgeredResponsesCall(): ResponsesCall {
  return async (body) => {
    const final = await streamedLedgeredResponse({ site: 'model-program.draft',
      detailOf: (b) => ({ model: String(b['model']), purpose: 'canonical_draft', ...agentRequestIdentity('agent.construct', b) }) }, body);
    const text = (final?.output ?? []).flatMap((o) => (o.type === 'message' ? o.content : [])).flatMap((c) => (c.type === 'output_text' ? [c.text] : []))[0];
    return { text: text ?? null, status: final?.status ?? null, incomplete: final?.incomplete_details?.reason ?? null, usage: final?.usage ?? null };
  };
}

/**
 * Draft → compile → (repair → compile) ≤ MAX_REPAIRS. `sourceText` is the person's own words (the brief), against which the
 * compiler checks every quote. A transport failure ends the loop with what it has; it is never retried here.
 * `interpret` (a FIRST draft): the model returned, compiled, saved and sent back to the agent is the compiler's reading of
 * the draft (`normalise`: a structure figure that is no structural constant is their question), never the raw draft
 * (buddy, #3709 r7). An update is read the same way, so its postimage is in the saved form.
 */
export async function draftCanonicalModel(brief: string | readonly InputMessage[], call: ResponsesCall, sourceText: string = typeof brief === 'string' ? brief : '',
  opts: { readonly interpret?: boolean; readonly onto?: CanonicalModelT } = {}): Promise<DraftOutcome> {
  const onto = opts.onto;
  const input: InputMessage[] = typeof brief === 'string' ? [{ role: 'user', content: brief }] : [...brief];
  const attempts: DraftAttempt[] = [];
  let model: CanonicalModelT | null = null;
  let compiled: CompileResult | null = null;
  for (let a = 0; a <= MAX_REPAIRS; a += 1) {
    const t0 = Date.now();
    let out: CallOutput;
    try { out = await call(draftRequestBody(input, onto !== undefined)); } catch (err) {
      attempts.push({ attempt: a, errors: null, failed: `call failed: ${err instanceof Error ? err.name : 'error'}`, provider_error: providerErrorOf(err), status: null, usage: null, ms: Date.now() - t0 });
      break;
    }
    const ms = Date.now() - t0;
    if (out.text === null) { attempts.push({ attempt: a, errors: null, failed: `no output (${out.status ?? 'unknown'}${out.incomplete ? `: ${out.incomplete}` : ''})`, status: out.status, usage: out.usage, ms }); break; }
    let json: unknown;
    try { json = JSON.parse(out.text); } catch { attempts.push({ attempt: a, errors: null, failed: 'output is not JSON', status: out.status, usage: out.usage, ms }); break; }
    // An update returns only its changes: the model it proposes is the saved one with them merged by id.
    const update = onto === undefined ? null : CanonicalUpdate.safeParse(json);
    const whole = update?.success ? mergeUpdate(onto!, update.data) : json;
    const parsed = CanonicalModel.safeParse(whole);
    const read = parsed.success && opts.interpret === true ? (update?.success ? readUpdate(onto!, update.data, normalise(parsed.data)) : normalise(parsed.data)) : undefined;
    // A first draft (the brief alone) must give every ask its question, but its last attempt falls back to the base behaviour
    // (an ask with no question is a typed blocker), so a draft is never refused whole for one; an update keeps the saved
    // model's asks as they are.
    const compileOpts = { sourceText, asksNeedQuestions: typeof brief === 'string' && a < MAX_REPAIRS };
    const result = read !== undefined ? compile(read, compileOpts) : compileJson(whole, compileOpts);
    if (parsed.success) { model = read ?? parsed.data; compiled = result; }
    attempts.push({ attempt: a, errors: result.errors, status: out.status, usage: out.usage, ms });
    if (result.errors.length === 0 || a === MAX_REPAIRS) break;
    input.push({ role: 'assistant', content: out.text }, { role: 'user', content: repairMessage(result.errors, onto === undefined ? REPAIR_PREFIX : UPDATE_REPAIR_PREFIX) });
  }
  return { model, compiled, attempts };
}

/**
 * THE AI'S POSTIMAGE (simplify v1: every intended update, the path mechanism completion began): the SAME drafter, in a
 * conversation holding the person's words, the saved model and the change, returns only the records it changes or adds and
 * the ids it removes; the host merges them by id onto the saved model (`mergeUpdate`), read as a first draft is. The caller
 * validates the merged model exactly (`validatePostimage`).
 */
export async function proposePostimage(model: CanonicalModelT, personWords: readonly string[], change: string, removals: readonly string[], call: ResponsesCall): Promise<DraftOutcome> {
  const ask = `${UPDATE_PREFIX}\nThe change: ${change}\nRemove: ${removals.length > 0 ? removals.join(', ') : 'nothing'}`;
  return draftCanonicalModel([{ role: 'user', content: personWords.join('\n\n') }, { role: 'assistant', content: JSON.stringify(model) }, { role: 'user', content: ask }],
    call, personWords.join('\n'), { interpret: true, onto: model });
}
