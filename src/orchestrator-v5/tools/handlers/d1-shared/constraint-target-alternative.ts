/**
 * ⭐⭐ WHEN A LIMIT LANDS ON A TARGET THAT CANNOT CARRY IT, NAME THE ONE THAT CAN.
 *
 * ── THE DEFECT, MEASURED ──────────────────────────────────────────────────
 * Paul's 16 Sep session `1dd2133d`. He said *"that's all we have to spend on
 * hiring resources this year"* and the £200,000 limit was written against
 * `dac3fdc3` — **"Budget Overrun Risk"**, `kind: risk`, `observed_state: null`.
 * **"Hiring and Onboarding Cost" (`7809def4`) was in the same graph.**
 *
 * From the CEE logs:
 *   v5.entity_kind_repaired  handler_id: add_constraint  entity_id: dac3fdc3
 *     proposed_kind: "constraint" -> resolved_kind: "node"
 *   v5.validator_outcome     handler_proposed: add_constraint   valid: true
 *
 * The system repaired the KIND LABEL and passed the entity as valid. Nothing
 * asked whether a *risk* is a plausible target for a *pound* limit.
 *
 * ⚠⚠ AND THE HONEST DISCLOSURE WAS ALREADY THERE AND ALREADY FIRED.
 * `constraint-write-admissibility.ts` (built 14 Sep for the identical defect on
 * "Subscriber Churn Rate") correctly told him *"Budget Overrun Risk has no
 * number recorded against it."* True, and useless: it names the SYMPTOM — this
 * node has no value — and not the CAUSE — the wrong node was chosen.
 *
 * ⇒ The pattern this closes: **converting a silent failure into an honest
 * failure and stopping there.** A truthful dead end is still a dead end.
 *
 * ── WHY THIS DOES NOT MATCH ON LABELS ─────────────────────────────────────
 * ⛔ The obvious implementation — find a factor whose label looks like a cost —
 * is the "label bound the metric" escape hatch, removed from this estate after
 * sixteen defects in one rule (CEE #1328) with a standing instruction never to
 * re-add it. A word in a label is not evidence about a quantity.
 *
 * The basis here is DATA: a candidate is a factor whose own recorded unit
 * matches the constraint's, symbol/code normalised (`£` and `GBP` are one unit
 * spelled two ways). That is the same comparison the writer uses, so a target
 * this names is one the analysis can actually check.
 *
 * ⚠ DEPENDS ON THE SCALE BEING RECORDED. Before the companion transform fix,
 * ZERO of 29 factors carried a unit on the wire, so this would find nothing and
 * correctly stay silent. It gets sharper as that data arrives — it never guesses
 * to fill the gap.
 *
 * ── REFUSALS ──────────────────────────────────────────────────────────────
 * Returns `null` — say nothing — when the chosen target is fine, when the
 * constraint has no unit to match on, or when the candidates number 0 or 2+.
 * Two candidates mean the question is genuinely open and the estate's ruling
 * for that is to ask, never to pick.
 *
 * Pure: no I/O, no LLM, no graph mutation. It proposes a QUESTION, never a write.
 */
import { isCurrencyUnit, sameUnit } from '../../../../utils/currency-alphabet.js';

export interface TargetAlternativeNode {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly label?: unknown;
  readonly observed_state?: unknown;
}

export interface TargetAlternative {
  readonly nodeId: string;
  readonly label: string;
  /** The unit the candidate already records, which is why it is a candidate. */
  readonly unit: string;
}

/**
 * ⚠⚠ THE CANDIDATE TEST IS *NARROWER* THAN WRITE-TIME ADMISSIBILITY, AND THAT
 * INVERSION IS THE WHOLE POINT (Codex CX-150, then derived by execution).
 *
 * The obvious move — and the one I first shipped — was to run the chosen
 * target's own `classifyConstraintWriteAdmissibility` on each candidate. **It
 * does not discriminate here, proven by running it:** that classifier speaks
 * from `constraintTargetCarriesNoQuantity`, which asks *"does this node record
 * any number, on any of the fields a quantity can arrive on"* by reading the
 * TOP-LEVEL keys. A node carrying `observed_state: {unit: 'GBP'}` and no figure
 * has a non-null `observed_state`, so it answers YES and classifies as
 * checkable — while PLoT's `classifyConstraintPu` reads `observed_state.value`
 * specifically and emits `missing_observed_state`.
 *
 * ⭐ That gap is DELIBERATE AND CORRECT WHERE IT LIVES, which is why widening
 * the shared predicate would be the wrong repair. For a REFUSAL the safe error
 * is a false silence — telling a user their good limit will be ignored is worse
 * than the defect. **Here the direction is inverted: a false positive NAMES A
 * NODE TO THE USER.** Two questions under one predicate (CLAUDE.md trap 21), so
 * they get two predicates, not one relaxed one.
 *
 * Derived at the consumer's bytes (`plot-lite-service`
 * `src/integrations/isl/translator-v3.ts` → `buildParameterUncertaintiesV3`,
 * pass 1): `kind === 'factor' && Number.isFinite(observed_state.value)`.
 *
 * ⚠ GAP RECORDED, NOT CHASED: PLoT's pass 2 also admits a factor carrying a
 * non-degenerate uniform `prior` and no `observed_state.value`. This stays
 * SILENT about that class rather than proposing it, because the entailment then
 * runs the safe way — everything proposed here is evaluable; not everything
 * evaluable is proposed.
 */
function recordsATestableFigure(node: TargetAlternativeNode): boolean {
  const os = node.observed_state;
  if (os === null || typeof os !== 'object' || Array.isArray(os)) return false;
  const value = (os as { value?: unknown }).value;
  return typeof value === 'number' && Number.isFinite(value);
}

