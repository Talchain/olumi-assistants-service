/**
 * FINAL-SWEEP (pre-handover) — Codex F-3: the runaway detector must be
 * attachment-aware. Every detector threshold (stall/ceiling deadlines + char
 * gate) was fitted on a NO-DOC corpus; #670/#671 then made a native document the
 * PRIMARY draft path without touching them. A document inflates TTFB and the
 * volume of doc-grounded prose before the first edge, so a HEALTHY large-doc
 * draft false-aborts on the no-doc char gate (8000, only +13% over the no-doc
 * healthy max).
 *
 * Fix: `draftAttachmentDetectorAllowance(bytes)` derives a BOUNDED, size-scaled
 * allowance added to the stall/ceiling deadlines + the char gate. RED-first here:
 * a healthy draft that emits 9000 chars of nodes prose before its first edge
 * COMPLETES on attempt 1 with a large document (raised gate) but char-aborts +
 * retries on the pre-fix 8000 gate; a genuine runaway WITH a document still dies.
 */

import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

import {
  draftAttachmentDetectorAllowance,
  DRAFT_ATTACHMENT_DETECT_ALLOWANCE_MS_MAX,
  DRAFT_ATTACHMENT_DETECT_ALLOWANCE_CHARS_MAX,
  DRAFT_MAX_RUNAWAY_RETRIES,
} from '../draft-budget.js';
import { DRAFT_ATTACHMENT_MAX_BYTES } from '../draft-attachment.js';

// ── Unit: the derivation (pins the derive-don't-mirror shape) ───────────────
describe('draftAttachmentDetectorAllowance — bounded, size-scaled derivation', () => {
  it('is zero for no / non-positive attachment', () => {
    expect(draftAttachmentDetectorAllowance(undefined)).toEqual({ extraMs: 0, extraChars: 0 });
    expect(draftAttachmentDetectorAllowance(0)).toEqual({ extraMs: 0, extraChars: 0 });
    expect(draftAttachmentDetectorAllowance(-10)).toEqual({ extraMs: 0, extraChars: 0 });
  });

  it('scales linearly with size and caps at the max-size document', () => {
    const half = draftAttachmentDetectorAllowance(DRAFT_ATTACHMENT_MAX_BYTES / 2);
    expect(half.extraMs).toBe(Math.round(DRAFT_ATTACHMENT_DETECT_ALLOWANCE_MS_MAX / 2));
    expect(half.extraChars).toBe(Math.round(DRAFT_ATTACHMENT_DETECT_ALLOWANCE_CHARS_MAX / 2));

    const full = draftAttachmentDetectorAllowance(DRAFT_ATTACHMENT_MAX_BYTES);
    expect(full.extraMs).toBe(DRAFT_ATTACHMENT_DETECT_ALLOWANCE_MS_MAX);
    expect(full.extraChars).toBe(DRAFT_ATTACHMENT_DETECT_ALLOWANCE_CHARS_MAX);

    // Belt-and-suspenders clamp above the cap (parse layer already rejects it).
    const over = draftAttachmentDetectorAllowance(DRAFT_ATTACHMENT_MAX_BYTES * 4);
    expect(over.extraMs).toBe(DRAFT_ATTACHMENT_DETECT_ALLOWANCE_MS_MAX);
    expect(over.extraChars).toBe(DRAFT_ATTACHMENT_DETECT_ALLOWANCE_CHARS_MAX);
  });
});

// ── Integration: the char gate is widened for a document ────────────────────
// Shared hoisted state the SDK mock + the test read.
const h = vi.hoisted(() => ({
  callCount: 0,
  nodesPreEdgeChars: 9_000, // >8000 (pre-fix gate) but <12000 (post-fix large-doc gate)
  runaway: false,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: () => {
        h.callCount += 1;
        return makeStream();
      },
    };
  }
  return { default: MockAnthropic };
});

function makeStream() {
  return {
    async *[Symbol.asyncIterator]() {
      // Delta 1: nodes prose with NO edge marker (`"from":`), long enough to test
      // the char gate. 'n' carries no quotes so the edges regex never matches.
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'n'.repeat(h.nodesPreEdgeChars) } };
      if (!h.runaway) {
        // Delta 2: the edges array — reaching this marks a HEALTHY generation.
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"edges":[{"from":"a","to":"b"}]}' } };
      }
    },
    async finalMessage() {
      // A genuine runaway produces no valid graph — the final (detection-off)
      // attempt must therefore FAIL to parse and the draft dies. A healthy draft
      // returns a parseable graph and completes.
      const text = h.runaway
        ? 'n'.repeat(h.nodesPreEdgeChars) // unsalvageable garbage (no nodes/edges)
        : '{"nodes":[{"id":"a","kind":"factor","label":"A"}],"edges":[{"from":"a","to":"b"}]}';
      return {
        content: [{ type: 'text', text }],
        usage: { input_tokens: 1_000, output_tokens: 500 },
        stop_reason: h.runaway ? 'max_tokens' : 'end_turn',
      };
    },
  };
}

// A near-max-size text attachment → the largest allowance (char gate ~12000).
function bigAttachment() {
  return {
    envelopeBlocks: [{ type: 'text', text: 'attached document' }],
    meta: {
      kind: 'txt',
      name: 'big.txt',
      bytes: DRAFT_ATTACHMENT_MAX_BYTES,
      tokens_est: Math.ceil(DRAFT_ATTACHMENT_MAX_BYTES / 4),
      media_type: 'text/plain',
    },
  } as unknown as import('../draft-attachment.js').BuiltDraftAttachment;
}

