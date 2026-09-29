/**
 * Agent lane — candidate admission.
 *
 * Turns a banked-contract construction candidate (gpt-4.1 faithful builder +
 * gpt-5.6 widener/critic) into a canonical GraphV3, WITHOUT inventing causal
 * magnitudes, and returns an explicit ledger of every representation loss.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐ WHY THIS MODULE EXISTS AT ALL.
 *
 * Measured on the first run of the banked chain (22 Sep 2026): the widener
 * proposed 10 links and EVERY ONE carried direction only — 0 numeric fields
 * across 26 proposed items, against a contrast control of 4 numeric fields in
 * the faithful skeleton. The faithful skeleton additionally carried 1 link
 * whose direction is 'unknown'. `EdgeV3Schema` requires `strength.mean` AND
 * `exists_probability` on every edge. So 11 edges needed a magnitude that
 * nobody authored, on turn one. This is not an edge case.
 *
 * ⛔ THE FORBIDDEN SHORTCUT is to fill those in and move on. The estate already
 * analyses AI-invented causal magnitudes while honest unknowns become
 * unanalysable; reproducing that here would defeat the experiment.
 *
 * ⭐ THE RULE, AND THE TWO CLASSES IT PRODUCES.
 *
 *   1. DIRECTION AUTHORED, MAGNITUDE NOT → the edge is admitted, its magnitude
 *      is a PROJECTION DEFAULT and is marked as one: `defaulted: true` (the
 *      existing CIL flag, `schemas/cee-v3.ts:496`, "true when default strength
 *      was applied"), plus a `RepairEntry` naming the field, the before/after
 *      and the reason. Provenance stays `cee_hypothesis` — the model proposed
 *      the link, so it must never read as user- or evidence-authored.
 *
 *   2. NO DIRECTION AUTHORED → there is no honest projection. A signed mean
 *      would invent the sign; a zero mean would assert "no effect", which is
 *      itself a claim. So the edge is WITHHELD from the canonical graph and
 *      recorded. Withholding is the correct outcome here, not a failure.
 *
 * Constants are the canonical ones from `@talchain/schemas` — never hand-rolled.
 * `DEFAULT_EXISTS_PROBABILITY` (0.8) is the value PLoT defaults to, and
 * `STRENGTH_DEFAULT_SIGNATURE` ({ mean: 0.5, std: 0.125 }) is the recognised
 * default-magnitude signature the existing warning codes already detect — so
 * `STRENGTH_DEFAULT_APPLIED` / `STRENGTH_MEAN_DEFAULT_DOMINANT` still fire on
 * what we produce, which is the point.
 */

import {
  DEFAULT_EXISTS_PROBABILITY,
  STRENGTH_DEFAULT_SIGNATURE,
  REPAIR_CODES,
  type RepairEntry,
} from '@talchain/schemas';
import type { LinkSizing, MagnitudeAuthor, NaturalEffect } from '../../cee/magnitude/link-effect.js';

/**
 * A magnitude the model did not author, expressed as a projection default.
 *
 * ⭐ DELIBERATELY THE DETECTION SIGNATURE, NOT `DEFAULT_STD`. The runtime shape
 * is `{ mean: 0.5, std: 0.125 }` — and 0.125 is exactly what the existing
 * `STRENGTH_DEFAULT_APPLIED` / `STRENGTH_MEAN_DEFAULT_DOMINANT` detectors match
 * against, within `STRENGTH_DEFAULT_TOLERANCE`. Using `DEFAULT_STD` (0.1)
 * instead would produce magnitudes the estate's own default-detection CANNOT
 * see. We want it to see them: a projection we hid from the detector is a
 * fabrication with better manners.
 */
const PROJECTED_MEAN = STRENGTH_DEFAULT_SIGNATURE.mean;
const PROJECTED_STD = STRENGTH_DEFAULT_SIGNATURE.std;

export type CandidateDirection = 'positive' | 'negative' | 'unknown';

export interface CandidateLink {
  readonly from: string;
  readonly to: string;
  readonly direction: CandidateDirection;
  readonly provenance: string;
  /** Present ONLY when a magnitude was genuinely authored. Normally absent. */
  readonly strength_mean?: number;
  /** Present ONLY when a spread was genuinely authored. Normally absent. */
  readonly strength_std?: number;
  /** Present ONLY when a link-existence probability was genuinely authored. Normally absent. */
  readonly existence_probability?: number;
  /**
   * The canonical `EdgeProvenanceV3.source` to stamp, when the caller knows it
   * exactly. The projection layer does: it carries a three-way authorship
   * (`user_stated` / `brief_extraction` / `model_proposed`) that the banked
   * construction contract's two-way `explicit` / `ai_proposed` cannot express,
   * and `brief_extraction` is a real distinct value of that enum. When absent
   * the coarse mapping below applies, which is what the banked contract needs.
   */
  readonly provenance_source?: string;
  /**
   * The magnitude contract (D1): the change in the TARGET's own unit (points for a percentage), caused by
   * `effect_per_source_change` of the SOURCE in its own unit (1 = switching a yes/no on). `null` means the
   * drafter could not say. Absent on a candidate from before the field, which means the same.
   */
  readonly effect_amount?: number | null;
  readonly effect_per_source_change?: number | null;
  /** Who stated the size. `null`/absent falls back to the link's own `provenance`. */
  readonly effect_provenance?: string | null;
}

