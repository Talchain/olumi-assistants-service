/**
 * LINK-TRACK R1 item 1 (contradiction cluster, C1) — THE "LIGHT ON DETAIL"
 * GUARD IS BLIND ON THE PATH THE PRODUCT ACTUALLY WALKS.
 *
 * ── WHAT WAS RE-DERIVED, AND WHY THIS FILE EXISTS ──────────────────────────
 * ROADMAP 2.972(c) (#873, merged 2026-08-08) added a guard: the draft
 * narrative must not tell a user their brief was light on detail when their
 * brief states amounts. `src/cee/provenance/__tests__/brief-completeness-claim.test.ts`
 * pins it, and pins it for B2 BY NAME.
 *
 * The guard was LIVE on 2026-08-11 and the sentence still shipped. Measured by
 * the L3 browser lane driving deployed staging with B2
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/arch-decision-2026-08-11/L3-BROWSER-TRUTH.md`
 * §5 C1): the draft summary opened "Your brief was light on detail, so adding
 * specifics will make the comparison more reliable." while the retention
 * receipt on the same session reported "I found 30 stated figures."
 *
 * ROOT CAUSE, derived at the bytes at `75516366` and NOT named by the evidence:
 * the guard is fed `briefText: payload.message` (draft-graph-dispatch.ts:243).
 * On the ordinary draft turn that IS the brief. But B2 goes through the
 * clarify-v2 intake gate, which PROCEEDs by dispatching the draft with
 * `briefOverride: decision.brief` (clarify-v2-dispatch.ts:382/461, threaded at
 * route-v2.ts:3649). On THAT turn `payload.message` is the user's one-line
 * intake answer ("Use sensible defaults" / "Success = ... Go ahead."), which
 * states no amounts — so `findStatedAmounts` returns empty and the advisory is
 * KEPT. The existing suite cannot see this: it calls the narrative builder
 * directly with the brief in hand, so it never exercises the seam where the
 * brief is somewhere else.
 *
 * The dispatcher already computes the right value one screen further down —
 * `const effectiveBrief = params.briefOverride ?? payload.message` (:436), the
 * SAME value it drafts from. The composer simply was not given it.
 *
 * This is CLAUDE.md trap 22's shape ("verify WHAT STRING THE GUARD ACTUALLY
 * RECEIVES, not that it is present and correct") and trap 16's ("a capture
 * proves what it was pointed at" — the 2.972 suite was pointed at the builder,
 * not the seam).
 *
 * ── HOW THIS PINS IT ───────────────────────────────────────────────────────
 * The brief text is passed as the 5th argument. At pristine the parameter does
 * not exist and the extra argument is ignored.
 *
 * ⚠ MEASURED AT PRISTINE, AND IT IS ITSELF A FINDING: only the "Use sensible
 * defaults" case REDs. The `Success = ... Q3 2027 ... one compulsory round
 * max.` variant PASSES at pristine — by accident, because that particular
 * intake answer happens to carry a date and a number, so `findStatedAmounts`
 * fires on the ANSWER and suppresses the advisory for a reason that has
 * nothing to do with the user's brief. **Whether the product insults a user's
 * brief currently depends on whether their one-line intake answer happens to
 * contain a digit.** Both cases are kept: one as the RED discriminator, one to
 * stop the accidental pass silently becoming the mechanism.
 *
 * The third case is the discriminating positive: a genuinely quantity-free
 * brief on the same path must KEEP the advisory, so the fix cannot pass by
 * suppressing the sentence unconditionally.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi } from 'vitest';

// emit() is telemetry-only; silence it so the composer runs side-effect-free.
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { draftResultToOlumiResponse } from '../draft-graph-dispatch.js';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';
import { BRIEF_TEXT_AS_PERSISTED } from '../../../cee/provenance/__tests__/fixtures/trace-captures.js';

/** The exact sentence measured on deployed staging. Pinned verbatim. */
const THIN_SENTENCE = 'Your brief was light on detail';

/**
 * The intake answer B2's user actually sent on the turn that drafted the
 * graph. Not authored here — it is the tail the trace shows CEE concatenating
 * onto the persisted brief (`trace-captures.ts` header), i.e. the bytes that
 * arrived as `payload.message` while the real brief travelled as
 * `briefOverride`.
 */
const B2_INTAKE_ANSWER =
  'Success = EBITDA breakeven by Q3 2027 while keeping the redundancy promise — one compulsory round max. Go ahead.';

const GRAPH = {
  nodes: [
    { id: 'dec_opex', kind: 'decision', label: 'How to take £4m out of opex' },
    { id: 'goal_opex', kind: 'goal', label: 'Achieve £4m annualised opex reduction by Q2 2027' },
    { id: 'opt_offshore', kind: 'option', label: 'Offshore support (TaskUs)' },
    { id: 'opt_automate', kind: 'option', label: 'Automation-led reduction' },
    { id: 'fac_automation', kind: 'factor', label: 'Automation deployment level' },
  ],
  edges: [{ from: 'opt_automate', to: 'goal_opex' }],
};

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    stage: 'frame' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function makeResult(): DraftGraphResult {
  return {
    blocks: [],
    assistantText: 'Drafted a decision graph.',
    latencyMs: 1000,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    // The LLM-authored enum that selects the advisory. `thin` is what staging
    // returned for B2 — the whole point of the row is that nothing derives it.
    coachingWideningLogObject: { brief_completeness: 'thin' },
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput: GRAPH,
  } as unknown as DraftGraphResult;
}

