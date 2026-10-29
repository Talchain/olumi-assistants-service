/**
 * THE CANONICAL DRAFTER (alpha): THE DRAFTING CALL + THE COMPILE/REPAIR LOOP.
 *
 * One strict structured call returns a CanonicalModel (S1's schema, `prompt.ts`), on the client CEE's core lane uses
 * (`ledgeredAgentsClient`: every attempt is a `_provider_calls` row), at the core budget's model with reasoning effort
 * MEDIUM (the benchmark arm alone may set CEE_DRAFT_REASONING_EFFORT). The draft is compiled; when it has errors, ONE
 * edit-only repair (prompts v2, INTEGRATION §3): the retained schema-valid candidate as labelled base data and the
 * compiler's sentences, both Olumi's (developer role), with the edit schema; its edits are merged onto that candidate and
 * compiled once more, and an output still invalid stops honestly. A draft that is not schema-valid, or none at all, has no
 * base, so it stops: the whole model is never asked for again. Nothing here edits the model but the host's own fields
 * (`withHostFields`) and the host's count of stated time: what compiles is the AI's own draft.
 */
import { streamedLedgeredResponse, type StreamedResponsesBody } from '../../adapters/llm/openai-agents-client.js';
import { coreBudget } from '../agent-lane/model-budgets.js';
import { agentRequestIdentity } from '../agent-lane/runtime/prompt-identity.js';
import { CanonicalModel, type CanonicalModelT } from '../model-program/canonical.js';
import { todayInLondon } from '../goal-target/deadline-date.js';
import { countStatedTime } from './stated-time.js';
import { compile, compileJson, normalise, type CompileError, type CompileResult } from '../model-program/compile.js';
import { BASE_MODEL_LABEL, CANONICAL_JSON_SCHEMA, CANONICAL_SCHEMA_NAME, CanonicalUpdate, DRAFTING_INSTRUCTIONS, MODELLING_RULES, REPAIR_ERRORS_LABEL, REPAIR_INSTRUCTIONS,
  SAVED_MODEL_LABEL, todayLine, UPDATE_CHANGE_LABEL, UPDATE_INSTRUCTIONS, UPDATE_JSON_SCHEMA, UPDATE_REMOVALS_LABEL, type CanonicalUpdateT } from './prompt.js';

/** ONE edit-only repair (prompts v2): a second compile failure stops, with no third call. */
export const MAX_REPAIRS = 1;
/** The drafter's default reasoning effort. */
export const DRAFT_REASONING_EFFORT = 'medium' as const;
const EFFORTS = ['low', 'medium', 'high'] as const;
/** The effort a drafting call is sent: medium, unless the benchmark arm sets CEE_DRAFT_REASONING_EFFORT to low, medium or high. */
// eslint-disable-next-line no-restricted-syntax -- call-time read by design: the benchmark arm alone sets it, per run (prompts v2)
export function draftReasoningEffort(env: Readonly<Record<string, string | undefined>> = process.env): (typeof EFFORTS)[number] {
  const v = env['CEE_DRAFT_REASONING_EFFORT'];
  return EFFORTS.find((e) => e === v) ?? DRAFT_REASONING_EFFORT;
}
/** Room for a whole canonical model plus its reasoning (phase 0b's largest draft used 11.7k of 16k on a smaller format). */
export const DRAFT_MAX_OUTPUT_TOKENS = 32_000;

/** `user` is the person's own words only; Olumi's host text and its agent's instructions are `developer` (C6: `proposePostimage`). */
export type InputMessage = { readonly role: 'user' | 'assistant' | 'developer'; readonly content: string };
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
  /** Today (Europe/London) as the drafter was told it, once for the whole drafting conversation, repairs included (alpha G14). */
  readonly today: string;
};

/**
 * The request body: fixed instructions and schema first (the cached prefix), then the conversation. A first draft is sent all
 * of DRAFTING_INSTRUCTIONS and the canonical schema; an edit (an update or a repair) only the MODELLING RULES and the edit
 * schema, its changes only. The date context is the conversation's first, developer message (`dateContext`).
 */
