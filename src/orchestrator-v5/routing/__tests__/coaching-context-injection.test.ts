/**
 * Coaching Context Pack v1 — prompt injection + flag-off byte-identity.
 *
 * The pack reaches the LLM only as the ContextPack `coaching_context` field
 * (plus a narrow receive-vs-author instruction). When the field is absent (flag
 * off), the serialised user message is byte-identical to today: no pack, no
 * instruction. Exercised through the public `routeWithToolUse` with a mock
 * adapter that captures the user message, exactly like route-with-tool-use.test.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import {
  assembleContextPack,
  type ContextPack,
} from '../../context/context-pack-assembler.js';
import {
  canonicalStateFromFreshness,
  summariseCoachingStatePack,
  type CoachingStatePack,
} from '../../context/canonical-analysis-state.js';
import {
  routeWithToolUse,
  COACHING_CONTEXT_INSTRUCTION,
  DISPLAY_GRAPH_INSTRUCTION,
  GRAPH_CONTEXT_INSTRUCTION,
  RECENT_CHANGES_INSTRUCTION,
  RUN_DELTA_INSTRUCTION,
} from '../route-with-tool-use.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

function mkResult(content: ToolResponseBlock[]): ChatWithToolsResult {
  return {
    content,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 1,
  };
}

function mockAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
      .mockResolvedValueOnce(mkResult([{ type: 'text', text: 'ok' }])),
  };
}

function stalePack(): CoachingStatePack {
  return summariseCoachingStatePack(
    canonicalStateFromFreshness(
      {
        freshness: 'stale',
        reason: 'graph_hash_diverged',
        selected_fact_index: 0,
        graph_hash_at_run: 'a1b2c3d4e5f60718',
        current_graph_hash: 'ffeeddccbbaa9988',
        computed_at: '2026-06-23T10:00:00.000Z',
      },
      { readiness: { status: 'ready', blockers: [] } },
    ),
  );
}

function packWith(coachingContext: CoachingStatePack | undefined): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({ turn_id: 't-1', scenario_id: 'scen-1', message: 'hi' }),
    priorTurns: [],
    priorFacts: [],
    ...(coachingContext ? { coachingContext } : {}),
  });
}

async function userMessageFor(coachingContext: CoachingStatePack | undefined): Promise<string> {
  const adapter = mockAdapter();
  await routeWithToolUse(packWith(coachingContext), 'hi', { requestId: 'req-1', adapter });
  const args = adapter.chatWithTools.mock.calls[0]![0];
  return args.messages[0]!.content as string;
}

const COACHING_HEADER = '## Coaching state (deterministic — authoritative)';

describe('Coaching Context Pack v1 — prompt injection (flag-on)', () => {
  it('injects the pack JSON and the receive-vs-author instruction', async () => {
    const msg = await userMessageFor(stalePack());
    expect(msg).toContain('"coaching_context"');
    expect(msg).toContain('"freshness": "stale"');
    expect(msg).toContain(COACHING_HEADER);
    expect(msg).toContain('do not present the results as current');
    // Base sections still present + ordered before the user turn.
    expect(msg).toContain('## ContextPack');
    expect(msg.indexOf(COACHING_HEADER)).toBeLessThan(msg.indexOf('## User turn'));
  });

  it('the injected pack carries no hash digest (prompt-safe)', async () => {
    const msg = await userMessageFor(stalePack());
    expect(msg).not.toContain('a1b2c3d4e5f60718');
    expect(msg).not.toContain('ffeeddccbbaa9988');
  });

  it('none-state coaching guidance is honest — no false "out of date" pre-analysis (review r2)', () => {
    // Pre-analysis (`freshness` "none") NOTHING has run, so instructing the model
    // to say the results "may be out of date" / to "re-run" is a false claim and
    // makes the T1/T2 dead-end partially recur live (the model self-nudges).
    const lines = COACHING_CONTEXT_INSTRUCTION.split('\n');
    const noneLine = lines.find((l) => /`freshness`\s+is\s+"none"/i.test(l));
    expect(noneLine, 'a none-state bullet exists').toBeDefined();
    expect(noneLine).toMatch(/no analysis has been run/i);
    expect(noneLine).not.toMatch(/out of date/i);
    expect(noneLine).not.toMatch(/re-?run/i);
    // The OTHER unsafe states (an analysis exists but is stale/unusable) still
    // legitimately suggest re-running.
    const otherLine = lines.find((l) => /^- Otherwise,/i.test(l));
    expect(otherLine, 'the non-none unsafe bullet is retained').toBeDefined();
    expect(otherLine).toMatch(/out of date/i);
    expect(otherLine).toMatch(/re-?run/i);
  });
});

describe('Coaching Context Pack v1 — flag-off byte-identity', () => {
  it('omits the pack and the instruction entirely when no field is supplied', async () => {
    const msg = await userMessageFor(undefined);
    expect(msg).not.toContain('coaching_context');
    expect(msg).not.toContain(COACHING_HEADER);
    expect(msg).toContain('## ContextPack');
    expect(msg).toContain('## User turn');
  });

  it('coaching omission adds no bytes beyond mandatory graph and edit-history authority', async () => {
    const msg = await userMessageFor(undefined);
    const pack = packWith(undefined);
    // Reconstruct the exact pre-lane serialisation: ## ContextPack / <json> /
    // '' / ## User turn / message — with raw analysis|graph|analysis_state +
    // the display_* originals stripped and display variants substituted under
    // analysis|graph (mirrors buildUserMessage's destructure exactly).
    const {
      analysis,
      display_analysis,
      graph,
      display_graph,
      graph_context,
      analysis_state,
      ...rest
    } = pack;
    void analysis;
    void graph;
    void analysis_state;
    const resolvedGraphContext = graph_context ?? { status: 'unavailable' as const };
    const llmFacing = {
      ...rest,
      analysis: display_analysis,
      graph_context: resolvedGraphContext,
      graph: display_graph,
    };
    expect(resolvedGraphContext).toEqual({ status: 'unavailable' });
    const expected = [
      '## ContextPack',
      JSON.stringify(llmFacing, null, 2),
      '',
      GRAPH_CONTEXT_INSTRUCTION,
      '',
      DISPLAY_GRAPH_INSTRUCTION,
      '',
      RECENT_CHANGES_INSTRUCTION,
      '',
      // ⭐ THE THIRD MANDATORY BLOCK, added deliberately with the `run_delta`
      // pack slice. This assertion is the alarm that a new ALWAYS-RENDERED
      // instruction cannot slip into every prompt unnoticed, and it fired
      // exactly as designed — the list is updated here, in the same change
      // that made the block mandatory, rather than the assertion being
      // loosened.
      //
      // WHY THIS ONE IS UNCONDITIONAL, like its two neighbours above: its
      // load-bearing clause governs the turn where `run_delta` is ABSENT, and
      // absence is the producer's DEFAULT path. Gating it on the field's
      // presence would render the absence rule only on the turns that do not
      // need it — a conditionally-emitted absence clause is dead text. Same
      // reasoning that already makes graph-authority and edit-history
      // mandatory: where absence could silently license a false claim, the
      // licence text is always present so absence can never read as permission.
      RUN_DELTA_INSTRUCTION,
      '',
      '## User turn',
      'hi',
    ].join('\n');
    expect(msg).toBe(expected);
  });

  it('still strips raw analysis / graph / analysis_state from the prompt', async () => {
    const msg = await userMessageFor(stalePack());
    // analysis_state (hash-bearing) must never reach the prompt even flag-on.
    expect(msg).not.toContain('"analysis_state"');
    expect(msg).not.toContain('graph_hash_at_run');
  });
});

/**
 * CONDITIONAL COACHING CAPABILITY — the wire-level proof for the change made to
 * `COACHING_CONTEXT_INSTRUCTION` on 2026-09-08.
 *
 * ⚠ READ THIS BEFORE TREATING ANY TEST BELOW AS A QUALITY RESULT. Every
 * assertion here is about the bytes the model is GIVEN. A captured adapter can
 * prove the assembled instruction and the assembled context, and it can prove
 * the safety floors that are stated as text. It CANNOT prove that a generated
 * answer is useful, and no test in this file may be cited as evidence that the
 * witnessed staging failure (2026-09-08 16:47Z, routing prompt v121, stale
 * analysis, £200,000 hiring question answered with model-maintenance advice)
 * is repaired. Generated quality belongs to the separate local baseline vs.
 * candidate comparison recorded with this change.
 *
 * What these DO establish: the positive obligation actually reaches the wire on
 * the same message as the coaching state; the prohibitions are scoped to
 * computed results rather than to advice in general; and the currentness,
 * invention, no-mutation and identifier floors survived the rewrite.
 */
