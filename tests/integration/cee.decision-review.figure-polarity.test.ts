/**
 * NARRATED FIGURES KEEP THEIR MEANING — carrier 2: `POST /assist/v1/decision-review`.
 *
 * PLoT calls this route and merges the parsed review into its `/v2/run`
 * response as `m1_review`, which the UI renders (see
 * `cee.decision-review.runner-up-gap.test.ts` for the carrier map). So the
 * polarity rule is installed at this route's egress too, beside the runner-up
 * gap policy, with the same reader the V5 enricher uses.
 *
 * The request body is PLoT's REAL egress body (`decision-review-egress-e18e17c2.json`),
 * with ONE edit for the defect case: `isl_results.robustness.recommendation_stability`
 * is deleted, which is what PLoT has sent since 7 Jul. `fragile_edges[0]
 * .switch_probability` is 0.61 in that body, so "holds in about 61%" is the
 * flip probability narrated as a stability — Paul's defect on a second carrier.
 *
 * ## RED-first at staging `c3e3f187` — MEASURED
 *
 * At the base the RED-FIRST case fails on `expected '…holds in about 61%…' not
 * to contain '61%'`: the shape check grounds 61% by the flip probability, so no
 * retry fires and the route ships it verbatim.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.stubEnv('LLM_PROVIDER', 'fixtures');
vi.stubEnv('CEE_DECISION_REVIEW_ENABLED', 'true');

import { build } from '../../src/server.js';
import * as routerMod from '../../src/adapters/llm/router.js';
import plotEgressBodyRaw from '../fixtures/plot/decision-review-egress-e18e17c2.json';

const plotEgressBody: Record<string, unknown> = plotEgressBodyRaw;

/** PLoT's body as it has been since 7 Jul: no stability figure. */
function bodyWithoutStability(): Record<string, unknown> {
  const body = JSON.parse(JSON.stringify(plotEgressBody)) as Record<string, unknown>;
  const isl = body.isl_results as Record<string, unknown>;
  const robustness = { ...(isl.robustness as Record<string, unknown>) };
  delete robustness.recommendation_stability;
  isl.robustness = robustness;
  return body;
}

let app: FastifyInstance;

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

function reviewWith(narrative: string): Record<string, unknown> {
  return {
    narrative_summary: narrative,
    readiness_rationale: 'The evidence base is thin on one factor.',
    story_headlines: {
      opt_tech_lead: 'Fastest route to senior capacity',
      opt_two_devs: 'More hands, slower ramp',
    },
    robustness_explanation: { summary: 'The result is sensitive to one relationship.' },
    evidence_enhancements: {},
    scenario_contexts: {},
    flip_thresholds: [],
    bias_findings: [],
    key_assumptions: [],
    decision_quality_prompts: [],
  };
}

async function postReview(
  body: Record<string, unknown>,
  output: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  stubReview(output);
  const res = await app.inject({ method: 'POST', url: '/assist/v1/decision-review', payload: body });
  // A non-200 would make every `not.toContain` below pass vacuously (trap 13).
  expect(res.statusCode, `route returned ${res.statusCode}: ${res.body.slice(0, 400)}`).toBe(200);
  const review = (JSON.parse(res.body) as Record<string, unknown>).review as Record<string, unknown> | undefined;
  expect(review, 'response must carry a `review` object').toBeDefined();
  return review as Record<string, unknown>;
}

const RISK = 'The main risk is the link from Marketing intensity to annual profit.';

describe('POST /assist/v1/decision-review — narrated figures keep their meaning (carrier 2)', () => {
  beforeAll(async () => {
    app = await build();
    await app.ready();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    vi.unstubAllEnvs();
  });

  it('RED-FIRST: stability ABSENT — a holds figure equal to the flip probability never leaves the route', async () => {
    const body = bodyWithoutStability();
    // Preconditions pinned in-test (trap 13b).
    const isl = body.isl_results as Record<string, unknown>;
    expect((isl.robustness as Record<string, unknown>).recommendation_stability).toBeUndefined();
    expect((isl.fragile_edges as Array<Record<string, unknown>>)[0].switch_probability).toBe(0.61);

    const review = await postReview(
      body,
      reviewWith(`The ordering holds in about 61% of variations. ${RISK}`),
    );
    const narrative = review.narrative_summary as string;
    expect(narrative).not.toContain('61%');
    expect(narrative).toContain(
      'This run does not report how often the ordering holds, so no figure is given for it.',
    );
    expect(narrative).toContain(RISK);
  });

  it('CONTRAST: PLoT body WITH stability 0.59025 — "holds in about 59%" passes byte-identical', async () => {
    const narrative = `The ordering holds in about 59% of variations. ${RISK}`;
    const review = await postReview(plotEgressBody, reviewWith(narrative));
    expect(review.narrative_summary).toBe(narrative);
  });

  it('CONTRAST: "could flip in about 61%" grounded in switch_probability 0.61 passes byte-identical', async () => {
    const narrative = `The ordering could flip in about 61% of variations of that link. ${RISK}`;
    const review = await postReview(bodyWithoutStability(), reviewWith(narrative));
    expect(review.narrative_summary).toBe(narrative);
  });
});
