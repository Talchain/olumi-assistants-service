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
  /**
   * The canonical `EdgeProvenanceV3.source` to stamp, when the caller knows it
   * exactly. The projection layer does: it carries a three-way authorship
   * (`user_stated` / `brief_extraction` / `model_proposed`) that the banked
   * construction contract's two-way `explicit` / `ai_proposed` cannot express,
   * and `brief_extraction` is a real distinct value of that enum. When absent
   * the coarse mapping below applies, which is what the banked contract needs.
   */
  readonly provenance_source?: string;
}

export interface AdmittedEdge {
  from: string;
  to: string;
  strength: { mean: number; std: number };
  exists_probability: number;
  effect_direction?: 'positive' | 'negative' | 'unknown';
  provenance?: { source: string; reasoning?: string };
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
}

function provenanceSourceFor(candidateProvenance: string): string {
  // 'ai_proposed' (widener) and 'inferred' (builder) are both the system's
  // reading, never the user's. Only an explicitly user-stated link may claim
  // user authorship, and the construction chain never produces one.
  return candidateProvenance === 'explicit' ? 'user_specified' : 'cee_hypothesis';
}

/**
 * Admit candidate links as canonical edges.
 *
 * Total: never throws on a well-formed link, never silently drops one — an
 * un-admittable link appears in `withheld` with its reason.
 */
export function admitCandidateLinks(links: readonly CandidateLink[]): AdmissionResult {
  const edges: AdmittedEdge[] = [];
  const loss: RepairEntry[] = [];
  const withheld: WithheldLink[] = [];

  for (const link of links) {
    const fieldPath = `edges[${link.from}::${link.to}]`;

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

    const authored = typeof link.strength_mean === 'number';
    const signedMean = authored
      ? (link.strength_mean as number)
      : link.direction === 'negative'
        ? -PROJECTED_MEAN
        : PROJECTED_MEAN;

    const edge: AdmittedEdge = {
      from: link.from,
      to: link.to,
      strength: { mean: signedMean, std: PROJECTED_STD },
      exists_probability: DEFAULT_EXISTS_PROBABILITY,
      effect_direction: link.direction,
      provenance: { source: link.provenance_source ?? provenanceSourceFor(link.provenance) },
    };

    if (!authored) {
      // The magnitude is ours, not theirs. Say so, in the edge and in the ledger.
      edge.defaulted = true;
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

    loss.push({
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

    edges.push(edge);
  }

  return { edges, loss, withheld };
}

/**
 * True when every admitted magnitude is either authored or marked `defaulted`.
 *
 * An authored magnitude is recognised by its provenance being a stated one
 * (`user_specified`) rather than by trusting the flag's absence.
 */
export function noUnmarkedMagnitudes(result: AdmissionResult): boolean {
  return result.edges.every(
    (e) => e.defaulted === true || e.provenance?.source === 'user_specified',
  );
}
