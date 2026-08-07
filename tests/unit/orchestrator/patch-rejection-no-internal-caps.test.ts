/**
 * ROADMAP 2.655 (I2) — NO INTERNAL OPERATION CAP REACHES A USER, SWEPT AT THE
 * PRODUCER.
 *
 * ── THE LEAK, VERBATIM (walk 2.634, 2026-08-07) ───────────────────────────
 *   "I tried to make that change, but it would require 6 node operations and 6
 *    edge operations - more than is safe in a single edit (limit: 4 node ops,
 *    8 edge ops)."
 *
 * Engineering vocabulary and two numbers the user has no way to act on — and
 * the sentence is misleading on its own terms: six edge operations were UNDER
 * the eight it quotes, so only the node budget tripped, which the copy never
 * says.
 *
 * ── WHY THE SWEEP LIVES AT THE PRODUCER AND NOT ONLY AT EGRESS ────────────
 * The runtime egress guard (`FORBIDDEN_USER_FACING_PHRASES`) replaces the WHOLE
 * response on a hit. That is the right last line of defence for a phrase that
 * should never exist, but it is a blunt one: a response erased at the wire is
 * still a turn the user lost. Catching the leak where the sentence is BUILT is
 * what stops it being emitted at all, and it is the only level at which the
 * copy can be checked across the whole input matrix rather than on the one
 * fixture a dispatch test happens to run.
 *
 * ── THE TWO GUARDS ARE NOT REDUNDANT (trap 12d) ───────────────────────────
 * The matrix below is DERIVED — it iterates the builder over every rejection
 * shape, so a new branch of the builder is swept automatically. Derivation can
 * only ever prove that the copies AGREE; it cannot prove the pattern is right.
 * So there is also a HAND-WRITTEN CORPUS of the sentences actually witnessed in
 * the wild, asserted to MATCH the pattern. Drop the corpus and a pattern that
 * matches nothing passes the sweep; drop the derivation and a new builder
 * branch leaks unobserved. Both, or neither is worth having.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildPatchRejectionEnvelope } from '../../../src/orchestrator/patch-rejection-helper.js';
import type { ConversationContext } from '../../../src/orchestrator/types.js';
import {
  MAX_NODE_OPS,
  MAX_EDGE_OPS,
  OPTION_ADD_MAX_EDGE_OPS,
} from '../../../src/orchestrator/tools/patch-budget-limits.js';

vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

const CONTEXT: ConversationContext = {
  messages: [],
  framing: null,
  graph: null,
  analysis_response: null,
  scenario_id: 'scenario-2655',
};

/**
 * ⭐ THE PATTERN. Two independent shapes, because the witnessed sentence
 * carries both and a partial de-leak reads clean against either alone:
 *   · a parenthesised internal cap   — "limit: 4 node ops"
 *   · a counted internal operation   — "6 node operations", "12 edge ops"
 */
const INTERNAL_CAP_LEAK = /limit:\s*\d|\d+\s+(?:node|edge)\s+op/i;

/**
 * ⭐⭐ THE CORPUS — real sentences, hand-written, asserted to MATCH.
 *
 * This is the completeness half of the guard: it is the only thing here that
 * can notice the pattern has been narrowed into uselessness.
 */
const WITNESSED_LEAKS: readonly string[] = [
  // Walk 2.634, 2026-08-07 — the sentence this row exists for.
  'I tried to make that change, but it would require 6 node operations and 6 edge operations - more than is safe in a single edit (limit: 4 node ops, 8 edge ops). Consider breaking this into smaller steps, or rebuilding the model from an updated brief.',
  // Probe C, 2026-08-05 (ROADMAP 2.474) — the same leak, different counts.
  'I tried to make that change, but it would require 3 node operations and 12 edge operations — more than is safe in a single edit (limit: 4 node ops, 8 edge ops).',
  // The narrower halves, so a pattern that only catches the full sentence fails.
  'limit: 4 node ops, 8 edge ops',
  'it would require 6 node operations',
];

/** Innocent copy that must NOT match, so the pattern cannot be over-broad. */
const MUST_NOT_MATCH: readonly string[] = [
  'That is a bigger change than I can put to you in one go, even in steps.',
  'Ask me for one part of it and I will propose that.',
  'That is more separate additions than I can take in one pass.',
  'Keep churn below 3% per month.',
  'The 3 options you added are now linked to the goal.',
];

describe('⭐⭐ 2.655 (I2) — the leak pattern itself is real', () => {
  it('every witnessed leak MATCHES the pattern (a guard that catches nothing is not a guard)', () => {
    for (const text of WITNESSED_LEAKS) {
      expect(INTERNAL_CAP_LEAK.test(text), `pattern missed a real leak: ${text}`).toBe(true);
    }
  });

  it('ordinary user-facing copy does NOT match', () => {
    for (const text of MUST_NOT_MATCH) {
      expect(INTERNAL_CAP_LEAK.test(text), `pattern over-matched: ${text}`).toBe(false);
    }
  });
});

/**
 * ⭐⭐ THE DERIVED SWEEP — every rejection shape the builder can produce.
 *
 * The matrix spans both `reason` values, present and absent counts, present
 * and absent caps, and each of the copy-replacing branches
 * (`structural_guidance`, `user_safe_reasons`). Counts deliberately include
 * values ABOVE and BELOW the real caps so a de-leak that only suppresses the
 * cap clause, or only the counts, is caught.
 */
