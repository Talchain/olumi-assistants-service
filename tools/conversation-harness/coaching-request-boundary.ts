/**
 * coaching-request-boundary — the ACTUAL model-client request boundary for the
 * #1398 candidate, and the attempt budget that guards any future paid dispatch.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────
 * Independent review of `d523588a`: the banked artefact was a USER-MESSAGE
 * contract. It proved message parity, but it never touched `ChatWithToolsArgs`,
 * so it said nothing about the system representation, the advertised tools,
 * `tool_choice`, temperature, output budget, thinking or cache blocks — all of
 * which production sets at `route-with-tool-use.ts` around the adapter call. A
 * ceiling recorded as a JSON field also enforces nothing at a future caller.
 *
 * This module closes both. It captures the COMPLETE arguments production would
 * send, through production `routeWithToolUse`, using the SAME captured-adapter
 * pattern the routing tests already use — and it puts the ceiling in the code
 * path that would dispatch, where it can actually refuse.
 *
 * ⚠ STILL NO PAID CALL HAPPENS HERE. `dispatchBounded` requires an adapter to be
 * handed in; nothing in this repo hands it a real one. It never executes a tool
 * proposal, never boots a server, never reads or writes a database or PMS.
 *
 * ⚠ DECLARED SYNTHETIC. The snapshot resolved locally is the registered default
 * (v40). The observed native failure ran served v121. This is a declared
 * synthetic comparison, not a replay of that turn.
 */