function recordedUnit(node: TargetAlternativeNode): string | null {
  const os = node.observed_state;
  if (os === null || typeof os !== 'object' || Array.isArray(os)) return null;
  const unit = (os as { unit?: unknown }).unit;
  return typeof unit === 'string' && unit.trim() !== '' ? unit : null;
}

/**
 * The one factor that could carry this limit, when exactly one can.
 *
 * @param chosenNodeId the target actually written, which is excluded from the
 *   candidates — proposing the node the user already has is not an alternative.
 */
export function findConstraintTargetAlternative(input: {
  /** The admissibility verdict for the chosen target. */
  readonly chosenIsCheckable: boolean;
  readonly chosenNodeId: string;
  /** The constraint's own unit, from the persisted row. Never inferred. */
  readonly constraintUnit: string | null | undefined;
  readonly nodes: readonly TargetAlternativeNode[];
}): TargetAlternative | null {
  // A checkable target needs no alternative, whatever else is in the graph.
  if (input.chosenIsCheckable) return null;

  const unit = typeof input.constraintUnit === 'string' ? input.constraintUnit.trim() : '';
  // With no unit there is nothing to match on, and matching on anything else
  // would be the label heuristic wearing a different hat.
  if (unit === '') return null;
  // ⛔ AND ONLY A CURRENCY. A shared `%` or `scale` says the two factors use
  // the same NOTATION, not that they measure the same kind of thing.
  if (!isCurrencyUnit(unit)) return null;

  const candidates: TargetAlternative[] = [];
  for (const node of input.nodes) {
    const id = typeof node.id === 'string' && node.id.trim() !== '' ? node.id : null;
    const label = typeof node.label === 'string' && node.label.trim() !== '' ? node.label.trim() : null;
    if (id === null || label === null) continue;
    if (id === input.chosenNodeId) continue;
    // Only a factor. An outcome or goal is derived by the engine, and a second
    // risk is the same mistake again.
    if (node.kind !== 'factor') continue;

    const candidateUnit = recordedUnit(node);
    if (candidateUnit === null || !sameUnit(candidateUnit, unit)) continue;

    // ⚠⚠ A MATCHING UNIT IS NOT A USABLE TARGET (Codex CX-150). It establishes
    // NOTIONAL COMPATIBILITY and nothing else — not amount, not scale, not
    // period, not quantity identity. A factor recording `{unit: 'GBP'}` and no
    // figure passes a unit match and is still the same dead end with a
    // different label — which is the very state this path exists to report.
    // See {@link recordsATestableFigure} for why this is NOT the chosen
    // target's own admissibility classifier.
    if (!recordsATestableFigure(node)) continue;

    candidates.push({ nodeId: id, label, unit: candidateUnit });
  }

  // Exactly one, or the question is genuinely open and must be asked rather
  // than answered (trap 22f — where direction cannot be determined, ask).
  return candidates.length === 1 ? candidates[0]! : null;
}

/**
 * The question. Names the node that cannot carry the limit and the one that
 * MIGHT be meant — so the user can correct it in one reply instead of
 * discovering two turns later that nothing was checked.
 *
 * ⚠⚠ IT OFFERS A CANDIDATE, NOT AN ASSURED TARGET (Codex CX-150). An earlier
 * draft said the alternative "does" have a figure the analysis can test. A
 * shared currency establishes notional compatibility only: a £revenue factor
 * is not a hiring-cost subject, and claiming otherwise is the same overreach
 * as the partial record this lane already shipped once. The copy states the
 * one thing that IS established — it is the only node recorded in that unit —
 * and asks.
 *
 * ⚠ It ASKS. It does not re-target anything: the user chose a node, and moving
 * their limit under them on a unit match would be exactly the confident
 * wrongness the admissibility check exists to prevent.
 *
 * ⚠⚠ AND IT PROMISES ONLY WHAT THE WRITE PATH CAN DO — "add", NOT "move"
 * (derived at `add-constraint.ts`, Codex CX-150's second half, which I had
 * claimed nothing about until I checked).
 *
 * The idempotency key for a constraint row is **`(node_id, operator)`**
 * (`add-constraint.ts:448`). Accepting this suggestion writes a DIFFERENT
 * `node_id`, so `existing` is `undefined` and the row **APPENDS**. `add_constraint`
 * is the only constraint handler in the estate, `apply-graph-mutation.ts:195`
 * states it "does NOT prune", and no removal path exists — so the original row
 * against the un-testable node SURVIVES, and keeps producing "One limit on your
 * model could not be checked" on every later rerun.
 *
 * ⭐ A first draft of this sentence said *"I will move the limit to it."* That
 * would have been a promise the write path cannot keep, invited by the very
 * disclosure meant to fix a dead end — the same shape as the honest-failure
 * pattern this module exists to break, pointed the other way. The copy says
 * "as well" because that is what actually happens.
 *
 * The exact move needs a supersession carrier (`{from_node_id, to_node_id,
 * operator}`) AND a consumer on the accept path. Named as the follow-up, NOT
 * built here: a producer without a round-trip is a mechanism this lane has
 * already shipped once and had to withdraw.
 */
export function formatConstraintTargetAlternative(input: {
  readonly chosenLabel: string;
  readonly alternative: TargetAlternative;
}): string {
  return (
    `I recorded this against ${input.chosenLabel}, which has no figure for the `
    + `analysis to test. ${input.alternative.label} may be the one you meant \u2014 `
    + `it is the only thing in your model recorded in ${input.alternative.unit}. `
    + `Say so and I will put the limit there as well.`
  );
}

