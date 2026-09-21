/**
 * FINAL-SWEEP (pre-handover) — Codex F-2: the Step-6 cost guard never saw the
 * native attachment. #671 made the native `document` block the primary path, so
 * on that path `docs=[]` and `promptChars` (hence `tokensIn`) excluded the
 * document entirely — up to ~131k input tokens for a 512KB doc, under-counting
 * per-request spend by up to ~50x. `meta.tokens_est` was computed and then never
 * wired into the guard.
 *
 * Fix (Step 6): add the attachment's `meta.tokens_est` (text kinds) or a
 * conservative bytes-derived estimate (PDF) into `tokensIn`.
 *
 * RED-first: the captured `tokensIn` argument to `allowedCostUSD` INCLUDES the
 * attachment's ~1000 tokens post-fix, and excludes them (brief-only) pre-fix.
 * Mutation-checked by reverting the Step-6 hunk.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';

import type { StageContext } from '../../types.js';

// Anthropic adapter so Step 5b passes and execution reaches Step 6.
vi.mock('../../../../adapters/llm/router.js', () => ({
  getAdapterWithResolution: () => ({
    adapter: { model: 'claude-sonnet-4-6', name: 'anthropic', draftGraph: vi.fn() },
    resolution: {
      task: 'draft_graph',
      resolved_model: 'claude-sonnet-4-6',
      resolution_source: 'default',
      provider: 'anthropic',
    },
  }),
}));

// Spy on the cost guard, capturing tokensIn, and force it to REFUSE so the stage
// early-returns at Step 6 (before the LLM call). `estimateTokens` stays REAL
// (importOriginal-spread) — the code under test uses it for both promptChars and
// the new attachment estimate.
const costCalls: Array<{ tokensIn: number; tokensOut: number; model: string }> = [];
vi.mock('../../../../utils/costGuard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../utils/costGuard.js')>();
  return {
    ...actual,
    allowedCostUSD: (tokensIn: number, tokensOut: number, model: string) => {
      costCalls.push({ tokensIn, tokensOut, model });
      return false; // refuse → Step 6 early-returns 429, never reaches the LLM
    },
  };
});

const { runStageParse } = await import('../parse.js');

// A 4000-char text document → meta.tokens_est = ceil(4000/4) = 1000.
const DOC_TEXT = 'a'.repeat(4000);
const DOC_B64 = Buffer.from(DOC_TEXT, 'utf8').toString('base64');
const EXPECTED_ATTACHMENT_TOKENS = Math.ceil(DOC_TEXT.length / 4); // 1000

function makeCtx(): StageContext {
  return {
    requestId: 'req-cost-guard',
    input: {
      brief: 'short brief', // ~11 chars → ~3 tokens; the doc dominates
      attachments: [{ id: 'att-1', kind: 'txt', name: 'big.txt' }],
    },
    rawBody: { attachment_payloads: { 'att-1': DOC_B64 } },
    effectiveBrief: 'short brief',
    opts: { requestStartMs: Date.now(), signal: undefined },
    earlyReturn: undefined,
    collector: undefined,
  } as unknown as StageContext;
}

beforeEach(() => {
  costCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('parse Step 6 — cost guard counts the native attachment (F-2)', () => {
  it('tokensIn passed to allowedCostUSD INCLUDES the attachment tokens [RED on pre-fix brief-only count]', async () => {
    const ctx = makeCtx();

    await runStageParse(ctx);

    // The guard refused → early-returned 429 at Step 6 (never reached the LLM).
    expect(ctx.earlyReturn?.statusCode).toBe(429);
    expect(costCalls).toHaveLength(1);

    // Post-fix: tokensIn counts the ~1000-token document. Pre-fix: brief only
    // (~3 tokens) → this assertion RED.
    expect(costCalls[0]!.tokensIn).toBeGreaterThanOrEqual(EXPECTED_ATTACHMENT_TOKENS);
  });
});
