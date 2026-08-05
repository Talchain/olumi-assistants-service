/**
 * Decision Review — DSK grounding policy for `decision_quality_prompts[]`
 * (ROADMAP 2.491, closing the 2.456 omitted-id asymmetry).
 *
 * ## The defect this closes
 *
 * `shape-check.ts` validates `dsk_claim_id` **only when the key is present**
 * (`if ("dsk_claim_id" in dqp)`). So the input space was covered asymmetrically:
 *
 *   - a PRESENT but unknown id  → HARD REJECT (whole response)
 *   - an OMITTED id             → **free** — no error, no warning, no marking
 *
 * A prompt with no id reached the user carrying a named decision-science
 * "principle" and rendered *indistinguishably* from an attested one, because
 * absence-of-badge is silent and no user reads silence as "this one is
 * improvised". Measured live (walk-dsk, 2026-08-05): 44% of decision-quality
 * prompts shipped with no id.
 *
 * ## Why the ids are omitted — DERIVED, not assumed
 *
 * The cause is **not** a short knowledge bundle. Measured against the walk's
 * own wire captures and this repo's bundle at `data/dsk/v1.json`:
 *
 *   - `science-claims.ts` injects **every** `DSK-T-*` technique claim into the
 *     prompt — no selection, no truncation — with its exact `title`, its
 *     `evidence_strength` and its linked protocol id.
 *   - The prompt then MANDATES the citation: *"a finding matching a listed
 *     claim MUST carry dsk_claim_id and evidence_strength copied exactly"*
 *     (`Prompts/canonical/decision_review.txt`), and declares omission to be
 *     the escape hatch for uncertainty: *"When unsure, omit the claim fields."*
 *   - Live, the model omits the id anyway — on principle strings that are
 *     **byte-identical to an injected claim title**, and even on the *same*
 *     principle string it cited correctly on other turns.
 *
 * So the ungrounded prompts are not un-attestable science; they are the *same*
 * techniques the bundle attests, with the citation dropped. That rules out both
 * naive answers: hard-rejecting the whole response destroys a turn's coaching
 * over a dropped citation, and labelling these "general guidance" would print a
 * *false* disclaimer next to a prompt whose principle is verbatim `DSK-T-001`.
 *
 * ## The policy — total over the input space, no case left free
 *
 * | `dsk_claim_id` | `principle`                        | verdict     |
 * |----------------|------------------------------------|-------------|
 * | present, resolves in bundle | (any)                 | `attested`  |
 * | present, does NOT resolve | (any)                   | **provenance STRIPPED**, then re-graded as if omitted (`resolved` or `general`) |
 * | omitted        | EXACT match of a bundle claim title | `resolved`  |
 * | omitted        | no exact match                      | `general`   |
 *
 * ⚠ The unknown-id row is enforced HERE, not delegated. An earlier version of
 * this file claimed `shape-check.ts` hard-rejects first; that is false on the
 * live path — `performShapeCheck` is never called from `invoke.ts`, which is
 * what the V5 enricher uses (its only two callers are a default-off flag arm in
 * `decompose.ts` and the standalone route). Claim ids were validated NOWHERE on
 * a live turn, so a fabricated id rendered a badge citing a nonexistent claim.
 *
 * `resolved` restores the citation the prompt already mandated, **from the same
 * table the prompt already gave the model** — an identity lookup, not a repair
 * and not a guess. It is not a weaker guarantee than the `attested` path we
 * already ship: both rest on the model selecting a row, and a verbatim title is
 * a longer, more specific token than the id. On resolve, id / strength /
 * protocol are taken from the BUNDLE and never from the entry, which is exactly
 * what *"copied exactly from it"* means.
 *
 * Matching is EXACT (after Unicode NFC normalisation and outer-whitespace trim
 * only). Paraphrases — "Consider-the-opposite" for "Consider-the-opposite as a
 * debiasing strategy" — are deliberately NOT resolved: a fuzzy match would
 * attest science on the model's behalf, which is the fabrication shape this
 * whole guard exists to prevent. They become `general`.
 *
 * `general` is a POSITIVE, first-class wire state, not an absence. It is what
 * lets a surface say "general guidance" instead of saying nothing — and,
 * because it is positive, a consumer that never receives the field renders
 * nothing rather than falsely disclaiming (fail-closed in both directions).
 *
 * When DSK is disabled the bundle is not loaded, so **nothing is marked at
 * all**: with no bundle we can neither attest nor honestly disclaim.
 */

