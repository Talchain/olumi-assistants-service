/**
 * MAY THE PRODUCT INVITE THE USER TO GO AND INVESTIGATE **THIS FACTOR**?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ THE WITNESSED HARM (deployed build, 2026-09-04 22:44–23:28Z). A founder
 * asked whether to hire a tech lead or two developers. Across EIGHT analysis
 * narrations the single actionable recommendation was always the same factor,
 * "Team coordination overhead":
 *
 *   "Reducing uncertainty here could decisively clarify which option delivers
 *    greater productivity towards your launch goal."
 *   "The link from Team coordination overhead to project outcomes could easily
 *    shift which hiring option leads."
 *   "Internal data: Gather internal project data or run a short pilot to
 *    measure actual team coordination overhead."
 *
 * The engine's own numbers for that same factor, in the same payload:
 *
 *   value_of_information   : 0
 *   evpi_percentage_points : 0
 *   evpi_method            : "heuristic"
 *   flip_risk_category     : "negligible"
 *   rank_flip_rate         : 0
 *   range_derivation_source: "default"
 *   sensitivity_score      : -0.35
 *
 * **The product spent a whole session telling a founder to run a pilot on a
 * factor its own engine scores at zero value of information and negligible
 * flip risk** — real time, for no modelled benefit — while asserting the exact
 * opposite of the `rank_flip_rate: 0` sitting beside it.
 *
 * WHY IT SHIPPED, at the bytes: the composition site could not see any of it.
 * `ContextPackAnalysisDriver` is `{factor_label, sensitivity_value}` and
 * `formatDriver` renders `{label, influence}`. The LLM was handed
 * "moderate negative influence" and NOTHING ELSE about that factor — so
 * "worth investigating" was not a hallucination against available evidence,
 * it was the only inference available. **The fix is to give the composer the
 * producer's verdict, not to add a gate it cannot evaluate.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ WHY THIS IS NOT `coaching/zero-effect-factors.ts` (trap #21 — two
 * authorities, two questions, named apart rather than aligned):
 *
 *   `coaching/zero-effect-factors.ts` — "did this run score this factor's
 *       EFFECT at zero?" It classifies on `sensitivity_score === 0` or a
 *       declared `zero_reason`, and its one consumer is the edit-comparison
 *       surface.
 *   THIS MODULE                       — "is there any measured VALUE in the
 *       user going and RESOLVING this factor?"
 *
 * They are not the same question and neither subsumes the other. The witnessed
 * factor proves it: `sensitivity_score: -0.35` is emphatically NOT zero, so
 * `zero-effect-factors` correctly does not fire — while `value_of_information`
 * IS zero, which is the fact that makes "go and run a pilot" false. A factor
 * can matter a great deal to the outcome and still be worthless to investigate.
 *
 * PURE AND TOTAL. Reads one persisted PLoT envelope. No I/O, no LLM.
 */

/**
 * What the producer's own numbers license us to say about investigating this
 * factor.
 *
 * ⚠ THESE ARE FOUR DIFFERENT SENTENCES, NOT FOUR SEVERITIES OF ONE. Collapsing
 * any pair would either attach a claim to a factor it is false for, or lose the
 * only true thing we can say. In particular `option_controlled` is NOT a weaker
 * `no_information_value`: the first says "this is a choice you are making", the
 * second says "this is an uncertainty not worth resolving".
 */
export type FactorInvestigationVerdict =
  /**
   * The producer declared the zero AND named an option override as its cause
   * (`zero_reason: "intervention_override"`). This factor is not an open
   * question the user could go and settle — **every option sets its own value
   * for it**. It is not uninformative; it is *not free to vary*.
   */
  | 'option_controlled'
  /**
   * Zero measured value of information AND the tested range produced no
   * reordering (`flip_risk_category: "negligible"` with a zero-or-absent
   * `rank_flip_rate`). The strongest honest statement: nothing we tested would
   * change which option leads.
   */
  | 'no_reordering_found'
  /**
   * Zero measured value of information, but reordering was NOT ruled out — the
   * producer reported a non-zero `rank_flip_rate`, or no flip evidence at all.
   *
   * ⚠ THIS MEMBER EXISTS BECAUSE THE TWO FIELDS DISAGREE ON REAL PRODUCER
   * OUTPUT. In the 2026-09-03 live capture, "UK Market Saturation" carries
   * `flip_risk_category: "negligible"` AND `rank_flip_rate: 0.25`. Licensing
   * "nothing we tested would change which option leads" off the CATEGORY alone
   * would have shipped a second false claim while fixing the first.
   */
  | 'no_information_value'
  /**
   * The producer scored a non-zero value of information. **Today's behaviour is
   * kept unchanged** — this factor genuinely is worth investigating and must
   * keep its recommendation.
   */
  | 'informative'
  /**
   * No value-of-information field arrived at all (older producer). **Absence is
   * never read as zero** — today's behaviour is kept unchanged.
   */
  | 'unscored';

