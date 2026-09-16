/**
 * ⭐ GO(A) — WHICH OPTION'S NATIVE COST TO ASK FOR, WHEN A MONEY LIMIT COULD NOT BE CHECKED.
 *
 * ## The defect this exists to close
 *
 * Measured on Paul's manual session `82f31082` (CEE `952187a`, 15 Sep 2026):
 * a budget limit saved perfectly — `Hiring Cost <= 200000`, `unit: "GBP"`,
 * `value_frame: "level"`, `provenance: "explicit"` — while the three options
 * carried UNITLESS interventions on that same factor (`0`, `0.85`, `0.7`) and
 * no native value anywhere. PLoT therefore refused to score it and CEE
 * correctly withheld the leader.
 *
 * The product then said, truthfully and uselessly:
 *
 *   "Tell me the limit you meant in your own words and I will record it."
 *
 * The limit was ALREADY correct. Restating it changes nothing, and the run
 * stays blocked. Every pending action minted on that turn was `run_analysis`
 * or `what_would_flip` — so even a perfect answer had nothing to bind to.
 *
 * The genuinely missing datum is the OPTION'S OWN COST IN THE LIMIT'S UNIT.
 * That is what this module selects, for the existing `elicit_option_effect`
 * carrier, whose reader (`routing/repair-value-binding.ts`) already binds a
 * bare value to the exact `(option_id, factor_id)` the pending names.
 *
 * ## ⚠⚠ WHY THE TRIGGER IS THE PRODUCER'S VERDICT AND NEVER OUR OWN PREDICTION
 *
 * The obvious gate — "the target carries no monetary quantity, so nothing can
 * score it" — IS A REVERTED RELEASE BLOCKER. PR #1225 shipped exactly that
 * predicate as `unmeasuredTargetIds` and it was reverted, because it inverts on
 * DERIVED targets: an `outcome` or `goal` node carries no stored quantity
 * PRECISELY BECAUSE ISL derives its value. Measured on #1225's own captured
 * deployed node sets, 20/20 outcome and goal nodes read as "carries no
 * quantity" against a clean contrast of 18 quantity-bearing factors — so the
 * gate fired hardest exactly where the engine is most able to score.
 * See the ⚠⚠ block at `tools/handlers/run-analysis.ts` (~:1473).
 *
 * So this module NEVER decides whether a constraint is scoreable. It is handed
 * the producer's own "I did not reach decision grade" verdict and only chooses
 * WHICH CELL to ask about. `notDecisionGrade` is an input, not a derivation.
 *
 * ## Refusals — each one is a decision not to guess
 *
 * Returns `null`, asking nothing, when:
 *   - the producer did not withhold (nothing to repair);
 *   - the ratified set contains 0 or 2+ monetary constraints — with two, the
 *     cell to ask about is ambiguous and picking one would be a guess;
 *   - the constraint carries no `node_id` or no `unit` (nothing to name, or no
 *     unit to record the answer in);
 *   - the target does not resolve to exactly one FACTOR node by id;
 *   - the unit is a bare ratio (`%` / `fraction`) — then the cell is already in
 *     the model's own scale and a "native value" question is meaningless;
 *   - every participating option already records a native value.
 *
 * ## One cell at a time, by construction
 *
 * `PENDING_ACTIONS_PER_TURN_CAP` is 3 and the turn's other pendings compete for
 * those slots, so minting one row per option would evict them. It is also the
 * shape the estate already uses: `buildReadinessEffectPending` mints ONE
 * `(option, factor)` pending and `carryForwardOptionEffectAttempt` moves to the
 * next missing cell on the following turn, resetting `attempt` because a new
 * cell is a new question.
 *
 * Pure: no I/O, no LLM, no telemetry, no clock.
 */

/** A graph NODE, at the shape this decision needs. Used only to resolve the target factor. */
export interface OptionCostAskNode {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly label?: unknown;
}

/**
 * An OPTION ENTRY (`OptionV3`), which is a different object from a graph node
 * and is the one that matters here.
 *
 * ⚠⚠ READ THE ENTRY, NEVER THE NODE. `raw_interventions` is the
 * OPTION-ENTRY-ONLY pre-encoding carrier — `reconcile-top-level-options.ts`
 * states it outright, having swept for the alternative: "zero
 * `raw_interventions` writes onto a node exist in `src/`". A first cut of this
 * module read `node.raw_interventions`, which is therefore ALWAYS `undefined`,
 * so the discriminator below would have read "no native value" for every
 * option forever — asking for a figure the product already held. Caught by
 * checking the carrier at the contract rather than by inspection.
 */
