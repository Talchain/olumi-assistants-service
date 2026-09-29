/**
 * THE MOUNT-PATH GUARD.
 *
 * Everything else in this directory tests `applyDraftQualityPass` directly. A
 * green suite over a function nothing calls is exactly the defect this estate
 * has shipped before (trap 3b: tests bound to a component the live path does
 * not reach). These assertions bind the pass to the SEAM it must sit on.
 *
 * They are read off the source at the tip they run against, so they cannot go
 * stale the way a hand-maintained note does — if the wiring is removed or moved
 * to a different arm, this file REDs and names which property broke.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wrapperPath = resolve(here, '../../unified-pipeline/index.ts');
const wrapper = readFileSync(wrapperPath, 'utf8');

describe('draft-quality is mounted on the live draft path', () => {
  it('the unified-pipeline wrapper imports the pass', () => {
    expect(wrapper).toContain('applyDraftQualityPass');
    expect(wrapper).toContain('../draft-quality/pipeline-hook.js');
  });

  it('⭐ it sits on the arm the FAILURE classifier did not claim, not beside it', () => {
    // The two authorities answer different questions and must stay sequenced:
    // `decideDraftAutoRetry` first (fails closed), the quality pass only on the
    // arm it declined. If the call ever moved above the failure decision, a
    // retryable 422 would be handed to a pass that expects a shippable model.
    const failureDecision = wrapper.indexOf('decideDraftAutoRetry(first, elapsedMs)');
    const qualityCall = wrapper.indexOf('applyDraftQualityPass({');
    expect(failureDecision).toBeGreaterThan(-1);
    expect(qualityCall).toBeGreaterThan(-1);
    expect(qualityCall).toBeGreaterThan(failureDecision);
  });

  it('the redraw reuses the ONE attempt runner, with the request-start baseline pinned', () => {
    const call = wrapper.slice(
      wrapper.indexOf('applyDraftQualityPass({'),
      wrapper.indexOf('applyDraftQualityPass({') + 1600,
    );
    // Same composition-safety rule as the failure retry: attempt 2's budgets
    // measure from where the REQUEST started, so the whole composition stays
    // inside DRAFT_REQUEST_BUDGET_MS by construction.
    expect(call).toContain('runUnifiedPipelineAttempt(input, rawBody, request, {');
    expect(call).toContain('requestStartMs: retryBaselineMs');
    expect(call).toContain('priorAttemptDirective');
  });

  it('the wrapper still returns the plain first result on the failure arms it owns', () => {
    // Regression guard: the quality pass replaced ONE `return first;`. The
    // unaffordable-copy arm above it must be untouched.
    expect(wrapper).toContain('return applyRetryUnaffordableCopy(first, unaffordableClass);');
  });
});
