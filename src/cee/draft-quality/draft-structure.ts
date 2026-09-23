/**
 * ⭐⭐ THE SECOND BLOCKING MECHANISM, AND IT IS NOT AN EDGE.
 *
 * `edge-grammar.ts` counts one thing: an `option → risk` link the drafter's own
 * contract forbids. That was measured as THE predictor of an unanalysable
 * option — and at n=8 on deployed staging it stopped being the whole story.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MEASUREMENT, 8 draws of one brief against `cee-staging`, 23 Sep 2026.
 *
 *   ready:                        2 / 8
 *   option→risk violations:       5 / 8
 *   NON-NODE intervention target: 4 / 8
 *   union of the two:             6 / 6 of the blocked runs
 *
 * ⛔ AND THE RUN THAT REFUTED THE EARLIER CLAIM. Run 7 carried ZERO edge
 * violations and still blocked. Its option `Raise Pro Plan from £49 to £59`
 * came back with `interventions: {}` and `unresolved_targets: ["49"]` — the
 * literal `49`, which is not a node id in that graph. The product then asked
 * the user:
 *
 *     "Which factor does "49" correspond to in the decision model?"
 *
 * …while a factor called **Pro Plan Price** sat in the same graph. The number
 * was read out of "from £49 to £59" and recorded as a TARGET.
 *
 * ⚠ The earlier "option→risk agrees with the refusal 100% of the time" was
 * true of the captures it was measured on and is FALSE at n=8: 7/8. It is
 * corrected here rather than quietly dropped, because the number was published.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS BELONGS TO THE SAME REDRAW AND NOT A NEW ONE.
 *
 * Both are the same shape: the drafter emitted something STRUCTURALLY INVALID
 * against the graph it built in the same breath, stochastically, on a draw that
 * otherwise succeeded. Both are cheap to detect without a model call, both are
 * fixed by asking the drafter again, and neither may be repaired by guessing —
 * binding `"49"` to `Pro Plan Price` is a judgement about the user's meaning,
 * and this module does not make it.
 *
 * ⛔ WHAT IS NOT CLAIMED. The duplicate option beside it (`Raise Pro Plan to
 * £59` already existed) is visible in the same capture and is NOT measured
 * here: "these two options are the same decision" needs a semantic judgement
 * this module has no basis for. Only the structural fact is counted — a target
 * that names nothing in the graph.
 */

import { readEdgeGrammarFacts, type EdgeGrammarFacts } from './edge-grammar.js';

