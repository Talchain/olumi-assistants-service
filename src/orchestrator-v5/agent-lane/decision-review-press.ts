/**
 * ⭐ A4 SLICE 1: "REVIEW THIS DECISION", AN ON-DEMAND TYPED REVIEW WITH NO MODEL CALL (DL 0df0e1, lease #87 5991360031;
 * Science wording rulings 5 Oct, `output/rc-00351a/A4-SLICE1-LEASE.md`).
 *
 * The user presses "Review this decision" after a Run; Olumi lists what to check before relying on that result. Every item
 * is ONE typed fact the bound Run already carries, said in words Science ruled, beside the existing press that acts on it.
 * Consume, never duplicate: each family is read through the reader that already speaks it, and nothing is inferred from
 * numbers or prose. A Run that is not the current, bound one gets the existing "can't explain that result as current" reply.
 *
 *   F1  `analysis_ready.unvalued_roots`          → `treatedAsZeroReplyLine` (gate 2, #2577): its own ask.
 *   F2  GOAL_ANCESTOR_DATA_GAP factor ancestors   → "‘X’ has no figure yet, …" (deduped against F1 by node id).
 *   F3/F4 GOAL_FIGURES_WITHHELD_CODES             → `goalChanceWithheldForAgent(...).say`. Gate 1 v2's identical-options
 *       code joins that reader with its own words (#2574), so F3 arrives through F4 and is never composed here.
 *   F5  `robustness.fragile_edges[0]`             → Science's sentence → Test without this link.
 *   F6  `flip_thresholds` (licence not withheld)  → `tippingPointOf(...).say` → What would change this?
 *   F7  `withheld_reason = options_do_not_separate`, only when no other item gives the reason → the withheld closing →
 *       Strengthen the model.
 *   Out of slice 1: edge_e_values (never-coach), option_comparison rows (no ranking), the ISL critique (DL).
 *
 * PURE: the route passes the final readback and maps `steps` to its own chips.
 */

import { assessRouteAdmission } from '../../cee/graph-readiness/canonical-readiness.js';
import { modePermitsAtLeast, PERMITTED_ANALYSIS_MODES } from '../admission/analysis-admission.js';
import { structuralChallengeEligibility } from '../coaching/structural-challenge-eligibility.js';
import { claimPermissionsFrom } from './first-analysis.js';
import { leaderLicenceFromState } from '../compose/leader-licence.js';
import { WITHHELD_NEAR_TIE } from '../compose/analysis-state-v1.js';
import { provisionalFiguresCaveatFor } from '../compose/leading-option-wire-enforcement.js';
import { placeholderZeroFactorIds } from '../coaching/unvalued-driver-card.js';
import { tippingPointOf } from './decision-sensitivity.js';
import { goalChanceWithheldForAgent } from './goal-chance-withheld.js';
import { runExplanationChip, RUN_EXPLANATION_UNAVAILABLE_TEXT, type RunExplanationRead } from './run-explanation.js';
import { survivesReplyEditors, treatedAsZeroReplyLine, TREATED_AS_ZERO_UNNAMED_ONE, treatedAsZeroUnnamedMany } from './root-line.js';
import { agentNoLeaderSentence } from './withheld-leader-fail-closed.js';
import { withoutProposalIds } from './display-ids.js';
import { textAtRest } from './decision-input-ask.js';

export const DECISION_REVIEW_PRESS_ID = 'agent-next-review-decision';
// Science's words (5 Oct), verbatim.
export const DECISION_REVIEW_OPENING = "Here's what to check before you rely on this result:";
export const DECISION_REVIEW_NOTHING_TO_FLAG = "None of this result's checks found anything to flag.";
const fragileLinkLine = (from: string, to: string): string =>
  `The link from ‘${from}’ to ‘${to}’ is one of the links this result is most sensitive to. You can test the result without it.`;
const zeroFactorLine = (label: string): string => `‘${label}’ has no figure yet, so these figures treat it as 0 until you give it.`;
// The forms for a finding whose label the reply's editors would rewrite, or whose test SCI-DEEP would refuse: the finding
// is still said (never "nothing to flag"), and nothing is promised that the press would refuse (Codex #2581 P2 ×2).
const FRAGILE_LINK_UNNAMED = 'One link in your model is one of the links this result is most sensitive to.';
const CAN_TEST_WITHOUT_IT = 'You can test the result without it.';
const TIPPING_UNNAMED = 'A factor in this model could change the comparison.';

