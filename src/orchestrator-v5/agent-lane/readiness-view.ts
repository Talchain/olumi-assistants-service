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
}

const UNCHECKED: ReadinessView = { checked: false, needs_from_user: [], olumi_can_offer: [], will_run_without: [] };

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
  for (const issue of verdict.readiness_issues) {
    const item = itemOf(issue);
    if (item === undefined) continue;
    const isDemand = issue.repairability === 'human_input_required' && issue.obligation !== 'offered' && issue.waived_by_exclusion !== true;
    if (isDemand) needs.push(item);
    else if (issue.obligation === 'offered') offers.push(item);
  }
  /**
   * ⛔ A BLOCK WITH NO DEMAND STILL HAS A REASON (served f-20260926T020217Z, CEE ef99a97): two options set identical
   * levels, so the verdict is `may_run: false` — and its reason rides only as a critique
   * (`IDENTICAL_OPTION_INTERVENTIONS`), not a readiness issue. Reading issues alone handed the Agent "can't run" with
   * no why. When the verdict blocks and names no demand, its own critiques are the reason, in its own words.
   */
  if (verdict.may_run === false && needs.length === 0) {
    for (const c of (verdict as { critiques?: readonly { message?: unknown }[] }).critiques ?? []) {
      const item = itemOf({ message: String(c?.message ?? '') });
      if (item !== undefined) needs.push(item);
    }
  }
  const labelOf = new Map<string, string>();
  for (const n of ((rawGraph as { nodes?: unknown }).nodes as { id?: unknown; label?: unknown }[] | undefined) ?? []) {
    if (typeof n?.id === 'string') labelOf.set(n.id, typeof n.label === 'string' && n.label !== '' ? n.label : n.id);
  }
  const excluded = (verdict.scaffold_plan.excluded_option_ids ?? []).map((id) => labelOf.get(id) ?? id);
  return { checked: true, may_run: verdict.may_run, needs_from_user: dedupe(needs), olumi_can_offer: dedupe(offers), will_run_without: excluded };
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
export function readinessSentence(view: ReadinessView): string {
  if (!view.checked) return 'I could not check whether the analysis can run yet.';
  if (view.may_run === true) {
    if (view.will_run_without.length === 0) return 'The analysis can run now.';
    const one = view.will_run_without.length === 1;
    return `The analysis can run now; it will leave out ${one ? `"${view.will_run_without[0]}"` : listOf(view.will_run_without)} until ${one ? 'its levels are' : 'their levels are'} set.`;
  }
  const why = view.needs_from_user.slice(0, 2).map((i) => i.message.replace(/\s+$/, '')).join(' ');
  return why !== '' ? `The analysis can't run yet. ${why}` : "The analysis can't run yet.";
}
