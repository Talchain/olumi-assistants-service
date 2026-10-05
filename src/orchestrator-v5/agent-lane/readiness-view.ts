/**
 * ⭐ (B) ONE READINESS VERDICT THE AGENT CAN READ — and the one sentence the user reads after a change.
 *
 * Paul's manual test (25 Sep 17:54Z): the model could not run (an option was not connected from the decision),
 * the Run control was correctly withheld, and the Agent told him "no recorded structural blocker … a fresh
 * analysis is the next valid step". The Agent had never been shown the verdict: `get_canonical_state` carried
 * the read route's readiness PLACEHOLDER (`{status:'unknown', blockers:[]}` — an empty list the composer treats as
 * "nothing blocking") and `structuralFacts`, which does not check decision links at all.
 *
 * This projects the route's ONE admission verdict — `assessRouteAdmission`, the same `resolveRunAdmission` the
 * run path throws on — over the graph the Agent just read. Nothing is re-derived here: `may_run`, each issue's
 * message, whether it is the user's to answer or only an offer, and which options a run would leave out all come
 * from the verdict as it stands.
 *
 * ⛔ NO CODES, NO IDS. The typed codes stay machine-readable where they already are (`analysis_ready` on the
 * wire). This view is what the Agent narrates from, so it carries the canonical plain-English message only
 * (ChatGPT 5839692762: "require the typed blocker code in the machine-readable result, but its accurate
 * PLAIN-ENGLISH explanation in user prose").
 */
import { assessRouteAdmission } from '../../cee/graph-readiness/canonical-readiness.js';
import { targetTestabilityOf, notTargetTestableSentence } from '../admission/target-testability.js';

export interface ReadinessItem {
  readonly message: string;
  readonly option?: string;
  readonly factor?: string;
}

export interface ReadinessView {
  /** False when the verdict could not be computed: say so, never "nothing is blocking". */
  readonly checked: boolean;
  /** Whether a run would be admitted NOW. Never inferred from `structure`. */
  readonly may_run?: boolean;
  /** Gaps only the user can answer (a demand, not waived by the run leaving an option out). */
  readonly needs_from_user: readonly ReadinessItem[];
  /** Gaps Olumi may only OFFER to help with — never presented as the user's task. */
  readonly olumi_can_offer: readonly ReadinessItem[];
  /** Options a run would leave out until they are complete, by label. */
  readonly will_run_without: readonly string[];
  /** Non-factor roots the admitted analysis treats as zero, by label. */
  readonly treated_as_zero?: readonly string[];
  /**
   * Option levels no one has set (`MISSING_OPTION_VALUE`, not waived by leaving the option out), by label — whether
   * the verdict demands them or only offers help: either way the figure is the user's to give. A run can still be
   * admitted without them (AI Conversation #70 5849012990 U3), so they are named on their own.
   */
  readonly levels_not_set: readonly { readonly option: string; readonly factor: string }[];
  /**
   * ⭐ DECISION-REPRESENTATION row 4 (AIQ #75 5913873948 row 3): the goal's stated target can't be tested by a Run yet,
   * in AIQ's words, with the one question when there is one (`notTargetTestableSentence`). Present only then: a Run may
   * still compare the options, but no Run answers the target until this is resolved.
   */
  readonly target_not_testable?: string;
  /** Why a run is refused when no demand explains it: the refusal's own words. Present only then. */
  readonly reason?: string;
}

const UNCHECKED: ReadinessView = { checked: false, needs_from_user: [], olumi_can_offer: [], will_run_without: [], levels_not_set: [] };

/** An internal code or field name is never user prose. */
const CODE_LIKE = /\b[A-Z]+(?:_[A-Z]+){2,}\b/;

