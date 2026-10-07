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
 *   F6  no item: "What would change this?" is offered where SCI-CHANGE answers (a current Run, a leader the licence
 *       names; `what-changes-turn.ts`), and that press says what would change it (Codex #2581 r2: a second tipping reader
 *       here would select differently from the press's own).
 *   F7  `withheld_reason = options_do_not_separate`, only when no other item gives the reason → the withheld closing →
 *       Strengthen the model.
 *   Out of slice 1: edge_e_values (never-coach), option_comparison rows (no ranking), the ISL critique (DL).
 *
 * Every item reaches the user whole or in a label-free form, never dropped: a finding is never "nothing to flag".
 *
 * PURE: the route passes the final readback and maps `steps` to its own chips.
 */

import { assessRouteAdmission } from '../../cee/graph-readiness/canonical-readiness.js';
import { modePermitsAtLeast, PERMITTED_ANALYSIS_MODES } from '../admission/analysis-admission.js';
import { structuralChallengeEligibility } from '../coaching/structural-challenge-eligibility.js';
import { claimPermissionsFrom } from './first-analysis.js';
import { leaderLicenceFromState } from '../compose/leader-licence.js';
import { WITHHELD_NEAR_TIE } from '../compose/analysis-state-v1.js';
import { placeholderZeroFactorIds } from '../coaching/unvalued-driver-card.js';
import { goalChanceWithheldForAgent, withoutAskedQuestion } from './goal-chance-withheld.js';
import { GOAL_CHANCE_RANGE } from '../goal-target/goal-chance-range.js';
import { runExplanationChip, RUN_EXPLANATION_UNAVAILABLE_TEXT, type RunExplanationRead } from './run-explanation.js';
import { survivesReplyEditors, treatedAsZeroReplyLine, TREATED_AS_ZERO_UNNAMED_ONE, treatedAsZeroUnnamedMany } from './root-line.js';
import { agentNoLeaderSentence } from './withheld-leader-fail-closed.js';
import { readFactorEnrichments, factorReviewSensitivity } from './factor-review.js';

export const DECISION_REVIEW_PRESS_ID = 'agent-next-review-decision';
// Science's words (5 Oct), verbatim.
export const DECISION_REVIEW_OPENING = "Here's what to check before you rely on this result:";
export const DECISION_REVIEW_NOTHING_TO_FLAG = "None of this result's checks found anything to flag.";
const fragileLinkLine = (from: string, to: string): string =>
  `The link from ‘${from}’ to ‘${to}’ is one of the links this result is most sensitive to.`;
const zeroFactorLine = (label: string): string => `‘${label}’ has no figure yet, so these figures treat it as 0 until you give it.`;
// The form for a link whose labels the reply's editors would rewrite: the finding is still said (Codex #2581 P2).
const FRAGILE_LINK_UNNAMED = 'One link in your model is one of the links this result is most sensitive to.';

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

export type DecisionReviewRead = RunExplanationRead & { readonly graph?: unknown; readonly analysisReady?: unknown;
  /** The canonical reader's same-Run persisted enrichment, kept out of the transport/model context. */
  readonly factorEnrichments?: unknown;
  /** The Agent's recent answers (NEVER RE-ASK, G1b d4): a withheld reason's question already asked is not asked again. */
  readonly recentReplies?: readonly string[] };

type Rec = Record<string, unknown>;
const recordOf = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** A stored challenge must not propose acting on, or prioritising, a shortened option reference. */
function questionSuggestsOptionAction(question: string, graph: unknown): boolean {
  if (!/\b(?:explor(?:e|ing)|choos(?:e|ing)|hir(?:e|ing)|recruit\w*|add(?:ing)?|rais(?:e|ing)|lower\w*|hold\w*|keep\w*|maintain\w*|use|using|switch\w*|select\w*|pursu(?:e|ing)|adopt\w*|prioriti[sz]\w*|prefer\w*|go\s+with|start\s+with|focus\s+on|first|before|ahead\s+of|instead\s+of|priority)\b/i.test(question)) return false;
  const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const questionWords = ` ${words(question).join(' ')} `;
  return [...graphNodes(graph).values()].some((node) => {
    if (node.kind !== 'option' || node.label === null) return false;
    // The option's noun phrase survives a dropped action/article: "Hire a Tech Lead" → "tech lead".
    const reference = words(node.label);
    while (reference.length > 1 && /^(?:a|an|the|hire|hiring|recruit|add|adding|raise|lower|hold|keep|maintain|use|using|choose|adopt|switch|to)$/.test(reference[0]!)) reference.shift();
    return reference.length > 0 && questionWords.includes(` ${reference.join(' ')} `);
  });
}

/** One rank-1 challenge, rank only. Every composed byte must survive the existing #2660 egress ladder. */
export function factorReviewPressLine(read: DecisionReviewRead): string | null {
  const enrichment = recordOf(recordOf(read.analysisResult)?.enrichment);
  const driver = factorReviewSensitivity(enrichment?.factor_sensitivity).find((r) => r.rank === 1);
  if (driver === undefined) return null;
  const stored = readFactorEnrichments(read.factorEnrichments ?? enrichment?.factor_enrichments);
  const question = str(stored?.find((e) => e.factor_id === driver.factor_id && e.sensitivity_rank === 1)?.confidence_question)?.trim();
  const label = graphNodes(read.graph).get(driver.factor_id)?.label;
  if (!label || !question) return null;
  if (questionSuggestsOptionAction(question, read.graph)) return null;
  if (!survivesReplyEditors(question, read.graph, read.analysisReady)) return null;
  // Only an open test question: no numeric/value assertion, recommendation or generated observations.
  if (!/^(?:what|which|how could|how would|could|would)\b/i.test(question) || !question.endsWith('?')
    || /[\d.!\n]|\b(?:best|recommend\w*|winner|elasticity)\b/i.test(question)
    || question.slice(0, -1).includes('?')) return null;
  const relative = /\b(?:this|the) model\b/i.test(question) ? question
    : `In this model, ${question[0]!.toLowerCase()}${question.slice(1)}`;
  const line = `The result moves most with ‘${label}’. A question to test it: ${relative}`;
  return survivesReplyEditors(line, read.graph, read.analysisReady) ? line : null;
}

/** Every node by id, its kind kept apart from its label: a node with no usable label is still the node (Codex r2 P2). */
function graphNodes(graph: unknown): Map<string, { readonly label: string | null; readonly kind: string | null }> {
  const out = new Map<string, { readonly label: string | null; readonly kind: string | null }>();
  const nodes = recordOf(graph)?.nodes;
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes.map(recordOf)) {
    const id = str(n?.id);
    const label = str(n?.label);
    if (id !== null) out.set(id, { label: label === null ? null : label.replace(/\s+/g, ' ').trim(), kind: str(n?.kind) });
  }
  return out;
}

