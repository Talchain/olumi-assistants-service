/**
 * ⭐⭐⭐ THE PERSON'S CAUSAL CLAIM ENDS AT A FACTOR THE OPTIONS SET THEMSELVES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT.
 *
 * Measured 19 Sep, scenario `26b908ee`. The person described a mechanism —
 * founder capacity drives time on fundraising drives capital raised — and the
 * product drew it: two authored edges, plus an option→time edge for all four
 * options. Real structural progress, visible on screen.
 *
 * And every option ALSO sets Capital Raised directly (`caf9ad5c`: 0.575, 0.45,
 * 0, 0.65). The producer says so in its own words on the run:
 * `zero_reason: "intervention_override"`.
 *
 * The 19:23 reply honestly disclosed the four missing option→time effects and
 * offered to collect them. What it never said is that the far end of the chain
 * is set directly by the options. **So the person is invited to spend effort on
 * a configuration step without the one fact that bears on whether it is worth
 * spending.** They cannot read it off the screen: the edges are drawn, the
 * numbers are plausible, and nothing is wrong with any of them individually.
 *
 * ⚠ AND THE FACT ALREADY EXISTS — IT JUST IS NOT GUARANTEED TO BE SAID.
 * `context/factor-investigation-licence.ts` already classifies this exact
 * condition as `option_controlled` from the producer's `zero_reason`, and
 * `format/format-analysis-for-context.ts` already carries the phrase *"every
 * option sets its own value for this — a choice, not an uncertainty to
 * investigate"*. That reaches the MODEL'S CONTEXT. Whether the person hears it
 * depends on the model choosing to relay it, and on the captured turn it did
 * not. This module is the deterministic half — the same shape as the
 * separation voice added in #1627, for the same reason.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔⛔ WHAT THIS MAY NOT CLAIM. Each of these was withdrawn by Core against my
 * own earlier draft, and the copy is built to make them unsayable.
 *
 *  1. ⛔ NOT "the comparison is inert" and NOT "your effort is wasted". A pin
 *     establishes that the options set that factor. It does NOT establish a
 *     generic downstream effect, whole-comparison inactivity, or that outcomes
 *     would be identical if the pins were removed (Core, CORE-CAPACITY-06).
 *
 *  2. ⛔ NOT A COMPOSED MULTI-HOP PATH. This reads ONE authored edge. It does
 *     not walk, and it does not stand in for the two-edge
 *     capacity → time → capital journey — Core required that scope be
 *     preserved "in the copy and acceptance claim", so the copy names the one
 *     link it actually read and stops.
 *
 *  3. ⛔ NO INVENTED QUANTITY. Nothing here converts a level word into a
 *     number, and the workload ordering stays qualitative.
 *
 *  4. ⛔ NEVER RE-DERIVES THE PRODUCER'S VERDICT. `decide-option-cost-ask.ts`
 *     records the cost of getting this wrong: PR #1225 shipped its own
 *     "the target carries no quantity" gate and was REVERTED, because it
 *     inverts on DERIVED targets — 20/20 outcome and goal nodes read as
 *     quantity-free precisely because ISL derives them. So `option_controlled`
 *     arrives here as an INPUT. This module chooses only which link to name.
 */

import type { FactorInvestigationSignal } from '../context/factor-investigation-licence.js';
import type { SuggestedAction } from '../../orchestrator/types.js';

/** One authored edge, as the canonical graph carries it. `EdgeV3`: from → to. */
export interface AuthoredEdge {
  readonly from?: unknown;
  readonly to?: unknown;
}

/** Minimal node projection — id and label, by identity never by label (trap 19). */
export interface ChainNode {
  readonly id?: unknown;
  readonly label?: unknown;
}

