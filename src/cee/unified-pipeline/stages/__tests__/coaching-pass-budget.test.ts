/**
 * Stage 4.5 (post-draft coaching pass) — BUDGET-AWARE gate (Lane C2, 2026-07-23)
 *
 * The coaching pass is STRICTLY best-effort: it runs only in whatever request
 * budget genuinely remains after a successful draft, and SKIPS (→ canonical-empty
 * coaching + a probe-readable `coaching_status='skipped_budget'` marker) when the
 * remaining budget cannot fit the pass to completion. It must NEVER cause a 504
 * for a turn whose draft succeeded.
 *
 * These are the positive controls for that gate:
 *  - AMPLE budget  → the pass RUNS (chat called), coaching is attached, and the
 *    status is NOT the skip marker. (Proves the test can SEE a PRESENCE — CLAUDE
 *    trap #13: an absence assertion is vacuous without a presence control.)
 *  - TIGHT budget  → the pass SKIPS: chat is NOT called, coaching stays
 *    canonical-empty (undefined), and `coaching_status==='skipped_budget'`.
 *
 * MUTATION: reverting the skip (e.g. dropping COACHING_PASS_MIN_BUDGET_MS back
 * below the measured pass-completion time, or removing the marker assignment)
 * turns the TIGHT test RED — chat gets called / the marker is absent.
 *
 * The budget constants (DRAFT_REQUEST_BUDGET_MS 120s, LLM_POST_PROCESSING_HEADROOM
 * 10s) are imported REAL so the genuine floor arithmetic is exercised.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Silence + observe the pino logger; keep everything else real so the actual
// budget arithmetic and the real floor constant are under test.
vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

import { runStageCoachingPass } from '../coaching-pass.js';
import {
  DRAFT_REQUEST_BUDGET_MS,
  LLM_POST_PROCESSING_HEADROOM_MS,
} from '../../../../config/timeouts.js';
import type { StageContext } from '../../types.js';

// remaining = DRAFT_REQUEST_BUDGET_MS - (now - requestStartMs) - HEADROOM.
// Solve requestStartMs for a TARGET `remaining`.
function requestStartForRemaining(remainingMs: number): number {
  const elapsed = DRAFT_REQUEST_BUDGET_MS - LLM_POST_PROCESSING_HEADROOM_MS - remainingMs;
  return Date.now() - elapsed;
}

function makeCtx(opts: {
  requestStartMs: number;
  chat: ReturnType<typeof vi.fn>;
}): StageContext {
  return {
    coaching: undefined,
    causalClaims: undefined,
    draftAdapter: { chat: opts.chat } as unknown as StageContext['draftAdapter'],
    graph: { nodes: [{ id: 'n1', kind: 'factor', label: 'a' }], edges: [] } as unknown as StageContext['graph'],
    effectiveBrief: 'Should I hire a contractor or a full-time employee?',
    requestId: 'req-c2',
    start: opts.requestStartMs,
    opts: { requestStartMs: opts.requestStartMs, signal: undefined } as StageContext['opts'],
    pipelineOutcome: { coaching_status: 'partial', warnings: [] } as unknown as StageContext['pipelineOutcome'],
  } as unknown as StageContext;
}

describe('coaching pass — budget-aware skip (Lane C2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('AMPLE budget: the pass RUNS, attaches coaching, and does NOT mark skipped_budget (presence control)', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        coaching: { summary: 'Consider a status-quo option.', strengthen_items: [] },
        causal_claims: [],
      }),
      usage: { input_tokens: 50, output_tokens: 120 },
      model: 'test-model',
      latencyMs: 10,
    });
    // ~105s remaining — far above the 28s floor.
    const ctx = makeCtx({ requestStartMs: requestStartForRemaining(105_000), chat });

    await runStageCoachingPass(ctx);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(ctx.coaching).toBeDefined();
    expect(ctx.pipelineOutcome.coaching_status).not.toBe('skipped_budget');
  });

  it('TIGHT budget: the pass SKIPS — chat NOT called, coaching canonical-empty, coaching_status=skipped_budget', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: '{}',
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'test-model',
      latencyMs: 0,
    });
    // ~24s remaining — BELOW the 28s floor (heavy-retry turn whose draft ate the
    // budget), and deliberately ABOVE the OLD 20s floor so a floor-revert mutation
    // is unambiguously caught (chat would be called under the old floor). Draft
    // already succeeded (ctx.graph populated); coaching must yield to the budget.
    const ctx = makeCtx({ requestStartMs: requestStartForRemaining(24_000), chat });

    await runStageCoachingPass(ctx);

    // NEVER launch the LLM call when it cannot complete inside the budget.
    expect(chat).not.toHaveBeenCalled();
    // Canonical-empty coaching (Stage 5 emits the empty block) — draft unaffected.
    expect(ctx.coaching).toBeUndefined();
    // Probe- + async-ingest-readable marker (rides to _pipeline_outcome).
    expect(ctx.pipelineOutcome.coaching_status).toBe('skipped_budget');
  });
});
