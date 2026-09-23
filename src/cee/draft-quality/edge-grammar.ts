/**
 * ⭐⭐ THE DRAFTER'S OWN EDGE GRAMMAR, MEASURED ON WHAT IT PRODUCED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS EXISTS FOR, measured on deployed staging `bdad785a`.
 *
 * The SAME brief, drafted four times, reached `status: ready` on two draws and
 * `needs_user_mapping` on the other two. Not a bad brief — a coin flip. Across
 * every capture taken (7+ drafts, ~25 options, 2 briefs) one predicate agreed
 * with the outcome 100% of the time:
 *
 *     an `option → risk` edge exists  ⟺  that option is NOT analysable
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A GRAMMAR VIOLATION AND NOT A PRODUCT DECISION — both
 * authorities were read before this file was written, and they AGREE.
 *
 *   · THE DRAFTER'S OWN CONTRACT forbids the edge. `prompts/defaults-v187.ts`
 *     enumerates ALLOWED EDGE PATTERNS — `option→factor` (structural,
 *     controllable only), `factor→risk` (causal), `risk→goal` (bridge) — and
 *     closes the list with the sentence "All other edge combinations are
 *     forbidden." `option→risk` is absent, and NONE of the prompt's own worked
 *     examples emits one. The mechanism it wants is `option → factor → risk`.
 *
 *   · THE VALIDATOR DELIBERATELY RETAINS IT. `ALLOWED_EDGES` in
 *     `validators/graph-validator.types.ts` carries
 *     `{ fromKind: "option", toKind: "risk" }` under the comment "Retained
 *     hypothesis; analysis readiness requires an intervention mapping."
 *
 * ⛔ THOSE TWO ARE NOT IN CONFLICT, AND READING THEM AS ONE RULE IS THE TRAP.
 * They are about DIFFERENT AUTHORS. The validator protects an edge somebody
 * ASSERTED — a user's hypothesis survives, and readiness honestly says it needs
 * a mapping. The prompt governs what the DRAFTER may assert unprompted. On turn
 * one nobody has asserted anything: the whole graph is drafter-authored by
 * construction, which is why this module is scoped to the draft seam and to
 * nothing else. It must never run over a graph a user has edited.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE MAY AND MAY NOT DO.
 *
 *   · IT COUNTS. It never mutates a graph, never drops an edge and never
 *     re-points one. Deletion was measured and REJECTED: of 12 illegal edges
 *     across three real captures only 4 were redundant (a legal
 *     `option→factor→…→risk` path already carried the claim), and in the two
 *     captures whose options were actually blocked, ZERO were. Dropping only
 *     the safe ones would have unblocked nothing; dropping the rest would have
 *     deleted a causal claim no other edge carries, and orphaned a risk node.
 *   · IT NEVER INVENTS THE MEDIATING FACTOR. Re-pointing `O→R` to `F→R` is
 *     unambiguous only when the option sets exactly one controllable factor.
 *     In the measured captures every option set two. Guessing is fabrication.
 *   · THE ONLY LEVER IT PULLS IS A REDRAW — the drafter is asked again, and
 *     told which rule of its own contract the last draw broke.
 */

/** One violation, named by the two node ids that form it. */
export interface EdgeGrammarViolation {
  readonly from: string;
  readonly to: string;
}

export interface EdgeGrammarFacts {
  /** Every drafter-authored `option → risk` edge in this draw. */
  readonly violations: readonly EdgeGrammarViolation[];
  /** Distinct options carrying at least one. This is the number that predicts
   *  how many options the readiness authority will refuse. */
  readonly optionsAffected: number;
  /** Total edges read. 0 means the graph was unreadable — see `readable`. */
  readonly edgeCount: number;
  /**
   * ⚠ FALSE WHEN THE SHAPE COULD NOT BE READ AT ALL, which is NOT the same as
   * "no violations". A caller that treats an unreadable graph as clean would
   * silently stop checking the moment the payload shape moved. Every consumer
   * here must branch on this before it branches on `violations.length`.
   */
  readonly readable: boolean;
}

