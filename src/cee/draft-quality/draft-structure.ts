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
 * came back with `interventions: {}` and `unresolved_targets: ["49"]`, and the
 * product asked the user:
 *
 *     "Which factor does "49" correspond to in the decision model?"
 *
 * …while a factor called **Pro Plan Price** sat in the same graph.
 *
 * ⛔⛔ THE DRAFTER DID NOT MINT THAT TARGET, AND AN EARLIER VERSION OF THIS FILE
 * SAID IT DID. Found by independent review, not by these tests.
 *
 * `"49"` is CEE'S OWN token. `intervention-extractor.ts:1243` returns early
 * whenever the drafter supplied a V4 intervention; only when it supplied NONE
 * does the legacy path reach `extractRawInterventions(optionLabel, …)` (`:1261`),
 * which tokenises the OPTION'S LABEL and emits the unmatched token as an
 * `unresolved_target` (`:1425`). In run 7 the drafter had wired
 * option → Pro Plan Price correctly.
 *
 * So the drafter's real error is the one UPSTREAM of that fallback: **an option
 * states a value and carries no intervention for it.** Telling it anything else
 * would break this module's own rule — never correct an error the model did not
 * make.
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
  /**
   * ⭐⭐ THE NUMBER THE REDRAW SELECTS ON: how many DISTINCT OPTIONS this draw
   * would have refused, counting an option once however many defects it carries.
   *
   * ⛔ IT REPLACED `totalViolations`, AND THE DIFFERENCE IS NOT COSMETIC. Edge
   * violations counted per EDGE while unresolvable targets counted per distinct
   * STRING, so the score mixed two units and a draw that refused MORE options
   * could win: measured on a banked draw, one refused option scored 3. Found by
   * independent review. Selecting on the refused-option count makes the score
   * the outcome the user actually meets.
   */
  readonly refusedOptions: number;
  /** Edge violations + unresolvable target strings. TELEMETRY ONLY — it mixes
   *  two units and must never decide which draw ships. */
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
      refusedOptions: 0,
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
  const optionsWithBadTarget = new Set<string>();
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
    if (hit) {
      optionsHit += 1;
      // The option's own id, so the refused-option union below counts an option
      // carrying BOTH defects exactly once.
      if (typeof o.id === 'string') optionsWithBadTarget.add(o.id);
    }
  }

  const unresolvableTargets = [...unresolvable].sort();

  // ⭐ ONE OPTION, COUNTED ONCE. `violations[].from` is the offending option's
  // own id, so the union is over option identity rather than over defect
  // instances — an option that both wires to a risk AND states an unbacked
  // value costs the user one refused option, not two.
  const refused = new Set<string>(optionsWithBadTarget);
  for (const v of edgeGrammar.violations) refused.add(v.from);

  return {
    edgeGrammar,
    unresolvableTargets,
    optionsWithUnresolvableTarget: optionsHit,
    refusedOptions: refused.size,
    totalViolations: edgeGrammar.violations.length + unresolvableTargets.length,
    readable: true,
  };
}

/** Should this draw be redrawn on structural grounds? Unreadable is never a
 *  trigger — see `violatesEdgeGrammar` for the same reasoning. */
export function violatesDraftStructure(facts: DraftStructureFacts): boolean {
  return facts.readable && facts.refusedOptions > 0;
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
  return second.refusedOptions < first.refusedOptions;
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
  // ⚠ OPTIONS, NOT STRINGS. `unresolvableTargets` is a set of distinct tokens;
  // the sentence below is about how many OPTIONS are affected, and using the
  // token count would state a number the drafter cannot reconcile with its own
  // output.
  const targets = facts.optionsWithUnresolvableTarget;
  if (targets > 0) {
    parts.push(
      `Your previous draft left ${targets} ${targets === 1 ? 'option that states a value' : 'options that state a value'} in ${targets === 1 ? 'its' : 'their'} label and ${targets === 1 ? 'carries' : 'carry'} no intervention for it.`,
      'EVERY option that names a value must carry an intervention for that value, targeting a controllable FACTOR by the id it holds in your own node list.',
      'Without an intervention the value cannot be tied back to any factor, and the option cannot be analysed at all.',
    );
  }
  return parts.join(' ');
}