export interface DraftStructureFacts {
  readonly edgeGrammar: EdgeGrammarFacts;
  /**
   * Distinct `unresolved_targets` entries that are not node ids in this graph.
   * Sorted, so two draws of the same defect compare equal and the log line is
   * stable.
   */
  readonly unresolvableTargets: readonly string[];
  /** Options carrying at least one unresolvable target. */
  readonly optionsWithUnresolvableTarget: number;
  /** Edge violations + unresolvable targets. The number the redraw selects on. */
  readonly totalViolations: number;
  /** False when the graph's shape could not be read — never "clean". */
  readonly readable: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Read both structural defects out of a successful draft body.
 *
 * ⚠ IT TAKES THE WHOLE BODY, NOT THE GRAPH. The edge violation lives in
 * `body.graph`; the unresolvable target lives in `body.analysis_ready`, which
 * is a DERIVED payload. A function handed only the graph could never see the
 * second defect, and that is exactly how it went unnoticed.
 *
 * Total and defensive: this runs on the success arm of the draft path, so
 * anything unreadable comes back `readable: false` rather than throwing.
 */
export function readDraftStructureFacts(body: unknown): DraftStructureFacts {
  const rec = asRecord(body);
  const graph = rec ? (rec.graph ?? rec) : null;
  const edgeGrammar = readEdgeGrammarFacts(graph);

  if (!edgeGrammar.readable) {
    return {
      edgeGrammar,
      unresolvableTargets: [],
      optionsWithUnresolvableTarget: 0,
      totalViolations: 0,
      readable: false,
    };
  }

  const graphRec = asRecord(graph);
  const nodeIds = new Set<string>();
  for (const node of (graphRec?.nodes as unknown[]) ?? []) {
    const n = asRecord(node);
    if (n && typeof n.id === 'string') nodeIds.add(n.id);
  }

  // ⚠ READ ONLY FROM `analysis_ready`, never from a loose `options` anywhere in
  // the body. `analysis_ready` is the payload the readiness authority itself
  // produced, so this counts the refusal the user will actually meet. A
  // best-effort search of the whole body would find mirrors that do not decide
  // anything and would drift from the refusal it is meant to predict.
  const analysisReady = asRecord(rec?.analysis_ready);
  const options = Array.isArray(analysisReady?.options) ? analysisReady.options : [];

  const unresolvable = new Set<string>();
  let optionsHit = 0;
  for (const option of options) {
    const o = asRecord(option);
    if (!o) continue;
    // ⛔ ONLY A REFUSED OPTION IS INSPECTED, and this line is the whole of that
    // rule. A `ready` option carrying a stale `unresolved_targets` entry costs
    // the user NOTHING — it is analysed either way — so counting it would fund
    // a redraw for a defect with no victim, and would make the violation count
    // stop tracking the refusal it exists to predict.
    if (o.status === 'ready') continue;
    const targets = Array.isArray(o.unresolved_targets) ? o.unresolved_targets : [];
    let hit = false;
    for (const target of targets) {
      if (typeof target !== 'string') continue;
      if (nodeIds.has(target)) continue;   // a real node — the other mechanism, or a real gap
      unresolvable.add(target);
      hit = true;
    }
    if (hit) optionsHit += 1;
  }

  const unresolvableTargets = [...unresolvable].sort();
  return {
    edgeGrammar,
    unresolvableTargets,
    optionsWithUnresolvableTarget: optionsHit,
    totalViolations: edgeGrammar.violations.length + unresolvableTargets.length,
    readable: true,
  };
}

/** Should this draw be redrawn on structural grounds? Unreadable is never a
 *  trigger — see `violatesEdgeGrammar` for the same reasoning. */
export function violatesDraftStructure(facts: DraftStructureFacts): boolean {
  return facts.readable && facts.totalViolations > 0;
}

/**
 * ⭐ FEWER VIOLATIONS WINS, A TIE KEEPS THE FIRST — the same rule as
 * `secondDrawIsCleaner`, now over both mechanisms.
 *
 * ⛔ THE TWO ARE SUMMED, NOT RANKED. Trading one edge violation for one
 * unresolvable target is not progress, and a lexicographic rule would let a
 * draw that fixed the cheaper defect win while the user stayed just as blocked.
 * Both cost the user exactly one refused option.
 */
export function secondDrawIsStructurallyCleaner(
  first: DraftStructureFacts,
  second: DraftStructureFacts,
): boolean {
  if (!first.readable || !second.readable) return false;
  return second.totalViolations < first.totalViolations;
}

/**
 * The corrective directive, extended to name whichever defects this draw
 * actually has — never both when only one is present, because a directive that
 * corrects an error the drafter did not make teaches it to avoid a shape that
 * was fine.
 *
 * ⚠ SYSTEM-AUTHORED AND CONTENT-FREE. Counts and our own sentences only: no
 * node ids, no labels, and — deliberately — **not the offending target string**,
 * which came from the user's brief.
 */
export function buildDraftStructureDirective(facts: DraftStructureFacts): string {
  const parts: string[] = [];
  const edges = facts.edgeGrammar.violations.length;
  if (edges > 0) {
    parts.push(
      `Your previous draft drew ${edges} direct option→risk ${edges === 1 ? 'link' : 'links'}, which the ALLOWED EDGE PATTERNS rule forbids.`,
      'An option never links straight to a risk. Route it through the controllable factor the option actually sets: option → factor → risk.',
      'Keep every risk you identified and keep its bridge to the goal — do NOT delete a risk to satisfy this rule, and do not weaken it.',
    );
  }
  const targets = facts.unresolvableTargets.length;
  if (targets > 0) {
    parts.push(
      `Your previous draft left ${targets} intervention ${targets === 1 ? 'target' : 'targets'} that ${targets === 1 ? 'does' : 'do'} not name any node in the graph you built.`,
      'Every intervention must target a controllable FACTOR that exists in your own node list, by its id — never a bare number, a price, or a word lifted from the brief.',
      'If an option states a value, put the value in the intervention and point the target at the factor that value belongs to.',
    );
  }
  return parts.join(' ');
}
