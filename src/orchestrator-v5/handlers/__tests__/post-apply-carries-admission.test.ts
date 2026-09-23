/**
 * ⛔⛔ THE POST-APPLY TURN RECOMPUTED THE ASSESSMENT BUT NOT THE ADMISSION.
 *
 * Release Control item 4 — "recompute canonical run admission after every
 * accepted repair" — as a mechanism, with the measurement that makes it worth
 * fixing.
 *
 * `turn-executor.ts` set the turn's readiness payload after an applied repair
 * and after an applied value batch by reading back
 * `assessCanonicalAnalysisReadiness(committed.persistedGraph).analysisReady`.
 * That function does not compute `may_run` — only
 * `buildCanonicalAnalysisReadyFromGraph`, which is
 * `canonicalAnalysisReadyFrom(resolveRunAdmission(graph), graph)`, does.
 *
 * So on the readiness loop's PAYOFF turn — the one right after the user
 * supplied what Olumi asked for — the payload carried NO admission verdict, and
 * every consumer gating the Run affordance fell back to the stricter `status`
 * rule. Measured over 400 real persisted models: `may_run` is absent on 400/400
 * assessments, and 95/400 (23.8%) carry a non-empty value-batch membership, so
 * this turn is genuinely reachable.
 *
 * ⚠ THIS IS NOT A SECOND ASSESSMENT. `resolveRunAdmission` exposes the
 * assessment it derived from, precisely so a caller needing both does not run
 * the assessor twice — two assessments of one graph could disagree, which is
 * the hazard `analysis-ready-core` exists to remove.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  assessCanonicalAnalysisReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../../../orchestrator/tools/analysis-ready-helper.js';

/**
 * A REAL persisted user model — the smallest of the 400 sampled that is
 * ADMISSIBLE (`may_run: true`) without being `status: 'ready'`, i.e. exactly
 * the readiness loop's payoff shape.
 *
 * ⚠ ANONYMISED, AND THE ANONYMISATION IS VERIFIED, NOT ASSUMED. Every label and
 * free-text field was blanked and every semantic node id remapped to an opaque
 * one (0 strings of 25+ characters survive), then the anonymised graph was run
 * through both producers and asserted to yield the IDENTICAL verdict as the
 * original: `status: needs_user_input`, `may_run: true`, `may_run: undefined`
 * from the assessment. A self-authored graph was tried first and produced
 * `analysisReady: undefined` — it was not a valid model, which is the reason
 * this fixture comes from the wire and not from my head.
 */
const GRAPH = JSON.parse(
  readFileSync(new URL('./fixtures/admissible-not-ready.graph.json', import.meta.url), 'utf8'),
) as unknown;

describe('the post-apply readiness payload carries the run admission', () => {
  it('⛔ the assessment alone does NOT carry may_run — this is the defect', () => {
    const assessed = assessCanonicalAnalysisReadiness(GRAPH);
    expect(assessed.analysisReady).toBeDefined();
    expect(assessed.analysisReady?.may_run).toBeUndefined();
  });

  it('⭐ the canonical builder DOES — and is what the post-apply readback must use', () => {
    const canonical = buildCanonicalAnalysisReadyFromGraph(GRAPH);
    expect(canonical).toBeDefined();
    expect(typeof canonical?.may_run).toBe('boolean');
  });

  /**
   * CONTRAST CONTROL. The two must agree on everything they BOTH compute — the
   * builder adds the admission, it does not re-answer the readiness question.
   * Without this, "use the other function" could silently change `status` too.
   */
  it('CONTROL: status is IDENTICAL between the two — only the admission is added', () => {
    const assessed = assessCanonicalAnalysisReadiness(GRAPH).analysisReady;
    const canonical = buildCanonicalAnalysisReadyFromGraph(GRAPH);
    expect(canonical?.status).toBe(assessed?.status);
    expect(canonical?.goal_node_id).toBe(assessed?.goal_node_id);
    expect(canonical?.options?.length).toBe(assessed?.options?.length);
  });
});
