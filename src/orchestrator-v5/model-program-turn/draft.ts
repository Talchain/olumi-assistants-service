/**
 * THE CANONICAL DRAFTER (alpha): THE DRAFTING CALL + THE COMPILE/REPAIR LOOP.
 *
 * One strict structured call returns a CanonicalModel (S1's schema, `prompt.ts`), on the client CEE's core lane uses
 * (`ledgeredAgentsClient`: every attempt is a `_provider_calls` row), at the core budget's model with reasoning effort
 * MEDIUM. The draft is compiled; while it has errors, the compiler's own sentences go back to the SAME conversation (the
 * draft as the assistant's turn, the errors as the next user turn: phase 0b's repair shape), at most twice. Nothing here
 * edits the model: what compiles is the AI's own draft.
 */
import { ledgeredAgentsClient } from '../../adapters/llm/openai-agents-client.js';
import { coreBudget } from '../agent-lane/model-budgets.js';
import { agentRequestIdentity } from '../agent-lane/runtime/prompt-identity.js';
import { CanonicalModel, type CanonicalModelT } from '../model-program/canonical.js';
import { compileJson, type CompileError, type CompileResult } from '../model-program/compile.js';
import { CANONICAL_JSON_SCHEMA, CANONICAL_SCHEMA_NAME, DRAFTING_INSTRUCTIONS, REPAIR_PREFIX } from './prompt.js';

export const MAX_REPAIRS = 2;
export const DRAFT_REASONING_EFFORT = 'medium' as const;
/** Room for a whole canonical model plus its reasoning (phase 0b's largest draft used 11.7k of 16k on a smaller format). */
export const DRAFT_MAX_OUTPUT_TOKENS = 32_000;

type Rec = Record<string, unknown>;
export type InputMessage = { readonly role: 'user' | 'assistant'; readonly content: string };
export type CallOutput = { readonly text: string | null; readonly status: string | null; readonly incomplete: string | null; readonly usage: unknown };
/** One Responses call with the body as built here. Injectable, so a test can answer it without a network. */
export type ResponsesCall = (body: Rec) => Promise<CallOutput>;

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
  /** The last schema-valid draft (compiling or not); null when no attempt returned one. */
  readonly model: CanonicalModelT | null;
  readonly compiled: CompileResult | null;
  readonly attempts: readonly DraftAttempt[];
};

/** The request body: fixed instructions and schema first (the cached prefix), then the conversation. */
export function draftRequestBody(input: readonly InputMessage[]): Rec {
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
  const pending: Promise<void>[] = [];
  const client = ledgeredAgentsClient({ site: 'model-program.draft', pending,
    detailOf: (body) => ({ model: String(body['model']), purpose: 'canonical_draft', ...agentRequestIdentity('agent.construct', body) }) });
  return async (body) => {
    const stream = await client.responses.create({ ...body, stream: true } as never) as unknown as AsyncIterable<{ type?: string; response?: Rec }>;
    let final: Rec | undefined;
    for await (const ev of stream) {
      if (ev.type === 'response.completed' || ev.type === 'response.incomplete' || ev.type === 'response.failed') final = ev.response;
    }
    await Promise.all(pending);
    const output = Array.isArray(final?.['output']) ? final!['output'] as Rec[] : [];
    const content = output.filter((o) => o['type'] === 'message').flatMap((o) => (Array.isArray(o['content']) ? o['content'] as Rec[] : []));
    const text = content.find((c) => c['type'] === 'output_text')?.['text'];
    return { text: typeof text === 'string' ? text : null, status: typeof final?.['status'] === 'string' ? final['status'] as string : null,
      incomplete: ((final?.['incomplete_details'] as Rec | undefined)?.['reason'] as string | undefined) ?? null, usage: final?.['usage'] ?? null };
  };
}

/**
 * Draft → compile → (repair → compile) ≤ MAX_REPAIRS. `sourceText` is the person's own words (the brief), against which the
 * compiler checks every quote. A transport failure ends the loop with what it has; it is never retried here.
 */
export async function draftCanonicalModel(brief: string, call: ResponsesCall, sourceText: string = brief): Promise<DraftOutcome> {
  const input: InputMessage[] = [{ role: 'user', content: brief }];
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
    const result = compileJson(json, { sourceText });
    const parsed = CanonicalModel.safeParse(json);
    if (parsed.success) { model = parsed.data; compiled = result; }
    attempts.push({ attempt: a, errors: result.errors, status: out.status, usage: out.usage, ms });
    if (result.errors.length === 0 || a === MAX_REPAIRS) break;
    input.push({ role: 'assistant', content: out.text }, { role: 'user', content: repairMessage(result.errors) });
  }
  return { model, compiled, attempts };
}
