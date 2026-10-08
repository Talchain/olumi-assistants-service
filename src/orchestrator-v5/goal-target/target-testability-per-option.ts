/**
 * ⭐ S-E GOALS, SLICE 6 — THE TARGET-TESTABILITY REASON, SCOPED PER OPTION (lane GOALS, DL 0fd71f routing 7 Oct; Science
 * finding on served staging B9, CEE df15c8c).
 *
 * Served: the Run's `GOAL_FIGURES_TARGET_NOT_TESTABLE` warning carried ONE Run-wide message, and the per-option panel
 * (DGAI `goalOptionCoverage.tsx`) put it beside every option it could not show — so "‘Carry on as now’: not shown yet. …
 * it needs a size for the links from Loyalty app deployment to …" named ANOTHER option's link beside the baseline.
 *
 * ONE scoping, read by BOTH surfaces: the chat's spoken `say` (`scope-target-not-testable.ts`) and the panel's
 * `per_option[option_id].message` (this module) come from the same per-option failures (`scopedFailuresFor`):
 *  · a failure about the goal itself (its level, its comparator, its unit: cases a, b, d) is every option's;
 *  · a link that is not sized (case c) is an option's only when it lies on THAT option's own path to the goal.
 * An option left with no failure of its own (the baseline: it moves nothing) says the DL's words (ruling 7 Oct 12:2xZ):
 * it needs nothing more of its own and waits for the others. It is still withheld: no licence changes here.
 */
import { asAnalysed } from '../../orchestrator/context/placeholder-parts.js';
import {
  reachedGoalPaths,
  targetBecause,
  untestableTargetParts,
  type TargetTestability,
  type TargetTestabilityFailure,
} from '../admission/target-testability.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** DL ruling (7 Oct 12:2xZ): the baseline's own words, after the panel's "‘<label>’: not shown yet." */
export const BASELINE_WAITS_FOR_OTHERS =
  'It needs nothing more of its own; it waits until the other options can be tested against your target, so all are shown on the same footing.';

/** The per-option message's cap: the Run warning's own carrier cap (`TARGET_TESTABLE_SENTENCE_CAP`, 388) + "Not shown. ". */
const PER_OPTION_SENTENCE_CAP = 388;

/** An option's own reason that cannot be said in the cap: the Run warning's own fallback, in the option's register. It
 * names no link, so it can never name another option's. */
export const OWN_REASON_FALLBACK = "It can't yet be tested against your target.";

/**
 * The failures that are THIS option's: every goal-level failure, and each unsized-link failure narrowed to the links on
 * `pathLinks` (the option's own reached path; empty for an option that moves nothing). A narrowed link failure names its
 * first remaining link as its lever and end, in the graph's labels.
 */
export function scopedFailuresFor(
  failures: readonly TargetTestabilityFailure[],
  pathLinks: ReadonlyArray<{ readonly from: string; readonly to: string }>,
  labelOf: (id: string) => string | undefined,
): TargetTestabilityFailure[] {
  const onPath = new Set(pathLinks.map((l) => JSON.stringify([l.from, l.to])));
  return failures.flatMap((f) => {
    if (f.case !== 'c') return [f];
    const links = (f.links ?? (f.link === undefined ? [] : [f.link])).filter((l) => onPath.has(JSON.stringify([l.from, l.to])));
    if (links.length === 0) return [];
    const link = links[0]!;
    return [{ ...f, links, link, lever: labelOf(link.from), link_to: labelOf(link.to) }];
  });
}

/** The option's own sentence (no "Not shown."): its target, what it needs, and the one question; `null` when unsayable. */
function ownSentence(graph: unknown, verdict: Extract<TargetTestability, { kind: 'not_testable' }>, namedLinkCount: number): string | null {
  const parts = untestableTargetParts(graph, verdict, namedLinkCount);
  if (parts === null) return null;
  return `It can't yet be tested against your target (${parts.target}), because ${targetBecause(parts)}.${parts.question !== null ? ` ${parts.question}` : ''}`;
}

/**
 * Each option's own reached path to the goal: the admission walk (`reachedGoalPaths`) over the ANALYSED graph, seeded
 * with the option's interventions, under this Run's identity evaluations. The one path read for the chat's `say` and the
 * panel's `per_option`.
 */
export function optionPathsOf(
  graph: unknown, optionIds: readonly string[], identityEvaluations?: readonly unknown[], goalId?: unknown,
): Map<string, Array<{ from: string; to: string }>> {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return new Map();
  const nodes = graph.nodes.filter(isRec);
  const { paths } = reachedGoalPaths(asAnalysed({ ...graph, nodes: graph.nodes }), optionIds, new Map(optionIds.map((id) => {
    const option = nodes.find((n) => n.kind === 'option' && n.id === id);
    return [id, isRec(option?.interventions) ? Object.keys(option.interventions) : []] as const;
  })), identityEvaluations, goalId);
  return new Map(paths.map((p) => [p.option_id, p.links.flatMap((l) =>
    (typeof l.from === 'string' && typeof l.to === 'string' ? [{ from: l.from, to: l.to }] : []))] as const));
}

/**
 * `{option_id: {message}}` for each id: "Not shown. " + the option's own reason, in the Run warning's register (its
 * readers strip "Not shown."). An option whose reason cannot be said in the cap says {@link OWN_REASON_FALLBACK}, never
 * the Run-wide message (which may name another option's link). `{}` for a verdict that is not `not_testable`.
 */
export function perOptionTargetReasons(
  graph: unknown,
  verdict: TargetTestability,
  pathsByOption: ReadonlyMap<string, ReadonlyArray<{ readonly from: string; readonly to: string }>>,
  optionIds: readonly string[],
): Record<string, { readonly message: string }> {
  if (verdict.kind !== 'not_testable' || !isRec(graph) || !Array.isArray(graph.nodes)) return {};
  const nodes = graph.nodes.filter(isRec);
  const labelOf = (id: string): string | undefined => {
    const node = nodes.find((n) => n.id === id);
    return typeof node?.label === 'string' && node.label.trim() !== '' ? node.label.trim() : undefined;
  };
  const out: Record<string, { message: string }> = {};
  for (const id of optionIds) {
    const failures = scopedFailuresFor(verdict.failures, pathsByOption.get(id) ?? [], labelOf);
    let said: string | null = null;
    if (failures.length === 0) {
      said = BASELINE_WAITS_FOR_OTHERS;
    } else {
      const scoped = { ...verdict, failures };
      for (let count = 3; count >= 1 && said === null; count -= 1) {
        const s = ownSentence(graph, scoped, count);
        if (s !== null && s.length <= PER_OPTION_SENTENCE_CAP) said = s;
      }
    }
    Object.defineProperty(out, id, { enumerable: true, configurable: true, writable: true, value: { message: `Not shown. ${said ?? OWN_REASON_FALLBACK}` } });
  }
  return out;
}

/** {@link perOptionTargetReasons} over the options' own paths ({@link optionPathsOf}): the Run producer's one call. */
export function perOptionTargetReasonsForRun(
  graph: unknown, verdict: TargetTestability, optionIds: readonly string[], identityEvaluations?: readonly unknown[],
): Record<string, { readonly message: string }> {
  if (verdict.kind !== 'not_testable') return {};
  return perOptionTargetReasons(graph, verdict, optionPathsOf(graph, optionIds, identityEvaluations, verdict.goal_id), optionIds);
}
