/**
 * F3 round 2 — THE FOURTH CARRIER. `POST /assist/v1/decision-review` must apply
 * the same runner-up-gap policy as the V5 enricher seam.
 *
 * ## Why this file exists (round-1 adversarial review, the decisive finding)
 *
 * The enricher seam covers the V5 auto-fire path, and the reviewer verified it
 * at the bytes. It found a SIBLING CARRIER it does not cover:
 *
 *   PLoT `decision-review-orchestrator.ts`
 *     → `POST /assist/v1/decision-review`   ← THIS ROUTE, previously unseamed
 *     → PLoT merges the parsed review into its `/v2/run` response as
 *       `m1_review` (its own comment: "public wire via the m1_review merge")
 *     → CEE forwards it in the enrichment passthrough (`sanitise-enrichment.ts`
 *       knows the key)
 *     → the UI has live readers (`hydrateAnalysis.ts`, `usePreAnalysisData.ts`)
 *
 * `m1_review` carries `narrative_summary` (PLoT `m1-review-types.ts:205`). So a
 * gap sentence that never touches the enricher could still reach a mounted
 * surface. F3's acceptance is EVERY mounted surface, so the policy is installed
 * at this route's egress as a fourth consumer of `replaceAssertingUnits` —
 * exactly the same reader, exactly the same replacement, no second policy.
 *
 * ## The sentences are the REVIEWER'S, not mine
 *
 * Every leak sentence below is verbatim from the round-1 independent corpus
 * (`corpus.ts`, ids preserved). Using my own would repeat the mistake that let
 * these classes through in the first place (CLAUDE.md trap 22c).
 *
 * ## RED-first at `7d0385b8` — MEASURED
 *
 * At the pre-fix head this file fails **2 of 3**, both on the assertion that the
 * route's `review.narrative_summary` no longer carries the statistic:
 *   `AssertionError: expected '…by a margin of 33 percentage points…' not to
 *    contain '33 percentage points'`
 * The third case is a CONTROL (a gap-free review passes through byte-identical),
 * which is trivially true at pristine and is not RED-first evidence.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.stubEnv('LLM_PROVIDER', 'fixtures');
vi.stubEnv('CEE_DECISION_REVIEW_ENABLED', 'true');

import { build } from '../../src/server.js';
import * as routerMod from '../../src/adapters/llm/router.js';
import { RUNNER_UP_GAP_REPLACEMENT } from '../../src/orchestrator-v5/compose/runner-up-gap-statistic.js';

/**
 * PLoT's REAL decision-review egress body, recovered byte-for-byte from the
 * diagnostic capture `PHASE0-EVIDENCE-2026-07-28/witness-plot-2480a-raw/`
 * (`POST /assist/v1/decision-review`), built by PLoT commit `e18e17c2`.
 * Re-used rather than composed so this test drives the route with what the
 * PRODUCER actually sends (trap 16: a fixture you wrote yourself is not
 * evidence about the wire).
 */
import plotEgressBodyRaw from '../fixtures/plot/decision-review-egress-e18e17c2.json';

const plotEgressBody: Record<string, unknown> = plotEgressBodyRaw;

/**
 * ⚠ THE LIVE WITNESS — this carrier has ALREADY EMITTED THE DEFECT.
 *
 * Verbatim `m1_review.narrative_summary` from
 * `olumi-docs/PHASE0-EVIDENCE-2026-07-28/probe2676-2026-08-07/probe-response.json`,
 * captured against DEPLOYED PLoT staging build `49549d5` at
 * `2026-08-06T09:07:17Z`, `review_status: "complete"`, with the capture's own
 * `meta.feature_flags.DECISION_REVIEW_ENABLE: "1"`.
 *
 * So this is not a hypothetical carrier and the flag is not a hypothetical
 * posture: the gap statistic reached the `/v2/run` wire through this path four
 * days before this PR. APPEND-ONLY EVIDENCE — read here, never edited (CLAUDE.md
 * trap 14b).
 */
const LIVE_M1_REVIEW_NARRATIVE_49549D5 =
  'New sales channel leads by 22 percentage points, but the link from Marketing intensity ' +
  'to Maximise annual profit is fragile and could alter the outcome. There is notable ' +
  'uncertainty here, so alternative options or more grounding may be needed.';

/** Verbatim from the round-1 reviewer's corpus. Ids preserved. */
const REVIEW_R1 =
  'Switch to HubSpot comes out ahead of Salesforce by a margin of 33 percentage points.';
const REVIEW_R9 = 'Option A wins by 12 points.';
const REVIEW_R11 = 'It holds a 20-point lead over Salesforce.';
const REVIEW_R25 = 'HubSpot is 33 percentage points better than Salesforce.';

/** The ratified-correct statistic — must pass through untouched. */
const CORRECT = 'Hire One Tech Lead came out ahead in 59% of runs of this model.';

let app: FastifyInstance;

/**
 * Stub the decision_review adapter so the route returns EXACTLY the review we
 * want to test. The fixtures provider returns a fixed body, which cannot carry
 * the reviewer's sentences.
 */