describe('LINK-R1 C1 — the brief-completeness advisory on the clarify-v2 (briefOverride) path', () => {
  // THE MEASURED CASE. L3 §2/§5 records the intake gate offering the chips
  // `Use sensible defaults · Goal: grow revenue · Goal: cut costs`, and §5 C2
  // records the drafter proceeding "given no new information beyond 'use
  // sensible defaults'". This is the turn on which the false sentence shipped.
  it('withholds "light on detail" when the real brief travels as briefOverride and payload.message is the intake chip', () => {
    const res = draftResultToOlumiResponse(
      makeResult(),
      makePayload('Use sensible defaults'),
      true,
      'req-override-1',
      // The brief the pipeline actually drafted from — `effectiveBrief`.
      BRIEF_TEXT_AS_PERSISTED.B2,
    );

    expect(
      res.assistant_text,
      'B2 was still told its brief was light on detail on the path the product walks',
    ).not.toContain(THIN_SENTENCE);
  });

  // Passes at pristine BY ACCIDENT (see the header): this answer carries
  // "Q3 2027" / "one", so the pre-fix guard fired on the ANSWER. Kept so that
  // accident cannot quietly become the mechanism.
  it('withholds it for a longer intake answer too — for the brief, not because the answer happens to carry a digit', () => {
    const res = draftResultToOlumiResponse(
      makeResult(),
      makePayload(B2_INTAKE_ANSWER),
      true,
      'req-override-2',
      BRIEF_TEXT_AS_PERSISTED.B2,
    );

    expect(res.assistant_text).not.toContain(THIN_SENTENCE);
  });

  it('KEEPS it when the effective brief genuinely states nothing quantitative — the discriminating positive', () => {
    // Without this the fix could pass by suppressing the advisory
    // unconditionally, which is a different behaviour and deletes a
    // legitimate nudge (CLAUDE.md trap 13b: a guard must not agree with
    // itself).
    const res = draftResultToOlumiResponse(
      makeResult(),
      makePayload('Use sensible defaults'),
      true,
      'req-override-3',
      'Should we go into Germany or push harder in the UK? Not sure.',
    );

    expect(res.assistant_text).toContain(THIN_SENTENCE);
  });

  it('still reads payload.message on the ordinary draft turn, where no override exists', () => {
    // The ordinary path passes `effectiveBrief === payload.message`. Behaviour
    // there is unchanged — pinned so a later edit cannot quietly stop
    // consulting the brief on the path 2.972 already covers.
    const res = draftResultToOlumiResponse(
      makeResult(),
      makePayload(BRIEF_TEXT_AS_PERSISTED.B2),
      true,
      'req-ordinary',
      BRIEF_TEXT_AS_PERSISTED.B2,
    );

    expect(res.assistant_text).not.toContain(THIN_SENTENCE);
  });
});

/**
 * THE HALF THE UNIT TESTS ABOVE CANNOT REACH.
 *
 * Every case above calls `draftResultToOlumiResponse` directly and hands it
 * the brief itself, so it pins the COMPOSER. It says nothing about whether the
 * DISPATCHER passes the right string — and that wiring is exactly where the
 * defect lived. TypeScript forces a 5th argument now, but `payload.message`
 * would satisfy the type and reinstate the bug in silence.
 *
 * Reaching the real call sites needs a Fastify request, the unified draft
 * pipeline and a live commit seam. So this asserts the wiring at the SOURCE,
 * DERIVED (the file is read at your tip; nothing is mirrored here) and
 * FAIL-LOUD: it counts the call sites rather than checking a known number, so
 * a THIRD call site added later cannot pass by being unlisted.
 */
describe('LINK-R1 C1 — the dispatcher passes the drafted-from brief, not the wire message', () => {
  const DISPATCHER = fileURLToPath(new URL('../draft-graph-dispatch.ts', import.meta.url));

  it('every draftResultToOlumiResponse call site passes effectiveBrief as its 5th argument', () => {
    const source = readFileSync(DISPATCHER, 'utf8');

    // Call sites only — exclude the declaration, which is `export function`.
    const calls = source
      .split('\n')
      .filter((l) => l.includes('draftResultToOlumiResponse(') && !l.includes('export function'));

    // A positive control on the probe itself: if the name is ever renamed and
    // this sweep silently finds nothing, an empty list would otherwise pass.
    expect(calls.length, 'found no draftResultToOlumiResponse call sites — the probe is blind').toBe(2);

    for (const call of calls) {
      expect(
        call,
        `a draftResultToOlumiResponse call site does not pass effectiveBrief: ${call.trim()}`,
      ).toContain('effectiveBrief');
      expect(
        call,
        `a draftResultToOlumiResponse call site passes the wire message as the brief: ${call.trim()}`,
      ).not.toContain('payload.message)');
    }
  });
});
