/**
 * Agent lane — the RICH DECISION MODEL.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐⭐ THE DIRECTION OF TRAVEL IS FIXED, AND THIS TYPE IS WHY.
 *
 *      rich meaning  ->  explicit analysis projection  ->  GraphV3 / PLoT
 *
 * NEVER rich meaning -> force everything into GraphV3 -> reconstruct meaning
 * later. Reconstruction is not possible: the information is gone by then. This
 * module is the canonical meaning; `project-for-analysis.ts` is the lossy step,
 * and it is lossy ON PURPOSE and ON THE RECORD.
 *
 * ⛔ THIS IS NOT A SUPERSET OF GraphV3 AND MUST NOT DRIFT INTO ONE. If a field
 * here starts existing only because GraphV3 needs it, it belongs in the
 * projection instead.
 *
 * ⭐ WHAT GraphV3 CANNOT HOLD — the concrete cases, from the banked six-turn
 * conversation rather than from imagination:
 *
 *   · "It could increase our churn by at least 2%" — a magnitude that is a
 *     FLOOR, not a point estimate.
 *   · "They ran the deal for 1 month, and after 2 months churn returned to
 *     normal" — onset, duration and recovery. `EdgeV3` has no temporal field of
 *     any kind, so a two-month shock and a permanent shift are the same edge.
 *   · "Our competitors have undercut us before and are likely to again" — a
 *     qualitative basis for believing a link exists, with no number at all.
 *   · "monthly churn under 4%" — a STRICT bound. `GoalConstraintSchema` offers
 *     only `>=` and `<=` (src/schemas/assist.ts:401-407), so admitting it
 *     widens the user's own constraint to admit exactly 4.0.
 *   · direction known, magnitude unknown — measured as 10 of 10 proposed links
 *     in the first live run of the banked construction chain.
 *
 * Every one of those survives here and is dropped, with a record, downstream.
 *
 * ⭐ UNKNOWN IS A VALUE, NOT AN ABSENCE. `{ kind: 'unknown' }` is a thing the
 * model asserts: "nobody has said." That is different from a field being
 * missing, which is ambiguous, and different from zero, which is a measurement.
 * The whole point of the discriminated union is that an unknown cannot be
 * mistaken for a number by a consumer that forgot to check.
 */

/** Who authored a piece of meaning. Never inferred from absence. */
export type Authorship =
  /** The user said it, in their own words. */
  | 'user_stated'
  /** Read out of the user's brief by extraction — the system's reading of their words. */
  | 'brief_extraction'
  /** The system proposed it. Never presentable as the user's claim. */
  | 'model_proposed';

export interface Provenance {
  readonly authored_by: Authorship;
  /** Why this is here, in the author's terms where available. */
  readonly basis?: string;
  /** Verbatim source, when there is one. Never paraphrased. */
  readonly quote?: string;
}

/**
 * A magnitude. `unknown` is first-class and is the common case.
 *
 * `at_least` exists because the banked conversation produced one ("at least
 * 2%") and collapsing it to a point estimate would invent precision the user
 * did not offer.
 */
export type Magnitude =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'point'; readonly value: number; readonly unit?: string }
  | { readonly kind: 'at_least'; readonly value: number; readonly unit?: string }
  | { readonly kind: 'at_most'; readonly value: number; readonly unit?: string }
  | { readonly kind: 'range'; readonly min: number; readonly max: number; readonly unit?: string }
  /** A magnitude expressed in words, with no number behind it. */
  | { readonly kind: 'qualitative'; readonly text: string };

export const UNKNOWN_MAGNITUDE: Magnitude = { kind: 'unknown' };

export function isKnownMagnitude(m: Magnitude): boolean {
  return m.kind !== 'unknown';
}

/** Does this magnitude carry a number a computation could use? */
export function hasNumericMagnitude(m: Magnitude): boolean {
  return m.kind === 'point' || m.kind === 'at_least' || m.kind === 'at_most' || m.kind === 'range';
}

/**
 * Temporal semantics. GraphV3 has no equivalent, so everything here is dropped
 * by the projection and must be recorded when it is.
 */
export interface Temporal {
  /** Months until the effect begins. */
  readonly onset_months?: number;
  /** Months the effect persists. */
  readonly duration_months?: number;
  /** Months until the affected quantity returns to its prior level. */
  readonly recovery_months?: number;
  /** The claim in the author's words, when it does not reduce to the numbers above. */
  readonly text?: string;
}

export type RichEntityKind =
  | 'goal'
  | 'option'
  | 'factor'
  | 'risk'
  | 'outcome'
  | 'decision'
  | 'action';

export interface RichEntity {
  readonly id: string;
  readonly kind: RichEntityKind;
  readonly label: string;
  /** controllable | observable | external, where the author said. */
  readonly role?: 'controllable' | 'observable' | 'external';
  /** The current level of this quantity. `unknown` is the honest default. */
  readonly baseline: Magnitude;
  readonly provenance: Provenance;
  /** Free-text evidence attached to this entity. Never summarised away. */
  readonly evidence?: readonly string[];
}

export interface RichRelationship {
  readonly from: string;
  readonly to: string;
  /** 'unknown' is a real state and must not be resolved by guessing a sign. */
  readonly direction: 'positive' | 'negative' | 'unknown';
  /** How big the effect is. Usually `unknown`. */
  readonly magnitude: Magnitude;
  /** How likely the link exists at all. Usually `unknown`. */
  readonly existence: Magnitude;
  readonly temporal?: Temporal;
  readonly provenance: Provenance;
}

/**
 * A constraint, holding the operator the AUTHOR used — including strict bounds
 * the canonical vocabulary cannot express.
 */
export interface RichConstraint {
  /** The quantity being bounded, as the author named it. */
  readonly metric: string;
  /** Resolved entity id, when the metric has been matched to one. */
  readonly entity_id?: string;
  readonly operator: '<' | '<=' | '>' | '>=';
  readonly value: number;
  readonly unit?: string;
  readonly provenance: Provenance;
}

/**
 * Something the model knows it does not know. This is the honest destination
 * for an unknown — not a default value.
 */
export interface OpenQuestion {
  readonly about: string;
  readonly question: string;
  /** Why answering it would change the decision. */
  readonly why_it_matters: string;
}

export interface RichDecisionModel {
  readonly entities: readonly RichEntity[];
  readonly relationships: readonly RichRelationship[];
  readonly constraints: readonly RichConstraint[];
  readonly open_questions: readonly OpenQuestion[];
  /** The brief, verbatim, so nothing downstream has to paraphrase it. */
  readonly brief?: string;
}

/** Entities whose baseline nobody has stated. */
export function entitiesWithUnknownBaseline(m: RichDecisionModel): readonly RichEntity[] {
  return m.entities.filter((e) => !isKnownMagnitude(e.baseline));
}

/** Relationships carrying meaning no GraphV3 edge can hold. */
export function relationshipsWithUnprojectableMeaning(
  m: RichDecisionModel,
): readonly RichRelationship[] {
  return m.relationships.filter(
    (r) =>
      r.temporal !== undefined ||
      r.magnitude.kind === 'qualitative' ||
      r.magnitude.kind === 'at_least' ||
      r.magnitude.kind === 'at_most' ||
      r.magnitude.kind === 'range',
  );
}

/** True when nothing in this model was authored by the system. */
export function isEntirelyAuthored(m: RichDecisionModel): boolean {
  const modelProposed = (p: Provenance) => p.authored_by === 'model_proposed';
  return (
    !m.entities.some((e) => modelProposed(e.provenance)) &&
    !m.relationships.some((r) => modelProposed(r.provenance))
  );
}
