/**
 * ⭐⭐ REPHRASE ABSORPTION — an obvious restatement of the user's own option may
 * not become a second canonical option.
 *
 * ── THE WITNESSED DEFECT (first-use-acceptance-2026-08-14, run-2, A_hiring-2) ──
 *
 *     brief : "Should I hire a Tech lead or two developers to increase productivity?"
 *     ⇒ options[]:
 *         "two developers"                        provenance from_brief   (the user's words)
 *         "Hire Two Developers Only"              provenance ai_inferred  (the model's rephrase)
 *         "Hire One Developer Now, Defer Second"  provenance ai_inferred  (a REAL alternative)
 *         "hire a Tech lead"                      provenance from_brief   (the user's words)
 *
 * The first two are ONE option wearing two labels, and they shipped as two
 * ranked alternatives. The existing intervention-signature dedup cannot see the
 * pair: at draft time the model's twin carried `interventions: {}` while the
 * user's carried one, so their signatures differ by construction — the dedup is
 * looking at the one field that is guaranteed not to match on this defect.
 *
 * The THIRD option is the reason this file is conservative rather than clever.
 * "Hire One Developer Now, Defer Second" is a genuinely distinct staged-hire
 * alternative and must NEVER be absorbed. Merging it would delete a real branch
 * of the user's decision, silently, and that is a strictly worse product than
 * the duplicate we are fixing.
 *
 * ── ⚠ THE ERROR DIRECTION IS THE WHOLE DESIGN ──────────────────────────────
 *
 * The two harms are NOT symmetric (trap 22b — one predicate, two opposite
 * harms), so they are not traded against each other here:
 *
 *   - FAILING TO MERGE a genuine rephrase leaves today's defect in place. The
 *     user sees a duplicate. Nothing is lost, and they can delete one.
 *   - MERGING a genuine alternative DESTROYS a branch of their reasoning. It is
 *     unrecoverable from the UI and invisible in the result.
 *
 * So every gate below is written to DECLINE on doubt, and every unknown input
 * resolves to "keep both". `mergeRephrasedOptions` can only ever remove options
 * it is positively certain about; it has no permissive default anywhere.
 *
 * ── ⚠⚠ WHY AUTHORSHIP IS TAKEN FROM `node.provenance` AND NOWHERE ELSE ──────
 *
 * Derived at the banked captures (39 option nodes across 12 draws), because two
 * plausible-looking fields are WRONG here and a lane reaching for either would
 * ship a merge gate that mis-reads authorship on most of the corpus:
 *
 *   - `options[].extraction_metadata.source` reads `cee_hypothesis` for 34 of
 *     39 — including every single `from_brief` option in the A/B/C scenarios.
 *     Keying on it misclassifies 21 of 26 user-authored options.
 *   - the response's top-level `graphReady.nodes` copy reads `ai_inferred` for
 *     ALL 39 — the same option (`be215545`, "two developers") reads `from_brief`
 *     in `draft_graph.nodes` and `ai_inferred` there.
 *
 * `nodes[].provenance` is the field that tracks brief-borne origin, and it is
 * derived immediately above this call by `bindOptionLabelToBrief` — the single
 * authority (`provenance/brief-binding.ts`). That binding is CONTAINMENT, and
 * containment is untruthful in both directions:
 *
 *   - a user option they reworded reads `ai_inferred`  (under-claims)
 *   - a model option whose label happens to be a brief substring reads
 *     `from_brief`                                      (over-claims)
 *
 * ⭐ THIS FILE DOES NOT NEED IT TO BE RIGHT. The gate requires EXACTLY ONE
 * `from_brief` and EXACTLY ONE `ai_inferred`, so BOTH error directions collapse
 * the pair to same-provenance, and same-provenance never merges:
 *
 *     user option mis-read as ai_inferred  ⇒ two ai_inferred ⇒ KEEP BOTH
 *     model option mis-read as from_brief  ⇒ two from_brief  ⇒ KEEP BOTH
 *
 * A wrong authorship read costs us the fix, never the user's alternative. That
 * is the only property this module claims about provenance, and it is a
 * structural property of the gate rather than a claim about the binder.
 */

