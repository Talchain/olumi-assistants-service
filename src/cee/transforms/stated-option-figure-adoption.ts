/**
 * ⭐⭐ THE USER'S OWN FIGURE REACHES THE OPTION MADE OF THE USER'S OWN WORDS.
 *
 * ── THE WITNESSED DEFECT (9 live staging drafts, `8e4efce0`, 2026-09-14) ─────
 *
 *     brief : "…should we increase the Pro plan price from £49 to £59 per month
 *              with the next Pro feature release?"
 *     ⇒ options[]:
 *         "increase the Pro plan price from £49 to £59 …"  from_brief   {}      ← 0
 *         "Raise Price to £59 Immediately (No Feature Tie)" ai_inferred  2 values
 *         "Raise Price to £59 with Feature Release"         ai_inferred  2 values
 *         "Hold Price at £49"                               ai_inferred  2 values
 *
 * The option carrying the user's own sentence is wired to the same factors as
 * its AI paraphrases and carries a value for NEITHER, so the product ranks the
 * user's proposal against a better-configured restatement of itself. Measured
 * across 9 drafts of one brief: **5 of 12 stated-option instances are wired to
 * a factor they carry no value for**, while an AI sibling carries one.
 *
 * ⚠ AND THE VALUE IS NOT MISSING FROM THE WORLD — it is missing from the OPTION.
 * The sibling's price intervention is stamped `source: "brief_extraction"`,
 * `reasoning: "the amount is stated in the brief"`, raw_value 59. The figure the
 * user typed reached the model's paraphrase and not the user's own option.
 *
 * ── WHAT THIS MODULE DOES, AND THE THREE THINGS IT REFUSES TO DO ────────────
 *
 * It ADOPTS a stated figure onto a stated option, and only under a conjunction
 * that cannot be satisfied by a guess. It does NOT delete the stated option, it
 * does NOT merge it with its paraphrase, and it does NOT invent a level.
 *
 * ⛔ DELETION IS REFUTED, NOT UNCONSIDERED. A prompt clause that removed the
 * raw-brief-labelled option was measured: in 3 of 6 runs that option is the
 * SOLE carrier of the user's stated proposal, so deleting it leaves the user a
 * status quo for a question about raising the price.
 *
 * ⛔ MERGING IS CLOSED BY DESIGN, and by the neighbouring module rather than by
 * preference. `option-rephrase-merge.ts` is a CONTAINMENT test over content
 * tokens: "increase the Pro plan price from £49 to £59 …" and "Raise Price to
 * £59 with Feature Release" share neither direction of containment ("increase"
 * vs "raise"), so it declines — correctly, and its allow-list header forbids
 * adding a word to make a case pass. Widening it to reach this pair would put
 * genuine alternatives at risk, which is the one harm that module exists to
 * prevent. So absorption is not the route, and this module never removes an
 * option.
 *
 * ⛔ AND NO LEVEL IS INVENTED. The sibling's SECOND intervention — the feature
 * -release coupling, and the product's own named swing factor — is stamped
 * `cee_hypothesis` with `value_confidence: "low"`. Copying it would decide the
 * user's decision with our guess wearing their authorship. It is refused, the
 * gap is recorded, and the existing ask stands.
 *
 * ── THE ADOPTION CONJUNCTION ───────────────────────────────────────────────
 *
 * A factor `F` on a stated option `O` is adopted only when ALL hold:
 *
 *  1. `O.provenance === "from_brief"` and `O` has a non-empty `source_quote`.
 *     Authorship is read from the node field, for the reason
 *     `option-rephrase-merge.ts` derived at 39 banked option nodes: the
 *     `extraction_metadata.source` and `graphReady.nodes` copies misreport it.
 *  2. `O` is connected to `F` by a surviving option→factor edge, and carries no
 *     finite magnitude for `F`. The graph already asserts the effect; only the
 *     level is absent.
 *  3. Some OTHER option carries an intervention on `F` with
 *     `source === "brief_extraction"` and a finite numeric `raw_value` — a
 *     DONOR. The figure is one the extractor already bound to the brief.
 *  4. Every eligible donor for `F` AGREES on that raw value. Disagreement is
 *     refused, never adjudicated.
 *  5. `O`'s OWN `source_quote` names EXACTLY ONE figure, and it is the donor's.
 *     This is what makes the write a recovery of the user's own words rather
 *     than a copy from a sibling — and the "exactly one" is load-bearing, not
 *     tidiness. See the trajectory note below.
 *  6. ⭐ EVERY connected factor of `O` clears 2–5, or NOTHING is adopted for
 *     `O`. See the all-or-nothing note below — it is the load-bearing rule.
 *
 * ── ⚠ WHY DONOR ELIGIBILITY IS FILTERED BY `is_baseline`, MEASURED ─────────
 *
 * The witnessed brief names TWO prices, and both are `brief_extraction` values
 * on the same factor: 59 on the raise options and 49 on "Hold Price at £49".
 * BOTH appear verbatim in the user's quote ("from £49 to £59"), so the quote
 * alone cannot discriminate — and writing 49 onto a proposal to RAISE the price
 * would convert the user's proposal into the status quo, which is this defect
 * inverted and strictly worse than leaving it unvalued.
 *
 * The discriminator is the typed role, not the language: a donor may only fund a
 * recipient with the SAME `is_baseline` role. The baseline option's 49 is then
 * ineligible for a non-baseline recipient by construction, the two remaining
 * donors agree on 59, and rule 4 is satisfied. Measured on the corpus: the
 * baseline filter is what turns `gap:disagree` into a clean adopt.
 *
 * ⚠ NO "from X to Y" RULE, DELIBERATELY. English direction-of-change parsing is
 * the shape that oscillates (trap 22f: four rounds, each fixing one direction
 * and opening the other). The typed role answers the same question without
 * reading the sentence, so the sentence is not read.
 *
 * ── ⛔⛔ A MULTI-FIGURE QUOTE IS REFUSED, AND AN OUTSIDE CORPUS IS WHY ───────
 *
 * The first version of this module required only that the donor's figure appear
 * SOMEWHERE in the recipient's quote. `tests/integration/model-readiness-
 * compiler-corpus.records.test.ts` refuted it — a corpus written long before
 * this module, containing the class its author's own fixtures did not:
 *
 *     option : "charging £49 now and £59 in Q2"     (non-baseline, no sets_to)
 *     sibling: "raising the price to £59 immediately" (non-baseline, sets_to 59)
 *     sibling: "keeping the price at £49"            (baseline,     sets_to 49)
 *
 * Every earlier gate passes: the recipient is `from_brief`, connected to
 * `Monthly Subscription Price` and unvalued; the baseline filter removes the 49;
 * the surviving donors agree on 59; and 59 is verbatim in the quote. So the
 * module ADOPTED 59 — collapsing a two-stage trajectory into one scalar, which
 * that brief's own last sentence forbids in words: *"do not turn two stages into
 * one made-up price."*
 *
 * ⚠ AND IT IS STRUCTURALLY INDISTINGUISHABLE FROM THE CASE THIS MODULE WAS
 * WRITTEN FOR. "increase the Pro plan price from £49 to £59" and "charging £49
 * now and £59 in Q2" are both non-baseline recipients whose quote names {49, 59}
 * with a non-baseline donor at 59, and in BOTH the other figure is claimed by
 * the baseline sibling. Nothing in the records tells them apart. The only
 * difference is linguistic — a transition to a destination versus a trajectory
 * through two stages — and that is the direction-of-change parse refused two
 * paragraphs above. Writing its mirror here would be the same mistake with the
 * sign flipped.
 *
 * So a quote naming more than one figure is AMBIGUOUS about the level and
 * adoption refuses. The cost is paid honestly: on the 9 witnessed drafts of the
 * motivating brief, whose quote names £49 and £59, this module now adopts
 * NOTHING and records the gap instead. That is the direction that loses a fix
 * rather than fabricating a number the user never chose.
 *
 * ── ⭐⭐ ALL-OR-NOTHING, AND WHY A PARTIAL ADOPTION WOULD BE WORSE THAN NONE ──
 *
 * Adopting the price alone on the witnessed brief would give the stated option
 * ONE intervention. `option-status.ts` calls an option with any intervention
 * `ready`, so the existing "Choose which factor … and by how much" ask would
 * DISAPPEAR, and the option would enter the comparison wired on 1 of 2 factors
 * against siblings wired on 2 — the missing one being the feature-release
 * coupling the product's own analysis calls the swing factor.
 *
 * That is the reported harm exactly (the user's option 16%, its paraphrase 72%,
 * "the lead is meaningful rather than marginal"), reached by a change that would
 * have scored as a fix on every count-based metric. So a stated option is
 * completed WHOLE or left alone with its ask intact (trap 23: a fix validated
 * against the symptom's metric can kill the symptom and leave the defect).
 *
 * ── WHAT THE NEGATIVE CONTROL IS, AND WHY IT HOLDS BY CONSTRUCTION ─────────
 *
 * "A brief stating a simple uncoupled alternative must not gain a spurious
 * second intervention." A second intervention requires a second CONNECTED
 * FACTOR (rule 2) with its own agreeing donor (3–4) and its own verbatim figure
 * in the same quote (5). An uncoupled alternative has one connected factor and
 * one figure, so no second key can be minted — this module can only ever fill
 * keys the graph already asserts, never add one. Pinned by test all the same.
 *
 * ── TOTALITY ───────────────────────────────────────────────────────────────
 *
 * Pure and total. Any shape it cannot read yields no adoptions and no gaps,
 * never a throw: this runs inside a draft that must not be failed by its own
 * instrumentation. `adopted` empty means the input is returned untouched, so a
 * fully-configured draft is unchanged to the byte.
 */