export interface AdmittedEdge {
  from: string;
  to: string;
  strength: { mean: number; std: number };
  exists_probability: number;
  effect_direction?: 'positive' | 'negative' | 'unknown';
  /**
   * `magnitude` (D9): who sized it. `natural_effect`: the size it carries in natural units, with the β it was written
   * for (`strength_mean`, the staleness key). Both absent on an edge that keeps today's projection unchanged.
   */
  provenance?: { source: string; reasoning?: string; magnitude?: MagnitudeAuthor; natural_effect?: NaturalEffect };
  /** CIL flag — true when the magnitude is a projection default, not authored. */
  defaulted?: boolean;
}

export interface WithheldLink {
  readonly from: string;
  readonly to: string;
  readonly reason: 'no_authored_direction';
  readonly detail: string;
}

export interface AdmissionResult {
  readonly edges: readonly AdmittedEdge[];
  /** Every field this module supplied that nobody authored. */
  readonly loss: readonly RepairEntry[];
  /** Links that could not be admitted honestly. */
  readonly withheld: readonly WithheldLink[];
  /**
   * `from::to` -> the numeric fields on that edge THIS MODULE chose, not the
   * author. Per field, because an edge can have an authored mean and an
   * unauthored existence probability at the same time — and reading one boolean
   * for the whole edge is exactly how a projected `exists_probability` passed as
   * clean and drove a `ready` verdict.
   */
  readonly projected_fields: Readonly<Record<string, readonly string[]>>;
  /**
   * `from::to` for each edge whose magnitude was genuinely authored.
   *
   * Tracked explicitly rather than inferred from the provenance value: authored-ness
   * and authorship are different questions, and reading one off the other is what
   * made the `user_specified` mistake above invisible.
   */
  readonly authored_magnitudes: readonly string[];
}

function provenanceSourceFor(candidateProvenance: string): string {
  // 'ai_proposed' (widener) and 'inferred' (builder) are both the system's
  // reading, never the user's.
  //
  // ⭐ 'explicit' MEANS "THE USER STATED IT IN THE BRIEF", WHICH IS
  // `brief_extraction` — NOT `user_specified`. This was wrong here and the error
  // had teeth: `src/cee/provenance/money-invariant.ts:211` gates its entire
  // audit on `observed.source === 'brief_extraction'`, so stamping
  // `user_specified` both asserted a direct user edit that never happened AND
  // exempted every brief-derived figure from the check that asks whether the
  // figure actually appears in the brief. `user_specified` is reserved for a
  // value the user set directly, which this construction chain never produces —
  // a caller that genuinely has one passes `provenance_source` explicitly.
  return candidateProvenance === 'explicit' ? 'brief_extraction' : 'cee_hypothesis';
}

/**
 * What the ledger says beside a sized link, whatever the edge carries: the question the user is asked
 * (`.magnitude_question`, routed to `open_questions` by `build-model.ts`), or — when a stated size could not be used
 * and nothing is asked — why (`.magnitude_unconvertible`, said in `not_represented`).
 */
function magnitudeNotes(fieldPath: string, link: CandidateLink, sized: LinkSizing): RepairEntry[] {
  const notes: RepairEntry[] = [];
  if (sized.question !== undefined) {
    notes.push({
      code: REPAIR_CODES.NORMALISE_STRENGTH_RANGE,
      layer: 'cee',
      field_path: `${fieldPath}.magnitude_question`,
      before: sized.stated_strength ?? null,
      after: sized.mean,
      reason: sized.question,
      severity: 'warn',
    });
  } else if (sized.problem === 'unconvertible' || sized.problem === 'sign_conflict') {
    notes.push({
      code: REPAIR_CODES.NORMALISE_STRENGTH_RANGE,
      layer: 'cee',
      field_path: `${fieldPath}.magnitude_unconvertible`,
      before: { effect_amount: link.effect_amount ?? null, effect_per_source_change: link.effect_per_source_change ?? null },
      after: null,
      reason:
        `The size stated for this link (${sized.statement ?? 'as given'}) ` +
        (sized.problem === 'unconvertible'
          ? 'could not be read on the ranges the two are measured on'
          : "runs the other way from the link's own direction") +
        ', so the standard placeholder strength is used instead. It is not a measurement.',
      severity: 'warn',
    });
  }
  return notes;
}

