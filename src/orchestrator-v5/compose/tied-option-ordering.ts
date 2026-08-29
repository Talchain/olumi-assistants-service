/**
 * Tied-option ordering — make a tied ranking DEFENSIBLE instead of arbitrary.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE HARM, measured at a live wire capture (`olumi-programme-docs`,
 * `golden-journey-runs/20260828T141150Z-fresh-4d29da-raw/step-T3_ANALYSE.json`):
 *
 *   win_probability   BIT-IDENTICAL 0.12090000000000044 on two options
 *   presented FIRST   a551345f "keep what we have"       mean 0.0117  regret 0.1592
 *   presented SECOND  a7d7b5cf "Phased HubSpot Pilot"    mean 0.0754  regret 0.0955
 *
 * The option presented HIGHER is strictly worse on BOTH measures the very same
 * payload carries. This is not a cosmetic tie-break: the product tells someone
 * the inferior option is the better one, with full confidence, on data it holds
 * that says otherwise.
 *
 * ⚠ THIS IS AN HONEST INTERIM, NOT THE ROOT-CAUSE FIX. The collapse originates
 * in ISL's winner determination: PLoT neither computes nor rounds
 * `win_probability` (`numeric-egress-guards.ts:27` `prob01` is a pure range
 * guard) and CEE passes it through verbatim, so two options arriving
 * bit-identical means ISL produced identical per-draw win indicators for
 * options with materially different outcome distributions. That stays open and
 * is not papered over here — this module only stops the layer that CAN see the
 * contradiction from presenting it as a confident ranking.
 *
 * ⚠ WHAT THIS DELIBERATELY DOES NOT DO. It does not invent, round, smooth or
 * edit `win_probability`. The producer's numbers ship byte-for-byte, tie
 * included — that tie is a true fact about the run and the user is entitled to
 * it. Only the ORDER and the ORDINAL move, and only inside a tied group.
 *
 * ─── WHICH ARRAY THE USER ACTUALLY SEES, DERIVED AT THE UI BYTES ───────────
 * `enrichment.option_comparison[]` — NOT `decision_brief.options[]`. Derived at
 * DecisionGuideAI `daf6537aa4f116b8124a0da9a54f8a70420eb6aa`:
 *
 *   • `mapV5AnalysisToReport.ts:571` — "Path A — enrichment.option_comparison
 *     is present: one row per entry", so `OptionResult[]` inherits THIS array's
 *     order.
 *   • `utils/optionDisplayOrder.ts:104-110` re-sorts those rows by
 *     `winProbability` DESCENDING. `Array.prototype.sort` is stable, so a tied
 *     pair keeps the order it arrived in — i.e. the order of THIS array.
 *   • `decision_brief.options[]` has NO display iteration at all. Its only two
 *     production readers (`resolveDecisionBriefOptions`,
 *     `briefWinProbability`) look up BY ID, and the UI declares the array
 *     `DECISION_BRIEF_OWNED_ELSEWHERE` ("the brief must not restate it").
 *     `rank` is not rendered as a number either — the "#N of M" prefix was
 *     removed (D17); rank now only picks a swatch colour.
 *
 * `decision_brief.options[]` is therefore reordered here for INTERNAL COHERENCE
 * only — so `rank` cannot contradict the order the user is shown — and never
 * because a user reads its order. Claiming otherwise would be the estate's
 * chronic "we build more than we plug in" failure.
 *
 * Reordering `option_comparison` is index-safe: `option_comparison[0]` has ZERO
 * non-test readers in CEE (positive control `option_comparison` = 147) and none
 * in the UI (its single hit is a doc comment in `debugRedactionManifest.ts`).
 * Every real consumer looks up by id or sorts for itself.
 *
 * ─── WHY IT LIVES AT COMPOSE, NOT AT THE FACT ──────────────────────────────
 * `run-analysis.ts:1796` assigns `enrichment: response as Record<string,
 * unknown>` — a byte-for-byte pass-through of the validated PLoT envelope,
 * enforced BOTH by `run-analysis.test.ts` ("fact.result.enrichment is the
 * validated V2RunResponse VERBATIM — zero added keys") and by
 * `scripts/validate-handler-ownership.sh` §6, which greps for that exact
 * assignment. A fact-level fix is therefore not available. The precedent for a
 * transport-time projection at this seam is `critiques`, the one keep-list
 * entry that is PROJECTED rather than forwarded (`compose.ts`,
 * `projectCritiquesForTransport`).
 *
 * ─── WHY IT RUNS ONLY ON A NON-WITHHELD TURN ───────────────────────────────
 * On a withheld turn `projectOptionsForWithheldClaim`
 * (`withheld-claim-projection.ts`) already DROPS the ordinal and neutralises
 * the order outright. Where there is deliberately no ranking there is no
 * ranking to make defensible, and reinstating one would reopen the leader-claim
 * harm that projection exists to close.
 *
 * ─── THE GROUPING PREDICATE, AND WHY IT IS THE SAFETY ARGUMENT ─────────────
 * Options group on a BIT-IDENTICAL `win_probability`. Not a tolerance, not an
 * epsilon, not a "near enough" band. Two consequences, both load-bearing:
 *
 *   1. No arbitrary constant is introduced. A threshold here would be exactly
 *      the shape CLAUDE.md trap 22f rules against — a predicate whose behaviour
 *      turns on a hand-picked number with hard cliffs either side.
 *   2. THE UNTIED CASE IS PROTECTED BY CONSTRUCTION, not by care. If two
 *      options differ in win probability at all, they land in different groups
 *      and NOTHING can permute them. 207 of 212 recorded analysis payloads
 *      carry no bit-identical tie at all; this module cannot touch any of
 *      them, and the twin tests pin that rather than trusting the argument.
 *
 *      ⚠ AND THE THING THAT IS *NOT* A DEFECT, because it will look like one:
 *      `rank` disagrees with `outcome.mean` in 119 of 597 recorded option
 *      pairs (19.9%, spanning 99 of 212 payloads) — ~24x more often than an
 *      exact tie. That is NOT this module's business and must not be
 *      "fixed" here. Ranking by P(best) and ranking by expected value are two
 *      legitimate and genuinely different decision rules, and outside a tie
 *      win probability is a real signal. A tie is special precisely because
 *      win probability then carries NO information, so deferring to expected
 *      value is the only defensible move left.
 *
 * ─── THE TIE-BREAK KEY, DERIVED ────────────────────────────────────────────
 * ⚠⚠ FIRST, THE THING A LATER LANE WILL OTHERWISE GET WRONG:
 * `expected_regret` AND `outcome.mean` ARE THE SAME KEY. Measured across the
 * whole capture corpus (212 analysis payloads, 597 option pairs, tolerance
 * 1e-9): `expected_regret + outcome.mean` is CONSTANT within every single
 * payload, 212/212. Regret is exactly `C − mean` — an affine transform of the
 * negated mean — so ordering by one IS ordering by the other. They disagreed
 * in 0 of 597 pairs, and not by luck. An earlier draft of this comment called
 * one "primary" and the other an independent "secondary"; that implied two
 * signals where the payload carries one, and it is corrected here rather than
 * left for someone to rediscover.
 *
 * PRIMARY: `downside.expected_regret`, ASCENDING (less regret is better).
 * SECONDARY: `outcome.mean`, DESCENDING — reached only when regret is absent
 *   or equal on both sides. Given the affine identity above, the secondary is
 *   a SHAPE fallback (for a payload shipping one field and not the other), NOT
 *   a second opinion. It can never overturn the primary.
 *
 * WHY REGRET IS READ FIRST, if the order is identical either way: it is the one
 *   of the two whose DIRECTION is fixed by construction. Regret is zero for the
 *   best option and positive otherwise, so "less is better" holds without CEE
 *   knowing whether the goal is maximised or minimised — which CEE does not
 *   know: there is no goal-direction field on the analysis payload, and the
 *   only polarity concept in the tree is `RiskPolarity`
 *   ('fears_high' | 'fears_low') for RISK nodes
 *   (`cee/compound-goal/risk-polarity.ts`). `outcome.mean`'s "higher is better"
 *   is merely IMPLIED, by the engine's own alignment between mean and win
 *   probability. Reading the self-orienting field first means the affine
 *   identity is what makes the other one safe, rather than an assumption doing
 *   it. A genuinely INDEPENDENT tie-break would have to come from a third
 *   quantity — `downside.cvar_10`, `p05`, `outcome.std` — which is a different
 *   design question and is deliberately NOT settled here.
 *
 *   ⚠ The UI carries `expected_regret` but deliberately never DISPLAYS it
 *   (`OptionCards.tsx`: "the estate's no-EVPI-display doctrine"). Using it as a
 *   sort key displays no magnitude — but a later lane wanting to SHOW why the
 *   order is what it is must clear that doctrine, or lean on `outcome.mean`,
 *   which the UI already renders as "Expected".
 *
 * ─── WHAT THE CURRENT (ARBITRARY) TIE-BREAK ACTUALLY IS ────────────────────
 * Derived from the captures, 5/5 consistent: the better rank goes to the
 * lexicographically smaller `option_id`, consistent with a stable sort on
 * `win_probability` over an upstream array arriving in alphabetical
 * `option_id` order (208/212 captures). A modern `option_id` is an 8-hex-char
 * content hash, so THE CURRENT TIE-BREAK IS A COIN FLIP ON A HASH PREFIX — and
 * it is not stable across runs: in capture `…-4d29da` `a551345f` WINS its tie
 * and takes rank 2; seventeen minutes later in `…-46c748` the same `a551345f`
 * LOSES a tie and drops to rank 3.
 *
 * ─── HOW OFTEN, AND THE CLASS THIS DOES NOT REACH ──────────────────────────
 * Across 212 analysis payloads: 5 bit-identical tied pairs (4 distinct
 * results). In 1 of the 5 the inferior option is ranked higher — the capture
 * fixed here. The other 4 land correctly BY COINCIDENCE of the hash ordering,
 * which is precisely why this is worth fixing: today's correct answers are not
 * earned.
 *
 * ⚠ KNOWN-UNCOVERED, STATED RATHER THAN LEFT TO BE FOUND: a pair ONE ULP
 * apart is not bit-identical, so it lands in different groups here and this
 * module leaves it alone. The corpus contains exactly such a case, and it is
 * the worst one in it — `20260811T013132Z-fresh-23c2c5/step-T3_ANALYSE.json`,
 * `gap: 5.551115123125783e-17`, where the product NAMES A LEADER
 * (`opt_switch_hubspot`) that has both the worse mean and the worse regret,
 * and `robustness.near_tie.is_tie` is already TRUE. That is a LEADER-CLAIM
 * defect with a signal the payload already carries, not an ordering defect,
 * and it belongs where the leader claim is decided. Widening the grouping
 * predicate to reach it would reintroduce exactly the arbitrary constant this
 * module refuses.
 *
 * ─── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * A reorder must be defensible or it must not happen. A tied group is left in
 * the producer's order whenever we cannot defend moving it: no separating
 * evidence, or any member lacking an id. `decision_brief.options` additionally
 * requires a finite numeric `rank` on every member of the group — reordering
 * elements while leaving ordinals behind would make array order and `rank`
 * disagree, which is worse than the defect being fixed.
 *
 * ─── WHAT THIS DOES NOT DELIVER, STATED RATHER THAN LEFT TO BE FOUND ───────
 * IT DOES NOT DISCLOSE THE TIE. A user still sees two identical win
 * percentages adjacent with no explanation. That half needs a UI change and
 * cannot be shipped from CEE: `decision_brief.warnings[]` is explicitly
 * `DECISION_BRIEF_DECLARED_DARK` ("the canonical inference-warning strip above
 * the brief is sole owner"), and the only live tie copy —
 * `OptionCards.tsx:241` "Statistically tied with the leading option" — is
 * gated on `Math.round((winner - option) * 100) > 0`, i.e. it fires only for a
 * tie WITH THE LEADER. The capture's tie is between 2nd and 3rd while the
 * leader is 64 points clear, so nothing fires. Emitting a disclosure into a
 * channel measured to be dark would be worse than emitting none: it would let
 * us believe the tie is disclosed when no user can see it.
 *
 * NOR DOES THE PRODUCER'S OWN TIE SIGNAL COVER IT. `robustness.near_tie` is
 * STRUCTURALLY BLIND below the top two — derived across all 212 payloads, not
 * inferred: `near_tie.gap == wp[rank1] - wp[rank2]` in 212/212 and
 * `is_tie == (gap < threshold)` in 212/212, with `threshold == 0.1` every
 * time. It only ever compares ranks 1 and 2. 81 of those 212 payloads contain
 * a sub-top-2 adjacent pair inside that same 0.1 threshold that `near_tie`
 * cannot see. And the wire carries no tie-break provenance of any kind:
 * `tie_break`, `tiebreak` and `tie_broken` appear in 0 of 1,010 captures.
 *
 * @module orchestrator-v5/compose/tied-option-ordering
 */

