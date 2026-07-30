/**
 * ROADMAP 2.146 — Pass-2 BUDGET pins (token cap + validation timeout).
 *
 * WHY THIS FILE EXISTS. At the deployed configuration Pass 2 could never
 * succeed: `DEFAULT_PASS2_MAX_TOKENS = 4096` against a MEASURED need of 4,560
 * completion tokens on a 16-edge graph, and a 30,000 ms timeout against a
 * MEASURED 27,961 ms completion. Both are latent defects in a shipped pipeline
 * — not tuning preferences — and both are invisible without a pin, because the
 * failure is a graceful `failed_degraded` that reads as a model problem.
 *
 * ── WHAT MAKES THESE PINS NON-VACUOUS ───────────────────────────────────────
 *
 * 1. They assert the REAL module constants. This file deliberately does NOT
 *    `vi.mock` `src/config/timeouts.js`. Its sibling
 *    (`validate-graph.test.ts`) does, with a hand-written
 *    `{ VALIDATION_PIPELINE_TIMEOUT_MS: 30_000 }` factory — and a `vi.mock`
 *    factory REPLACES the module, so every timeout assertion made under it
 *    would measure the mock and pass forever at any real value (CLAUDE.md
 *    trap 12: the hand-maintained mirror). The mock is correct for that file's
 *    purpose (parse behaviour) and fatal for this one's.
 *
 * 2. `getMaxTokensFromConfig` is mocked to return `undefined`, which is the
 *    DEPLOYED condition: `CEE_MAX_TOKENS_VALIDATION` is ABSENT from the
 *    Render env (complete 115-row manifest, contested-edge-probe.md). Mocking
 *    it to a number — as the sibling file does, returning 4096 — masks the
 *    default that actually ships and would make the cap pin vacuous.
 *
 * 3. The requirements are DERIVED FROM MEASUREMENTS, not restated from the
 *    source constants. A pin that says `expect(CAP).toBe(16384)` is a mirror
 *    of the line it guards and proves nothing. These say
 *    `CAP >= f(measured tokens/edge, documented edge range)`.
 *
 * 4. LOAD-INDEPENDENT, the #758 way: pure arithmetic over frozen constants.
 *    No sleeps, no wall clock, no timers. A CPU-starved runner cannot flip a
 *    single assertion here.
 *
 * ── THE MEASUREMENT THESE PINS ARE ANCHORED TO ──────────────────────────────
 * PINNED TO THE HISTORICAL ARTEFACT, NOT TO "CURRENT" (CLAUDE.md trap 12b: a
 * control pinned to whatever is deployed now decays into a tautology the first
 * time "now" moves). Re-measuring Pass 2 later adds a NEW row; it does not
 * edit these numbers.
 */

import { describe, it, expect, vi } from 'vitest';
import type { CallOpts } from '../../../src/adapters/llm/types.js';

// ── Module mocks — the minimum needed to keep the LLM and the prompt store out.
// NOTHING here replaces src/config/timeouts.js. See note 1 in the header.

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('SYSTEM'),
}));

const chatSpy = vi.hoisted(() => vi.fn());

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({ name: 'openai', model: 'o4-mini', chat: chatSpy }),
  // The DEPLOYED condition: CEE_MAX_TOKENS_VALIDATION is absent, so the
  // config lookup returns undefined and the code default is what ships.
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
}));

const { callValidateGraph } = await import(
  '../../../src/cee/validation-pipeline/validate-graph.js'
);
// REAL constants — no mock in front of them.
const { VALIDATION_PIPELINE_TIMEOUT_MS, MAX_TIMEOUT_MS } = await import(
  '../../../src/config/timeouts.js'
);
const { getTurnExecutorBudgets } = await import('../../../src/orchestrator-v5/budgets.js');

// ============================================================================
// The frozen measurement (PHASE0-EVIDENCE-2026-07-28/contested-edge-probe.md)
// ============================================================================

/**
 * Call 2 of the 30 Jul 2026 Phase-0 pre-check, run THROUGH the deployed
 * service (CEE build `2180702`) so the model, the served prompt bytes and the
 * provider key were all the production ones:
 *
 *   model             o4-mini            (routing `source: "default"`, #758 pin)
 *   system prompt     validate_graph_default v4, content_hash 45073b566184
 *   reasoning_effort  medium             (adapter default)
 *   graph             12 nodes / 16 causal edges
 *   result            finish_reason "stop", prompt 2,884 | completion 4,560
 *                     tokens, 27,961 ms, 4,531 chars of well-formed Pass-2 JSON
 *
 * ⚠ DECLARED DIVERGENCE, carried forward from the probe: that harness could
 * not send `response_format: json_object` (the admin route has no such
 * option); real Pass 2 does. `sends response_format json_object` below pins
 * the real setting so the divergence cannot silently become the shipped
 * behaviour.
 */