function stubReview(output: Record<string, unknown>): void {
  const real = routerMod.getAdapter('decision_review');
  vi.spyOn(routerMod, 'getAdapter').mockImplementation(((task: string) => {
    if (task !== 'decision_review') return real;
    return {
      name: 'stub',
      model: 'stub-model',
      chat: async () => ({
        content: JSON.stringify(output),
        model: 'stub-model',
        latencyMs: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
  }) as unknown as typeof routerMod.getAdapter);
}

/** A review that satisfies the route's shape check, with `narrative` injected. */
function reviewWith(narrative: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    narrative_summary: narrative,
    readiness_rationale: 'The evidence base is thin on one factor.',
    story_headlines: {
      opt_tech_lead: 'Fastest route to senior capacity',
      opt_two_devs: 'More hands, slower ramp',
    },
    robustness_explanation: { summary: 'Stable across most runs.' },
    evidence_enhancements: {},
    scenario_contexts: {},
    flip_thresholds: [],
    bias_findings: [],
    key_assumptions: [],
    decision_quality_prompts: [],
    ...extra,
  };
}

async function postReview(output: Record<string, unknown>): Promise<Record<string, unknown>> {
  stubReview(output);
  const res = await app.inject({
    method: 'POST',
    url: '/assist/v1/decision-review',
    payload: plotEgressBody,
  });
  // A non-200 would make every `not.toContain` below pass vacuously (trap 13):
  // assert the status BY VALUE before reading the body.
  expect(res.statusCode, `route returned ${res.statusCode}: ${res.body.slice(0, 400)}`).toBe(200);
  const body = JSON.parse(res.body) as Record<string, unknown>;
  const review = body.review as Record<string, unknown> | undefined;
  expect(review, 'response must carry a `review` object').toBeDefined();
  return review as Record<string, unknown>;
}

describe('POST /assist/v1/decision-review applies the runner-up gap policy (F3, carrier 2)', () => {
  beforeAll(async () => {
    app = await build();
    await app.ready();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    vi.unstubAllEnvs();
  });

  it('strips the gap sentence from the m1_review narrative on the way out', async () => {
    // Precondition pinned in-test (trap 13b): the fixture genuinely carries it.
    expect(REVIEW_R1).toContain('33 percentage points');

    const review = await postReview(
      reviewWith(`${REVIEW_R1} The result leans on the Seat Price Level assumption.`),
    );

    const narrative = review.narrative_summary as string;
    expect(narrative).not.toContain('33 percentage points');
    expect(narrative).toContain(RUNNER_UP_GAP_REPLACEMENT);
    // Surgery, not demolition — and never emptied.
    expect(narrative).toContain('Seat Price Level');
    expect(narrative.trim().length).toBeGreaterThan(0);
  });

  it('covers every prose field of the review, not just narrative_summary', async () => {
    const review = await postReview(
      reviewWith(CORRECT, {
        robustness_explanation: { summary: REVIEW_R11 },
        // `key_assumptions` is the field the UI's m1_review readers render.
        key_assumptions: [REVIEW_R9, 'Ramp-up completes inside one quarter'],
        story_headlines: {
          opt_tech_lead: REVIEW_R25,
          opt_two_devs: 'More hands, slower ramp',
        },
      }),
    );

    expect((review.robustness_explanation as Record<string, unknown>).summary).not.toContain(
      '20-point',
    );
    const assumptions = review.key_assumptions as string[];
    expect(assumptions[0]).not.toContain('12 points');
    // The NON-offending sibling is untouched — bound by index and by content.
    expect(assumptions[1]).toBe('Ramp-up completes inside one quarter');
    expect((review.story_headlines as Record<string, unknown>).opt_tech_lead).not.toContain(
      'better than',
    );
    expect((review.story_headlines as Record<string, unknown>).opt_two_devs).toBe(
      'More hands, slower ramp',
    );
    // …and the correct statistic survives verbatim.
    expect(review.narrative_summary).toBe(CORRECT);
  });

  it('THE LIVE WITNESS: the sentence this carrier actually shipped on 2026-08-06 is removed', async () => {
    // Precondition pinned in-test: the capture genuinely carries the statistic.
    expect(LIVE_M1_REVIEW_NARRATIVE_49549D5).toContain('22 percentage points');

    const review = await postReview(reviewWith(LIVE_M1_REVIEW_NARRATIVE_49549D5));
    const narrative = review.narrative_summary as string;

    expect(narrative).not.toContain('22 percentage points');
    expect(narrative).not.toContain('leads by');
    expect(narrative).toContain(RUNNER_UP_GAP_REPLACEMENT);
    // The third sentence — the honest uncertainty caveat — survives verbatim.
    expect(narrative).toContain(
      'There is notable uncertainty here, so alternative options or more grounding may be needed.',
    );
    // ⚠ Sentence 2 goes WITH sentence 1: they share one unit only if the
    // splitter merges them, and here they do not — sentence 1 ends at the full
    // stop after "outcome." So assert what actually happens rather than what
    // would be convenient: the fragility clause rides in the SAME sentence as
    // the gap claim (one sentence, one comma), so it is removed with it. That
    // is the documented over-removal direction, never under.
    expect(narrative).not.toContain('Marketing intensity');
  });

  it('CONTROL: a review stating the leader’s own win probability passes through untouched', async () => {
    const clean = reviewWith(
      `${CORRECT} Raising conversion by 5 percentage points would not change that ordering.`,
    );
    const review = await postReview(clean);

    expect(review.narrative_summary).toBe(clean.narrative_summary);
    expect((review.robustness_explanation as Record<string, unknown>).summary).toBe(
      'Stable across most runs.',
    );
    expect((review.story_headlines as Record<string, unknown>).opt_tech_lead).toBe(
      'Fastest route to senior capacity',
    );
  });
});