/** Tie-break evidence for one option, read from `enrichment.option_comparison[]`. */
interface TieBreakFacts {
  readonly expectedRegret: number | null;
  readonly outcomeMean: number | null;
}

interface OptionLike {
  readonly option_id?: unknown;
  readonly id?: unknown;
  readonly win_probability?: unknown;
  readonly rank?: unknown;
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The option identity an element claims, or null when it claims none. */
function identityOf(option: OptionLike): string | null {
  const id = option.option_id ?? option.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Read tie-break evidence keyed by option id.
 *
 * Tolerates BOTH the nested live-staging shape (`outcome.mean`,
 * `downside.expected_regret`) and the flat variant (`outcome_mean`), matching
 * the tolerance the existing `analysis-signals.ts` resolver already applies to
 * the same array — a payload shipping one shape must not be silently read as
 * having no evidence.
 */
function readTieBreakFacts(enrichment: Record<string, unknown>): Map<string, TieBreakFacts> {
  const facts = new Map<string, TieBreakFacts>();
  const comparison = enrichment.option_comparison;
  if (!Array.isArray(comparison)) return facts;

  for (const entry of comparison) {
    if (!isRecord(entry)) continue;
    const id = identityOf(entry);
    if (id === null) continue;

    const outcome = isRecord(entry.outcome) ? entry.outcome : undefined;
    const downside = isRecord(entry.downside) ? entry.downside : undefined;

    facts.set(id, {
      expectedRegret: finiteOrNull(downside?.expected_regret ?? entry.expected_regret),
      outcomeMean: finiteOrNull(outcome?.mean ?? entry.outcome_mean),
    });
  }
  return facts;
}

/**
 * Order two tied options. Returns 0 only when NOTHING separates them — the
 * caller treats that as "not defensibly orderable" for the group as a whole.
 *
 * ⚠ Deliberately does NOT consult `win_probability`: every option reaching this
 * comparator already carries the same one, bit for bit. That is the premise of
 * the group, not something to re-test.
 */
function compareTiedByEvidence(
  aId: string,
  bId: string,
  facts: Map<string, TieBreakFacts>,
): number {
  const a = facts.get(aId);
  const b = facts.get(bId);

  const aRegret = a?.expectedRegret ?? null;
  const bRegret = b?.expectedRegret ?? null;
  if (aRegret !== null && bRegret !== null && aRegret !== bRegret) {
    return aRegret - bRegret; // less expected regret first
  }

  const aMean = a?.outcomeMean ?? null;
  const bMean = b?.outcomeMean ?? null;
  if (aMean !== null && bMean !== null && aMean !== bMean) {
    return bMean - aMean; // higher modelled outcome first
  }

  return 0;
}

/** Index groups of BIT-IDENTICAL win probability, preserving first-seen order. */
function groupByIdenticalWinProbability(options: readonly OptionLike[]): number[][] {
  const groups = new Map<number, number[]>();
  for (const [index, option] of options.entries()) {
    const probability = finiteOrNull(option.win_probability);
    if (probability === null) continue;
    const bucket = groups.get(probability);
    if (bucket === undefined) groups.set(probability, [index]);
    else bucket.push(index);
  }
  return [...groups.values()].filter((indices) => indices.length > 1);
}

/**
 * Sort one tied group on the evidence. Returns null when the evidence does not
 * separate every adjacent pair — "partly separable" is not separable, because a
 * pair the comparator returns 0 for would keep whatever order it arrived in and
 * that is the arbitrariness being removed.
 */
function orderTiedGroup(
  members: readonly OptionLike[],
  facts: Map<string, TieBreakFacts>,
): OptionLike[] | null {
  const ids = members.map(identityOf);
  if (ids.some((id) => id === null)) return null;

  const sorted = [...members].sort((a, b) =>
    compareTiedByEvidence(identityOf(a)!, identityOf(b)!, facts),
  );
  const separated = sorted.every(
    (member, i) =>
      i === 0 ||
      compareTiedByEvidence(identityOf(sorted[i - 1]!)!, identityOf(member)!, facts) !== 0,
  );
  return separated ? sorted : null;
}

/** Reorder tied groups of a plain array (no ordinal to maintain). */
function reorderTiedGroups(
  options: readonly OptionLike[],
  facts: Map<string, TieBreakFacts>,
): OptionLike[] | null {
  const groups = groupByIdenticalWinProbability(options);
  if (groups.length === 0) return null;

  const out = [...options];
  let moved = false;
  for (const indices of groups) {
    const sorted = orderTiedGroup(
      indices.map((i) => options[i]!),
      facts,
    );
    if (sorted === null) continue;
    indices.forEach((position, offset) => {
      out[position] = sorted[offset]!;
    });
    moved = true;
  }
  return moved ? out : null;
}

/**
 * Reorder tied groups of `decision_brief.options[]`, carrying each group's own
 * `rank` VALUES across into the new order. The values are the producer's; only
 * their assignment within a tied group changes, so nothing outside the group
 * moves and no ordinal is invented.
 */
function reorderBriefOptions(
  options: readonly OptionLike[],
  facts: Map<string, TieBreakFacts>,
): OptionLike[] | null {
  const groups = groupByIdenticalWinProbability(options);
  if (groups.length === 0) return null;

  const out = [...options];
  let moved = false;
  for (const indices of groups) {
    const members = indices.map((i) => options[i]!);
    const ranks = members.map((m) => finiteOrNull(m.rank));
    // Fail closed: without a rank per member, a reorder would desynchronise
    // array order from the ordinal.
    if (ranks.some((r) => r === null)) continue;

    const sorted = orderTiedGroup(members, facts);
    if (sorted === null) continue;

    indices.forEach((position, offset) => {
      out[position] = { ...sorted[offset]!, rank: ranks[offset]! };
    });
    moved = true;
  }
  return moved ? out : null;
}

/**
 * Re-order tied options on the evidence the same payload carries.
 *
 * Pure and TOTAL: any shape it cannot read is returned unchanged rather than
 * thrown on — this sits on a disclosure seam, where a throw would replace a
 * good analysis with a 500.
 */
export function projectTiedOptionOrderingForTransport(enrichment: unknown): unknown {
  if (!isRecord(enrichment)) return enrichment;

  const facts = readTieBreakFacts(enrichment);
  const patch: Record<string, unknown> = {};

  // 1. THE ARRAY THE USER SEES. Its order survives the UI's stable sort for
  //    every tied pair, so this is where the visible harm lives.
  const comparison = enrichment.option_comparison;
  if (Array.isArray(comparison) && comparison.length > 1 && comparison.every(isRecord)) {
    const reordered = reorderTiedGroups(comparison as OptionLike[], facts);
    if (reordered !== null) patch.option_comparison = reordered;
  }

  // 2. INTERNAL COHERENCE ONLY. Nothing renders this array's order, but `rank`
  //    travels with it and must not contradict (1).
  const brief = enrichment.decision_brief;
  if (isRecord(brief)) {
    const options = brief.options;
    if (Array.isArray(options) && options.length > 1 && options.every(isRecord)) {
      const reordered = reorderBriefOptions(options as OptionLike[], facts);
      if (reordered !== null) patch.decision_brief = { ...brief, options: reordered };
    }
  }

  return Object.keys(patch).length > 0 ? { ...enrichment, ...patch } : enrichment;
}