export function draftRequestBody(input: readonly InputMessage[], edit: boolean): StreamedResponsesBody {
  const effort = draftReasoningEffort();
  return {
    model: coreBudget(effort).model,
    instructions: edit ? MODELLING_RULES : DRAFTING_INSTRUCTIONS,
    input: input.map((m) => ({ role: m.role, content: m.content })),
    reasoning: { effort },
    max_output_tokens: DRAFT_MAX_OUTPUT_TOKENS,
    store: false,
    text: { format: { type: 'json_schema', name: CANONICAL_SCHEMA_NAME, strict: true, schema: edit ? UPDATE_JSON_SCHEMA : CANONICAL_JSON_SCHEMA } },
  };
}
/** Today and the saved period 0, as facts for reading stated time: Olumi's, in the developer role (INTEGRATION §1). */
export const dateContext = (today: string, periodZero: string | null = today): InputMessage => ({ role: 'developer', content: todayLine(today, periodZero) });
/** The repair's task: REPAIR_INSTRUCTIONS, then the compiler's sentences, one per line. */
export const repairMessage = (errors: readonly CompileError[]): string => `${REPAIR_INSTRUCTIONS}\n\n${REPAIR_ERRORS_LABEL}\n${errors.map((e) => `- ${e.message}`).join('\n')}`;
/** A shape the schema refuses, said as the compiler says one (`compileJson`), for the attempt's record. */
const schemaErrors = (issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[], what: string): CompileError[] =>
  issues.slice(0, 20).map((i) => ({ code: 'schema', message: `${what} shape is wrong at ${i.path.map(String).join('.') || 'its top level'}: ${i.message}.`, items: [] }));

type Family = Exclude<keyof CanonicalModelT, 'version' | 'question' | 'title' | 'period' | 'coaching_questions' | 'decide_by' | 'history'>;
const FAMILIES = Object.keys(CanonicalModel.shape).filter((k) => !['version', 'question', 'title', 'period', 'coaching_questions', 'decide_by', 'history'].includes(k)) as Family[];
/**
 * THE HOST'S FIELDS ON A DRAFT (Paul 26 Oct: no unnecessary AI work). The drafter is never sent approval, approved_by or author_id
 * (`prompt.ts`), so before its JSON is read, every record and every link in a relation takes the host's values: proposed,
 * approved by no one. Nor is it sent history (spec §3: host-owned, appended from the actual changes): a first draft's is the
 * host's, none yet, whatever came back; an update's is the saved model's (`mergeUpdate`). Nothing else in the draft changes,
 * and a shape the schema refuses stays refused. The saved form is set later, as before (`postimage.ts` asDrafted, accepted).
 */
export function withHostFields(json: unknown, firstDraft: boolean): unknown {
  const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isRec(json)) return json;
  const host = (r: unknown): unknown => (isRec(r) ? { ...r, approval: 'proposed', approved_by: null, author_id: null } : r);
  const record = (r: unknown): unknown => { const x = host(r); return isRec(x) && Array.isArray(x['terms']) ? { ...x, terms: x['terms'].map(host) } : x; };
  return { ...json, ...Object.fromEntries(FAMILIES.filter((f) => Array.isArray(json[f])).map((f) => [f, (json[f] as unknown[]).map(record)])),
    ...(firstDraft ? { history: [] } : {}) };
}
/**
 * AN UPDATE, MERGED BY ID onto the saved model (DL 24 Oct, DoD-G classes 12 and 4): in each family a returned id replaces
 * that record where it stands, a new id is added after the saved ones, and an id in remove is deleted; every record not
 * returned is the saved one, exactly. The question, the time step and Olumi's questions change only when returned (Box 2:
 * null keeps the saved list, [] clears it). A returned id given twice,
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
  // When they must decide (TIME-AND-DECIDE-BY v2): null keeps the saved one; {date: null, quote: null} clears it; any other replaces it.
  const d = update.decide_by;
  const decideBy = d === null ? saved.decide_by : d.date === null && d.quote === null ? null : d;
  return { ...saved, ...families, question: update.question ?? saved.question, period: update.period ?? saved.period,
    coaching_questions: update.coaching_questions ?? saved.coaching_questions, decide_by: decideBy } as CanonicalModelT;
}
/**
 * An update read as a first draft is, only where it speaks (Codex BLOCK on #3740): `read` is the first draft's reading of
 * the merged model (`normalise`, with #3742's direction clearing; the merged model its context); what the update returned,
 * and what its options' inline values become, take that reading, and every saved record it did not return stays exactly as
 * saved, whatever its new context.
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
 * Draft → compile → (ONE edit-only repair → compile). `sourceText` is the person's own words (the brief). A call that failed
 * ends with what it has: nothing here is sent again (strip, Paul 26 Oct); the OpenAI client's own configured retries are the
 * only resend.
 * `interpret` (a FIRST draft): the model returned, compiled, saved and sent back to the agent is the compiler's reading of
 * the draft (`normalise`), never the raw draft (buddy, #3709 r7). An update is read the same way, so its postimage is in the
 * saved form. `periodZero` (an update): the saved model's period-0 date, the first draft's today (`drafted_on`); a first
 * draft counts from today; a program saved before it was kept has none (PL HOLD a), and its date context says so. A
 * position span counts from today, the day it is said (PL 13:40Z).
 * The repair (INTEGRATION §3 and "Update repair base"): its base is the retained schema-valid candidate, for an update the
 * original delta materialised onto the saved model; the repair's edits are merged onto that candidate (`mergeUpdate`), never
 * onto the saved model again, and the caller validates the final candidate against the original saved revision and the
 * whole removal permission list (`validatePostimage`). Only the records each call returns are counted (`stated-time.ts`).
 */
