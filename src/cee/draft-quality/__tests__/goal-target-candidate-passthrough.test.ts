/**
 * ROUND 6 (CEE #1328) — the goal-label CANDIDATE survives the wrapper's
 * quality pass on EVERY success arm.
 *
 * `runUnifiedPipeline` is a wrapper: the attempt returns `{ statusCode, body,
 * goal_target_candidate? }`, and both success arms return through
 * `applyDraftQualityPass`, which may ship the FIRST draw, a REDRAWN second, or
 * the first after a failed redraw. If any arm rebuilds the result as a bare
 * `{ statusCode, body }`, the candidate is emitted and lost — the same silent
 * drop as `runStageEnrich` discarding `warnings`, one hop later. Pinned here
 * behaviourally, with a negative twin, so the chain enricher → stage → attempt
 * → wrapper → draft-graph tool has no unobserved link.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTestSink } from '../../../utils/telemetry.js';
import { applyDraftQualityPass } from '../pipeline-hook.js';
import type { UnifiedPipelineResult } from '../../unified-pipeline/types.js';

beforeEach(() => { setTestSink(() => {}); });
afterEach(() => setTestSink(null));

const BRIEF = 'Four things matter here: dilution, speed, strategic value and board control.';
const THIN = Object.freeze({
  nodes: [
    { id: 'opt_a', kind: 'option' }, { id: 'opt_b', kind: 'option' },
    { id: 'fac_1', kind: 'factor' }, { id: 'out_1', kind: 'outcome' }, { id: 'goal_1', kind: 'goal' },
  ],
  edges: [
    { from: 'opt_a', to: 'fac_1' }, { from: 'opt_b', to: 'fac_1' },
    { from: 'fac_1', to: 'out_1' }, { from: 'out_1', to: 'goal_1' },
  ],
});
const RICH = Object.freeze({
  nodes: [
    { id: 'opt_a', kind: 'option' }, { id: 'opt_b', kind: 'option' },
    { id: 'fac_cost', kind: 'factor' }, { id: 'fac_speed', kind: 'factor' },
    { id: 'out_1', kind: 'outcome' }, { id: 'goal_1', kind: 'goal' },
  ],
  edges: [
    { from: 'opt_a', to: 'fac_cost' }, { from: 'opt_b', to: 'fac_speed' },
    { from: 'fac_cost', to: 'out_1' }, { from: 'fac_speed', to: 'out_1' }, { from: 'out_1', to: 'goal_1' },
  ],
});
const C1 = { goal_node_id: 'goal_1', value_user_units: 20000, unit: '£', label_span: '£20k', brief_span: '£20k', binding: 'governed' as const, reason: 'governed' as const };
const C2 = { ...C1, value_user_units: 30000, label_span: '£30k', brief_span: '£30k' };
const ok = (graph: unknown, candidate?: typeof C1): UnifiedPipelineResult =>
  ({ statusCode: 200, body: { graph }, ...(candidate ? { goal_target_candidate: candidate } : {}) });
const graphAwareJudge = async ({ graph }: { graph: unknown }) =>
  JSON.stringify(graph).includes('fac_speed')
    ? ({ kind: 'adequate' } as const)
    : ({ kind: 'impoverished', grounds: ['collapsed_dimensions'] } as const);

const pass = (first: UnifiedPipelineResult, redraw?: () => Promise<UnifiedPipelineResult>) =>
  applyDraftQualityPass({
    first, brief: BRIEF, requestId: 'r6-passthrough', elapsedMs: 1_000, retryBaselineMs: Date.now(),
    attemptSource: 'first', ...(redraw ? { redraw } : {}), judge: graphAwareJudge as never,
  } as never);

describe('round 6 — goal_target_candidate survives applyDraftQualityPass on every success arm', () => {
  it('no-redraw arm (adequate first draw): the first result — and its candidate — is returned unchanged', async () => {
    const result = await pass(ok(RICH, C1));
    expect(result.statusCode).toBe(200);
    expect(result.goal_target_candidate).toEqual(C1);
  });

  it('⭐ NEGATIVE TWIN: a first result WITHOUT a candidate returns without one', async () => {
    const result = await pass(ok(RICH));
    expect(result.goal_target_candidate).toBeUndefined();
  });

  it('redraw arm, second shipped: the SECOND attempt\'s candidate is what arrives', async () => {
    const result = await pass(ok(THIN, C1), async () => ok(RICH, C2));
    expect(result.statusCode).toBe(200);
    expect(JSON.stringify(result.body)).toContain('fac_speed'); // the second draw shipped
    expect(result.goal_target_candidate).toEqual(C2);
  });

  it('redraw arm, second failed: the FIRST result — and its candidate — still arrives', async () => {
    const result = await pass(ok(THIN, C1), async () => ({ statusCode: 500, body: { error: 'draft failed' } }));
    expect(result.statusCode).toBe(200);
    expect(result.goal_target_candidate).toEqual(C1);
  });
});

describe('round 6 — the attempt hands the candidate to the wrapper (source pin: the attempt cannot be driven offline)', () => {
  // The same technique metric-honesty.test.ts uses on the wrapper: the success
  // return of `runUnifiedPipelineAttempt` is inline and needs a live draft to
  // reach, so its shape is pinned at the source. A refactor that rebuilds that
  // return as a bare `{ statusCode, body }` REDs here.
  const indexPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../unified-pipeline/index.ts');
  const src = readFileSync(indexPath, 'utf8');
  const attempt = src.slice(src.indexOf('async function runUnifiedPipelineAttempt('));
  it('the 200 return that carries ctx.finalResponse also carries ctx.goal_target_candidate', () => {
    expect(attempt.length).toBeGreaterThan(500);
    const successReturn = attempt.match(/return \{\s*statusCode: 200,\s*body: ctx\.finalResponse,[^}]*\}/);
    expect(successReturn, 'the success return of the attempt was not found').not.toBeNull();
    expect(successReturn![0]).toContain('goal_target_candidate: ctx.goal_target_candidate');
  });
});