import type { NodeV3T, OptionV3T, InterventionV3T, EdgeV3T } from "../../schemas/cee-v3.js";

/** One filled intervention, with the donor that funded it named. */
export interface AdoptedStatedFigure {
  readonly option_id: string;
  readonly factor_id: string;
  readonly raw_value: number;
  readonly donor_option_id: string;
}

/**
 * One element of a stated proposal the product could not wire.
 *
 * `covered_by_sibling` is the half that makes this the reported harm rather
 * than a bare absence: the comparison contains an option that DOES carry a
 * value for this factor, so the stated option is being ranked against a
 * better-configured rival on exactly this dimension.
 */
export interface StatedOptionCoverageGap {
  readonly option_id: string;
  readonly factor_id: string;
  readonly reason:
    | "no_stated_donor"
    | "donors_disagree"
    | "quote_names_several_figures"
    | "figure_not_in_quote";
  readonly covered_by_sibling: boolean;
}

export interface StatedOptionCoverageResult {
  readonly adopted: readonly AdoptedStatedFigure[];
  readonly gaps: readonly StatedOptionCoverageGap[];
}

/**
 * Figures spelled in a brief quote, as bare numbers.
 *
 * ⚠ SCALE WORDS ARE NOT EXPANDED, ON PURPOSE. "£20k" yields 20, not 20000, so a
 * donor whose raw value is 20000 does NOT match a quote saying "20k". That
 * declines an adoption; expanding would risk MATCHING the wrong figure, and the
 * two error directions are not symmetric here (rule 5 is a safety gate, so its
 * failures must lose adoptions, never gain them). A brief that spells the figure
 * the way the extractor recorded it still matches.
 */