function graphHasLink(graph: unknown, from: string, to: string): boolean {
  const edges = recordOf(graph)?.edges;
  return Array.isArray(edges) && edges.map(recordOf).some((e) => str(e?.from) === from && str(e?.to) === to);
}

/** The typed unvalued roots' node ids (the same verdict `treatedAsZeroReplyLine` speaks from). */
function unvaluedRootIds(graph: unknown): ReadonlySet<string> {
  try {
    return new Set((assessRouteAdmission(graph).unvalued_roots ?? []).map((r) => r.node_id));
  } catch {
    return new Set();
  }
}

/** The count an unnamed treated-as-zero line states (gate 2's label-free forms), or 0 for any other line. */
function unnamedZeroCount(line: string | null): number {
  if (line === null) return 0;
  if (line === TREATED_AS_ZERO_UNNAMED_ONE) return 1;
  const n = Number(/^(\d+) inputs on your goal’s path/.exec(line)?.[1] ?? 0);
  return n > 1 && line === treatedAsZeroUnnamedMany(n) ? n : 0;
}
const unnamedZeroLine = (n: number): string => (n === 1 ? TREATED_AS_ZERO_UNNAMED_ONE : treatedAsZeroUnnamedMany(n));

/** Remove withhold words for the fail-closed opening; ranges are not withhold reasons and keep their display licence. */
function withoutWarningWords(result: unknown): unknown {
  const block = recordOf(result);
  if (block === undefined) return result;
  const wordless = (w: unknown): unknown => (Array.isArray(w) ? w.map((x) => (recordOf(x) && recordOf(x)?.code !== GOAL_CHANCE_RANGE ? { ...recordOf(x), message: '' } : x)) : w);
  const enrichment = recordOf(block.enrichment);
  return { ...block, inference_warnings: wordless(block.inference_warnings),
    ...(enrichment !== undefined ? { enrichment: { ...enrichment, inference_warnings: wordless(enrichment.inference_warnings) } } : {}) };
}

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

  const factorLine = factorReviewPressLine(read);
  if (factorLine !== null) lines.push(factorLine);

  // F1: a non-factor root on the goal's path, treated as zero, with its ask.
  const rootLine = treatedAsZeroReplyLine(graph, analysisReady);
  const rootIds = rootLine !== null ? unvaluedRootIds(graph) : new Set<string>();

  // F2: a factor ancestor the Run defaulted to 0 (PLoT's GOAL_ANCESTOR_DATA_GAP, read by its one reader against this
  // graph's own factor ids, so any id the graph holds is found), named. The reader yields only quoted ids of this graph,
  // and only a FACTOR node counts, as its card uses it. A factor with no label, or one the reply's editors would rewrite,
  // is COUNTED by node identity and said in gate 2's label-free form, together with F1's unnamed roots (one count).
  const zeroLines: string[] = [];
  let unnamedZero = unnamedZeroCount(rootLine);
  const factorIds = [...nodes].filter(([id, n]) => n.kind === 'factor' && !rootIds.has(id)).map(([id]) => id);
  for (const id of placeholderZeroFactorIds(analysisResult, factorIds)) {
    const label = nodes.get(id)?.label ?? null;
    const line = label === null ? null : zeroFactorLine(label);
    if (line !== null && survivesReplyEditors(line, graph, analysisReady)) zeroLines.push(line);
    else unnamedZero += 1;
  }
  if (rootLine !== null && unnamedZeroCount(rootLine) === 0) lines.push(rootLine);
  if (unnamedZero > 0) lines.push(unnamedZeroLine(unnamedZero));
  lines.push(...zeroLines);

  // F3/F4: the Run withheld goal figures, in the typed reason's own words when they reach the user whole; otherwise the
  // reader's own fail-closed opening (the withhold is still said, its label-bearing reason is not; Codex r2 P2).
  const withheld = goalChanceWithheldForAgent(analysisResult, graph);
  const withheldSay = str(withheld?.say);
  if (withheldSay !== null) {
    const said = withoutAskedQuestion(survivesReplyEditors(withheldSay, graph, analysisReady) ? withheldSay
      : str(goalChanceWithheldForAgent(withoutWarningWords(analysisResult), graph)?.say) ?? withheldSay, read.recentReplies ?? []);
    if (said.trim() !== '') lines.push(said);
  }

  // F5: the most sensitive link of the stored graph the Run carries; never names an option. The test is never promised in
  // words: SCI-DEEP decides at the press, on its own baseline evidence and the Run's wire graph, and answers a refusal in
  // its own words. Its press is offered only where nothing SCI-DEEP checks first already refuses it: the link's removal
  // eligibility on this graph, and the Run's licence for the comparison (at least `quantified_provisional`, goal claims
  // allowed), as its dispatch reads them. Both are necessary, not sufficient (Codex r2 P2).
  const robustness = recordOf(enrichment?.robustness);
  const fragile = (Array.isArray(robustness?.fragile_edges) ? robustness!.fragile_edges : []).map(recordOf)
    .map((e) => ({ from: str(e?.from_id), to: str(e?.to_id) }))
    .find((e): e is { from: string; to: string } => e.from !== null && e.to !== null && graphHasLink(graph, e.from, e.to));
  if (fragile !== undefined) {
    const from = nodes.get(fragile.from)?.label ?? null;
    const to = nodes.get(fragile.to)?.label ?? null;
    const named = from !== null && to !== null ? fragileLinkLine(from, to) : null;
    lines.push(named !== null && survivesReplyEditors(named, graph, analysisReady) ? named : FRAGILE_LINK_UNNAMED);
    const permissions = claimPermissionsFrom(analysisState, analysisReady);
    const mode = PERMITTED_ANALYSIS_MODES.find((m) => m === permissions.permitted_analysis_mode);
    const notRefusedFirst = structuralChallengeEligibility(graph, { from_id: fragile.from, to_id: fragile.to }).eligible
      && mode !== undefined && modePermitsAtLeast(mode, 'quantified_provisional')
      && permissions.total_goal_claims_allowed !== false;
    if (notRefusedFirst) steps.push({ kind: 'test_without_link', from_id: fragile.from, to_id: fragile.to });
  }

  // F6: "What would change this?" where SCI-CHANGE answers it: this bound, current Run with a leader the licence names
  // (its own gate, `what-changes-turn.ts`: `run.leader_licensed` = licence not withheld). No item: that press says it.
  if (licence !== 'withheld') steps.push({ kind: 'what_would_change' });

  // F7: the options did not separate, said only when no other item already gives the withhold its reason.
  const claim = recordOf(recordOf(analysisState)?.leader_claim);
  if (claim?.withheld_reason === WITHHELD_NEAR_TIE && withheldSay === null) {
    lines.push(agentNoLeaderSentence(WITHHELD_NEAR_TIE, analysisReady, [], undefined, undefined, str(claim.separation) ?? undefined));
    steps.push({ kind: 'strengthen' });
  }

  if (lines.length === 0) return { bound: true, reply: DECISION_REVIEW_NOTHING_TO_FLAG, lines: [DECISION_REVIEW_NOTHING_TO_FLAG], steps };
  const items = lines.map((l) => `- ${l}`);
  return { bound: true, reply: [DECISION_REVIEW_OPENING, '', ...items].join('\n'), lines: [DECISION_REVIEW_OPENING, ...items], steps };
}
