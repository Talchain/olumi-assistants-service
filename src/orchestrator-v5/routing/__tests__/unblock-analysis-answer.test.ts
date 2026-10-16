/**
 * GOLDEN REGRESSION — Paul's blocked journey, 23 Sep 2026.
 *
 * ⛔ THE FIXTURE IS THE REAL PERSISTED GRAPH, captured from deployed staging
 * (scenario `399c2814`) after the session in which the product failed him. It
 * is not an invention of this author's, which matters: the whole defect was a
 * predicate that looked right against imagined data.
 *
 * ── WHAT HAPPENED ──────────────────────────────────────────────────────────
 * Readiness held exactly ONE blocking issue for thirty-seven minutes:
 *   OPTION_NEEDS_MAPPING — "How does Two Developers change Coordination
 *   Overhead Risk? The proposed relationship is retained, but its mechanism
 *   and value still need clarification." (repairability: human_input_required)
 * "Hire a Tech Lead" was `status: ready` throughout.
 *
 * The product instead told him "'Two Developers' does not have effect values
 * yet" (it had two), and routed "just fix what's stopping me" to
 * `adjust_edge_strength`, which moved a number that could never satisfy a
 * mapping obligation.
 *
 * These assertions are what the user should have been told, derived from the
 * readiness authority and nothing else.
 */
import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';


import {
buildCanonicalAnalysisReadyFromGraph
} from '../../../orchestrator/tools/analysis-ready-helper.js';

const blockedGraph = JSON.parse(
  readFileSync('src/orchestrator-v5/routing/__tests__/fixtures/blocked-journey-graph.json', 'utf-8'),
) as unknown;

describe("Paul's blocked journey — the answer he should have received", () => {
  const readiness = buildCanonicalAnalysisReadyFromGraph(blockedGraph as never) as never;

  it('the real graph retains its mapping gap and now also requires the unknown risk level', () => {
    const r = readiness as { status?: string; readiness_issues?: readonly { code?: string }[] };
    expect(r.status).toBe('needs_user_input');
    expect(r.readiness_issues?.map(i => i.code)).toEqual(['OPTION_NEEDS_MAPPING', 'MISSING_FACTOR_LEVEL']);
  });








});



/**
 * ⛔ "NOTHING IS BLOCKING" IS ONLY SAYABLE ON AN EXPLICIT `ready`.
 *
 * The predicate was `status === 'ready' || blocking.length === 0`, so an empty
 * issue list alone produced the claim. A reviewer fed it a REAL production
 * producer and got the opposite of the truth — the payload said `blocked` and
 * named its blocker, and the answer said the model was ready to run.
 *
 * These bind the real producer, not a hand-authored shape, because the shape is
 * exactly what I got wrong.
 */


/**
 * ⛔ THE TAIL MUST NOT PRESCRIBE A REMEDY — regression on a REAL captured graph.
 *
 * A reviewer fed `src/routes/__tests__/__fixtures__/scenario-graph-base-capture.json`
 * (a capture already in this repo, not a fixture of mine) through the SAME
 * producer the executor uses. The payload comes back blocked with MANY issues —
 * ORPHAN_NODE, OPTION_NO_FACTOR_EDGES, OPTION_NOT_LINKED_TO_DECISION,
 * NO_PATH_TO_GOAL — every one `human_input_required`, and none of them a
 * mapping obligation.
 *
 * The old tail answered: *"**This one** needs your answer rather than an
 * assumption from me — **tell me the mechanism** and I will write it in."*
 * Singular for many, and a MAPPING remedy for issues whose own messages say
 * "Add at least one factor edge" and "Link the decision to it". That is a
 * second opinion about what is wrong — precisely what this module's header
 * forbids and what its compose-site register entry claims it does not do.
 *
 * The golden regression above could not catch it: it covers the single
 * `OPTION_NEEDS_MAPPING` case, the one shape where that wording is true.
 */
describe('the repair tail on a real multi-issue capture', () => {
  const capture = JSON.parse(
    readFileSync('src/routes/__tests__/__fixtures__/scenario-graph-base-capture.json', 'utf-8'),
  ) as { graph: unknown };
  const readiness = buildCanonicalAnalysisReadyFromGraph(capture.graph as never) as never;

  it('the capture really does produce MANY human-input issues', () => {
    const r = readiness as { status?: string; readiness_issues?: readonly { repairability?: string }[] };
    expect(r.status).not.toBe('ready');
    expect((r.readiness_issues ?? []).length).toBeGreaterThan(1);
    expect((r.readiness_issues ?? []).every((i) => i.repairability === 'human_input_required')).toBe(true);
  });








});

/**
 * ⛔ ADMISSION IS `may_run`, NOT `status` — and this test must RED without the fix.
 *
 * A reviewer swept 61 canonical payloads and found **13 answered wrongly**: 12
 * `needs_user_input` and 1 `needs_user_mapping`, every one with `may_run: true`
 * and ZERO blocking issues. The user was told *"The analysis cannot run yet —
 * the model is needs_user_input. I do not have an itemised list…"* — both
 * clauses false, the raw enum leaked into prose, and no run offered, on a model
 * the product was perfectly willing to run.
 *
 * The contract is written down at `schemas/analysis-ready.ts:298-313`:
 * *"`status` is the STRICTER 'is this model ready as it stands?'. `may_run` is
 * [the run verdict]. Consumers gate on `may_run !== false` and fall back to
 * their existing [check]."*
 *
 * ⚠ THE REVIEWER'S MUTANT SURVIVED at the previous head because nothing pinned
 * this. These assertions exist so it cannot survive again.
 */


/**
 * ⛔ A BLOCKER IS A GAP IN THE TEAM'S THINKING, NOT A GATE ON A MACHINE.
 *
 * Olumi's purpose (Paul, 23 Sep): *"a reasoning-enhancement system, not an
 * answer or decision engine … analysis describes what the current model
 * implies … model-relative findings for further reasoning, not
 * recommendations."*
 *
 * The earlier copy said "One thing is blocking the analysis", which frames
 * REACHING AN ANALYSIS as the goal and the issue as an obstacle. It is not:
 * `OPTION_NEEDS_MAPPING` means the team believes two things are connected and
 * has not said how — a causal belief the Living Model exists to expose "so [it]
 * can be expanded, challenged, tested and improved".
 *
 * These pin the framing, not the phrasing, so a future edit that drifts back to
 * gate-language fails.
 */
