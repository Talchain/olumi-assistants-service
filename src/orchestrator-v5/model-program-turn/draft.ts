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
import { compile, compileJson, normalise, quoteIn, type CompileError, type CompileResult } from '../model-program/compile.js';
import { addMechanism, statesFigure } from '../model-program/answer.js';
import { CANONICAL_JSON_SCHEMA, CANONICAL_SCHEMA_NAME, COMPLETION_PREFIX, DRAFTING_INSTRUCTIONS, REPAIR_PREFIX } from './prompt.js';

export const MAX_REPAIRS = 2;
export const DRAFT_REASONING_EFFORT = 'medium' as const;
/** Room for a whole canonical model plus its reasoning (phase 0b's largest draft used 11.7k of 16k on a smaller format). */
export const DRAFT_MAX_OUTPUT_TOKENS = 32_000;

export type InputMessage = { readonly role: 'user' | 'assistant'; readonly content: string };
export type CallOutput = { readonly text: string | null; readonly status: string | null; readonly incomplete: string | null; readonly usage: unknown };
/** One Responses call with the body as built here. Injectable, so a test can answer it without a network. */
export type ResponsesCall = (body: StreamedResponsesBody) => Promise<CallOutput>;

export type DraftAttempt = {
  readonly attempt: number;
  /** The compiler's errors on this attempt's output; null when no model came back. */
  readonly errors: readonly CompileError[] | null;
  readonly failed?: string;
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

/** The request body: fixed instructions and schema first (the cached prefix), then the conversation. */
export function draftRequestBody(input: readonly InputMessage[]): StreamedResponsesBody {
  return {
    model: coreBudget(DRAFT_REASONING_EFFORT).model,
    instructions: DRAFTING_INSTRUCTIONS,
    input: input.map((m) => ({ role: m.role, content: m.content })),
    reasoning: { effort: DRAFT_REASONING_EFFORT },
    max_output_tokens: DRAFT_MAX_OUTPUT_TOKENS,
    store: false,
    text: { format: { type: 'json_schema', name: CANONICAL_SCHEMA_NAME, strict: true, schema: CANONICAL_JSON_SCHEMA } },
  };
}

/** The repair turn: the compiler's sentences, one per line. */
export const repairMessage = (errors: readonly CompileError[]): string => `${REPAIR_PREFIX}\n${errors.map((e) => `- ${e.message}`).join('\n')}`;

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
 * the draft (`normalise` with their words: a structure figure their words do not state is their question), never the raw draft
 * (buddy, #3709 r7). Completion takes the raw draft: it reads its own additions (`addMechanism`).
 */
export async function draftCanonicalModel(brief: string | readonly InputMessage[], call: ResponsesCall, sourceText: string = typeof brief === 'string' ? brief : '',
  opts: { readonly interpret?: boolean } = {}): Promise<DraftOutcome> {
  const input: InputMessage[] = typeof brief === 'string' ? [{ role: 'user', content: brief }] : [...brief];
  const attempts: DraftAttempt[] = [];
  let model: CanonicalModelT | null = null;
  let compiled: CompileResult | null = null;
  for (let a = 0; a <= MAX_REPAIRS; a += 1) {
    const t0 = Date.now();
    let out: CallOutput;
    try { out = await call(draftRequestBody(input)); } catch (err) {
      attempts.push({ attempt: a, errors: null, failed: `call failed: ${err instanceof Error ? err.name : 'error'}`, status: null, usage: null, ms: Date.now() - t0 });
      break;
    }
    const ms = Date.now() - t0;
    if (out.text === null) { attempts.push({ attempt: a, errors: null, failed: `no output (${out.status ?? 'unknown'}${out.incomplete ? `: ${out.incomplete}` : ''})`, status: out.status, usage: out.usage, ms }); break; }
    let json: unknown;
    try { json = JSON.parse(out.text); } catch { attempts.push({ attempt: a, errors: null, failed: 'output is not JSON', status: out.status, usage: out.usage, ms }); break; }
    const parsed = CanonicalModel.safeParse(json);
    const read = parsed.success && opts.interpret === true ? normalise(parsed.data, statesFigure(quoteIn(sourceText))) : undefined;
    const result = read !== undefined ? compile(read, { sourceText }) : compileJson(json, { sourceText });
    if (parsed.success) { model = read ?? parsed.data; compiled = result; }
    attempts.push({ attempt: a, errors: result.errors, status: out.status, usage: out.usage, ms });
    if (result.errors.length === 0 || a === MAX_REPAIRS) break;
    input.push({ role: 'assistant', content: out.text }, { role: 'user', content: repairMessage(result.errors) });
  }
  return { model, compiled, attempts };
}

/**
 * Mechanism completion (DL 23 Oct): when the person has said how an aim is measured and nothing in the model works that
 * measure out, the SAME drafter, in a conversation holding their words, the model as it stands and the request, proposes
 * what works it out. Only its additions of Olumi's kinds are kept (`addMechanism`); quotes are checked against the person's
 * words only, never against the model's JSON. Null when nothing is needed, the drafter fails, or its additions are refused:
 * the measure then stays as they named it, with its asks.
 */
export async function completeMechanism(model: CanonicalModelT, goalId: string, personWords: readonly string[], call: ResponsesCall,
  fresh: ReadonlySet<string>, isTheirs: (quote: string | null) => boolean): Promise<{ readonly model: CanonicalModelT; readonly attempts: readonly DraftAttempt[] } | null> {
  const goal = model.goals.find((g) => g.id === goalId);
  const measure = goal?.measure ?? null;
  const measured = measure === null ? undefined : model.quantities.find((q) => q.id === measure.quantity);
  if (goal === undefined || measured === undefined || !fresh.has(measured.id) || model.relations.some((r) => r.defines === measured.id)) return null;
  const ask = `${COMPLETION_PREFIX}\nThe aim: "${goal.label}" (${goal.id}), measured by "${measured.label}" (${measured.id}, in ${measured.unit}).`;
  const draft = await draftCanonicalModel([{ role: 'user', content: personWords.join('\n\n') }, { role: 'assistant', content: JSON.stringify(model) }, { role: 'user', content: ask }],
    call, personWords.join('\n'));
  if (draft.model === null) return null;
  const merged = addMechanism(model, draft.model, measured.id, fresh, isTheirs);
  if (!merged.ok || compile(merged.model, { sourceText: personWords.join('\n') }).errors.length > 0) return null;
  return { model: merged.model, attempts: draft.attempts };
}