import type { NodeV3T, OptionV3T, EdgeV3T, ValidationWarningV3T } from "../../schemas/cee-v3.js";

/**
 * Code for the record a merge emits. ⚠ NOT a user notice on the draft turn —
 * `validation_warnings` has no wire carrier there (see the header).
 */
export const OPTION_REPHRASE_ABSORBED = "OPTION_REPHRASE_ABSORBED";

/**
 * Closed-class English function words, dropped before comparison.
 *
 * ⚠ DELIBERATELY CLOSED-CLASS ONLY. This list is safe to hand-write precisely
 * because it is a closed set of the language (trap 12 — a hand-maintained list
 * that mirrors an OPEN set drifts; one that mirrors a CLOSED set cannot).
 *
 * ⚠ AND NOTE WHAT IS ABSENT, ON PURPOSE: `not`, `no`, `never`, `without`,
 * `instead`, `rather`. Negation and contrast are CONTENT here. Dropping them
 * would make "do not hire" and "hire" compare equal, which is the single
 * worst merge this module could make.
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "our", "my", "your", "their", "its",
  "we", "us", "i", "you", "they", "it",
  "to", "of", "for", "in", "on", "at", "by", "with", "from", "into",
  "and", "or", "as", "that", "this", "these", "those",
  "is", "are", "be", "am", "was", "were", "been",
  "has", "have", "had",
]);

/**
 * ⭐⭐ THE ELABORATIVE ALLOW-LIST — AN ALLOW-LIST, NOT A DENY-LIST, AND THAT
 * CHOICE IS THE SAFETY ARGUMENT.
 *
 * When one label contains the other, the surplus tokens decide whether the
 * longer label is the SAME option said at greater length, or a DIFFERENT one.
 * Only tokens named here may appear in that surplus.
 *
 * A deny-list ("block quantities, magnitudes, sequencing…") was the obvious
 * shape and is rejected: a token nobody thought to add would PERMIT a merge,
 * so every gap in the list destroys a user's alternative. With an allow-list a
 * gap merely declines a merge — the direction that loses nothing. The list is a
 * hand-maintained mirror either way; this orientation makes its drift harmless.
 *
 * ⚠ SO DO NOT ADD A WORD HERE TO MAKE A CASE PASS. Every entry must be a word
 * whose presence cannot change WHICH option is meant. Quantities (`two`,
 * `single`), magnitudes (`small`, `large`, `aggressive`), sequencing (`now`,
 * `defer`, `staged`, `phased`), scope (`partial`, `full`) and negation are all
 * absent by design, and `__tests__/option-rephrase-merge.corpus.test.ts` asserts
 * this list is DISJOINT from an explicit discriminator corpus — so adding one
 * of them here REDs immediately rather than being discovered in a capture.
 *
 * ⭐⭐ AND THE STRONGER RULE, ADDED 14 Aug 2026: **EVERY ENTRY MUST BE EARNED.**
 * The corpus ablates each entry in turn and requires that removing it BREAKS at
 * least one must-merge case. The list went 31 → 23 → 6 under that guard: the
 * status-quo verbs were removed because they were WRONG, and seventeen more
 * because they were merely UNUSED. Both cuts matter, and the second is the
 * general defence — the four false merges the review found came from words
 * nothing required, so nothing objected to them. An unearned entry is pure
 * attack surface with no demonstrated benefit; a missing one only declines a
 * merge. When a real capture needs a word, it arrives WITH the case that earns
 * it, never on its own.
 */
const ELABORATIVE_MODIFIERS: ReadonlySet<string> = new Set([
  // Domain action verbs that name ACQUIRING the thing the option names. An
  // option is the thing done; naming the doing does not change the thing.
  // "two developers" and "hire two developers" are one option.
  "hire", "hiring", "adopt",
  // Neutral nominal fillers — they name the CATEGORY, never the member.
  "option", "approach",
  // Neutral restrictive, witnessed in "Hire Two Developers Only".
  //
  // ⚠ CONDITIONAL ON MUTUAL EXCLUSIVITY of the option set, which holds for
  // options under one decision: the bare label already excludes its siblings,
  // so `Only` restates that exclusion rather than adding one. A portfolio- or
  // combination-style option set would break this, and it would have to go.
  // Named because the condition is invisible from the tokens alone.
  "only",
]);

