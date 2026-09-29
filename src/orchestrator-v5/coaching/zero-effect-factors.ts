/**
 * WHICH FACTORS DID **THIS ANALYSIS** MEASURE AS HAVING NO MARGINAL EFFECT?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ THE PRODUCER'S OWN VERDICT, READ FROM THE SAME PAYLOAD THE PROSE IS
 * COMPOSED FROM. On the 2026-09-03 capture the product told the user its lead
 * moved *"because the higher investment value increases the modelled Runway
 * Depletion Risk more strongly"*. The refutation was in the same envelope, on
 * the very factor named: `sensitivity_score: 0`, `elasticity: 0`,
 * `value_of_information: 0`, `influence_rank: 6 of 6`, and — decisively —
 * `zero_reason: "intervention_override"`. Nothing had to be inferred. Nothing
 * had to be recomputed. The producer had already said it.
 *
 * So the rule this module enables is not a heuristic: **a factor the analysis
 * scored at zero cannot be the reason anything moved, and no sentence may say
 * it was.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ RELATION TO THE TWO NEIGHBOURING AUTHORITIES — three questions, three
 * names, no defaults aligned (CLAUDE.md trap #21):
 *
 *   `context/intervention-controlled-drivers.ts`  — STRUCTURAL, from the graph:
 *       "is this factor a lever SOME option pulls?"
 *   `context/baseline-override-reach.ts`          — STRUCTURAL, from the graph:
 *       "is this factor's baseline replaced by EVERY option?"
 *   THIS MODULE                                   — MEASURED, from the analysis:
 *       "did this run score this factor at zero, and why?"
 *
 * The structural pair can answer before any analysis exists; this one cannot.
 * This one catches a zero the graph does not explain (a flat factor, a
 * disconnected one, a producer zero we have not modelled); the structural pair
 * catches an inert edit on a graph whose last analysis is stale or absent.
 * **Neither subsumes the other and both are consulted.** That union is also the
 * completeness check each list needs from OUTSIDE itself: a factor missing from
 * the envelope's `factor_sensitivity[]` is still caught structurally, and a
 * producer zero with no structural explanation is still caught here.
 *
 * ⚠ `intervention-controlled-drivers.ts` says in its own header that CEE "does
 * not consume" `zero_reason`. That sentence is TRUE OF THAT MODULE and is not
 * an estate-wide rule: it explains why a claim-safety BACKSTOP for a producer
 * gap must be structural (a structural check still fires when the producer has
 * not been fixed). It is not a reason to ignore the producer when the producer
 * has spoken — `coaching/analysis-result-headline.ts` already reads
 * `zero_reason` for exactly this purpose.
 *
 * PURE AND TOTAL. Reads one persisted PLoT envelope. No I/O, no LLM.
 */

/**
 * Why the analysis scored this factor at zero.
 *
 * `intervention_override` is kept as its own member because it supports a
 * SPECIFIC and actionable sentence — "every option sets its own value for
 * this, so this figure is the baseline they replace" — which the generic zero
 * does not. Collapsing them would either lose that coaching or attach it to
 * zeroes it is false for.
 */
export type ZeroEffectReason =
  /** The producer declared the zero and named an option override as the cause. */
  | 'intervention_override'
  /**
   * The producer declared some OTHER zero reason. Kept as one member rather
   * than an enum of PLoT's vocabulary: a hand-listed enum here is a mirror of
   * a list this repo does not own, and it would drift the moment PLoT adds a
   * reason (CLAUDE.md trap #12). What every member of this class has in common
   * is the only thing the consumers need — the producer says the effect is
   * zero.
   */
  | 'producer_declared_zero'
  /** No reason was declared; the measured sensitivity is itself zero. */
  | 'zero_sensitivity';

export interface ZeroEffectFactorIndex {
  /** Structural ids (`factor_id` / `node_id` / `id`) → reason. */
  readonly byId: ReadonlyMap<string, ZeroEffectReason>;
  /**
   * Normalised labels → reason. Present because some surfaces hold only a
   * label. ⚠ A LABEL IS NOT AN IDENTITY (trap 19): two factors can share one,
   * so this index is for surfaces that have nothing better, and every caller
   * that holds an id must join on {@link byId}.
   */
  readonly byLabel: ReadonlyMap<string, ZeroEffectReason>;
}

const EMPTY_INDEX: ZeroEffectFactorIndex = {
  byId: new Map(),
  byLabel: new Map(),
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normaliseLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Classify one `factor_sensitivity[]` entry, or null when it is not a zero.
 *
 * ⚠ THE `zero_reason` TEST IS "A REASON WAS DECLARED", NOT "THE REASON IS ONE
 * I RECOGNISE". Testing `=== 'intervention_override'` alone would let every
 * future PLoT zero reason through as though the factor were live — a guard
 * derived from a list the consumer does not own, which is the mirror defect in
 * its most damaging direction (silence, not noise).
 */
function classifyEntry(entry: Record<string, unknown>): ZeroEffectReason | null {
  const zeroReason = entry.zero_reason;
  if (typeof zeroReason === 'string' && zeroReason.trim().length > 0) {
    return zeroReason.trim() === 'intervention_override'
      ? 'intervention_override'
      : 'producer_declared_zero';
  }
  const sensitivity = entry.sensitivity_score;
  if (typeof sensitivity === 'number' && Number.isFinite(sensitivity) && sensitivity === 0) {
    return 'zero_sensitivity';
  }
  return null;
}

/**
 * Index the factors this analysis scored at zero.
 *
 * @param enrichment the byte-for-byte PLoT envelope persisted on a
 *                   `run_analysis` fact (`result.enrichment`).
 */
export function collectZeroEffectFactors(enrichment: unknown): ZeroEffectFactorIndex {
  const envelope = readRecord(enrichment);
  if (envelope === null) return EMPTY_INDEX;
  const entries = envelope.factor_sensitivity;
  if (!Array.isArray(entries)) return EMPTY_INDEX;

  const byId = new Map<string, ZeroEffectReason>();
  const byLabel = new Map<string, ZeroEffectReason>();

  for (const raw of entries) {
    const entry = readRecord(raw);
    if (entry === null) continue;
    const reason = classifyEntry(entry);
    if (reason === null) continue;
    // Every id spelling a PLoT entry may carry. `analysis-compact` resolves
    // `node_id ?? factor_id`, so an entry keyed by only one of them must still
    // be findable by whichever id the caller holds.
    for (const key of ['factor_id', 'node_id', 'id'] as const) {
      const value = entry[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        byId.set(value.trim(), reason);
      }
    }
    for (const key of ['factor_label', 'label'] as const) {
      const value = entry[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        byLabel.set(normaliseLabelKey(value), reason);
      }
    }
  }

  return { byId, byLabel };
}

/**
 * The reason this factor was scored at zero, or null when it was not.
 *
 * Joins on the STRUCTURAL id. `label` is consulted only when no id is held —
 * pass `null` rather than a placeholder so the weaker join is a deliberate act
 * at each call site.
 */
export function zeroEffectReasonFor(
  index: ZeroEffectFactorIndex,
  factorId: string | null,
  label: string | null = null,
): ZeroEffectReason | null {
  if (factorId !== null) {
    const id = factorId.trim();
    if (id.length > 0) {
      const byId = index.byId.get(id);
      if (byId !== undefined) return byId;
    }
  }
  if (label !== null && label.trim().length > 0) {
    return index.byLabel.get(normaliseLabelKey(label)) ?? null;
  }
  return null;
}