const PROBE = {
  /** Causal edges in the user message (post structural/bidirected filter). */
  EDGES: 16,
  /** Completion tokens = reasoning + visible output, the quantity the cap bounds. */
  COMPLETION_TOKENS: 4_560,
  /** Provider-side wall time for the completion. */
  LATENCY_MS: 27_961,
} as const;

/**
 * Live staged-frame timings for a real draft turn with the flag OFF, three
 * runs against deployed staging, measured per TCP chunk arrival — never
 * derived from totals (PHASE0-EVIDENCE-2026-07-28/cee2-live-latency.md).
 * The WORST run is used everywhere a baseline is needed.
 */
const LIVE_DRAFT = {
  /** Worst of 3 runs (cold): COMPLETE frame, i.e. the whole draft turn. */
  WORST_COMPLETE_MS: 63_957,
  /**
   * Time Pass 2 hides behind, credited CONSERVATIVELY.
   *
   * The real overlap window runs from the Pass-2 fire site (immediately after
   * Repair) to the await site (after the coaching pass), so it is at least
   * COACHING_READY − GRAPH_READY = 59,178 − 35,834 = 23,344 ms on the median
   * run, and more once Stage 4b and the GRAPH_READY emit are counted. We
   * credit only the 19,800 ms the ROADMAP 2.146 design assumed. Under-crediting
   * the overlap OVER-states the added latency, which is the safe direction for
   * a ceiling check.
   */
  CONSERVATIVE_OVERLAP_MS: 19_800,
} as const;

/**
 * The largest causal-edge count Pass 2 must be sized for.
 *
 * NOT the structural cap (`GRAPH_MAX_EDGES = 100`). At the per-edge cost
 * derived below, 100 edges would need ~28,500 tokens and ~175 s — the timeout
 * governs long before the cap could, so sizing the cap for 100 edges would buy
 * nothing real (see `timeout binds before the token cap`). 30 is the top of the
 * 10–30 causal edges a real draft carries (contested-edge-slice.md C3) and is
 * consistent with the live measurement of 33–35 TOTAL edges per draft
 * (cee2-live-latency.md) once structural edges are filtered out.
 */
const LARGEST_REAL_DRAFT_EDGES = 30;

// ── Derived, with the conservatism stated ───────────────────────────────────
//
// Model: cost(E) = FIXED + PER_EDGE·E, fitted to one point with FIXED := 0.
// That choice MAXIMISES the slope, so every extrapolation below is an UPPER
// bound on the true cost: for any FIXED > 0 the real cost at E > 16 is lower.
// One measurement cannot separate the two terms; assuming the worse split is
// the only honest way to use it.

/** 285.0 completion tokens per causal edge. */
const TOKENS_PER_EDGE = PROBE.COMPLETION_TOKENS / PROBE.EDGES;
/** 1,747.6 ms per causal edge. */
const MS_PER_EDGE = PROBE.LATENCY_MS / PROBE.EDGES;
/** 163.1 completion tokens per second. */
const TOKENS_PER_SECOND = PROBE.COMPLETION_TOKENS / (PROBE.LATENCY_MS / 1_000);

/** 8,550 tokens — what a 30-causal-edge draft needs. */
const REQUIRED_MAX_TOKENS = Math.ceil(TOKENS_PER_EDGE * LARGEST_REAL_DRAFT_EDGES);
/** 52,427 ms — how long a 30-causal-edge draft takes. */
const REQUIRED_TIMEOUT_MS = Math.ceil(MS_PER_EDGE * LARGEST_REAL_DRAFT_EDGES);

// ============================================================================
// Helpers
// ============================================================================

const CALL_OPTS: CallOpts = { requestId: 'pass2-budget-pin', timeoutMs: 1 };

/** A Pass-2 response shaped exactly like the probe's byte-exact output. */
function pass2Fixture(edgeCount: number) {
  return {
    edges: Array.from({ length: edgeCount }, (_, i) => ({
      from: `n_src_${i}`,
      to: `n_dst_${i}`,
      strength: { mean: 0.4, std: 0.15 },
      exists_probability: 0.9,
      reasoning:
        'Hiring additional sales and SE roles typically increases blended CAC due to higher sales expense.',
      basis: 'domain_prior',
      needs_user_input: true,
    })),
    model_notes: ['[brief_ambiguity] The brief does not state the target segment.'],
  };
}