/** The existing press an item points to; the route maps each to its own chip. */
export type DecisionReviewStep =
  | { readonly kind: 'test_without_link'; readonly from_id: string; readonly to_id: string }
  | { readonly kind: 'what_would_change' }
  | { readonly kind: 'strengthen' };

export interface DecisionReviewTurn {
  /** Bound to the current Run: the review was composed. `false` = the existing unavailable reply. */
  readonly bound: boolean;
  readonly reply: string;
  /** Each item exactly as it stands on its own line of `reply` (the route protects these through the wire gate). */
  readonly lines: readonly string[];
  readonly steps: readonly DecisionReviewStep[];
}

export type DecisionReviewRead = RunExplanationRead & { readonly graph?: unknown; readonly analysisReady?: unknown };

type Rec = Record<string, unknown>;
const recordOf = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function graphNodes(graph: unknown): Map<string, { readonly label: string; readonly kind: string | null }> {
  const out = new Map<string, { readonly label: string; readonly kind: string | null }>();
  const nodes = recordOf(graph)?.nodes;
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes.map(recordOf)) {
    const id = str(n?.id);
    const label = str(n?.label);
    if (id !== null && label !== null) out.set(id, { label: label.replace(/\s+/g, ' ').trim(), kind: str(n?.kind) });
  }
  return out;
}

function graphHasLink(graph: unknown, from: string, to: string): boolean {
  const edges = recordOf(graph)?.edges;
  return Array.isArray(edges) && edges.map(recordOf).some((e) => str(e?.from) === from && str(e?.to) === to);
}

/** The factors an option itself sets (its `interventions`): the decision's own levers, never a change in the world. */
function leverIds(graph: unknown): ReadonlySet<string> {
  const g = recordOf(graph);
  const holders = [...(Array.isArray(g?.options) ? g!.options : []),
    ...(Array.isArray(g?.nodes) ? (g!.nodes as unknown[]).filter((n) => recordOf(n)?.kind === 'option') : [])];
  return new Set(holders.flatMap((o) => Object.keys(recordOf(recordOf(o)?.interventions) ?? {})));
}

/** The typed unvalued roots' node ids (the same verdict `treatedAsZeroReplyLine` speaks from). */
function unvaluedRootIds(graph: unknown): ReadonlySet<string> {
  try {
    return new Set((assessRouteAdmission(graph).unvalued_roots ?? []).map((r) => r.node_id));
  } catch {
    return new Set();
  }
}

/** On a licensed turn only the proposal-id scrub and the at-rest parse edit prose (the ranking drop and gate stand down). */
const survivesLicensedEditors = (line: string): boolean =>
  !line.includes('\n') && withoutProposalIds(line) === line && textAtRest(line) === line;