const EMPTY: EdgeGrammarFacts = {
  violations: [],
  optionsAffected: 0,
  edgeCount: 0,
  readable: false,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Read the `option → risk` violations out of an unknown draft payload.
 *
 * Deliberately total and defensive: this runs on the success arm of the draft
 * path, so a throw here would break a draft that is otherwise shippable.
 * Anything it cannot read comes back `readable: false`.
 *
 * ⚠ `edge_type: "bidirected"` is EXCLUDED, matching the readiness authority's
 * own filter in `transforms/analysis-ready.ts`. A bidirected edge asserts an
 * unmeasured common cause, not an intervention, so it is not the claim the
 * refusal is about. Binding to the same discriminator is what keeps this
 * predicate and the refusal from drifting apart.
 */
export function readEdgeGrammarFacts(graph: unknown): EdgeGrammarFacts {
  const rec = asRecord(graph);
  if (!rec) return EMPTY;
  const nodes = rec.nodes;
  const edges = rec.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return EMPTY;

  const kindById = new Map<string, string>();
  for (const node of nodes) {
    const n = asRecord(node);
    if (!n) continue;
    const id = n.id;
    const kind = n.kind;
    if (typeof id === 'string' && typeof kind === 'string') kindById.set(id, kind);
  }

  const violations: EdgeGrammarViolation[] = [];
  const affected = new Set<string>();
  for (const edge of edges) {
    const e = asRecord(edge);
    if (!e) continue;
    const from = e.from;
    const to = e.to;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    if (e.edge_type === 'bidirected') continue;
    if (kindById.get(from) !== 'option') continue;
    if (kindById.get(to) !== 'risk') continue;
    violations.push({ from, to });
    affected.add(from);
  }

  return {
    violations,
    optionsAffected: affected.size,
    edgeCount: edges.length,
    readable: true,
  };
}

/**
 * Should a draw be redrawn on grammar grounds?
 *
 * ⚠ UNREADABLE IS NOT A TRIGGER. If the shape could not be read, the honest
 * answer is that nothing is known about this draw, and spending the user's
 * remaining budget on a guess is not a decision this module is entitled to
 * make. It ships what the drafter produced, exactly as today.
 */
export function violatesEdgeGrammar(facts: EdgeGrammarFacts): boolean {
  return facts.readable && facts.violations.length > 0;
}

/**
 * ⭐ WHICH DRAW SHIPS, and why this is not `isMaterallyRicher`.
 *
 * The draft-quality pass selects on COVERAGE, and coverage rewards MORE nodes —
 * the opposite direction from this question. Fusing the two selectors would
 * make a cleaner, smaller second draw lose to the thing it fixed. They answer
 * different questions and are deliberately kept apart (trap 21).
 *
 * The rule is the whole rule: FEWER VIOLATIONS WINS, and a TIE KEEPS THE FIRST.
 *
 * ⛔ A TIE MUST KEEP THE FIRST DRAW, NOT THE SECOND. The first draw is the one
 * the rest of the pipeline has already run its passes over, and an equal-scoring
 * swap would churn the user's model for no measured gain while making the
 * shipped result depend on which sample landed second. Returning `false` on
 * equality is therefore load-bearing, not a default.
 */
export function secondDrawIsCleaner(
  first: EdgeGrammarFacts,
  second: EdgeGrammarFacts,
): boolean {
  if (!second.readable) return false;
  if (!first.readable) return false;
  return second.violations.length < first.violations.length;
}

/**
 * The corrective directive handed to the drafter for the redraw.
 *
 * ⚠ SYSTEM-AUTHORED AND CONTENT-FREE, to the same standard as
 * `buildPriorAttemptDirective`: it carries our own sentences, the rule the
 * drafter's own contract already states, and a COUNT. It carries no node ids,
 * no labels and no user text, so it cannot smuggle untrusted content into the
 * next prompt, and it cannot leak one user's model into another's.
 *
 * ⛔ IT DOES NOT ASK FOR THE RISK TO BE DROPPED. Telling a drafter to delete a
 * risk to satisfy a shape rule is how a model learns to hide a downside — the
 * exact harm the prompt's "decorative risk does not count" rule guards against.
 * It asks for the MECHANISM the contract already requires.
 */
export function buildEdgeGrammarDirective(facts: EdgeGrammarFacts): string {
  const n = facts.violations.length;
  const plural = n === 1 ? 'link' : 'links';
  return [
    `Your previous draft drew ${n} direct option→risk ${plural}, which the ALLOWED EDGE PATTERNS rule forbids.`,
    'An option never links straight to a risk. Route it through the controllable factor the option actually sets: option → factor → risk.',
    'Keep every risk you identified and keep its bridge to the goal — do NOT delete a risk to satisfy this rule, and do not weaken it.',
    'If you cannot name the controllable factor that carries the effect, leave the risk linked only from the factors that already influence it.',
  ].join(' ');
}