import { getAllByType } from '../../orchestrator/dsk-loader.js';
import { config } from '../../config/index.js';
import type { DSKClaim, DSKProtocol } from '../../dsk/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * The wire key carrying the grounding verdict on each
 * `decision_quality_prompts[]` entry. Additive and optional: a consumer that
 * does not know it is unaffected, and a consumer that does must treat ABSENCE
 * as "no verdict was made" — never as `general`.
 */
export const DSK_GROUNDING_KEY = 'dsk_grounding' as const;

export type DskGroundingState =
  /** The model supplied a `dsk_claim_id` that resolves in the bundle. */
  | 'attested'
  /** Id omitted, but `principle` is byte-identical to a bundle claim title;
   *  id/strength/protocol were resolved FROM THE BUNDLE. */
  | 'resolved'
  /** Id omitted and `principle` matches no bundle claim title. Genuinely
   *  unattested — surfaces must mark this positively as general guidance. */
  | 'general';

export interface DskGroundingPolicyStats {
  attested: number;
  resolved: number;
  general: number;
  /**
   * Entries whose `dsk_claim_id` did NOT resolve in the bundle. The id and its
   * companion provenance were stripped and the entry re-graded. Non-zero means
   * the model fabricated a citation — alarm-worthy, not routine.
   */
  unverified: number;
  /**
   * Attested entries citing a non-`DSK-T-` claim. Off-contract (DQPs are
   * offered the technique table only) but the claim is real, so it is counted
   * and kept rather than stripped.
   */
  nonTechniqueAttested: number;
  /** True when the bundle was unavailable/disabled and nothing was marked. */
  skipped: boolean;
}

export interface DskGroundingPolicyResult {
  prompts: Record<string, unknown>[];
  stats: DskGroundingPolicyStats;
}

// ============================================================================
// Title index — DERIVED from the bundle, never a hand-maintained mirror
// ============================================================================

/**
 * Normalise a title/principle for exact comparison. Unicode NFC + outer-
 * whitespace trim ONLY. Deliberately NOT case-folding, NOT collapsing inner
 * whitespace and NOT stripping punctuation: each of those would widen an
 * identity lookup into a fuzzy match. The DSK bundle carries a typographic
 * apostrophe in at least one title (`Devil's advocate exercise`), which is
 * precisely the kind of character a looser comparison would paper over.
 */
function normaliseTitle(s: string): string {
  return s.normalize('NFC').trim();
}

interface TitleIndexEntry {
  claim: DSKClaim;
  protocolId?: string;
}

/**
 * Build `normalised claim title -> claim (+ linked protocol)` for TECHNIQUE
 * claims (`DSK-T-*`) — the claim family `decision_quality_prompts` cite, and
 * the same family `science-claims.ts` puts in the prompt's TECHNIQUE CLAIMS
 * table. Bias claims (`DSK-B-*`) are excluded on purpose: they ground
 * `bias_findings`, a different field, and admitting them here would let a
 * prompt resolve against a claim the prompt was never offered for this slot.
 *
 * Derived on every call from the loaded bundle. If two technique claims ever
 * share a title the entry is AMBIGUOUS and is dropped from the index, so it
 * falls through to `general` rather than resolving arbitrarily.
 */
export function buildTechniqueTitleIndex(): Map<string, TitleIndexEntry> {
  const claims = (getAllByType('claim') as DSKClaim[]).filter((c) =>
    c.id.startsWith('DSK-T-'),
  );

  const protocols = getAllByType('protocol') as DSKProtocol[];
  const claimToProtocol = new Map<string, string>();
  for (const p of protocols) {
    if (p.linked_claim_id) claimToProtocol.set(p.linked_claim_id, p.id);
  }

  const index = new Map<string, TitleIndexEntry>();
  const ambiguous = new Set<string>();
  for (const c of claims) {
    if (typeof c.title !== 'string' || c.title.trim() === '') continue;
    const key = normaliseTitle(c.title);
    if (index.has(key)) {
      ambiguous.add(key);
      continue;
    }
    index.set(key, { claim: c, protocolId: claimToProtocol.get(c.id) });
  }
  for (const key of ambiguous) index.delete(key);

  return index;
}

// ============================================================================
// Policy
// ============================================================================

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Apply the grounding policy to a `decision_quality_prompts[]` array.
 *
 * Pure and non-mutating: returns new entry objects. Every returned entry
 * carries `dsk_grounding` unless the bundle was unavailable, in which case the
 * input is returned untouched (`stats.skipped === true`).
 */