function chatResult(parsed: unknown, stopReason: string | null = 'stop') {
  return {
    content: JSON.stringify(parsed),
    latencyMs: PROBE.LATENCY_MS,
    model: 'o4-mini',
    stopReason,
    usage: { input_tokens: 2_884, output_tokens: PROBE.COMPLETION_TOKENS },
  };
}

/** Runs a real Pass-2 call and returns the args the adapter was handed. */
async function captureChatArgs(edgeCount: number = PROBE.EDGES) {
  chatSpy.mockReset();
  chatSpy.mockResolvedValue(chatResult(pass2Fixture(edgeCount)));
  await callValidateGraph(
    'Should I hire a VP of Sales?',
    [{ id: 'n_src_0', kind: 'factor', label: 'Sales hires' }],
    Array.from({ length: edgeCount }, (_, i) => ({ from: `n_src_${i}`, to: `n_dst_${i}` })),
    { ...CALL_OPTS, timeoutMs: VALIDATION_PIPELINE_TIMEOUT_MS },
  );
  expect(chatSpy).toHaveBeenCalledTimes(1);
  return chatSpy.mock.calls[0][0] as { maxTokens: number; responseFormat?: string };
}

// ============================================================================
// Pin 1 — the token cap
// ============================================================================

describe('Pass 2 token cap — sized against the measured completion, not a guess', () => {
  it('sends a cap that covers the MEASURED 16-edge completion (4,560 tokens)', async () => {
    const args = await captureChatArgs();
    // BITES at 4096: the shipped cap was 464 tokens BELOW the measured need,
    // which is exactly what produced empty content on every draft.
    expect(args.maxTokens).toBeGreaterThanOrEqual(PROBE.COMPLETION_TOKENS);
  });

  it('sends a cap that covers the largest real draft (30 causal edges)', async () => {
    const args = await captureChatArgs();
    expect(REQUIRED_MAX_TOKENS).toBe(8_550); // guards the arithmetic itself
    expect(args.maxTokens).toBeGreaterThanOrEqual(REQUIRED_MAX_TOKENS);
  });

  it('applies the same cap regardless of how many edges are sent', async () => {
    // The cap is a constant, not a function of load — so a small graph and a
    // large one get the same budget. Pinned because a future "optimisation"
    // that scales the cap with edge count would reintroduce the failure mode
    // at the small end, where the reasoning overhead dominates (75% of the
    // measured completion was reasoning, and reasoning is not proportional to
    // output length).
    const small = await captureChatArgs(2);
    const large = await captureChatArgs(30);
    expect(small.maxTokens).toBe(large.maxTokens);
  });

  it('sends response_format json_object — the probe harness could not, real Pass 2 must', async () => {
    const args = await captureChatArgs();
    expect(args.responseFormat).toBe('json_object');
  });
});

// ============================================================================
// Pin 2 — the validation timeout, one-sided bounds
// ============================================================================

describe('Pass 2 validation timeout — bounded from below by the task, above by the turn', () => {
  it('FLOOR: covers the measured 16-edge completion (27,961 ms)', () => {
    // BITES at 30,000: 2,039 ms of margin on an N=1 measurement of a reasoning
    // model whose registry averageLatencyMs is 75,000 is not a margin.
    expect(VALIDATION_PIPELINE_TIMEOUT_MS).toBeGreaterThan(PROBE.LATENCY_MS);
  });

  it('FLOOR: covers the largest real draft (30 causal edges → 52,427 ms)', () => {
    expect(REQUIRED_TIMEOUT_MS).toBe(52_427); // guards the arithmetic itself
    expect(VALIDATION_PIPELINE_TIMEOUT_MS).toBeGreaterThanOrEqual(REQUIRED_TIMEOUT_MS);
  });

  it('CEILING: a full-timeout Pass 2 still lands inside the V5 turn budget', () => {
    // DERIVED from config, not restated. `turn_ms` is itself
    // min(TURN_BUDGET_MS, browserProxyTimeoutMs − TURN_RESPONSE_HEADROOM_MS),
    // so lowering the proxy deadline tightens this pin automatically instead of
    // leaving a stale literal behind (CLAUDE.md trap 12).
    const turnBudgetMs = getTurnExecutorBudgets().turn_ms;
    const addedByPass2 = Math.max(
      0,
      VALIDATION_PIPELINE_TIMEOUT_MS - LIVE_DRAFT.CONSERVATIVE_OVERLAP_MS,
    );
    const worstDraftWithFlagOn = LIVE_DRAFT.WORST_COMPLETE_MS + addedByPass2;

    expect(worstDraftWithFlagOn).toBeLessThan(turnBudgetMs);
  });

  it('CEILING: the clamp cannot silently swallow the configured value', () => {
    // clampTimeout() pins the value into [MIN_TIMEOUT_MS, MAX_TIMEOUT_MS].
    // If the default is ever raised past MAX_TIMEOUT_MS the clamp would apply
    // silently and the deployed timeout would not be the one in the source.
    expect(VALIDATION_PIPELINE_TIMEOUT_MS).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
  });
});