export function decisionReviewFor(scenarioId: string, read: DecisionReviewRead): DecisionReviewTurn {
  if (runExplanationChip(scenarioId, read) === null) {
    return { bound: false, reply: RUN_EXPLANATION_UNAVAILABLE_TEXT, lines: [], steps: [] };
  }
  const { graph, analysisReady, analysisState, analysisResult } = read;
  const enrichment = recordOf(recordOf(analysisResult)?.enrichment);
  const nodes = graphNodes(graph);
  const licence = leaderLicenceFromState(analysisState, analysisReady);
  const lines: string[] = [];
  const steps: DecisionReviewStep[] = [];

  // F1: a non-factor root on the goal's path, treated as zero, with its ask.
  const rootLine = treatedAsZeroReplyLine(graph, analysisReady);
  if (rootLine !== null) lines.push(rootLine);
  const rootIds = rootLine !== null ? unvaluedRootIds(graph) : new Set<string>();

  // F2: a factor ancestor the Run defaulted to 0 (PLoT's GOAL_ANCESTOR_DATA_GAP, read by its one reader), named. That
  // reader yields every quoted slug in the warning — the goal's own id included — so only a FACTOR node of this graph
  // counts, as its card uses it (a membership test on a factor driver, `unvalued-driver-card.ts:138`). A label the
  // reply's editors would rewrite is counted and said in gate 2's label-free form.
  let unnamedZero = 0;
  for (const id of placeholderZeroFactorIds(analysisResult)) {
    if (rootIds.has(id)) continue;
    const node = nodes.get(id);
    if (node === undefined || node.kind !== 'factor') continue;
    const line = zeroFactorLine(node.label);
    if (survivesReplyEditors(line, graph, analysisReady)) lines.push(line);
    else unnamedZero += 1;
  }
  if (unnamedZero > 0) {
    const line = unnamedZero === 1 ? TREATED_AS_ZERO_UNNAMED_ONE : treatedAsZeroUnnamedMany(unnamedZero);
    if (!lines.includes(line)) lines.push(line);
  }

  // F3/F4: the Run withheld goal figures, in the typed reason's own words.
  const withheldSay = str(goalChanceWithheldForAgent(analysisResult)?.say);
  if (withheldSay !== null) lines.push(withheldSay);

  // F5: the most sensitive link of the stored graph the Run carries; never names an option. The test is promised and
  // offered only where SCI-DEEP would run it: the link's own removal eligibility (`structuralChallengeEligibility`) and
  // the Run's licence for the comparison (at least `quantified_provisional`, goal claims allowed), as its dispatch reads.
  const robustness = recordOf(enrichment?.robustness);
  const fragile = (Array.isArray(robustness?.fragile_edges) ? robustness!.fragile_edges : []).map(recordOf)
    .map((e) => ({ from: str(e?.from_id), to: str(e?.to_id) }))
    .find((e): e is { from: string; to: string } => e.from !== null && e.to !== null && graphHasLink(graph, e.from, e.to));
  if (fragile !== undefined) {
    const from = nodes.get(fragile.from)?.label;
    const to = nodes.get(fragile.to)?.label;
    const permissions = claimPermissionsFrom(analysisState, analysisReady);
    const mode = PERMITTED_ANALYSIS_MODES.find((m) => m === permissions.permitted_analysis_mode);
    const testable = structuralChallengeEligibility(graph, { from_id: fragile.from, to_id: fragile.to }).eligible
      && mode !== undefined && modePermitsAtLeast(mode, 'quantified_provisional')
      && permissions.total_goal_claims_allowed !== false;
    const named = from !== undefined && to !== undefined ? fragileLinkLine(from, to) : null;
    const sentence = named !== null && survivesReplyEditors(named, graph, analysisReady)
      ? named.slice(0, -(` ${CAN_TEST_WITHOUT_IT}`).length) : FRAGILE_LINK_UNNAMED;
    lines.push(testable ? `${sentence} ${CAN_TEST_WITHOUT_IT}` : sentence);
    if (testable) steps.push({ kind: 'test_without_link', from_id: fragile.from, to_id: fragile.to });
  }

  // F6: a factor that could change the comparison, only where the licence names a leader (as SCI-CHANGE answers:
  // `complete_current` and a licensed leader) and never a lever (Science 5 Oct; PLoT #432): a factor the options
  // themselves set is the decision, not a change in the world. Its caveat rides with it.
  let tippingSaid = false;
  if (licence !== 'withheld') {
    const levers = leverIds(graph);
    const flipRows = Array.isArray(enrichment?.flip_thresholds) ? enrichment!.flip_thresholds as unknown[] : [];
    const tp = tippingPointOf({ ...enrichment, flip_thresholds: flipRows.filter((r) => !levers.has(String(recordOf(r)?.factor_id ?? ''))) });
    if (tp.status === 'found') {
      const say = survivesLicensedEditors(tp.say) ? tp.say : TIPPING_UNNAMED;
      lines.push(licence === 'permitted_with_caveat' ? `${say} ${provisionalFiguresCaveatFor(analysisReady)}` : say);
      steps.push({ kind: 'what_would_change' });
      tippingSaid = true;
    }
  }

  // F7: the options did not separate, said only when no other item already gives the withhold its reason.
  const claim = recordOf(recordOf(analysisState)?.leader_claim);
  if (claim?.withheld_reason === WITHHELD_NEAR_TIE && withheldSay === null && !tippingSaid) {
    lines.push(agentNoLeaderSentence(WITHHELD_NEAR_TIE, analysisReady, [], undefined, undefined, str(claim.separation) ?? undefined));
    steps.push({ kind: 'strengthen' });
  }

  if (lines.length === 0) return { bound: true, reply: DECISION_REVIEW_NOTHING_TO_FLAG, lines: [DECISION_REVIEW_NOTHING_TO_FLAG], steps: [] };
  const items = lines.map((l) => `- ${l}`);
  return { bound: true, reply: [DECISION_REVIEW_OPENING, '', ...items].join('\n'), lines: [DECISION_REVIEW_OPENING, ...items], steps };
}