export async function draftCanonicalModel(brief: string | readonly InputMessage[], call: ResponsesCall, sourceText: string = typeof brief === 'string' ? brief : '',
  opts: { readonly interpret?: boolean; readonly onto?: CanonicalModelT; readonly periodZero?: string } = {}): Promise<DraftOutcome> {
  const onto = opts.onto;
  const today = todayInLondon(new Date());
  // The day stated time is counted from: the saved period 0; a first draft's is today. An update on a model saved before its
  // period 0 was kept has none, never today (PL HOLD a): what needs it is withheld, naming the missing start date.
  const anchor = opts.periodZero ?? (onto === undefined ? today : null);
  const conversation: InputMessage[] = typeof brief === 'string' ? [{ role: 'user', content: brief }] : [...brief];
  const dated = dateContext(today, anchor);
  const attempts: DraftAttempt[] = [];
  /** One call: its output's text, or the attempt recorded as failed (nothing back) and null. */
  const send = async (a: number, input: readonly InputMessage[], edit: boolean): Promise<{ readonly json: unknown; readonly out: CallOutput; readonly ms: number } | null> => {
    const t0 = Date.now();
    let out: CallOutput;
    try { out = await call(draftRequestBody(input, edit)); } catch (err) {
      attempts.push({ attempt: a, errors: null, failed: `call failed: ${err instanceof Error ? err.name : 'error'}`, provider_error: providerErrorOf(err), status: null, usage: null, ms: Date.now() - t0 });
      return null;
    }
    const ms = Date.now() - t0;
    if (out.text === null) {
      attempts.push({ attempt: a, errors: null, failed: `no output (${out.status ?? 'unknown'}${out.incomplete ? `: ${out.incomplete}` : ''})`, status: out.status, usage: out.usage, ms });
      return null;
    }
    try { return { json: JSON.parse(out.text), out, ms }; } catch { attempts.push({ attempt: a, errors: null, failed: 'output is not JSON', status: out.status, usage: out.usage, ms }); return null; }
  };
  /** The reading of `base` with `edit` merged onto it (an update, or a repair), only where the edit speaks. */
  const merged = (base: CanonicalModelT, edit: CanonicalUpdateT): CanonicalModelT | null => {
    const m = CanonicalModel.safeParse(mergeUpdate(base, edit));
    if (!m.success) return null;
    // A stated date or span counted by the host, from the saved period 0, on what this edit returns only: a saved or retained
    // record is never recounted, so a figure the person gave is never overwritten. A position span counts from the day it was
    // said, its said_on: today when stated in this message, the saved day when returned unrestated (PL 13:40Z, 14:12Z).
    const counted = countStatedTime(m.data, anchor, new Set(edit.quantities.map((x) => x.id)), today);
    return opts.interpret === true ? readUpdate(base, edit, normalise(counted)) : counted;
  };

  // ── the draft (or the update) ──────────────────────────────────────────────────────────────────────────────────────
  const first = await send(0, [dated, ...conversation], onto !== undefined);
  if (first === null) return { model: null, compiled: null, attempts, today };
  let candidate: CanonicalModelT | null;
  if (onto === undefined) {
    const json = withHostFields(first.json, true);
    const parsed = CanonicalModel.safeParse(json);
    const counted = parsed.success ? countStatedTime(parsed.data, anchor, undefined, today) : null;
    candidate = counted === null ? null : opts.interpret === true ? normalise(counted) : counted;
    if (candidate === null) {
      attempts.push({ attempt: 0, errors: compileJson(json, { sourceText }).errors, failed: 'output is not in the model schema', status: first.out.status, usage: first.out.usage, ms: first.ms });
      return { model: null, compiled: null, attempts, today };
    }
  } else {
    const update = CanonicalUpdate.safeParse(withHostFields(first.json, false));
    candidate = update.success ? merged(onto, update.data) : null;
    if (candidate === null) {
      attempts.push({ attempt: 0, errors: update.success ? [] : schemaErrors(update.error.issues, 'The update\'s'), failed: 'output is not in the edit schema', status: first.out.status, usage: first.out.usage, ms: first.ms });
      return { model: null, compiled: null, attempts, today };
    }
  }
  // A first draft (the brief alone) must give every ask its question, but its repair falls back to the base behaviour (an ask
  // with no question is a typed blocker), so a draft is never refused whole for one; an update keeps the saved model's asks.
  const compiled = compile(candidate, { sourceText, asksNeedQuestions: typeof brief === 'string' });
  attempts.push({ attempt: 0, errors: compiled.errors, status: first.out.status, usage: first.out.usage, ms: first.ms });
  if (compiled.errors.length === 0) return { model: candidate, compiled, attempts, today };

  // ── ONE edit-only repair, onto the retained candidate ──────────────────────────────────────────────────────────────
  // The person's verified words stay their own messages; the candidate and the compiler's sentences are Olumi's (developer).
  const input: InputMessage[] = [dated, ...conversation.filter((m) => m.role === 'user'), { role: 'developer', content: `${BASE_MODEL_LABEL}\n${JSON.stringify(candidate)}` },
    { role: 'developer', content: repairMessage(compiled.errors) }];
  const second = await send(1, input, true);
  if (second === null) return { model: candidate, compiled, attempts, today };
  const fix = CanonicalUpdate.safeParse(withHostFields(second.json, false));
  const repaired = fix.success ? merged(candidate, fix.data) : null;
  if (repaired === null) {
    attempts.push({ attempt: 1, errors: fix.success ? [] : schemaErrors(fix.error.issues, 'The repair\'s'), failed: 'repair is not in the edit schema', status: second.out.status, usage: second.out.usage, ms: second.ms });
    return { model: candidate, compiled, attempts, today };
  }
  const recompiled = compile(repaired, { sourceText, asksNeedQuestions: false });
  attempts.push({ attempt: 1, errors: recompiled.errors, status: second.out.status, usage: second.out.usage, ms: second.ms });
  return { model: repaired, compiled: recompiled, attempts, today };
}