const itemOf = (i: { message: string; option_label?: string; factor_label?: string }): ReadinessItem | undefined => {
  const message = String(i.message ?? '').trim();
  if (message === '' || CODE_LIKE.test(message)) return undefined;
  return {
    message,
    ...(typeof i.option_label === 'string' && i.option_label !== '' ? { option: i.option_label } : {}),
    ...(typeof i.factor_label === 'string' && i.factor_label !== '' ? { factor: i.factor_label } : {}),
  };
};

export function readinessViewOf(rawGraph: unknown): ReadinessView {
  if (rawGraph === null || rawGraph === undefined || typeof rawGraph !== 'object') return UNCHECKED;
  let verdict: ReturnType<typeof assessRouteAdmission>;
  try {
    verdict = assessRouteAdmission(rawGraph);
  } catch {
    return UNCHECKED;
  }
  if (verdict.may_run === 'unknown') return UNCHECKED;
  const needs: ReadinessItem[] = [];
  const offers: ReadinessItem[] = [];
  const levelsNotSet: { option: string; factor: string }[] = [];
  const treatedAsZero = (verdict.unvalued_roots ?? []).map((root) => root.label);
  for (const issue of verdict.readiness_issues) {
    const item = itemOf(issue);
    if (item === undefined) continue;
    if ((issue as { code?: unknown }).code === 'MISSING_OPTION_VALUE' && issue.waived_by_exclusion !== true
      && item.option !== undefined && item.factor !== undefined
      && !levelsNotSet.some((l) => l.option === item.option && l.factor === item.factor)) {
      levelsNotSet.push({ option: item.option, factor: item.factor });
    }
    const isDemand = issue.repairability === 'human_input_required' && issue.obligation !== 'offered' && issue.waived_by_exclusion !== true;
    if (isDemand) needs.push(item);
    else if (issue.obligation === 'offered') offers.push(item);
  }
  /**
   * ⛔ A BLOCK WITH NO DEMAND STILL HAS A REASON (served f-20260926T020217Z, CEE ef99a97): two options set identical
   * levels, strict readiness passes, and the run's comparison floor refuses — `may_run: false` with no demand. The
   * view read issues alone, so the Agent was handed "can't run" with no why. The reason is the REFUSAL'S OWN
   * `blocker_reason` (Canonical 5842490587: the run path's `blockedNextStep`), never a second check such as the
   * critiques, which answer a different question (#1955 review 5842389608).
   */
  const blockerReason = typeof verdict.blocker_reason === 'string' ? verdict.blocker_reason.trim() : '';
  const reason =
    verdict.may_run === false && needs.length === 0 && blockerReason !== '' && !CODE_LIKE.test(blockerReason)
      ? blockerReason
      : undefined;
  const labelOf = new Map<string, string>();
  for (const n of ((rawGraph as { nodes?: unknown }).nodes as { id?: unknown; label?: unknown }[] | undefined) ?? []) {
    if (typeof n?.id === 'string') labelOf.set(n.id, typeof n.label === 'string' && n.label !== '' ? n.label : n.id);
  }
  const excluded = (verdict.scaffold_plan.excluded_option_ids ?? []).map((id) => labelOf.get(id) ?? id);
  const target = notTargetTestableSentence(rawGraph, targetTestabilityOf(rawGraph));
  return {
    checked: true,
    may_run: verdict.may_run,
    needs_from_user: dedupe(needs),
    olumi_can_offer: dedupe(offers),
    will_run_without: excluded,
    levels_not_set: levelsNotSet,
    ...(treatedAsZero.length > 0 ? { treated_as_zero: treatedAsZero } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(target !== null ? { target_not_testable: target } : {}),
  };
}

function dedupe(items: readonly ReadinessItem[]): ReadinessItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)));
}