/**
 * ⭐⭐ THE STATUS-QUO VERBS ARE NOT ELABORATIVE — REMOVED 14 Aug 2026 AFTER AN
 * INDEPENDENT CORPUS PROVED THEY MERGE GENUINE ALTERNATIVES.
 *
 * `keep`, `keeping`, `retain`, `retaining` and `continue` were on the list above
 * on the reasoning that they name "the doing" of the option. **That reasoning was
 * wrong, and it is worth naming why, because the same mistake is available for
 * any verb.** These verbs do not name the doing of the thing — they name
 * PERSISTING WITH a thing you already have, which is a DIFFERENT ACTION from
 * acquiring it. In a hiring brief, "two developers" is the hire; "Keep Two
 * Developers" is the status quo. They are the two sides of the decision.
 *
 * Demonstrated by execution through `mergeRephrasedOptions`, not argued: one
 * canonical "two developers" with twins "Hire Two Developers" AND "Keep Two
 * Developers" absorbed BOTH — two different actions folded into one option. At
 * most one of them can be a rephrase, so at least one absorption destroyed an
 * alternative. No context is needed for that form of the argument.
 *
 * ⚠ AND THE COMPOSITIONAL LESSON, which is the durable one: allow-listed words
 * STACK. "Keep Hiring Two Developers" and "Choose To Keep Two Developers" each
 * built a discriminator out of TWO individually-allowed tokens. **An entry is
 * safe only if it is safe in every combination with every other entry**, and a
 * per-word review cannot see that. The mitigations are the ablation guard below
 * (no unearned entries) and a corpus that includes stacked surplus.
 *
 * This set exists so the removal is a DECISION with a reason attached rather
 * than an absence a later lane "restores" — the corpus test asserts every member
 * is refused as a surplus token.
 */
const REFUSED_STATUS_QUO_VERBS: readonly string[] = [
  "keep", "keeping", "retain", "retaining", "continue", "continuing",
  "maintain", "maintaining", "stay", "remain", "preserve",
];

