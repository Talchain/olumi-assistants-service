/**
 * PRODUCER pin for the coaching pass's served-prompt + model attribution.
 *
 * The coaching pass is a SECOND, ungated LLM call on every draft turn and the
 * dominant one by wall-clock (~19.8 s). Its prompt hash, prompt version and
 * resolved model were all computed at the call site and thrown into a log line
 * — visible in Render, invisible in `_diagnostic_trace`, which is the surface
 * anyone debugging a draft actually reads. Nothing needed deriving; what was
 * missing was a channel, and `ctx.opts.promptAttribution` is it.
 *
 * WHY A PRODUCER FILE AT ALL. The consumer suite
 * (`orchestrator-v5/diagnostics/__tests__/pipeline-prompt-attribution.test.ts`)
 * hands the builder a snapshot and asserts it lands. That suite stays fully
 * GREEN if this stage never calls `record()` — which is exactly how an
 * always-empty `llm_calls[]` once shipped under a builder-only test. This file
 * is the half that can see it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

import { runStageCoachingPass, COACHING_PROMPT_HASH, COACHING_PROMPT_VERSION } from '../coaching-pass.js';
import { PromptAttributionCollector } from '../../../../orchestrator/pipeline/prompt-attribution.js';
import {
  DRAFT_REQUEST_BUDGET_MS,
  LLM_POST_PROCESSING_HEADROOM_MS,
} from '../../../../config/timeouts.js';
import type { StageContext } from '../../types.js';

function requestStartForRemaining(remainingMs: number): number {
  const elapsed = DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS - remainingMs;
  return Date.now() - elapsed;
}

function makeCtx(opts: {
  requestStartMs: number;
  chat: ReturnType<typeof vi.fn>;
  promptAttribution?: PromptAttributionCollector;
}): StageContext {
  return {
    coaching: undefined,
    causalClaims: undefined,
    draftAdapter: {
      // The pass resolves no provider of its own; it inherits the draft
      // adapter's, exactly as it inherits the model.
      name: 'anthropic',
      chat: opts.chat,
    } as unknown as StageContext['draftAdapter'],
    graph: {
      nodes: [{ id: 'n1', kind: 'factor', label: 'a' }],
      edges: [],
    } as unknown as StageContext['graph'],
    effectiveBrief: 'Should I hire a contractor or a full-time employee?',
    requestId: 'req-attrib',
    start: opts.requestStartMs,
    opts: {
      requestStartMs: opts.requestStartMs,
      signal: undefined,
      ...(opts.promptAttribution ? { promptAttribution: opts.promptAttribution } : {}),
    } as StageContext['opts'],
    pipelineOutcome: {
      coaching_status: 'partial',
      warnings: [],
    } as unknown as StageContext['pipelineOutcome'],
  } as unknown as StageContext;
}

function usableCoachingChat() {
  return vi.fn().mockResolvedValue({
    content: JSON.stringify({
      coaching: { summary: 'Consider a status-quo option.', strengthen_items: [] },
      causal_claims: [],
    }),
    usage: { input_tokens: 4100, output_tokens: 380 },
    model: 'claude-sonnet-4-6',
    latencyMs: 19_800,
    stopReason: 'end_turn',
  });
}

describe('coaching pass — served-prompt and model attribution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records the coaching prompt identity and the RESOLVED model on a pass that produced coaching', async () => {
    const attribution = new PromptAttributionCollector();
    const chat = usableCoachingChat();
    const ctx = makeCtx({
      requestStartMs: requestStartForRemaining(105_000),
      chat,
      promptAttribution: attribution,
    });

    await runStageCoachingPass(ctx);

    // Presence control first: a pass that never ran cannot attribute anything,
    // so an attribution assertion over a skipped pass would be vacuous.
    expect(chat).toHaveBeenCalledTimes(1);
    expect(ctx.coaching).toBeDefined();

    const snapshot = attribution.snapshot();
    const identity = snapshot.prompt_identity.find((p) => p.task_id === 'draft_coaching');
    expect(identity).toBeDefined();
    // Bound to the module's REAL constants, not to a literal copied into this
    // file. `COACHING_PROMPT_HASH` is computed over the RENDERED prompt, which
    // interpolates contract enums — a schemas bump moves the served text with
    // no diff in coaching-pass.ts, and a hardcoded expectation here would then
    // pin a hash the model was never shown.
    expect(identity!.hash).toBe(COACHING_PROMPT_HASH);
    expect(identity!.version).toBe(COACHING_PROMPT_VERSION);
    expect(identity!.source).toBe('code');

    const call = snapshot.llm_calls.find((c) => c.role === 'draft_coaching');
    expect(call).toBeDefined();
    // ⚠ THE POINT OF THE MODEL FIELD. This pass chooses no model — it reuses
    // the draft adapter, whose model the DRAFT prompt's store `model_config`
    // can re-pin. Recording the resolved model is how a silent re-pin of a
    // second, un-evalled LLM call becomes visible.
    expect(call!.model).toBe('claude-sonnet-4-6');
    expect(call!.provider).toBe('anthropic');
    expect(call!.input_tokens).toBe(4100);
    expect(call!.output_tokens).toBe(380);
  });

  it('still attributes a pass whose JSON was UNUSABLE — the failure a reader is most likely investigating', async () => {
    const attribution = new PromptAttributionCollector();
    const chat = vi.fn().mockResolvedValue({
      content: 'not json at all',
      usage: { input_tokens: 4100, output_tokens: 12 },
      model: 'claude-sonnet-4-6',
      latencyMs: 900,
      stopReason: 'end_turn',
    });
    const ctx = makeCtx({
      requestStartMs: requestStartForRemaining(105_000),
      chat,
      promptAttribution: attribution,
    });

    await runStageCoachingPass(ctx);

    // The pass ran and produced nothing usable — `failed_degraded`, not a skip.
    expect(chat).toHaveBeenCalledTimes(1);
    expect(ctx.pipelineOutcome.coaching_status).toBe('failed_degraded');
    // Attribution is recorded BEFORE the parse, so the prompt and model that
    // produced the unusable output are still named. Recording after the parse
    // would leave the trace silent on exactly the turn someone is debugging.
    expect(
      attribution.snapshot().prompt_identity.some((p) => p.task_id === 'draft_coaching'),
    ).toBe(true);
  });

  it('records NOTHING when the pass skipped on budget — an absence that is a fact, not an omission', async () => {
    const attribution = new PromptAttributionCollector();
    const chat = usableCoachingChat();
    // ~24 s remaining, below the floor: the pass must not launch a call it
    // cannot finish.
    const ctx = makeCtx({
      requestStartMs: requestStartForRemaining(24_000),
      chat,
      promptAttribution: attribution,
    });

    await runStageCoachingPass(ctx);

    expect(chat).not.toHaveBeenCalled();
    expect(ctx.pipelineOutcome.coaching_status).toBe('skipped_budget');
    // OPPOSITE-DIRECTION TWIN of case 1. A site that recorded unconditionally
    // would attribute a call that never happened — a fabrication, and strictly
    // worse than the silence this change replaced. The first case is the
    // positive control that makes this absence meaningful.
    expect(attribution.isEmpty()).toBe(true);
  });

  it('runs unchanged when no collector is threaded (every recording site is a guarded no-op)', async () => {
    const chat = usableCoachingChat();
    const ctx = makeCtx({ requestStartMs: requestStartForRemaining(105_000), chat });

    await runStageCoachingPass(ctx);

    // The pipeline has callers that thread no collector (the assist routes).
    // Attribution must never be able to break a draft that would have worked.
    expect(chat).toHaveBeenCalledTimes(1);
    expect(ctx.coaching).toBeDefined();
    expect(ctx.pipelineOutcome.coaching_status).not.toBe('failed_degraded');
  });
});