import { createHash } from 'node:crypto';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../src/adapters/llm/types.js';
import { assembleContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import { ensureRoutingPromptSnapshot } from '../../src/orchestrator-v5/routing/prompt-loader.js';
import {
  COACHING_CONTEXT_INSTRUCTION,
  routeWithToolUse,
} from '../../src/orchestrator-v5/routing/route-with-tool-use.js';
import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';
import { coachingState, type ArmName } from './coaching-request-contract.js';
import { frozenBrief, frozenGraph, recordedPriorTurns } from './coaching-recorded-context.js';

/**
 * THE AUTHORISED TOTAL, for the whole comparison and both arms together.
 * Every attempt counts: first tries, retries and failures alike. It is not
 * reset between arms, between questions, or after an error.
 */
export const ATTEMPT_CEILING = 18;

/** Thrown when a dispatch would exceed the authorised total. Never caught internally. */
export class AttemptCeilingExceeded extends Error {
  constructor(readonly attempted: number, readonly ceiling: number) {
    super(
      `REFUSED: attempt ${attempted} would exceed the authorised total of ${ceiling}. ` +
        'The ceiling counts retries and failures and is never reset. Obtain a new ' +
        'authorised total rather than restarting this one.',
    );
    this.name = 'AttemptCeilingExceeded';
  }
}

/**
 * A single shared counter for a whole comparison run.
 *
 * The charge happens BEFORE dispatch, deliberately: charging afterwards would let
 * a call that timed out or threw escape the budget, which is precisely how "18
 * answers" quietly becomes thirty.
 */
export class AttemptBudget {
  private used = 0;
  constructor(readonly ceiling: number = ATTEMPT_CEILING) {}
  get spent(): number {
    return this.used;
  }
  get remaining(): number {
    return this.ceiling - this.used;
  }
  /** Charge one attempt or refuse. Call immediately before every dispatch. */
  charge(): void {
    const attempted = this.used + 1;
    if (attempted > this.ceiling) throw new AttemptCeilingExceeded(attempted, this.ceiling);
    this.used = attempted;
  }
}

export interface BoundaryCapture {
  readonly question: string;
  readonly freshness: 'none' | 'stale';
  readonly args: ChatWithToolsArgs;
}

/** A capturing adapter — the pattern already used by the routing tests. */
function capturingAdapter(): {
  readonly calls: ChatWithToolsArgs[];
  readonly chatWithTools: (args: ChatWithToolsArgs) => Promise<ChatWithToolsResult>;
} {
  const calls: ChatWithToolsArgs[] = [];
  return {
    calls,
    chatWithTools: async (args: ChatWithToolsArgs): Promise<ChatWithToolsResult> => {
      calls.push(args);
      return {
        content: [{ type: 'text', text: 'captured' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        model: 'capture-only',
        latencyMs: 0,
      } as unknown as ChatWithToolsResult;
    },
  };
}

/**
 * Capture the complete arguments production would send for one question in one
 * coaching state, on the NONEMPTY recorded context.
 */
export async function captureBoundary(
  question: string,
  freshness: 'none' | 'stale',
): Promise<BoundaryCapture> {
  const graph = frozenGraph();
  const pack = assembleContextPack({
    payload: makeMessagePayload({
      turn_id: `boundary-${freshness}`,
      scenario_id: 'coaching-capability-contract',
      message: question,
    }),
    priorTurns: recordedPriorTurns(),
    priorFacts: [],
    brief: frozenBrief(),
    graphContext: { status: 'canonical' },
    graph: graph as never,
    coachingContext: coachingState(freshness),
  });
  const adapter = capturingAdapter();
  await routeWithToolUse(pack, question, { requestId: `boundary-${freshness}`, adapter });
  const args = adapter.calls[0];
  if (!args) throw new Error('boundary: the adapter was never called');
  return { question, freshness, args };
}

/**
 * The baseline arm AT THE REQUEST BOUNDARY: the same captured arguments with only
 * the instruction bytes swapped inside the user message.
 *
 * Every other field — system, tools, tool_choice, temperature, maxTokens,
 * thinking, cache blocks — is the SAME OBJECT REFERENCE as the candidate's, so
 * "one changed variable" is structural here rather than a claim to be audited.
 */
export function baselineArgs(args: ChatWithToolsArgs, baselineInstruction: string): ChatWithToolsArgs {
  const first = args.messages[0];
  if (!first || typeof first.content !== 'string') {
    throw new Error('boundary: expected a single string user message');
  }
  const occurrences = first.content.split(COACHING_CONTEXT_INSTRUCTION).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `boundary: the candidate instruction appears ${occurrences} times; a swap here would ` +
        'not isolate one changed variable',
    );
  }
  return {
    ...args,
    messages: [
      { ...first, content: first.content.replace(COACHING_CONTEXT_INSTRUCTION, baselineInstruction) },
      ...args.messages.slice(1),
    ],
  };
}

/** Everything about a request EXCEPT the user message — must match across arms. */
export function nonMessageArgs(args: ChatWithToolsArgs): Record<string, unknown> {
  const { messages: _messages, ...rest } = args;
  void _messages;
  return rest as Record<string, unknown>;
}

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Explicit snapshot provenance, read from the production loader. */
export async function snapshotProvenance(): Promise<Record<string, unknown>> {
  const snapshot = await ensureRoutingPromptSnapshot();
  return {
    prompt_version: snapshot.version,
    prompt_sent_hash: snapshot.sent_hash,
    declared_synthetic: true,
    note:
      'Locally registered default. The observed native coaching failure ran served v121 ' +
      '(bec840a648800928); this is a declared synthetic comparison, not that replay.',
  };
}

export interface DispatchRecord {
  readonly arm: ArmName;
  readonly question: string;
  readonly freshness: 'none' | 'stale';
  readonly attempt: number;
  readonly ok: boolean;
  readonly text: string | null;
  readonly toolProposalsSeen: number;
  readonly error: string | null;
  readonly argsSha256_16: string;
}

/**
 * The ONLY sanctioned dispatch path, and the only place a paid call could ever
 * originate. Three properties are structural, not documentary:
 *
 *  1. The budget is charged BEFORE `send` is invoked, so a throw or a timeout has
 *     already been paid for and cannot be retried for free.
 *  2. It returns tool proposals as a COUNT, never as something to run. Nothing
 *     here dispatches a handler, and no handler module is even imported.
 *  3. It takes `send` as a parameter. Nothing in this repository passes it a real
 *     model client, so importing this module cannot spend money by accident.
 */
export async function dispatchBounded(
  requests: readonly { readonly arm: ArmName; readonly capture: BoundaryCapture; readonly args: ChatWithToolsArgs }[],
  send: (args: ChatWithToolsArgs) => Promise<ChatWithToolsResult>,
  budget: AttemptBudget,
): Promise<DispatchRecord[]> {
  const out: DispatchRecord[] = [];
  for (const req of requests) {
    budget.charge();
    const attempt = budget.spent;
    const argsSha256_16 = sha16(JSON.stringify(req.args));
    try {
      const result = await send(req.args);
      const text = result.content.find((b) => b.type === 'text');
      out.push({
        arm: req.arm,
        question: req.capture.question,
        freshness: req.capture.freshness,
        attempt,
        ok: true,
        text: text && 'text' in text ? (text as { text: string }).text : null,
        // Counted as EVIDENCE. Never executed: a proposal from an evaluation run
        // has no consent behind it and no model to apply itself to.
        toolProposalsSeen: result.content.filter((b) => b.type === 'tool_use').length,
        error: null,
        argsSha256_16,
      });
    } catch (e) {
      out.push({
        arm: req.arm,
        question: req.capture.question,
        freshness: req.capture.freshness,
        attempt,
        ok: false,
        text: null,
        toolProposalsSeen: 0,
        error: e instanceof Error ? e.message : String(e),
        argsSha256_16,
      });
    }
  }
  return out;
}

/**
 * Bank the boundary evidence. Capture only — this entry point never calls
 * {@link dispatchBounded} and never constructs a model client.
 */
async function main(): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { QUESTIONS, baselineInstruction } = await import('./coaching-request-contract.js');
  const repoRoot = join(import.meta.dirname, '..', '..');
  const argOut = process.argv.indexOf('--out');
  const outDir =
    argOut > -1 && process.argv[argOut + 1]
      ? process.argv[argOut + 1]!
      : join(repoRoot, 'tools', 'conversation-harness', 'runs', 'request-boundary');
  mkdirSync(outDir, { recursive: true });

  const baseline = baselineInstruction(repoRoot);
  const rows: Record<string, unknown>[] = [];
  for (const [qi, question] of QUESTIONS.entries()) {
    for (const freshness of ['none', 'stale'] as const) {
      const cap = await captureBoundary(question, freshness);
      const other = baselineArgs(cap.args, baseline);
      const stem = `q${qi + 1}-${freshness}`;
      writeFileSync(join(outDir, `${stem}.candidate.args.json`), `${JSON.stringify(cap.args, null, 2)}\n`);
      writeFileSync(join(outDir, `${stem}.baseline.args.json`), `${JSON.stringify(other, null, 2)}\n`);
      rows.push({
        id: stem,
        question,
        freshness,
        non_message_args_identical:
          JSON.stringify(nonMessageArgs(cap.args)) === JSON.stringify(nonMessageArgs(other)),
        candidate_args_sha256_16: sha16(JSON.stringify(cap.args)),
        baseline_args_sha256_16: sha16(JSON.stringify(other)),
        system_sha256_16: sha16(cap.args.system),
        system_chars: cap.args.system.length,
        tools: cap.args.tools.map((t) => t.name),
        tool_choice: cap.args.tool_choice,
        temperature: cap.args.temperature,
        max_tokens: cap.args.maxTokens,
        thinking: cap.args.thinking ?? null,
      });
    }
  }
  writeFileSync(
    join(outDir, 'boundary.json'),
    `${JSON.stringify(
      {
        generated_by: 'tools/conversation-harness/coaching-request-boundary.ts',
        provider_calls: 0,
        database_writes: 0,
        pms_writes: 0,
        tool_executions: 0,
        attempt_ceiling: ATTEMPT_CEILING,
        snapshot: await snapshotProvenance(),
        requests: rows,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `banked ${rows.length * 2} complete ChatWithToolsArgs + boundary.json under ${outDir}\n` +
      'zero provider calls, zero database writes, zero PMS writes, zero tool executions.\n',
  );
}

if (process.argv[1] && process.argv[1].endsWith('coaching-request-boundary.ts')) {
  await main();
}