let draftGraphWithAnthropic: typeof import('../anthropic.js').draftGraphWithAnthropic;
let priorKey: string | undefined;

beforeAll(async () => {
  priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-f3';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import('../anthropic.js'));
});

afterAll(async () => {
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = priorKey;
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => {
  h.callCount = 0;
  h.runaway = false;
  h.nodesPreEdgeChars = 9_000;
  vi.restoreAllMocks();
});

describe('draft_graph runaway detector — attachment-aware char gate (F-3)', () => {
  it('a HEALTHY large-document draft emitting 9000 chars of nodes before its first edge is NOT char-aborted (completes on attempt 1) [RED on the pre-fix 8000 gate]', async () => {
    h.nodesPreEdgeChars = 9_000; // > 8000 (pre-fix) but < 12000 (post-fix large-doc gate)
    h.runaway = false;

    await draftGraphWithAnthropic(
      { brief: 'Should we launch A or B?', docs: [], seed: 1, attachment: bigAttachment() },
      { timeoutMs: 120_000, forceDefault: true },
    ).catch(() => undefined); // parse outcome irrelevant; the observable is attempt count

    // Edges reached on attempt 1 → NO runaway retry → exactly one stream attempt.
    // Pre-fix (gate 8000): the 9000-char nodes delta char-aborts before the edge →
    // runaway → retry → MORE than one attempt → RED.
    expect(h.callCount).toBe(1);
  });

  it('REFUTE — a genuine runaway WITH a document still trips the raised gate and dies (13000 chars, no edge)', async () => {
    // ⚠ UPDATED 2026-07-25 (skip-gate alignment). The abort is now authorised
    // only when the post-abort window can RE-FUND the cap being abandoned
    // (`isAbortableRetryViable`) — because aborting into a window that cannot is
    // how 60s of a 110s budget got burned for nothing (A2killer 0/18). At the
    // FULL attempt-1 cap no abort can ever be re-funded, so the ladder is
    // correctly silent there; the test therefore lowers attempt 1's cap via
    // `maxTokensCeiling` to put the detector in the regime where it IS armed.
    // The claim under test is unchanged: the raised char gate is BOUNDED.
    h.nodesPreEdgeChars = 13_000; // > 12000 raised gate → still a runaway
    h.runaway = true; // never emits an edge

    // aff(120s) = 9,450; aff(120s - 30s ceiling) = 6,750. A 6,000-token attempt-1
    // cap is therefore re-fundable after an abort → the ladder is armed.
    let threw = false;
    await draftGraphWithAnthropic(
      { brief: 'Should we launch A or B?', docs: [], seed: 1, attachment: bigAttachment() },
      { timeoutMs: 120_000, forceDefault: true, maxTokensCeiling: 6_000 },
    ).catch(() => {
      threw = true;
    });

    // The raised gate is BOUNDED: a 13000-char no-edge stream still trips it, the
    // attempt aborts, and (all retries hitting the same runaway) the draft fails.
    expect(threw).toBe(true);
    expect(h.callCount).toBeGreaterThan(1); // aborted + retried (the gate fired)
  });

  it('⭐ DEFAULT REGIME: the runaway IS aborted and retried — and the ladder still terminates', async () => {
    // ⚠ FLIPPED 2026-07-25 (FAST-ABORT). This test previously pinned
    // `h.callCount === 1` — "no abort can be re-funded, so the ladder does not
    // run". That WAS the live behaviour (`runaway_abort_count: 0` on all 30
    // observations), and it was the defect: the abort was gated on the retry
    // being able to re-fund the ABANDONED CAP, which is arithmetically
    // impossible at default configuration. A runaway never reaches the edges
    // array, so its cap says nothing about what a retry needs; the gate now asks
    // whether the post-abort window can fund a CONVERGED draft (<=2,271 tokens
    // measured). See config/timeouts.ts and
    // `parallel-briefs/TOKEN-CEILING-EXPERIMENT-2026-07-25.md`.
    h.nodesPreEdgeChars = 13_000;
    h.runaway = true;

    let threw = false;
    await draftGraphWithAnthropic(
      { brief: 'Should we launch A or B?', docs: [], seed: 1, attachment: bigAttachment() },
      { timeoutMs: 120_000, forceDefault: true },
    ).catch(() => {
      threw = true;
    });

    // A persistent runaway still FAILS — the abort buys retries, not a fake
    // success. Zero-corrupt is guaranteed by validation, not by the abort.
    expect(threw).toBe(true);
    // …but it is now retried rather than swallowing the whole window on one
    // doomed generation. This harness resolves streams synchronously, so no wall
    // clock is consumed and the TIME reserve never binds; the loop therefore
    // terminates on `DRAFT_MAX_RUNAWAY_RETRIES` (5 aborts + 1 final attempt).
    // That defensive backstop existing is exactly why a zero-elapsed provider
    // cannot spin here.
    expect(h.callCount).toBe(DRAFT_MAX_RUNAWAY_RETRIES + 1);
    expect(h.callCount).toBeGreaterThan(1);
  });
});