interface RejectionShape {
  readonly name: string;
  readonly ctx: Parameters<typeof buildPatchRejectionEnvelope>[0];
}

const ACTIONS = [
  { role: 'facilitator' as const, label: 'Break into smaller steps', prompt: 'Smaller steps please.' },
];

const SHAPES: readonly RejectionShape[] = [
  {
    name: 'budget_exceeded — the walk`s shape (node cap tripped, edge cap not)',
    ctx: {
      reason: 'budget_exceeded',
      detail: 'Consider breaking this into smaller steps, or rebuilding the model from an updated brief.',
      node_ops: 6,
      edge_ops: 6,
      max_node_ops: MAX_NODE_OPS,
      max_edge_ops: MAX_EDGE_OPS,
      suggested_actions: ACTIONS,
    },
  },
  {
    name: 'budget_exceeded — probe C`s shape (edge cap tripped)',
    ctx: {
      reason: 'budget_exceeded',
      detail: 'Consider breaking this into smaller steps.',
      node_ops: 3,
      edge_ops: 12,
      max_node_ops: MAX_NODE_OPS,
      max_edge_ops: MAX_EDGE_OPS,
      suggested_actions: ACTIONS,
    },
  },
  {
    name: 'budget_exceeded — the option-addition bucket cap',
    ctx: {
      reason: 'budget_exceeded',
      detail: 'Consider breaking this into smaller steps.',
      node_ops: 1,
      edge_ops: 9,
      max_node_ops: MAX_NODE_OPS,
      max_edge_ops: OPTION_ADD_MAX_EDGE_OPS,
      suggested_actions: ACTIONS,
    },
  },
  {
    name: 'budget_exceeded — counts and caps absent (the fallback branch)',
    ctx: {
      reason: 'budget_exceeded',
      detail: 'Consider breaking this into smaller steps.',
      suggested_actions: ACTIONS,
    },
  },
  {
    name: 'budget_exceeded — both dimensions over',
    ctx: {
      reason: 'budget_exceeded',
      detail: 'Consider breaking this into smaller steps.',
      node_ops: 11,
      edge_ops: 20,
      max_node_ops: MAX_NODE_OPS,
      max_edge_ops: MAX_EDGE_OPS,
      suggested_actions: ACTIONS,
    },
  },
  {
    name: 'structural_violation — generic',
    ctx: {
      reason: 'structural_violation',
      detail: 'Consider simplifying the change.',
      violations: ['NO_PATH_TO_GOAL raw detail'],
      suggested_actions: ACTIONS,
    },
  },
  {
    name: 'structural_violation — caller-vetted reasons',
    ctx: {
      reason: 'structural_violation',
      detail: 'Consider simplifying the change.',
      user_safe_reasons: ['This change would leave a node that cannot reach the goal.'],
      suggested_actions: ACTIONS,
    },
  },
  {
    name: 'structural_violation — flag-gated structural guidance',
    ctx: {
      reason: 'structural_violation',
      detail: 'Consider simplifying the change.',
      structural_guidance: 'Tell me which option the new risk belongs to and I will add it there.',
      suggested_actions: ACTIONS,
    },
  },
];

describe('⭐⭐ 2.655 (I2) — no rejection the builder can produce names an internal cap', () => {
  for (const shape of SHAPES) {
    it(shape.name, () => {
      const envelope = buildPatchRejectionEnvelope(shape.ctx, 'turn-2655', CONTEXT);
      const text = envelope.assistant_text ?? '';
      expect(text.length).toBeGreaterThan(0);
      expect(text, `internal cap leaked in "${shape.name}": ${text}`).not.toMatch(
        INTERNAL_CAP_LEAK,
      );
    });
  }

  it('the suggested actions are swept too — a chip label is user-facing copy', () => {
    for (const shape of SHAPES) {
      const envelope = buildPatchRejectionEnvelope(shape.ctx, 'turn-2655', CONTEXT);
      for (const action of envelope.suggested_actions ?? []) {
        expect(action.label).not.toMatch(INTERNAL_CAP_LEAK);
        expect(action.prompt).not.toMatch(INTERNAL_CAP_LEAK);
      }
    }
  });
});

/**
 * ⭐ THE RUNTIME LAST LINE OF DEFENCE, PINNED.
 *
 * The producer sweep above stops the sentence being BUILT. The egress guard
 * stops it being SENT, whatever future path builds it. Without this block the
 * new `FORBIDDEN_USER_FACING_PHRASES` entry is unguarded: deleting it would
 * leave every test in this file green, which is the shape of a protection
 * nobody notices losing (CLAUDE.md trap 12).
 */
describe('⭐ 2.655 (I2) — the egress guard catches the operation vocabulary too', () => {
  it('every witnessed leak is caught by `findForbiddenPhraseHit`', async () => {
    const { findForbiddenPhraseHit } = await import(
      '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js'
    );
    for (const text of WITNESSED_LEAKS) {
      expect(findForbiddenPhraseHit(text), `egress guard missed: ${text}`).not.toBeNull();
    }
  });

  it('and ordinary copy still passes it untouched', async () => {
    const { findForbiddenPhraseHit } = await import(
      '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js'
    );
    for (const text of MUST_NOT_MATCH) {
      expect(findForbiddenPhraseHit(text), `egress guard over-matched: ${text}`).toBeNull();
    }
  });
});