const listOf = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).map((x) => `"${x}"`).join(', ')} and "${xs[xs.length - 1]}"`;

/**
 * The ONE sentence the user reads after a change, from the same verdict. Deterministic; plain English; never a
 * code. Says whether the analysis can run NOW — and what it would leave out, or what stands in the way.
 */
/**
 * ⛔ AN ADMITTED RUN CAN STILL BE WAITING ON A LEVEL ONLY THE USER CAN GIVE (AI Conversation #70 5849012990 U3, served
 * 79c299a turns[4]): after one approval "Keep £49 and add a paid AI add-on" acted on AI feature availability with no
 * level; the run was admitted and the receipt said only "run it again". Named as the question the user can answer,
 * from the verdict's own labels — never a code. Only while a run is admitted: a refusal already names what it needs.
 */
export function stillNeededLine(view: ReadinessView): string | null {
  if (!view.checked || view.may_run !== true) return null;
  const lines: string[] = [];
  const n = view.levels_not_set.length;
  if (n > 0) {
    const asks = view.levels_not_set.slice(0, 2).map((l) => `what does "${l.option}" set ${l.factor} to`).join(', and ');
    lines.push(n === 1 ? `One level is not set yet: ${asks}?`
      : n === 2 ? `Two levels are not set yet: ${asks}?` : `${n} levels are not set yet, including: ${asks}?`);
  }
  const roots = treatedAsZeroLine(view);
  if (roots !== null) lines.push(roots);
  return lines.length > 0 ? lines.join(' ') : null;
}

/**
 * DL gate 2 (5 Oct): a non-factor root with no figure runs at zero (as ISL does) and is SAID, never a block — with the
 * ask for its figure. One sentence for both readers: the post-write ask above, and the Run turn and its replay
 * (`agent-v1-turn.ts`), which said neither (Acceptance #87 5987804248, scenario 9b9a4b81). Science (5 Oct): `treated_as`
 * is only `'zero'`, and the ask does not branch on `kind` ("risk" here is not a probability).
 */
export function treatedAsZeroLine(view: ReadinessView): string | null {
  if (!view.checked || view.may_run !== true) return null;
  const roots = view.treated_as_zero ?? [];
  if (roots.length === 1) {
    return `No figure is set for "${roots[0]}" yet, so the analysis treats it as zero. How likely or how large is it today?`;
  }
  if (roots.length > 1) {
    const labels = `"${roots[0]}" and "${roots[1]}"${roots.length > 2 ? ` and ${roots.length - 2} more` : ''}`;
    return `No figures are set for ${labels} yet, so the analysis treats them as zero. How likely or how large is each today?`;
  }
  return null;
}

/**
 * The refusal's own words without an opening that already says the model can't be analysed — every sentence that
 * quotes a reason after its own "can't run" uses this, so none reads "can't … can't" (#1957 review, advisory 2).
 */
export function withoutCantRunOpening(reason: string): string {
  return reason.replace(/^This model can(?:'|\u2019)t be analysed yet\.\s*/i, '');
}

export function readinessSentence(view: ReadinessView): string {
  if (!view.checked) return 'I could not check whether the analysis can run yet.';
  if (view.may_run === true) {
    const one = view.will_run_without.length === 1;
    const leaveOut = view.will_run_without.length === 0 ? ''
      : `leave out ${one ? `"${view.will_run_without[0]}"` : listOf(view.will_run_without)} until ${one ? 'its levels are' : 'their levels are'} set.`;
    // ⛔ A run that proceeds over a target it can't test never reads "can run" and then shows nothing (AIQ 5914209776):
    // the lead is DR row 4's own sentence.
    if (view.target_not_testable !== undefined) return leaveOut === '' ? view.target_not_testable : `${view.target_not_testable} The run will ${leaveOut}`;
    return leaveOut === '' ? 'The analysis can run now.' : `The analysis can run now; it will ${leaveOut}`;
  }
  const why = view.needs_from_user.slice(0, 2).map((i) => i.message.replace(/\s+$/, '')).join(' ');
  if (why !== '') return `The analysis can't run yet. ${why}`;
  // The refusal's own words may open by saying so already; never "can't … can't".
  const reason = withoutCantRunOpening(view.reason ?? '');
  return reason !== '' ? `The analysis can't run yet. ${reason}` : "The analysis can't run yet.";
}