export interface OptionControlledChainFinding {
  /** The factor the person made a claim about. */
  readonly subjectId: string;
  readonly subjectLabel: string;
  /** The factor at the far end of the ONE authored edge read. */
  readonly controlledId: string;
  readonly controlledLabel: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Is the subject one authored edge away from a factor the producer has called
 * `option_controlled`?
 *
 * Returns `null` on every uncertainty. The failure direction is "says nothing",
 * which is correct: the existing disclosure and the model's own context are
 * unaffected, and a wrong link named here would be worse than silence.
 *
 * ⚠ EDGES ARE DIRECTIONAL AND THIS READS `from → to` ONLY. The captured chain
 * runs capacity → time → capital, i.e. the person's subject is UPSTREAM. An
 * undirected read would also fire on a factor that merely feeds the subject,
 * which is a different sentence and not one this copy makes.
 *
 * ⚠ AMBIGUITY REFUSES. Two or more option-controlled neighbours is a question,
 * not a fact, and naming one of them would be a guess wearing a disclosure's
 * clothes.
 */
export function findOptionControlledChain(
  subjectId: string | null | undefined,
  nodes: readonly ChainNode[] | null | undefined,
  edges: readonly AuthoredEdge[] | null | undefined,
  investigation: readonly FactorInvestigationSignal[] | null | undefined,
): OptionControlledChainFinding | null {
  const subject = str(subjectId);
  if (subject === null) return null;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
  if (!Array.isArray(investigation) || investigation.length === 0) return null;

  const controlledIds = new Set(
    investigation
      .filter((s) => s.verdict === 'option_controlled')
      .map((s) => str(s.factor_id))
      .filter((id): id is string => id !== null),
  );
  if (controlledIds.size === 0) return null;

  const labelById = new Map<string, string>();
  for (const n of nodes) {
    const id = str(n.id);
    const label = str(n.label);
    if (id !== null && label !== null) labelById.set(id, label);
  }
  const subjectLabel = labelById.get(subject);
  if (subjectLabel === undefined) return null;

  const downstream = new Set<string>();
  for (const e of edges) {
    if (str(e.from) !== subject) continue;
    const to = str(e.to);
    if (to !== null && controlledIds.has(to)) downstream.add(to);
  }
  if (downstream.size !== 1) return null;

  const controlledId = [...downstream][0]!;
  const controlledLabel = labelById.get(controlledId);
  if (controlledLabel === undefined) return null;

  return { subjectId: subject, subjectLabel, controlledId, controlledLabel };
}

/**
 * The sentence. ONE authored link, named; the producer's own verdict, relayed;
 * and a question, because what to do about it is the person's call and not a
 * conclusion this module is entitled to draw.
 *
 * ⚠ EVERY CLAUSE IS THE WEAKEST TRUE ONE, in the manner of
 * `analysis-participation-disclosure.ts`:
 *   · "you've linked A to B" — an authored edge exists. Read, not inferred.
 *   · "every option sets its own value for B" — the producer's
 *     `intervention_override`, relayed in the words the context formatter
 *     already uses.
 *   · "so a change to A reaches the comparison through some OTHER route, if it
 *     reaches it at all" — the honest consequence of a direct set, and it
 *     stops short of claiming there is no other route, which this module did
 *     not look for.
 *   · the question, not a recommendation.
 */
export function composeOptionControlledChainAsk(
  finding: OptionControlledChainFinding,
): string {
  return (
    `You've linked ${finding.subjectLabel} to ${finding.controlledLabel}, and ` +
    `every option sets its own value for ${finding.controlledLabel} directly. ` +
    `So a change to ${finding.subjectLabel} reaches the comparison through some ` +
    `other route, if it reaches it at all. Do you want ${finding.controlledLabel} ` +
    `to follow from ${finding.subjectLabel} instead of being set per option — or ` +
    `is setting it per option what you meant?`
  );
}

/**
 * ⭐⭐ THE RETAINED ANSWER — and it is retained by the EXISTING interface, not
 * a new one.
 *
 * The person's answer must bind to the exact pair this asked about, or the ask
 * is a dead end — the same defect as inviting an estimate the product cannot
 * record. So the offer is not free prose: each chip's `prompt` is a
 * well-formed instruction naming BOTH factors, which routes through the
 * existing edit path → `graph-management/referee` → `compose/held-proposal` →
 * Core's validated atomic apply on consent.
 *
 * ⛔ NO NEW PENDING KIND, NO NEW HELPER, NO NEW CONSENT MECHANISM. Core's
 * direction was explicit that the held-consent operation already exists; a
 * bespoke retention path here would be a second consent surface for one
 * decision, which is how this estate grows twins. The chip IS the retention:
 * it carries the pair forward in a form the existing routing already binds.
 *
 * ⚠ BOTH ANSWERS ARE OFFERED, AND NEITHER IS RECOMMENDED. "Keep it per option"
 * is a legitimate model — it is what the person already has, and the captured
 * receipt for that choice is truthful today. Offering only the change would
 * make a question into a nudge, and the whole point of asking is that this
 * module cannot know which they meant.
 *
 * ⚠ THE CHANGE CHIP DOES NOT PROMISE AN OUTCOME. Its prompt asks for the
 * structural change and nothing about what the comparison will then show —
 * because this module read one authored edge and has no basis for a claim
 * about the result (Core, CORE-CAPACITY-06).
 */
export function buildOptionControlledChainActions(
  finding: OptionControlledChainFinding,
): SuggestedAction[] {
  return [
    {
      label: `Let ${finding.controlledLabel} follow from ${finding.subjectLabel}`,
      prompt:
        `Stop setting ${finding.controlledLabel} directly on each option, and let it ` +
        `follow from ${finding.subjectLabel} instead.`,
      role: 'facilitator',
    },
    {
      label: `Keep setting ${finding.controlledLabel} per option`,
      prompt:
        `Keep ${finding.controlledLabel} set per option \u2014 that is what I meant.`,
      role: 'facilitator',
    },
  ];
}
