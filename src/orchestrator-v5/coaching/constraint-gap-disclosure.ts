/**
 * T1 — deterministic disclosure for a hard constraint that was APPLIED and
 * then never evaluated.
 *
 * DEFECT THIS CLOSES (reported 1/1 on live staging): the user asked for total
 * three-year cost below £2,500; CEE replied "Added constraint: Total
 * three-year cost must be at most £2,500."; PLoT returned
 * `CONSTRAINT_OUT_OF_DOMAIN` and withheld goal-fit under
 * `CONSTRAINT_TARGET_UNRELIABLE`; CEE then led with "MacBook Pro currently
 * leads by 18 percentage points" and disclosed nothing in the primary message.
 * The condition was accepted, silently discarded by the engine, and a
 * recommendation was asserted over the top of it.
 *
 * Required behaviour (three parts, all deterministic):
 *   (a) the leading-option claim is withheld — done by the headline builder
 *       via `constraint_unevaluated` (analysis-result-headline.ts);
 *   (b) THIS module states exactly which user condition was not evaluated;
 *   (c) THIS module offers a repair step the user can act on.
 *
 * Claim-safety posture: this copy is composed from CEE's OWN persisted
 * `goal_constraints` labels (user-ratified text CEE already echoed back at
 * ratification time), never from PLoT enrichment content. The producer's
 * warning CODES decide only WHETHER to speak — no message, wording or value
 * from a PLoT warning entry is read or interpolated, so no Tier-3 field
 * reaches user-facing prose. Labels pass through the same `sanitiseLabel`
 * the headline grammar uses; a label that fails sanitisation degrades to a
 * count-only phrasing rather than leaking an id.
 */

import { sanitiseLabel } from '../context/enrichment-graph-labels.js';
import type { RatifiedConstraint } from '../../orchestrator/context/constraint-feasibility.js';

/**
 * How many constraint labels to name before collapsing to a count. Keeps the
 * primary message readable when a brief ratified many conditions.
 */
const MAX_NAMED_CONSTRAINTS = 3;

/**
 * The repair step. Deterministic and constant — it never interpolates a
 * value, unit, or engine message. The out-of-domain class is always the same
 * shape of mistake: a threshold in real units bound to a target that does not
 * carry those units.
 */
const REPAIR_STEP =
  ' Re-state that limit against a measure recorded in the same units as the limit, then run the analysis again.';

function quoted(label: string): string {
  return `“${label}”`;
}

/** Join labels as "A", "A and B", "A, B and C". */
function joinLabels(labels: readonly string[]): string {
  if (labels.length === 1) return quoted(labels[0]!);
  const quotedLabels = labels.map(quoted);
  const last = quotedLabels[quotedLabels.length - 1]!;
  return `${quotedLabels.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * Build the disclosure sentence(s) for unevaluated hard constraints, or the
 * empty string when there is nothing to disclose.
 *
 * Returns a leading-space-prefixed fragment so it appends to the summary the
 * same way the scaffold and reduced-samples disclosures do.
 */
export function buildConstraintGapDisclosure(
  constraints: readonly RatifiedConstraint[],
): string {
  if (constraints.length === 0) return '';

  const named: string[] = [];
  for (const c of constraints) {
    if (named.length >= MAX_NAMED_CONSTRAINTS) break;
    const clean =
      c.label === null ? null : sanitiseLabel(c.label, c.constraint_id);
    if (clean !== null) named.push(clean);
  }

  const subject =
    named.length === 0
      ? constraints.length === 1
        ? 'One of the conditions you set was not checked.'
        : `${constraints.length} of the conditions you set were not checked.`
      : constraints.length === 1
        ? `One of the conditions you set was not checked: ${joinLabels(named)}.`
        : `${constraints.length} of the conditions you set were not checked, including ${joinLabels(named)}.`;

  return ` ${subject} The analysis engine could not evaluate ${constraints.length === 1 ? 'it' : 'them'} against this model, so no option can be recommended yet.${REPAIR_STEP}`;
}