// ============================================================================
// Pin 3 — the binding order: the timeout must run out before the cap does
// ============================================================================

describe('binding order — the timeout, never the token cap, is what stops Pass 2', () => {
  it('the timeout binds first: a full-timeout run cannot produce more tokens than the cap', async () => {
    // THIS IS THE DESIGN INVARIANT, and it is why the cap is not sized for the
    // 100-edge structural maximum. The two failure modes are not equivalent:
    //
    //   cap-bound   → the provider returns EMPTY content. The adapter throws
    //                 `openai_empty_response` (openai.ts chat(), the `if
    //                 (!content)` branch), which unified-pipeline classifies as
    //                 `api_error`. Nothing in that trail names the token
    //                 budget. It reads as a provider fault, on every single
    //                 draft, forever.
    //   timeout-bound → AbortError → `UpstreamTimeoutError` → classified
    //                 `timeout`, with the elapsed ms attached.
    //
    // So the cap must sit above whatever the timeout can physically produce.
    const args = await captureChatArgs();
    const producibleWithinTimeout = Math.ceil(
      TOKENS_PER_SECOND * (VALIDATION_PIPELINE_TIMEOUT_MS / 1_000),
    );
    expect(args.maxTokens).toBeGreaterThan(producibleWithinTimeout);
  });
});

// ============================================================================
// Pin 4 — a cap-bound completion must fail LOUD, naming the cap
// ============================================================================

describe('truncation is reported as truncation, not as a parse failure', () => {
  it('throws an error naming the token cap when the provider stops at length', async () => {
    chatSpy.mockReset();
    // Truncated mid-object: valid Pass-2 prefix, no closing brace. Without the
    // guard this lands in extractJsonFromResponse and surfaces as a generic
    // `parse_error`, which points the reader at the model's JSON discipline
    // instead of at the budget that actually ran out.
    chatSpy.mockResolvedValue({
      content: '{"edges":[{"from":"a","to":"b","strength":{"mean":0.4,',
      latencyMs: 1,
      model: 'o4-mini',
      stopReason: 'length',
      usage: { input_tokens: 2_884, output_tokens: 99_999 },
    });

    await expect(
      callValidateGraph('brief', [], [], { ...CALL_OPTS, timeoutMs: 1_000 }),
    ).rejects.toThrow(/truncated/i);
  });

  it('names the actual cap in the message so the fix is obvious from the log line', async () => {
    // Derive the cap the module really sends, then assert the message carries
    // that same number — a hard-coded literal here would be a mirror of the
    // source constant and would go stale the next time the cap moves.
    const { maxTokens: cap } = await captureChatArgs(1);

    chatSpy.mockReset();
    chatSpy.mockResolvedValue({
      content: '{"edges":[',
      latencyMs: 1,
      model: 'o4-mini',
      stopReason: 'length',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await expect(
      callValidateGraph('brief', [], [], { ...CALL_OPTS, timeoutMs: 1_000 }),
    ).rejects.toThrow(String(cap));
  });

  it('does NOT fire on a normal stop', async () => {
    // Positive control for the guard's absence assertion: the same code path
    // with stopReason 'stop' must return normally. Without this, a guard that
    // threw unconditionally would still pass the two tests above.
    chatSpy.mockReset();
    chatSpy.mockResolvedValue(chatResult(pass2Fixture(1), 'stop'));
    const result = await callValidateGraph('brief', [], [], { ...CALL_OPTS, timeoutMs: 1_000 });
    expect(result.edges).toHaveLength(1);
  });

  it('does NOT fire when the provider omits a stop reason', async () => {
    chatSpy.mockReset();
    chatSpy.mockResolvedValue(chatResult(pass2Fixture(1), null));
    const result = await callValidateGraph('brief', [], [], { ...CALL_OPTS, timeoutMs: 1_000 });
    expect(result.edges).toHaveLength(1);
  });
});
