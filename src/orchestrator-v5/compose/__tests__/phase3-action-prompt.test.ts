/**
 * ROADMAP 2.225 (CEE half) — the action-pill producer trio emits
 * `action_prompt`, which is what actually lights the UI #554 seam.
 *
 * THE SEAM. DGAI #554 (merged `a27cadf7`) is live: a coaching card dispatches
 * a chip IFF the producer authored `action_prompt`, and the UI's chain is
 * `action_prompt ?? suggested_prompt ?? title`. The `?? action_label` fallback
 * was DELIBERATELY REFUSED, and `CoachingBlockSchema`'s own doc comment
 * (schemas 0.31.0, `blocks.js:509-515`) requires VERBATIM dispatch with no
 * templating and a silent fail-closed on absence. So until a producer authors
 * one, three cards render a pill that either does nothing or — worse — sends
 * the card's TITLE as the user's turn ("An assumption to check").
 *
 * WHY THESE THREE. They are the producers that already emit
 * `action_intent`/`action_label` and therefore already render a pill:
 * `assumption_check`, `calibration_prompt`, and the stale-rerun `orientation`
 * block. The lens/`strengthen` producer is deliberately EXCLUDED — it emits no
 * action fields at all under the "no inert chips, ever" rule pinned in
 * `lens-suggestion-block.test.ts`, and arming it is a separate product
 * decision, not a wiring job.
 *
 * WHAT THE COPY MUST BE. Imperative, sendable verbatim as a user turn. NEVER
 * an enum token (the exact #554 defect: the UI used to submit the literal
 * string "gather_evidence"), and never a caption — `action_label` is the
 * caption, and a prompt equal to it would be a button that types its own name.
 */
import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';

import {
  buildCoachingBlocks,
  buildStaleRerunCoachingBlock,
  type BlockBuildCtx,
} from '../phase3-blocks.js';

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';

const CTX: BlockBuildCtx = {
  created_at: '2026-05-16T15:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

/** Contract max for `action_prompt` at schemas 0.31.0 (`PHASE3_ACTION_PROMPT_MAX`). */
const ACTION_PROMPT_MAX = 300;

/** Enum-shaped: snake_case token, no spaces — what must NEVER be dispatched. */
const ENUM_TOKEN_SHAPE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function makeFact(decisionReview: Record<string, unknown>): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      enrichment: { decision_review: decisionReview },
      computed_at: '2026-05-16T14:59:00.000Z',
      graph_hash_at_run: GRAPH_HASH,
    },
  } as unknown as RunAnalysisHandlerFact;
}

function assertDispatchablePrompt(prompt: string | undefined, actionLabel?: string): void {
  expect(prompt).toBeDefined();
  const value = prompt as string;
  expect(value.length).toBeGreaterThan(0);
  expect(value.length).toBeLessThanOrEqual(ACTION_PROMPT_MAX);
  // Sendable prose, not a token.
  expect(value).not.toMatch(ENUM_TOKEN_SHAPE);
  expect(value).toContain(' ');
  // Not the caption.
  if (actionLabel !== undefined) expect(value).not.toBe(actionLabel);
}

describe('ROADMAP 2.225 — producers author action_prompt (lights the #554 pill)', () => {
  it('assumption_check carries a dispatchable action_prompt', () => {
    const blocks = buildCoachingBlocks(
      makeFact({
        key_assumptions: ['Edge strengths assume current market conditions persist.'],
      }),
      new Map(),
      CTX,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].coaching_kind).toBe('assumption_check');
    assertDispatchablePrompt(blocks[0].action_prompt, blocks[0].action_label);
    // The #554 defect in its original form: the pill must not send the title.
    expect(blocks[0].action_prompt).not.toBe(blocks[0].title);
  });

  it('calibration_prompt carries a dispatchable action_prompt', () => {
    const blocks = buildCoachingBlocks(
      makeFact({
        decision_quality_prompts: [
          {
            question: 'What would change your mind about delivery risk?',
            principle: 'Disconfirmation',
            applies_because: 'Win probability is high.',
          },
        ],
      }),
      new Map(),
      CTX,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].coaching_kind).toBe('calibration_prompt');
    assertDispatchablePrompt(blocks[0].action_prompt, blocks[0].action_label);
    expect(blocks[0].action_prompt).not.toBe(blocks[0].title);
  });

  it('stale-rerun orientation carries a dispatchable action_prompt', () => {
    const block = buildStaleRerunCoachingBlock(CTX);
    expect(block).not.toBeNull();
    assertDispatchablePrompt(block!.action_prompt, block!.action_label);
    expect(block!.action_prompt).not.toBe(block!.title);
  });

  it('every emitted action_prompt re-parses under CoachingBlockSchema', () => {
    // The contract gate. `CoachingBlockSchema` is `.strict()` with
    // `action_prompt: z.string().min(1).max(300).optional()`, so an
    // over-length or wrongly-typed prompt would DROP the whole block
    // silently — the card would vanish rather than lose its pill.
    const blocks = [
      ...buildCoachingBlocks(
        makeFact({
          key_assumptions: ['Edge strengths assume current market conditions persist.'],
          decision_quality_prompts: [
            {
              question: 'What would change your mind about delivery risk?',
              principle: 'Disconfirmation',
              applies_because: 'Win probability is high.',
            },
          ],
        }),
        new Map(),
        CTX,
      ),
      buildStaleRerunCoachingBlock(CTX)!,
    ];

    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      const parsed = CoachingBlockSchema.safeParse(block);
      expect(parsed.success, `block ${block.coaching_kind} failed schema parse`).toBe(true);
      expect((parsed as { data: { action_prompt?: string } }).data.action_prompt).toBeDefined();
    }
  });

  it('the three prompts are DISTINCT — no shared generic filler', () => {
    // A single copy-pasted prompt across all three would satisfy every
    // assertion above while making the pills interchangeable and useless.
    const blocks = [
      ...buildCoachingBlocks(
        makeFact({
          key_assumptions: ['Edge strengths assume current market conditions persist.'],
          decision_quality_prompts: [
            {
              question: 'What would change your mind about delivery risk?',
              principle: 'Disconfirmation',
              applies_because: 'Win probability is high.',
            },
          ],
        }),
        new Map(),
        CTX,
      ),
      buildStaleRerunCoachingBlock(CTX)!,
    ];

    const prompts = blocks.map((b) => b.action_prompt);
    expect(new Set(prompts).size).toBe(3);
  });
});