/**
 * Admit candidate links as canonical edges.
 *
 * Total: never throws on a well-formed link, never silently drops one — an
 * un-admittable link appears in `withheld` with its reason.
 *
 * `sizing` (the magnitude contract, `cee/magnitude/link-effect.ts`) is keyed `from::to` and decided by the caller,
 * which alone knows both ends' frames and the options' levels. A link it does not size, or sizes `unchanged`, is
 * admitted exactly as before.
 */
export function admitCandidateLinks(
  links: readonly CandidateLink[],
  sizing: ReadonlyMap<string, LinkSizing> = new Map(),
): AdmissionResult {
  const edges: AdmittedEdge[] = [];
  const loss: RepairEntry[] = [];
  const withheld: WithheldLink[] = [];
  const authored_magnitudes: string[] = [];
  const projected_fields: Record<string, readonly string[]> = {};

  for (const link of links) {
    const fieldPath = `edges[${link.from}::${link.to}]`;
    const sized = typeof link.strength_mean === 'number' ? undefined : sizing.get(`${link.from}::${link.to}`);

    if (link.direction === 'unknown') {
      withheld.push({
        from: link.from,
        to: link.to,
        reason: 'no_authored_direction',
        detail:
          'Direction is unknown, so no honest magnitude exists: a signed mean would invent ' +
          'the sign and a zero mean would assert no effect. Withheld from the canonical ' +
          'graph rather than fabricated.',
      });
      continue;
    }

    if (sized !== undefined && sized.outcome !== 'unchanged') {
      // ⭐ THE MAGNITUDE CONTRACT. The mean is the stated size read on the two frames (an estimate, or the user's
      // own, D7), or Olumi's frame-aware placeholder (D5/D6). Every number that is ours is marked and ledgered
      // field by field, exactly as below, and the edge says who sized it (D9).
      const meanOurs = sized.outcome === 'placeholder';
      const stdAuthored = typeof link.strength_std === 'number';
      const existenceStated = typeof link.existence_probability === 'number';
      const projected = [
        ...(meanOurs ? ['strength.mean'] : []),
        ...(stdAuthored ? [] : ['strength.std']),
        ...(existenceStated ? [] : ['exists_probability']),
      ];
      const std = stdAuthored ? (link.strength_std as number) : sized.std;
      const key = `${link.from}::${link.to}`;
      const edge: AdmittedEdge = {
        from: link.from,
        to: link.to,
        strength: { mean: sized.mean, std },
        exists_probability: existenceStated ? (link.existence_probability as number) : DEFAULT_EXISTS_PROBABILITY,
        effect_direction: link.direction,
        provenance: {
          source: link.provenance_source ?? provenanceSourceFor(link.provenance),
          magnitude: sized.magnitude!,
          ...(sized.natural_effect !== undefined ? { natural_effect: sized.natural_effect } : {}),
        },
      };
      projected_fields[key] = projected;
      if (projected.length > 0) edge.defaulted = true;
      if (!meanOurs) authored_magnitudes.push(key);
      if (!stdAuthored) {
        loss.push({
          code: REPAIR_CODES.CLAMP_STD_MINIMUM,
          layer: 'cee',
          field_path: `${fieldPath}.strength.std`,
          before: null,
          after: std,
          reason:
            'Nobody stated how uncertain this strength is. Olumi uses half its size as the spread. ' +
            'It is not a measurement of anyone\'s confidence.',
          severity: 'info',
        });
      }
      loss.push(meanOurs
        ? {
            code: REPAIR_CODES.APPLY_SIGN_FROM_DIRECTION,
            layer: 'cee',
            field_path: `${fieldPath}.strength.mean`,
            before: sized.stated_strength ?? null,
            after: sized.mean,
            reason:
              'Direction was authored but no size Olumi could use. Applied Olumi\'s placeholder, sized to keep the ' +
              'target within its range across the options, as an ANALYSIS PROJECTION, marked `defaulted`. This is not ' +
              'a measurement and must never be presented as user- or evidence-authored.',
            severity: 'warn',
          }
        : {
            code: REPAIR_CODES.NORMALISE_STRENGTH_RANGE,
            layer: 'cee',
            field_path: `${fieldPath}.strength.mean`,
            before: { effect_amount: link.effect_amount ?? null, effect_per_source_change: link.effect_per_source_change ?? null },
            after: sized.mean,
            reason:
              `${sized.outcome === 'user_stated' ? 'Stated by the user' : 'Olumi\'s estimate'}: ${sized.statement ?? 'as given'}. ` +
              'Read on the ranges the two are measured on, that is the strength shown.',
            severity: 'info',
          });
      if (!existenceStated) loss.push({
        code: REPAIR_CODES.DEFAULT_EXISTS_PROBABILITY,
        layer: 'cee',
        field_path: `${fieldPath}.exists_probability`,
        before: null,
        after: DEFAULT_EXISTS_PROBABILITY,
        reason:
          'Nobody stated how likely this link is to exist. Applied the canonical default. ' +
          'A defaulted value and an elicited value are the same number, so the ledger is the ' +
          'only place the difference survives.',
        severity: 'info',
      });
      loss.push(...magnitudeNotes(fieldPath, link, sized));
      edges.push(edge);
      continue;
    }

    const authored = typeof link.strength_mean === 'number';
    const signedMean = authored
      ? (link.strength_mean as number)
      : link.direction === 'negative'
        ? -PROJECTED_MEAN
        : PROJECTED_MEAN;

    // Every numeric is either the author's or ours, decided field by field.
    const projected: string[] = [];
    if (!authored) projected.push('strength.mean');
    const stdAuthored = typeof link.strength_std === 'number';
    if (!stdAuthored) projected.push('strength.std');
    const existenceAuthored = typeof link.existence_probability === 'number';
    if (!existenceAuthored) projected.push('exists_probability');

    const edge: AdmittedEdge = {
      from: link.from,
      to: link.to,
      strength: { mean: signedMean, std: stdAuthored ? (link.strength_std as number) : PROJECTED_STD },
      exists_probability: existenceAuthored
        ? (link.existence_probability as number)
        : DEFAULT_EXISTS_PROBABILITY,
      effect_direction: link.direction,
      provenance: { source: link.provenance_source ?? provenanceSourceFor(link.provenance) },
    };

    const key = `${link.from}::${link.to}`;
    projected_fields[key] = projected;
    // ⭐ MARKED WHENEVER **ANY** NUMBER IS OURS, not only when the mean is.
    // The previous condition was `!authored`, so an edge with an authored mean
    // carried an unauthored std and existence probability while reporting itself
    // clean.
    if (projected.length > 0) edge.defaulted = true;

    if (authored) authored_magnitudes.push(key);

    if (!stdAuthored) {
      loss.push({
        code: REPAIR_CODES.CLAMP_STD_MINIMUM,
        layer: 'cee',
        field_path: `${fieldPath}.strength.std`,
        before: null,
        after: PROJECTED_STD,
        reason:
          'Nobody stated how uncertain this strength is. Applied the recognised default spread. ' +
          'It is not a measurement of anyone\'s confidence.',
        severity: 'info',
      });
    }

    if (!authored) {
      // The magnitude is ours, not theirs. Say so in the ledger (the edge is
      // already marked above).
      loss.push({
        code: REPAIR_CODES.APPLY_SIGN_FROM_DIRECTION,
        layer: 'cee',
        field_path: `${fieldPath}.strength.mean`,
        before: null,
        after: signedMean,
        reason:
          'Direction was authored but magnitude was not. Applied the recognised default-magnitude ' +
          'signature as an ANALYSIS PROJECTION, marked `defaulted`. This is not a measurement and ' +
          'must never be presented as user- or evidence-authored.',
        severity: 'warn',
      });
    }

    if (!existenceAuthored) loss.push({
      code: REPAIR_CODES.DEFAULT_EXISTS_PROBABILITY,
      layer: 'cee',
      field_path: `${fieldPath}.exists_probability`,
      before: null,
      after: DEFAULT_EXISTS_PROBABILITY,
      reason:
        'Nobody stated how likely this link is to exist. Applied the canonical default. ' +
        'A defaulted value and an elicited value are the same number, so the ledger is the ' +
        'only place the difference survives.',
      severity: 'info',
    });

    // Today's projection, unchanged. A stated size it could not use, or a question it raises, is still said.
    if (sized !== undefined) loss.push(...magnitudeNotes(fieldPath, link, sized));

    edges.push(edge);
  }

  return { edges, loss, withheld, authored_magnitudes, projected_fields };
}

/**
 * True when every admitted magnitude is either authored or marked `defaulted`.
 *
 * An authored magnitude is recognised by its provenance being a stated one
 * (`user_specified`) rather than by trusting the flag's absence.
 */
export function noUnmarkedMagnitudes(result: AdmissionResult): boolean {
  const ledgered = new Set(result.loss.map((l) => l.field_path));
  return result.edges.every((e) => {
    const key = `${e.from}::${e.to}`;
    const projected = result.projected_fields[key] ?? [];
    if (projected.length === 0) return true;
    if (e.defaulted !== true) return false;
    return projected.every((f) => ledgered.has(`edges[${key}].${f}`));
  });
}

/** True only when NO number on any edge was chosen by this module. */
export function isFullyAuthored(result: AdmissionResult): boolean {
  return Object.values(result.projected_fields).every((f) => f.length === 0);
}