/** Tokens that are pure punctuation/empty after normalisation are dropped. */
function tokenise(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9%£$]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * ⭐⭐ THERE IS DELIBERATELY NO PLURAL FOLD. REMOVED 14 Aug 2026; DO NOT RESTORE.
 *
 * A `foldPlural` step ("developers" → "developer") was here, justified as
 * symmetric and therefore harmless. **It was neither necessary nor harmless.**
 *
 *  - NOT NECESSARY, measured: disabling it left the whole suite GREEN, 67/67,
 *    including the witnessed pair — because a rephrase of a plural label is
 *    almost always ALSO plural ("two developers" / "Hire Two Developers Only").
 *    The fold was carrying no case at all.
 *  - NOT HARMLESS: an independent corpus showed `"hire a developer"` absorbing
 *    `"Hire Developers"` — the article `a` dropped as a function word and the
 *    plural folded away, **erasing a headcount distinction**. One developer and
 *    several developers are different options, and the two normalisation steps
 *    composed to delete exactly the token that said so.
 *
 * ⭐ THE RULE THIS ESTABLISHES: in English a plural IS often count-bearing, so
 * folding it is a semantic change wearing the costume of a normalisation. The
 * symmetry argument ("applied to both sides, so it cannot make two different
 * words equal") is TRUE and IRRELEVANT — the harm was never two different words
 * colliding, it was one word losing the meaning that distinguished the options.
 * A normalisation is safe only if the thing it discards cannot be a
 * discriminator; grammatical number can be.
 *
 * The cost is paid in KNOWN-DROPPED: genuine singular/plural rephrases now
 * decline. That is the direction that loses nothing.
 */

/** Content tokens: normalised and function words removed. No stemming — see above. */
function contentTokens(label: string | null | undefined): Set<string> {
  if (typeof label !== "string") return new Set();
  const out = new Set<string>();
  for (const token of tokenise(label)) {
    if (FUNCTION_WORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

/**
 * ⭐ THE SPECIFICITY FLOOR, and it is a floor against COINCIDENCE, not a model
 * of meaning — the same honest framing as `MIN_QUOTE_CHARS` in brief-binding.
 *
 * A one-word label ("hire", "price", "no") is contained by a great many longer
 * labels for reasons that have nothing to do with being the same option. Two
 * content words is the point at which containment starts being evidence rather
 * than accident. It is not tuned: it is the smallest number greater than one.
 */
const MIN_SHARED_CONTENT_TOKENS = 2;

/**
 * The allow-list the predicate uses by default. Exported so the corpus test can
 * ABLATE it — see `isHighConfidenceRephrase`'s third parameter.
 */
export const DEFAULT_ELABORATIVE_MODIFIERS = ELABORATIVE_MODIFIERS;

/** The status-quo verbs, exported so the corpus can assert each is refused. */
export const REFUSED_STATUS_QUO_VERBS_FOR_TEST = REFUSED_STATUS_QUO_VERBS;

/**
 * Is `twinLabel` a high-confidence rephrase of `canonicalLabel`?
 *
 * Pure and exported so the corpus test can drive it directly.
 *
 * `elaborative` exists ONLY so the corpus can prove **every allow-list entry is
 * EARNED** — removing any one of them must break at least one must-merge case.
 * That guard is what stops the list re-growing an unearned entry, which is
 * exactly how the status-quo verbs got in: nothing required them, so nothing
 * objected. Production always uses the default.
 */
export function isHighConfidenceRephrase(
  canonicalLabel: string | null | undefined,
  twinLabel: string | null | undefined,
  elaborative: ReadonlySet<string> = ELABORATIVE_MODIFIERS,
): boolean {
  const canonical = contentTokens(canonicalLabel);
  const twin = contentTokens(twinLabel);
  if (canonical.size === 0 || twin.size === 0) return false;

  // Which contains which? Either direction is admissible: the user may have
  // written the terse label ("two developers") or the fuller one. Authorship,
  // not length, decides who is canonical — that is settled by the caller.
  const canonicalInTwin = [...canonical].every((t) => twin.has(t));
  const twinInCanonical = [...twin].every((t) => canonical.has(t));
  if (!canonicalInTwin && !twinInCanonical) return false;

  const [subset, superset] = canonicalInTwin ? [canonical, twin] : [twin, canonical];

  // Coincidental containment of a one-word label is not identity.
  if (subset.size < MIN_SHARED_CONTENT_TOKENS) return false;

  // ⭐ THE DECIDING CLAUSE. Every surplus token must be one that cannot change
  // which option is meant. An unknown word declines the merge.
  for (const token of superset) {
    if (subset.has(token)) continue;
    if (!elaborative.has(token)) return false;
  }
  return true;
}

/** An intervention map as it appears on an option. */
type InterventionMap = Record<string, unknown> | undefined;

function interventionTargets(map: InterventionMap): string[] {
  return map && typeof map === "object" ? Object.keys(map) : [];
}

/**
 * Read an intervention's numeric level, whatever shape it arrives in.
 *
 * At this seam an entry is either a bare number (the analysis-ready shape) or
 * an object carrying `value` (the draft-graph shape) — both occur in the banked
 * captures for the same option, so reading only one of them would silently
 * treat every entry of the other shape as level-less.
 */
function interventionLevel(entry: unknown): number | undefined {
  if (typeof entry === "number" && Number.isFinite(entry)) return entry;
  if (entry && typeof entry === "object") {
    const v = (entry as { value?: unknown }).value;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * May these two options be merged on their interventions?
 *
 * If BOTH carry interventions they must name exactly the same targets **AND
 * agree on every level**. Two options levering different factors — or the same
 * factor at different levels — are two different proposals whatever their
 * labels say, and the label predicate does not get to overrule that. Only a
 * one-sided or empty intervention set is otherwise compatible.
 *
 * ⚠⚠ THE LEVEL CHECK WAS DOCUMENTED HERE BEFORE IT EXISTED, AND THAT IS THE
 * DEFECT THIS COMMENT NOW RECORDS. The first version compared `Object.keys`
 * only, while this paragraph already claimed "the same factor at different
 * levels" was refused. So `raise prices {price: 0.10}` and
 * `Raise Prices Option {price: 0.30}` had equal target sets, passed as
 * compatible, and the 0.30 proposal was absorbed — and because the disclosure
 * filters on target NAMES the canonical lacks, a divergent level on a SHARED
 * target was not offered either. **Silently discarded, under a docstring saying
 * it could not be.** A comment that describes a check the code does not perform
 * is worse than no comment: it retires the question for every later reader.
 * The code now does what this paragraph says.
 */
export function interventionsAreCompatible(a: InterventionMap, b: InterventionMap): boolean {
  const ta = interventionTargets(a);
  const tb = interventionTargets(b);
  if (ta.length === 0 || tb.length === 0) return true;
  if (ta.length !== tb.length) return false;
  // Same targets is necessary, not sufficient: the LEVELS must agree too.
  const setB = new Set(tb);
  for (const target of ta) {
    // A target the other side does not name at all: not the same proposal.
    if (!setB.has(target)) return false;
    const la = interventionLevel((a as Record<string, unknown>)[target]);
    const lb = interventionLevel((b as Record<string, unknown>)[target]);
    // An unreadable level on either side is not evidence of agreement.
    if (la === undefined || lb === undefined) return false;
    if (la !== lb) return false;
  }
  return true;
}

export interface RephraseMergeResult {
  /** Option ids that were absorbed and removed. */
  readonly absorbedOptionIds: string[];
  /** Disclosures — one per absorption. Never silent. */
  readonly warnings: ValidationWarningV3T[];
}

/**
 * Absorb AI rephrasings of user-authored options, in place.
 *
 * MUTATES `nodes`, `edges` and `options` — it is called at the draft transform's
 * commit point, where these three are the only copies in existence.
 *
 * ⭐ WHAT ABSORPTION PRESERVES (the ruling's "nothing silently lost"):
 *   - the user's LABEL, id and provenance stay canonical, untouched;
 *   - the model's label survives on the canonical option's `description`
 *     ("Also drafted as: …") so the phrasing the user saw is still there;
 *   - any factor link or intervention the twin carried and the canonical does
 *     NOT is DISCLOSED in the warning's `details`, and deliberately NOT adopted.
 *     Adopting them would let a merge silently rewire the user's option — the
 *     #853 defect class. Offered, never taken.
 *
 * ⚠⚠ WHERE THAT DISCLOSURE ACTUALLY REACHES, AT ITS HONEST RUNG (corrected
 * 14 Aug 2026 — the first version of this file called the warning channel
 * "user-facing", which an independent review REFUTED at the artefacts):
 *
 *   - `OPTION_REPHRASE_ABSORBED` rides `validation_warnings`, and on the DRAFT
 *     TURN that channel has **no wire carrier**: the draft-turn projector
 *     builds `{nodes, edges, node_count, edge_count, goal_constraints?}` and
 *     `DraftGraphBlockSchema` is `.strict()`, so warnings cannot ride it. They
 *     appear nowhere in the captured turn payload. The UI's only readers are
 *     debug-panel surfaces. **So the warning is NOT how a user learns of a
 *     merge today.**
 *   - The genuinely user-reachable trace is the `description` line: it rides
 *     the wire on the node, survives the UI mapper's `...rest`, and renders in
 *     the option inspector. Rung: CODE-TRACED end to end, **not**
 *     journey-witnessed.
 *
 * So the accurate statement is: the merge is RECORDED, and it is reachable for
 * a user who opens the option inspector. Anyone wanting it on the primary
 * surface needs the warning given a wire carrier — a contract change, rowed,
 * not something this module can do. Do not restate "never silent" without
 * naming which rung; that phrasing is what the review had to refute.
 */
export function mergeRephrasedOptions(args: {
  readonly nodes: NodeV3T[];
  readonly edges: EdgeV3T[];
  readonly options: OptionV3T[];
}): RephraseMergeResult {
  const { nodes, edges, options } = args;
  const absorbedOptionIds: string[] = [];
  const warnings: ValidationWarningV3T[] = [];

  const optionNodes = nodes.filter((n) => n.kind === "option");
  const canonicals = optionNodes.filter((n) => n.provenance === "from_brief");
  const twins = optionNodes.filter((n) => n.provenance === "ai_inferred");
  if (canonicals.length === 0 || twins.length === 0) {
    return { absorbedOptionIds, warnings };
  }

  const optionById = new Map(options.map((o) => [o.id, o]));

  for (const twin of twins) {
    // ⭐ AMBIGUITY KEEPS BOTH. A twin that reads as a rephrase of two different
    // user options is exactly the case the ruling reserves for asking the user
    // (a separate slice). Until that exists, ambiguous identity is preserved
    // untouched — never resolved by picking the first match.
    const matches = canonicals.filter((c) => {
      if (!isHighConfidenceRephrase(c.label, twin.label)) return false;
      return interventionsAreCompatible(
        optionById.get(c.id)?.interventions as InterventionMap,
        optionById.get(twin.id)?.interventions as InterventionMap,
      );
    });
    if (matches.length !== 1) continue;

    const canonicalNode = matches[0]!;
    const canonicalOption = optionById.get(canonicalNode.id);
    const twinOption = optionById.get(twin.id);
    // No entry in options[] means this is not the surface we own. Decline.
    if (!canonicalOption || !twinOption) continue;

    // ── What the twin held that the canonical does not — disclosed, not taken ──
    const canonicalTargets = new Set(
      edges.filter((e) => e.from === canonicalNode.id).map((e) => e.to),
    );
    const offeredFactorLinks = edges
      .filter((e) => e.from === twin.id && !canonicalTargets.has(e.to))
      .map((e) => e.to);

    const canonicalInterventions = new Set(
      interventionTargets(canonicalOption.interventions as InterventionMap),
    );
    const offeredInterventions = interventionTargets(
      twinOption.interventions as InterventionMap,
    ).filter((t) => !canonicalInterventions.has(t));

    // ── Preserve the model's phrasing on the canonical option ──
    const alsoDraftedAs = `Also drafted as: ${twin.label}`;
    const appendDescription = (existing: string | undefined): string =>
      existing && existing.trim().length > 0 ? `${existing}\n\n${alsoDraftedAs}` : alsoDraftedAs;
    canonicalOption.description = appendDescription(canonicalOption.description);
    canonicalNode.description = appendDescription(canonicalNode.description);

    // ── Remove the twin: option entry, graph node, and every incident edge ──
    const optionIndex = options.findIndex((o) => o.id === twin.id);
    if (optionIndex >= 0) options.splice(optionIndex, 1);
    const nodeIndex = nodes.findIndex((n) => n.id === twin.id);
    if (nodeIndex >= 0) nodes.splice(nodeIndex, 1);
    for (let i = edges.length - 1; i >= 0; i -= 1) {
      const e = edges[i]!;
      if (e.from === twin.id || e.to === twin.id) edges.splice(i, 1);
    }
    optionById.delete(twin.id);
    absorbedOptionIds.push(twin.id);

    warnings.push({
      code: OPTION_REPHRASE_ABSORBED,
      severity: "info",
      // Says what happened and what was kept. It does not claim the model was
      // wrong, and it does not tell the user to do anything.
      // ⚠ This rides `validation_warnings`, which has NO wire carrier on the
      // draft turn (see the header). It is a RECORD, not a user notice.
      message:
        `“${twin.label}” was drafted as a restatement of your own option ` +
        `“${canonicalNode.label}”, so the two are shown as one. Your wording is kept.` +
        (offeredFactorLinks.length > 0 || offeredInterventions.length > 0
          ? ` The restatement also linked to ${offeredFactorLinks.length + offeredInterventions.length} thing(s) your option does not — these were not added, and you can add them yourself.`
          : ""),
      affected_option_id: canonicalNode.id,
      affected_node_id: canonicalNode.id,
      stage: "v3_transform",
      details: {
        canonical_option_id: canonicalNode.id,
        canonical_label: canonicalNode.label,
        absorbed_option_id: twin.id,
        absorbed_label: twin.label,
        offered_factor_links: offeredFactorLinks,
        offered_intervention_targets: offeredInterventions,
        adopted: false,
      },
    } as ValidationWarningV3T);
  }

  return { absorbedOptionIds, warnings };
}