export function applyDskGroundingPolicy(
  prompts: readonly unknown[],
  opts?: { dskEnabled?: boolean },
): DskGroundingPolicyResult {
  const enabled = opts?.dskEnabled ?? config.features.dskEnabled;
  const stats: DskGroundingPolicyStats = {
    attested: 0,
    resolved: 0,
    general: 0,
    unverified: 0,
    nonTechniqueAttested: 0,
    skipped: false,
  };

  const passthrough = (): DskGroundingPolicyResult => {
    stats.skipped = true;
    return {
      prompts: prompts.map((e) => ({ ...((e ?? {}) as Record<string, unknown>) })),
      stats,
    };
  };

  if (!enabled) return passthrough();

  const index = buildTechniqueTitleIndex();
  // No bundle (load failure) ⇒ we can neither attest nor honestly disclaim.
  if (index.size === 0) return passthrough();

  // Every claim id in the loaded bundle. Derived, never mirrored. This is the
  // set `getClaimById` searches, so validating against it enforces exactly the
  // documented boundary — no wider, no narrower.
  const claimIds = new Set((getAllByType('claim') as DSKClaim[]).map((c) => c.id));

  const out = prompts.map((entry) => {
    const e = { ...((entry ?? {}) as Record<string, unknown>) };

    // 1. Attested — the model cited, AND the id resolves in the bundle.
    //
    // ⚠ This branch validates the id ITSELF. The earlier version of this file
    // delegated to `shape-check.ts`'s hard reject and was WRONG on the live
    // path: `performShapeCheck` is called from exactly two places
    // (`decompose.ts:781`, behind a DEFAULT-OFF flag, and the standalone
    // `assist.v1.decision-review` route) and NEVER from `invoke.ts` — which is
    // what the V5 enricher actually calls. `getClaimById` has no other
    // production caller. So on every live turn, claim ids were validated
    // NOWHERE, and `{dsk_claim_id: 'DSK-T-999', principle: 'anything'}` would
    // have rendered a grounding badge citing a claim that does not exist.
    // Enforcing it here is the first real check on that path.
    if (nonEmptyString(e.dsk_claim_id)) {
      if (claimIds.has(e.dsk_claim_id)) {
        stats.attested++;
        e[DSK_GROUNDING_KEY] = 'attested' satisfies DskGroundingState;
        // Observed but NOT acted on: `decision_quality_prompts` are offered the
        // TECHNIQUE table only, so a bias-claim citation here is off-contract.
        // It is counted rather than stripped — the documented boundary is
        // "id exists in the bundle", and silently dropping a real claim would
        // be stricter than the rule this branch exists to enforce.
        if (!e.dsk_claim_id.startsWith('DSK-T-')) stats.nonTechniqueAttested++;
        return e;
      }

      // UNVERIFIABLE CITATION. The disposition is to strip the provenance and
      // fall through, NOT to discard the whole response:
      //   - the trust property we need is "no fabricated citation reaches the
      //     user", and stripping achieves it completely;
      //   - this policy runs at EGRESS, after the LLM call. Throwing here trips
      //     the enricher's safety net, which returns the facts unchanged — the
      //     user would lose the entire decision review (narrative, assumptions,
      //     every other prompt) over one bad field;
      //   - it is strictly stronger than the status quo, which shipped the
      //     badge. Whole-response rejection remains available as a policy
      //     choice; it is deliberately not taken unilaterally here.
      stats.unverified++;
      delete e.dsk_claim_id;
      delete e.dsk_protocol_id;
      delete e.evidence_strength;
      // …and fall through: the prompt may still resolve by title, and if it
      // does not it is marked `general` like any other unattested prompt.
    }

    // 2. Resolved — id omitted, but the principle IS a bundle claim title.
    const principle = nonEmptyString(e.principle) ? normaliseTitle(e.principle) : '';
    const hit = principle ? index.get(principle) : undefined;
    if (hit) {
      stats.resolved++;
      // Bundle is the single source of truth — "copied exactly from it".
      e.dsk_claim_id = hit.claim.id;
      e.evidence_strength = hit.claim.evidence_strength;
      if (hit.protocolId) e.dsk_protocol_id = hit.protocolId;
      e[DSK_GROUNDING_KEY] = 'resolved' satisfies DskGroundingState;
      return e;
    }

    // 3. General — genuinely unattested. No id is invented, ever.
    stats.general++;
    e[DSK_GROUNDING_KEY] = 'general' satisfies DskGroundingState;
    return e;
  });

  return { prompts: out, stats };
}