/** One factor's investigation verdict, joined downstream on `factor_id`. */
export interface FactorInvestigationSignal {
  /**
   * Structural id — the ONLY join key a consumer holding an id may use.
   * ⚠ A LABEL IS NOT AN IDENTITY (trap #19): two factors can share one.
   */
  readonly factor_id: string | null;
  readonly factor_label: string;
  readonly verdict: FactorInvestigationVerdict;
  /**
   * True when the value-of-information figure is itself heuristic, or rests on
   * a default (not user-supplied) range — `evpi_method: "heuristic"` or
   * `range_derivation_source: "default"`.
   *
   * Carried so the honest sentence can disclose the strength of its own
   * evidence. Suppressing a false "go investigate this" only to replace it with
   * an overconfident "this is settled" would trade one lie for another.
   */
  readonly heuristic_basis: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Is the producer's measured value of information zero?
 *
 * ⚠ THE TEST IS `<= 0`, NOT "below a near-zero band", AND THE DIRECTION OF THAT
 * CHOICE IS DELIBERATE. Two opposite harms sit under this one predicate and
 * they must not share a window (trap 22b):
 *
 *   - firing too WIDE suppresses a genuine recommendation → the user never
 *     learns about a factor that really was worth resolving (a GAP);
 *   - firing too NARROW leaves the witnessed lie in place (a LIE).
 *
 * A band would buy a little more coverage of the lie at the cost of silently
 * eating small-but-real value. Exact zero is what the producer actually emits
 * for this class (six of six factors in the 2026-09-03 capture, and the
 * witnessed factor), so the narrow test costs nothing real and cannot suppress
 * a positive score. **Any positive value of information keeps today's
 * behaviour.**
 */
function hasNoInformationValue(entry: Record<string, unknown>): boolean {
  const voi = readFiniteNumber(entry.value_of_information);
  if (voi !== null) return voi <= 0;
  // `evpi_percentage_points` is the same claim in different units. Consulted
  // only when the primary field is absent, so a producer that carries one but
  // not the other is still understood.
  const evpi = readFiniteNumber(entry.evpi_percentage_points);
  return evpi !== null ? evpi <= 0 : false;
}

/** Did the producer's tested range leave the option ordering untouched? */
function foundNoReordering(entry: Record<string, unknown>): boolean {
  const category = readNonEmptyString(entry.flip_risk_category);
  if (category === null || category.toLowerCase() !== 'negligible') return false;
  const rankFlipRate = readFiniteNumber(entry.rank_flip_rate);
  // Absent rate ⇒ the category alone carries the claim. A PRESENT non-zero rate
  // REFUTES it — see {@link FactorInvestigationVerdict.no_information_value};
  // the live capture carries exactly this disagreement.
  return rankFlipRate === null ? true : rankFlipRate <= 0;
}

function readsAsHeuristic(entry: Record<string, unknown>): boolean {
  const method = readNonEmptyString(entry.evpi_method);
  const range = readNonEmptyString(entry.range_derivation_source);
  return (
    (method !== null && method.toLowerCase() === 'heuristic') ||
    (range !== null && range.toLowerCase() === 'default')
  );
}

/**
 * Classify one `factor_sensitivity[]` entry.
 *
 * Order is load-bearing: `intervention_override` is consulted FIRST, because a
 * factor every option overrides is also (correctly) scored at zero value of
 * information — and if the generic zero won, the specific and more useful
 * sentence would be lost on exactly the factors that have one.
 */
export function classifyFactorInvestigation(
  entry: Record<string, unknown>,
): FactorInvestigationVerdict {
  const zeroReason = readNonEmptyString(entry.zero_reason);
  if (zeroReason === 'intervention_override') return 'option_controlled';

  const voiPresent =
    readFiniteNumber(entry.value_of_information) !== null ||
    readFiniteNumber(entry.evpi_percentage_points) !== null;
  // Absence is NEVER zero — an older producer keeps today's behaviour.
  if (!voiPresent) return 'unscored';

  if (!hasNoInformationValue(entry)) return 'informative';
  return foundNoReordering(entry) ? 'no_reordering_found' : 'no_information_value';
}

/**
 * Derive the per-factor investigation verdicts from a raw PLoT envelope.
 *
 * @param enrichment the byte-for-byte PLoT envelope persisted on a
 *                   `run_analysis` fact (`result.enrichment`).
 * @returns one entry per labelled `factor_sensitivity[]` row. Entries whose
 *          verdict is `informative` or `unscored` ARE included: a consumer that
 *          needs "this one is genuinely worth investigating" must be able to
 *          read it positively rather than infer it from an absence.
 */
export function deriveFactorInvestigationFromEnrichment(
  enrichment: unknown,
): FactorInvestigationSignal[] {
  const envelope = asRecord(enrichment);
  if (envelope === null) return [];
  const entries = envelope.factor_sensitivity;
  if (!Array.isArray(entries)) return [];

  const out: FactorInvestigationSignal[] = [];
  for (const raw of entries) {
    const entry = asRecord(raw);
    if (entry === null) continue;
    const label =
      readNonEmptyString(entry.factor_label) ?? readNonEmptyString(entry.label);
    if (label === null) continue;
    const factorId =
      readNonEmptyString(entry.factor_id) ??
      readNonEmptyString(entry.node_id) ??
      readNonEmptyString(entry.id);
    out.push({
      factor_id: factorId,
      factor_label: label,
      verdict: classifyFactorInvestigation(entry),
      heuristic_basis: readsAsHeuristic(entry),
    });
  }
  return out;
}
