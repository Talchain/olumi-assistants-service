/**
 * FINAL-SWEEP (pre-handover) — F-1: doc-attach honesty on a non-Anthropic override.
 *
 * The native document block (Step 1a) is Anthropic-native. #671 made native the
 * PRIMARY document path and dropped the legacy grounding fallback for every
 * attachment native carries. So a request that overrides the draft `model` to a
 * non-Anthropic provider AND attaches a document had the document TOTALLY and
 * SILENTLY dropped: the OpenAI adapter never reads `args.attachment`, the only
 * attachment-disclosure log lives in the Anthropic adapter, and Step 1b's legacy
 * grounding is skipped once native carried the block. The user believed the doc
 * was considered.
 *
 * Fix (Step 5b): fail-closed — a document attached alongside a non-Anthropic
 * resolved model returns a typed 400 with honest copy, never a silent drop. The
 * live default draft model is Claude, so this NEVER fires on the default journey.
 *
 * RED-first: the openai-override arm goes RED on the pre-fix stage (no earlyReturn;
 * the adapter is called and the doc silently dropped). Mutation-checked by
 * reverting the Step-5b hunk.
 *
 * REFUTE guard: the Anthropic arm must NOT be caught by the gate — it reaches the
 * adapter (the doc is carried), proving the fix does not break the default path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';

import type { StageContext } from '../../types.js';

// ── Mock the adapter resolver so we control the resolved model/provider ─────
let mockAdapterModel = 'gpt-4o';
const draftGraphSpy = vi.fn(async () => {
  throw new Error('__reached_adapter_sentinel__');
});

vi.mock('../../../../adapters/llm/router.js', () => ({
  getAdapterWithResolution: () => ({
    adapter: { model: mockAdapterModel, name: 'mock', draftGraph: draftGraphSpy },
    resolution: {
      task: 'draft_graph',
      resolved_model: mockAdapterModel,
      resolution_source: 'client_override',
    },
  }),
}));

const { runStageParse } = await import('../parse.js');

const DOC_TEXT = 'Quarterly ad budget is 50k. The decision is whether to expand marketing.';
const DOC_B64 = Buffer.from(DOC_TEXT, 'utf8').toString('base64');

function makeCtx(model: string): StageContext {
  return {
    requestId: 'req-attach-gate',
    input: {
      brief: 'Should we expand marketing?',
      model,
      attachments: [{ id: 'att-1', kind: 'txt', name: 'brief.txt' }],
    },
    rawBody: { attachment_payloads: { 'att-1': DOC_B64 } },
    effectiveBrief: 'Should we expand marketing?',
    opts: { requestStartMs: Date.now(), signal: undefined },
    earlyReturn: undefined,
    collector: undefined,
  } as unknown as StageContext;
}

beforeEach(() => {
  draftGraphSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('parse Step 5b — attachment/adapter compatibility (F-1 honesty)', () => {
  it('openai override + attachment → FAIL CLOSED (typed 400, adapter never called) [RED on pre-fix]', async () => {
    mockAdapterModel = 'gpt-4o'; // non-Anthropic
    const ctx = makeCtx('gpt-4o');

    await runStageParse(ctx);

    // Post-fix: refused at Step 5b before the adapter — the doc is never silently
    // handed to a provider that ignores it. Pre-fix: no earlyReturn, adapter
    // called, doc dropped → RED.
    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn!.statusCode).toBe(400);
    const body = ctx.earlyReturn!.body as { code?: string; message?: string };
    expect(body.code).toBe('CEE_VALIDATION_FAILED');
    expect(String(body.message)).toMatch(/default model|cannot read attachments/i);
    expect(draftGraphSpy).not.toHaveBeenCalled();
  });

  it('REFUTE — anthropic model + attachment → NOT gated; reaches the adapter (doc carried, default path intact)', async () => {
    mockAdapterModel = 'claude-sonnet-4-6'; // Anthropic → native block is read
    const ctx = makeCtx('claude-sonnet-4-6');

    // The adapter (mocked) throws a sentinel once reached; that is fine — we only
    // assert the gate did NOT short-circuit before it.
    await runStageParse(ctx).catch(() => undefined);

    // No attachment-incompatibility earlyReturn was raised…
    const body = ctx.earlyReturn?.body as { message?: string } | undefined;
    expect(body?.message ?? '').not.toMatch(/cannot read attachments/i);
    // …and execution reached the adapter (past Step 5b + the cost guard).
    expect(draftGraphSpy).toHaveBeenCalled();
  });
});
