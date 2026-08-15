/**
 * S2-L1 — typed readiness/coaching intake composer.
 *
 * THE GAP THIS CLOSES: `analysis_readiness` is an intent CEE already accepts
 * on the wire (`@talchain/schemas` 0.20.0 `ActionType`), but nothing routes a
 * `source='chip_click'` + `chip.action_type='analysis_readiness'` turn on its
 * TYPE. The enum comment in 0.20.0 promises CEE "routes the turn through the
 * existing pre-heuristic chip branch to its readiness/coaching arm" — that arm
 * did not exist. Today the routing is done by the hand-maintained string mirror
 * (`process-meta-intake.ts` `PRODUCT_COACHING_PROMPTS`, trap-12), i.e. by the
 * canned wording, not by the type.
 *
 * This module is the readiness/coaching arm the type should reach. It consumes
 * the SAME readiness engine the coaching spine uses
 * (the canonical graph readiness adapter + `summariseReadiness`, which
 * `coaching-state.ts`'s `evaluateReadiness` also wraps) — no new science — and
 * the SAME honest fresh-canvas answer (`composeProcessMetaIntakeResponse`), now
 * reached by the type. The string-mirror branch and the typed branch collapse
 * onto one composer on a fresh canvas; on a populated canvas the type reaches
 * deterministic readiness coaching keyed on the persisted graph, not on the
 * chip's canned text.
 *
 * Pure + total: never throws (structural readiness is best-effort; an
 * unparseable persisted graph degrades to the honest fresh-canvas answer, the
 * same defensive stance `evaluateReadiness` takes).
 *
 * DELIBERATELY does NOT delete the string mirror. That is S2-L5, gated on the
 * typed path being deployed + the UI re-vendored + staging-confirmed
 * (consume-then-delete; never before the confirm).
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

import { GraphV3 } from '../../schemas/cee-v3.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { summariseReadiness } from './readiness-summary.js';
import { composeProcessMetaIntakeResponse } from './process-meta-intake.js';

/** Where the readiness arm landed — surfaced to telemetry so the typed arm is
 *  observable per turn (fresh-canvas unification vs each populated branch). */
export type ReadinessIntakeOutcome =
  | 'fresh_canvas'
  | 'goal_missing'
  | 'readiness_open'
  | 'readiness_ready';

export interface ReadinessIntakeResult {
  readonly outcome: ReadinessIntakeOutcome;
  readonly response: OlumiResponse;
}

type StageIndicator = OlumiResponse['stage_indicator'];

/**
 * Stable copy markers for tests/telemetry greps. Each populated-canvas branch
 * carries exactly one so a routing change goes RED against an EXACT phrase
 * rather than hiding inside a substring overlap. The fresh-canvas branch reuses
 * `composeProcessMetaIntakeResponse`'s own marker (`a model on the canvas`).
 */
export const READINESS_GOAL_MISSING_MARKER = 'does not have a goal node yet';
/** Reused verbatim from `summariseReadiness`'s prose lead. */
export const READINESS_OPEN_MARKER = 'still open before this can run cleanly';
export const READINESS_READY_MARKER = 'looks ready to analyse';

function composeGoalMissingResponse(stage: StageIndicator): OlumiResponse {
  const assistantText =
    'Your model is on the canvas, but it does not have a goal node yet, so ' +
    'there is nothing for the analysis to judge the options against. Add the ' +
    'goal you want to weigh the options up against, and I will help you check ' +
    'the rest before you run the first analysis.';
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: stage,
  } as OlumiResponse;
}

function composeOpenItemsResponse(prose: string, stage: StageIndicator): OlumiResponse {
  // `prose` is the reviewed, deterministic readiness-summary text (the SAME
  // string the post-analysis advice gate ships). It already opens with
  // "Here's what's still open before this can run cleanly: …" and never echoes
  // a numeric readiness percentage, so it is safe to surface verbatim as the
  // whole answer. We prepend nothing structural to avoid drift with that gate.
  return {
    response_version: 2,
    assistant_text: prose,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: stage,
  } as OlumiResponse;
}

function composeReadyResponse(stage: StageIndicator): OlumiResponse {
  const assistantText =
    'Your model has a goal, at least two options, and factors mapped with ' +
    'values, so it looks ready to analyse. Run the analysis whenever you are ' +
    'ready, and I can talk through the results with you afterwards.';
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: stage,
  } as OlumiResponse;
}

/**
 * Compose the readiness/coaching answer for a typed `analysis_readiness`
 * chip_click, reading the PERSISTED scenario graph (the same authority the
 * run_analysis chip uses — never the HTTP body).
 *
 * Branch tree (mirrors `evaluateReadiness`'s own structural gates so the two
 * cannot diverge on what "readiness" means):
 *   - no graph / empty / unparseable  → the honest fresh-canvas checklist
 *     (`composeProcessMetaIntakeResponse`), now reached by the type. This is
 *     the unification with the string-mirror branch.
 *   - populated, no goal node         → canonical projection returns
 *     undefined (its strongest "not ready" blocker) → name the missing goal.
 *   - populated, open readiness items → surface `summariseReadiness`'s prose.
 *   - populated, nothing open         → say the model looks ready to analyse.
 */
export function composeReadinessIntakeResponse(
  persistedGraph: unknown | null,
  stage: StageIndicator,
): ReadinessIntakeResult {
  if (persistedGraph == null) {
    return { outcome: 'fresh_canvas', response: composeProcessMetaIntakeResponse() };
  }
  const parsed = GraphV3.safeParse(persistedGraph);
  // Unparseable, or parseable but structurally empty (no nodes): we cannot
  // assess readiness, so give the honest fresh-canvas answer rather than a
  // misleading populated-canvas claim.
  if (!parsed.success || parsed.data.nodes.length === 0) {
    return { outcome: 'fresh_canvas', response: composeProcessMetaIntakeResponse() };
  }
  // Preserve canonical top-level options when present; GraphV3 parsing is the
  // validity gate but its projection may intentionally omit those carriers.
  const readiness = buildCanonicalAnalysisReadyFromGraph(persistedGraph);
  if (readiness === undefined) {
    return { outcome: 'goal_missing', response: composeGoalMissingResponse(stage) };
  }
  const summary = summariseReadiness(readiness);
  if (summary.open_items.length > 0) {
    return { outcome: 'readiness_open', response: composeOpenItemsResponse(summary.prose, stage) };
  }
  return { outcome: 'readiness_ready', response: composeReadyResponse(stage) };
}