describe('Coaching Context Pack v1 — conditional coaching capability (assembled wire)', () => {
  const lines = COACHING_CONTEXT_INSTRUCTION.split('\n');
  const noneLine = lines.find((l) => /`freshness`\s+is\s+"none"/i.test(l))!;
  const unsafeLine = lines.find((l) => /^- Otherwise,/i.test(l))!;
  const refusalLine = lines.find((l) => /`latest_run_attempt_refused`/i.test(l))!;

  it('the positive obligation reaches the model on the same message as the stale coaching state', async () => {
    const msg = await userMessageFor(stalePack());
    // The state the answer must be honest about, and the obligation to coach
    // anyway, are on ONE message — not two independently-shipped things.
    expect(msg).toContain('"freshness": "stale"');
    expect(msg).toContain('It never suspends coaching');
    expect(msg).toContain(
      'still help the person think about the problem they actually raised',
    );
    // Conditional reasoning from the supplied material, an implication or
    // trade-off, the decisive unknown, and a next question — the four things
    // the witnessed answer omitted.
    expect(msg).toMatch(/Reason conditionally from the supplied material/);
    expect(msg).toMatch(/practical implication or trade-off/);
    expect(msg).toMatch(/unknown that would most change the answer/);
    expect(msg).toMatch(/ask one question/);
    // Model maintenance is permitted alongside, never instead of.
    expect(msg).toMatch(/may accompany that; it must never replace it/);
  });

  it('grounded facts and hypotheses must be distinguishable, and that reaches the wire', async () => {
    const msg = await userMessageFor(stalePack());
    expect(msg).toMatch(/Keep grounded facts and hypotheses distinguishable/);
    expect(msg).toMatch(
      /never asserted as a fact about the model, the analysis or the world/,
    );
  });

  /**
   * THE DISCRIMINATOR. Without this the two tests above would pass just as well
   * against the OLD block with the new sentences bolted on — the defect was the
   * blanket prohibition, so its ABSENCE is the load-bearing assertion, and it is
   * made against the assembled message, not the constant.
   */
  it('the blanket advice prohibition is gone from the assembled message', async () => {
    const msg = await userMessageFor(stalePack());
    expect(msg).not.toContain('before giving confident advice');
    expect(msg).not.toContain('do not recommend one option over another');
  });

  it('UNSAFE-CURRENT-RESULT CONTROL — the narrowed ban still forbids every current-result claim', () => {
    // Currentness honesty, unchanged.
    expect(unsafeLine).toContain('do not present the results as current');
    expect(unsafeLine).toMatch(/out of date/i);
    expect(unsafeLine).toMatch(/re-?run/i);
    // A leader/winner may still not be named off stale figures...
    expect(unsafeLine).toMatch(/leading, winning or recommended option/i);
    expect(unsafeLine).toMatch(/as though the figures settled it/i);
    // ...but the qualitative work is explicitly still required.
    expect(unsafeLine).toMatch(/still give the qualitative reasoning/i);

    // Pre-analysis: qualitative reasoning licensed, computed results banned.
    expect(noneLine).toMatch(/no analysis has been run/i);
    expect(noneLine).toMatch(/reason qualitatively/i);
    expect(noneLine).toMatch(/no computed result, ranking, probability or score/i);
    // ...and the r2 honesty property is not lost by the rewrite.
    expect(noneLine).not.toMatch(/out of date/i);
    expect(noneLine).not.toMatch(/re-?run/i);

    // The invention floor, now explicit that figures have a single source.
    const inventionLine = lines.find((l) => /^- Never invent freshness/.test(l))!;
    expect(inventionLine).toMatch(
      /Computed results, rankings and figures may come only from the supplied analysis/,
    );
  });

  it('REFUSAL BULLET — untouched by this change (byte identity)', () => {
    expect(refusalLine).toBe(
      '- If `latest_run_attempt_refused` is true: the latest attempt was refused before computation. ' +
        'Do not say running is safe, that the current model can produce a result, or that a run would ' +
        'show probabilities unless a newer successful run is present. Answer the user’s question ' +
        'directly, preserve the refusal caveat, and give one useful next fact or remedy.',
    );
  });

  it('NO-EDIT / CONSENT CONTROL — the mutation and identifier floors survive, and assembly proposes nothing', async () => {
    const msg = await userMessageFor(stalePack());
    expect(msg).toMatch(/Never claim a change was applied, saved, confirmed or re-run/);
    expect(msg).toMatch(/propose it and ask/);
    expect(msg).toContain('Never quote hashes, identifiers, or internal field names.');

    // And the turn itself mutates nothing: a text-only completion routes to
    // `text_only` with no proposal. ⚠ This is a control on THIS path only —
    // it is not proof that the downstream executor cannot mutate.
    const adapter = mockAdapter();
    const result = await routeWithToolUse(packWith(stalePack()), 'hi', {
      requestId: 'req-consent',
      adapter,
    });
    expect(result.type).toBe('text_only');
    expect(result).not.toHaveProperty('proposal');
  });

  it('every coaching_context field the pack carries is still named by the instruction', async () => {
    // The prompt-pack sanction gate reads the same property estate-wide; keeping
    // it local too means a field dropped from the wording fails HERE, in the
    // file that owns the wording, rather than only in the estate gate.
    for (const field of [
      'freshness',
      'latest_run_attempt_refused',
      'rerun_required',
      'usable_for_chips',
      'blocked',
    ]) {
      expect(COACHING_CONTEXT_INSTRUCTION).toContain(`\`${field}\``);
    }
  });
});