function quotedFigures(quote: string): ReadonlySet<number> {
  const out = new Set<number>();
  for (const match of quote.matchAll(/\d+(?:\.\d+)?/g)) {
    const parsed = Number.parseFloat(match[0]);
    if (Number.isFinite(parsed)) out.add(parsed);
  }
  return out;
}

/** Does this option carry a finite magnitude for `factorId`? */
function carriesMagnitude(option: OptionV3T, factorId: string): boolean {
  const entry = (option.interventions as Record<string, InterventionV3T> | undefined)?.[factorId];
  if (entry === undefined || entry === null) return false;
  return typeof entry.value === "number" && Number.isFinite(entry.value);
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Object-shaped enough to read keys off.
 *
 * ⚠ RETURNS `boolean`, NOT A TYPE PREDICATE, AND THAT IS THE POINT. A
 * `v is Record<string, unknown>` predicate narrows the caller's `NodeV3T` away
 * and forces a cast back to store it — and a cast that hides declared fields
 * from the type system is the shape this estate has already paid for. The
 * runtime check is identical; only the narrowing is declined.
 */
function isReadableMember(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Fill the stated options' missing levels from the user's own stated figures.
 *
 * Mutates `options[]` in place (and therefore the option nodes, which alias the
 * same `interventions` object) and returns what was adopted and what remains a
 * gap. Nothing is removed and no option is created.
 */
export function adoptStatedFiguresForStatedOptions(args: {
  readonly nodes: readonly NodeV3T[];
  readonly edges: readonly EdgeV3T[];
  readonly options: readonly OptionV3T[];
}): StatedOptionCoverageResult {
  const { nodes, edges, options } = args;
  const adopted: AdoptedStatedFigure[] = [];
  const gaps: StatedOptionCoverageGap[] = [];
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(options)) {
    return { adopted, gaps };
  }

  // ⚠ The guards below READ without NARROWING. Narrowing to
  // `Record<string, unknown>` would lose `NodeV3T`/`OptionV3T` and force a cast
  // back — and a cast that hides fields from a derived guard is a defect class
  // this estate has already paid for. The runtime shape is still checked,
  // because these arrays arrive from a boundary transform and a malformed
  // member must be skipped rather than throw inside a draft.
  const kindById = new Map<string, string | undefined>();
  const nodeById = new Map<string, NodeV3T>();
  for (const node of nodes) {
    if (!isReadableMember(node)) continue;
    const id: unknown = (node as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    nodeById.set(id, node);
    const kind: unknown = (node as { kind?: unknown }).kind;
    kindById.set(id, typeof kind === "string" ? kind : undefined);
  }
  const optionById = new Map<string, OptionV3T>();
  for (const option of options) {
    if (!isReadableMember(option)) continue;
    const id: unknown = (option as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    optionById.set(id, option);
  }

  // Surviving option→factor edges. Repair-authored edges are INCLUDED here, and
  // that differs deliberately from `connectedFactorCount` in
  // `analysis-ready.ts`, which excludes them so the product cannot count its own
  // wiring as the user's mapping. The question here is different: the shipped
  // graph asserts this effect to the user whoever authored the edge, so an
  // asserted effect with no level is a gap the user should see either way.
  // Measured: 3 of 9 drafts wire the stated option by the status-quo
  // connectivity repair, so excluding repair edges would blind this module to
  // the majority of the very cases it exists for.
  const connectedFactors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!isPlainRecord(edge)) continue;
    const from = typeof edge.from === "string" ? edge.from : undefined;
    const to = typeof edge.to === "string" ? edge.to : undefined;
    if (from === undefined || to === undefined) continue;
    if (kindById.get(from) !== "option") continue;
    if (kindById.get(to) !== "factor") continue;
    const set = connectedFactors.get(from) ?? new Set<string>();
    set.add(to);
    connectedFactors.set(from, set);
  }

  for (const [optionId, factors] of connectedFactors) {
    const node = nodeById.get(optionId);
    const option = optionById.get(optionId);
    if (node === undefined || option === undefined) continue;
    if (node.provenance !== "from_brief") continue;
    const quote = typeof node.source_quote === "string" ? node.source_quote : "";
    if (quote.length === 0) continue;

    const recipientIsBaseline = option.is_baseline === true;
    const figures = quotedFigures(quote);

    // Pass 1 — decide every connected factor before writing anything, because
    // an adoption is valid only if the WHOLE option can be completed.
    const pending: AdoptedStatedFigure[] = [];
    const pendingGaps: StatedOptionCoverageGap[] = [];
    for (const factorId of [...factors].sort()) {
      if (carriesMagnitude(option, factorId)) continue;

      const donors: { id: string; raw: number; intervention: InterventionV3T }[] = [];
      let anySiblingCovers = false;
      for (const sibling of options) {
        if (sibling.id === optionId) continue;
        if (carriesMagnitude(sibling, factorId)) anySiblingCovers = true;
        if ((sibling.is_baseline === true) !== recipientIsBaseline) continue;
        const entry = (sibling.interventions as Record<string, InterventionV3T> | undefined)?.[
          factorId
        ];
        if (entry === undefined || entry === null) continue;
        if (entry.source !== "brief_extraction") continue;
        const raw = entry.raw_value;
        if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
        donors.push({ id: sibling.id, raw, intervention: entry });
      }

      const distinct = new Set(donors.map((d) => d.raw));
      if (distinct.size === 0) {
        pendingGaps.push({
          option_id: optionId,
          factor_id: factorId,
          reason: "no_stated_donor",
          covered_by_sibling: anySiblingCovers,
        });
        continue;
      }
      if (distinct.size > 1) {
        pendingGaps.push({
          option_id: optionId,
          factor_id: factorId,
          reason: "donors_disagree",
          covered_by_sibling: anySiblingCovers,
        });
        continue;
      }
      const donor = donors[0]!;
      // ⭐⭐ RULE 5. The recipient's own quote must name EXACTLY ONE figure, and
      // it must be the donor's. A quote naming several is ambiguous about which
      // one is this option's LEVEL, and no deterministic rule available here can
      // resolve it — see the header's note on the temporal trajectory.
      if (figures.size > 1) {
        pendingGaps.push({
          option_id: optionId,
          factor_id: factorId,
          reason: "quote_names_several_figures",
          covered_by_sibling: anySiblingCovers,
        });
        continue;
      }
      if (!figures.has(donor.raw)) {
        pendingGaps.push({
          option_id: optionId,
          factor_id: factorId,
          reason: "figure_not_in_quote",
          covered_by_sibling: anySiblingCovers,
        });
        continue;
      }
      pending.push({
        option_id: optionId,
        factor_id: factorId,
        raw_value: donor.raw,
        donor_option_id: donor.id,
      });
    }

    // ⭐ RULE 6. A gap anywhere on this option withdraws every adoption on it.
    if (pendingGaps.length > 0) {
      gaps.push(...pendingGaps);
      continue;
    }
    if (pending.length === 0) continue;

    // Pass 2 — write. The donor's ENCODED `value` is copied alongside its raw
    // value because donor and recipient are keyed to the SAME factor, so they
    // share that factor's scale frame by construction. Nothing is re-derived
    // here, so no unit or scale decision is taken by this module.
    const bundle = option.interventions as Record<string, InterventionV3T>;
    for (const entry of pending) {
      const donorOption = optionById.get(entry.donor_option_id);
      const donorIntervention = (
        donorOption?.interventions as Record<string, InterventionV3T> | undefined
      )?.[entry.factor_id];
      if (donorIntervention === undefined) continue;
      bundle[entry.factor_id] = {
        ...donorIntervention,
        target_match: { ...donorIntervention.target_match, node_id: entry.factor_id },
        source: "brief_extraction",
        // The receipt asserts only what the conjunction establishes: the figure
        // is stated in THIS option's own brief quote, and every option carrying
        // a stated figure for this factor in the same baseline role agrees on
        // it. It does not claim the user attached the figure to this factor —
        // that is the graph's assertion, made by the edge, not by this write.
        reasoning:
          `Stated figure ${entry.raw_value} appears in this option's own brief quote, ` +
          `and every option carrying a brief figure for this factor agrees on it`,
      };
      adopted.push(entry);
    }
    if (node.kind === "option") node.interventions = bundle;
  }

  return { adopted, gaps };
}