export interface OptionCostAskOption {
  readonly id?: unknown;
  readonly label?: unknown;
  /** ALWAYS present on `OptionV3`: factor id → encoded intervention. */
  readonly interventions?: unknown;
  /**
   * OPTIONAL on `OptionV3`: the original value before encoding. Its presence
   * for a factor says "we already hold this option's value in its own units",
   * so its ABSENCE beside a present `interventions` entry is the whole
   * discriminator — an encoded number with no native record behind it.
   */
  readonly raw_interventions?: unknown;
}

/** The cell to ask about, named by identity. */
export interface OptionCostAskTarget {
  readonly option_id: string;
  readonly option_label: string;
  readonly factor_id: string;
  readonly factor_label: string;
  /** The unit the answer will be recorded in — the constraint's own, never invented. */
  readonly unit: string;
  /** The user-ratified limit this repairs, for copy that names what it is about. */
  readonly constraint_label: string | null;
}

/** A ratified constraint at the shape this decision needs. */
export interface OptionCostAskConstraint {
  readonly node_id?: string | null;
  readonly unit?: string | null;
  readonly label?: string | null;
}

/**
 * Units that are NOT a native scale — a value already expressed as a ratio has
 * no separate "real" figure to collect, so asking would be incoherent.
 * Lower-cased membership test; a currency code or a named unit is anything else.
 */
const NON_NATIVE_UNITS: ReadonlySet<string> = new Set(['%', 'percent', 'fraction', 'ratio', 'probability']);

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** True when this constraint states a threshold in a native (non-ratio) unit. */
function isMonetaryish(c: OptionCostAskConstraint): boolean {
  const unit = typeof c.unit === 'string' ? c.unit.trim() : '';
  if (unit.length === 0) return false;
  return !NON_NATIVE_UNITS.has(unit.toLowerCase());
}

export function decideOptionCostAsk(input: {
  /**
   * The PRODUCER's verdict, read off the wire by the caller. Never derived
   * here — see the ⚠⚠ block above; deriving it is a reverted release blocker.
   */
  readonly notDecisionGrade: boolean;
  readonly ratified: readonly OptionCostAskConstraint[];
  /** Graph nodes — used ONLY to resolve the constraint's target factor. */
  readonly nodes: readonly OptionCostAskNode[];
  /** Option ENTRIES — the only carrier of `raw_interventions`. */
  readonly options: readonly OptionCostAskOption[];
}): OptionCostAskTarget | null {
  if (!input.notDecisionGrade) return null;

  // Exactly one native-unit constraint, or we would be guessing which cell the
  // user's answer belongs to.
  const monetary = input.ratified.filter(isMonetaryish);
  if (monetary.length !== 1) return null;
  const constraint = monetary[0]!;

  const factorId = readId(constraint.node_id);
  const unit = typeof constraint.unit === 'string' ? constraint.unit.trim() : '';
  if (factorId === null || unit.length === 0) return null;

  // Bind the target by IDENTITY and require it to be a factor — a duplicate or
  // foreign id is not a referent (trap 19).
  const factors = input.nodes.filter((n) => readId(n.id) === factorId && n.kind === 'factor');
  if (factors.length !== 1) return null;
  const factorLabel = typeof factors[0]!.label === 'string' ? factors[0]!.label.trim() : '';
  if (factorLabel.length === 0) return null;

  // The first option that PARTICIPATES in this factor (it carries an encoded
  // intervention) but holds NO native value for it. Stable graph order, so a
  // re-ask on an unchanged graph names the same cell rather than rotating.
  for (const option of input.options) {
    const optionId = readId(option.id);
    const optionLabel = typeof option.label === 'string' ? option.label.trim() : '';
    if (optionId === null || optionLabel.length === 0) continue;

    const encoded = readRecord(option.interventions);
    if (encoded === null || encoded[factorId] === undefined) continue;

    const native = readRecord(option.raw_interventions);
    if (native !== null && native[factorId] !== undefined) continue;

    return {
      option_id: optionId,
      option_label: optionLabel,
      factor_id: factorId,
      factor_label: factorLabel,
      unit,
      constraint_label: typeof constraint.label === 'string' ? constraint.label : null,
    };
  }

  return null;
}