/**
 * THE AI'S POSTIMAGE (simplify v1: every intended update, the path mechanism completion began): the SAME drafter, in a
 * conversation holding the person's words, the saved model and the change, returns only the records it changes or adds and
 * the ids it removes; the host merges them by id onto the saved model (`mergeUpdate`), read as a first draft is. The caller
 * validates the merged model exactly (`validatePostimage`). `periodZero`: the saved program's `drafted_on`, so a date in the
 * change counts from the model's own period 0 (undefined on a program saved before it: none, withheld where needed).
 * C6 ("Source quote, contributor and approval actor stay distinct"): `change` is the agent's own instruction, never the
 * person's words, so it is sent as Olumi's (`UPDATE_CHANGE_LABEL`), with the update's task (UPDATE_INSTRUCTIONS) and the
 * permitted removal ids, in the developer role; the saved model is labelled data (`SAVED_MODEL_LABEL`), also Olumi's; the
 * only user-role message is the person's verified words (`personWords`), where they always were (prompts v2, INTEGRATION
 * §2). Staging 29 Oct: sent as the last user-role message, "The change: Amend the existing…" came back as a quote and was
 * shown "in your words".
 */
export async function proposePostimage(model: CanonicalModelT, personWords: readonly string[], change: string, removals: readonly string[], call: ResponsesCall,
  periodZero?: string): Promise<DraftOutcome> {
  const ask = `${UPDATE_INSTRUCTIONS}\n\n${UPDATE_CHANGE_LABEL} ${change}\n${UPDATE_REMOVALS_LABEL} ${removals.length > 0 ? removals.join(', ') : 'none'}`;
  return draftCanonicalModel([{ role: 'user', content: personWords.join('\n\n') }, { role: 'developer', content: `${SAVED_MODEL_LABEL}\n${JSON.stringify(model)}` }, { role: 'developer', content: ask }],
    call, personWords.join('\n'), { interpret: true, onto: model, ...(periodZero !== undefined ? { periodZero } : {}) });
}
