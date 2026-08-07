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
 * | `dsk_claim_id` | `principle` / companions            | verdict     |
 * |----------------|-------------------------------------|-------------|
 * | present, resolves to a `DSK-T-*` claim, `principle` EQUALS that claim's title, and any supplied `evidence_strength` / `dsk_protocol_id` EQUAL that claim's | `attested` |
 * | present, but ANY of the above fails  | **provenance STRIPPED**, then re-graded as if omitted (`resolved` or `general`) |
 * | omitted        | EXACT match of a bundle claim title  | `resolved`  |
 * | omitted        | no exact match                       | `general`   |
 *
 * ⚠ The unknown-id row is enforced HERE, not delegated. An earlier version of
 * this file claimed `shape-check.ts` hard-rejects first; that is false on the
 * live path — `performShapeCheck` is never called from `invoke.ts`, which is
 * what the V5 enricher uses (its only two callers are a default-off flag arm in
 * `decompose.ts` and the standalone route). Claim ids were validated NOWHERE on
 * a live turn, so a fabricated id rendered a badge citing a nonexistent claim.
 *
 * ## ⚠⚠ "THE ID EXISTS" IS NECESSARY AND NOT SUFFICIENT (corroborated twice)
 *
 * The first version of this branch validated only that the id EXISTED. It never
 * checked that the id corresponded to the sentence displayed beside it, nor
 * that the companion provenance equalled the bundle's values for that claim.
 * Measured independently by two reviewers on 2026-08-05:
 *
 *   - `{dsk_claim_id:'DSK-T-002', dsk_protocol_id:'DSK-P-BOGUS',
 *      evidence_strength:'weak'}` was marked `attested`, RETAINING a protocol
 *     id that exists nowhere in the bundle and a strength of `weak` for a claim
 *     the bundle rates `strong`.
 *   - Arbitrary model-authored principle prose paired with ANY real claim id
 *     was marked `attested`, and the raw prose + strength then rendered as
 *     grounded.
 *
 * That is user-visible, and WORSE than "an unmarked prompt". Verified at the
 * bytes on UI staging tip `af5c5a37`:
 *
 *   KeyQuestionCard.tsx:85-86  `Grounded in: {grounding.principle}`
 *                              `{grounding.strength ? ` · ${strength} evidence`}`
 *   decisionQualityPrompts.ts:122-128  `deriveDskGrounding` gates ONLY on
 *                              `p.dskClaimId && p.principle`, and sets
 *                              `principle: p.principle` — THE ENTRY'S OWN TEXT.
 *
 * So the badge renders THE MODEL'S PROSE, not the bundle's title, under the
 * bundle's authority — with the model's strength. The UI type even documents
 * that field as *"Sanitised DSK claim title"*; nothing made that true. Binding
 * the attest arm to the canonical record is what makes it true.
 *
 * The invariant now enforced, and the reason the necessary-but-not-sufficient
 * distinction is written into the code rather than a comment:
 *
 *   **COMPANIONS APPEAR ONLY WHEN THEY EQUAL THE BUNDLE'S VALUES FOR THE
 *   RESOLVING CLAIM.** Everything displayed as provenance — id, strength,
 *   protocol — is bound to the CANONICAL RECORD the id resolves to, and the
 *   `principle` must be that record's own title. The old rule ("companions
 *   require a resolving id") is satisfied EXACTLY by the `DSK-P-BOGUS` case.
 *
 * Additionally the id must be of the TECHNIQUE class (`DSK-T-*`). A real bias
 * claim (`DSK-B-*`) is a genuine claim but not one this field was ever offered:
 * `science-claims.ts` injects the TECHNIQUE table only, so a bias citation here
 * cannot have come from the table the prompt showed the model.
 *
 * ⚠ MEASURED COST OF THE TIGHTENING: ZERO on real traffic. All 25 entries that
 * carried a `dsk_claim_id` across the walk of 2026-08-05
 * (`PHASE0-EVIDENCE-2026-07-28/walk-dsk-raw/`) are exactly two tuples —
 * `DSK-T-002 / 'Outside view and reference class forecasting' / strong /
 * DSK-P-002` (15×) and `DSK-T-003 / 'Consider-the-opposite as a debiasing
 * strategy' / medium / DSK-P-003` (10×) — both bundle-canonical in every field.
 * Every one still attests. The tightening removes fabrication surface, not
 * observed attestations.
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
   * Entries whose supplied provenance did not survive verification. The id and
   * its companions were stripped and the entry re-graded. Non-zero means the
   * model fabricated a citation — alarm-worthy, not routine. Exactly equal to
   * the sum of `unverifiedByReason`.
   */
  unverified: number;
  /**
   * Why each rejection happened. An operator needs to distinguish "the model
   * invented an id" from "the model cited a real claim next to the wrong
   * sentence" — they are different failure modes with different fixes.
   */
  unverifiedByReason: {
    /** `dsk_claim_id` is not a claim id in the bundle at all (incl. protocol ids). */
    unknownId: number;
    /** A real claim, but not `DSK-T-*` — the wrong family for this field. */
    nonTechniqueId: number;
    /** `principle` is missing, or is not this claim's own title. */
    principleMismatch: number;
    /** A supplied `evidence_strength` / `dsk_protocol_id` differs from the bundle's. */
    companionMismatch: number;
  };
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
  return buildTechniqueIndex().byTitle;
}

export interface TechniqueIndex {
  /** normalised claim title → claim (ambiguous titles dropped). */
  byTitle: Map<string, TitleIndexEntry>;
  /**
   * claim id → the SAME canonical record. This is what makes "the id resolves"
   * into "the id resolves TO A RECORD", so everything displayed beside it can
   * be bound to that record rather than trusted from the model.
   *
   * Ambiguous TITLES are dropped from `byTitle` only: an id is unique, so a
   * citation that names the id unambiguously identifies the claim even when
   * two claims happen to share a title.
   */
  byId: Map<string, TitleIndexEntry>;
}

/** Build both views of the technique claims in one pass over the bundle. */
export function buildTechniqueIndex(): TechniqueIndex {
  const claims = (getAllByType('claim') as DSKClaim[]).filter((c) =>
    c.id.startsWith('DSK-T-'),
  );

  const protocols = getAllByType('protocol') as DSKProtocol[];
  const claimToProtocol = new Map<string, string>();
  for (const p of protocols) {
    if (p.linked_claim_id) claimToProtocol.set(p.linked_claim_id, p.id);
  }

  const byTitle = new Map<string, TitleIndexEntry>();
  const byId = new Map<string, TitleIndexEntry>();
  const ambiguous = new Set<string>();
  for (const c of claims) {
    if (typeof c.title !== 'string' || c.title.trim() === '') continue;
    const entry: TitleIndexEntry = { claim: c, protocolId: claimToProtocol.get(c.id) };
    byId.set(c.id, entry);
    const key = normaliseTitle(c.title);
    if (byTitle.has(key)) {
      ambiguous.add(key);
      continue;
    }
    byTitle.set(key, entry);
  }
  for (const key of ambiguous) byTitle.delete(key);

  return { byTitle, byId };
}

// ============================================================================
// Policy
// ============================================================================

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Overwrite an entry's provenance with the CANONICAL record's values — the
 * single place where displayed provenance is decided, shared by the `attested`
 * and `resolved` arms so the two cannot drift apart.
 *
 * "Copied exactly from it" (`Prompts/canonical/decision_review.txt`) is taken
 * literally: nothing here is inferred from the entry. A field the canonical
 * record does not have is DELETED rather than left standing — otherwise a
 * technique claim with no linked protocol would let a model-supplied
 * `dsk_protocol_id` survive beside a bundle-resolved claim id, which is the
 * very shape the invariant forbids. (Unreachable at today's bundle: all six
 * `DSK-T-*` claims carry a linked protocol and an evidence strength. It is
 * written for the bundle we do not have yet — trap 12d.)
 */
function bindCanonicalProvenance(e: Record<string, unknown>, hit: TitleIndexEntry): void {
  e.dsk_claim_id = hit.claim.id;
  if (nonEmptyString(hit.claim.evidence_strength)) e.evidence_strength = hit.claim.evidence_strength;
  else delete e.evidence_strength;
  if (nonEmptyString(hit.protocolId)) e.dsk_protocol_id = hit.protocolId;
  else delete e.dsk_protocol_id;
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
    unverifiedByReason: {
      unknownId: 0,
      nonTechniqueId: 0,
      principleMismatch: 0,
      companionMismatch: 0,
    },
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

  const index = buildTechniqueIndex();
  // No bundle (load failure) ⇒ we can neither attest nor honestly disclaim.
  // Keyed on `byId`, which carries every titled technique claim: `byTitle` can
  // legitimately shrink to zero on an all-ambiguous bundle without the bundle
  // being absent.
  if (index.byId.size === 0) return passthrough();

  // Every claim id in the loaded bundle. Derived, never mirrored. This is the
  // set `getClaimById` searches, and it is used ONLY to tell an id that is not
  // a claim at all apart from one that is a claim of the wrong family — the
  // two rejections have different operational meanings.
  const allClaimIds = new Set((getAllByType('claim') as DSKClaim[]).map((c) => c.id));

  const out = prompts.map((entry) => {
    const e = { ...((entry ?? {}) as Record<string, unknown>) };

    // 1. Attested — the model cited, AND the citation RESOLVES TO THE CLAIM
    //    THAT IS DISPLAYED.
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
    //
    // ⚠⚠ …and validating EXISTENCE alone was still not enough. See the header:
    // `{dsk_claim_id:'DSK-T-002', dsk_protocol_id:'DSK-P-BOGUS',
    //   evidence_strength:'weak'}` passed that check while displaying a
    // nonexistent protocol and a false strength under a real id. Everything
    // shown as provenance is now bound to the canonical record.
    if (nonEmptyString(e.dsk_claim_id)) {
      const citedId = e.dsk_claim_id;
      const canonical = index.byId.get(citedId);

      let reason: keyof DskGroundingPolicyStats['unverifiedByReason'] | undefined;
      if (canonical === undefined) {
        // A real claim of the wrong family is a different diagnosis from an
        // invented id: the first means the model reached outside the table it
        // was shown, the second means it invented a row.
        reason = allClaimIds.has(citedId) ? 'nonTechniqueId' : 'unknownId';
      } else if (
        !nonEmptyString(e.principle) ||
        normaliseTitle(e.principle) !== normaliseTitle(canonical.claim.title)
      ) {
        // The sentence the user reads is not this claim's. Attesting it would
        // put the bundle's authority behind prose the bundle never made.
        reason = 'principleMismatch';
      } else if (
        (e.evidence_strength !== undefined &&
          e.evidence_strength !== canonical.claim.evidence_strength) ||
        (e.dsk_protocol_id !== undefined && e.dsk_protocol_id !== canonical.protocolId)
      ) {
        // Companions appear ONLY when they equal the bundle's values. "The id
        // resolves" is satisfied exactly by the DSK-P-BOGUS case, so it is
        // necessary and NOT sufficient.
        reason = 'companionMismatch';
      }

      if (reason === undefined) {
        stats.attested++;
        // Canonical even on the happy path: the wire carries the BUNDLE's
        // values, never the model's copy of them, so `attested` and `resolved`
        // are byte-identical in everything they display.
        bindCanonicalProvenance(e, canonical!);
        e[DSK_GROUNDING_KEY] = 'attested' satisfies DskGroundingState;
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
      // Stripping is not a repair: nothing is invented, a claim is removed.
      stats.unverified++;
      stats.unverifiedByReason[reason]++;
      delete e.dsk_claim_id;
      delete e.dsk_protocol_id;
      delete e.evidence_strength;
      // …and fall through: the prompt may still resolve by title, and if it
      // does not it is marked `general` like any other unattested prompt.
    }

    // 2. Resolved — id omitted, but the principle IS a bundle claim title.
    const principle = nonEmptyString(e.principle) ? normaliseTitle(e.principle) : '';
    const hit = principle ? index.byTitle.get(principle) : undefined;
    if (hit) {
      stats.resolved++;
      // Bundle is the single source of truth — "copied exactly from it".
      bindCanonicalProvenance(e, hit);
      e[DSK_GROUNDING_KEY] = 'resolved' satisfies DskGroundingState;
      return e;
    }

    // 3. General — genuinely unattested. No id is invented, ever.
    //
    // ORPHANED CREDIBILITY FIELDS ARE STRIPPED. A model that omits the id can
    // still emit `evidence_strength: 'strong'` and a `dsk_protocol_id`, and
    // those are credibility signals in their own right: an entry declared
    // "genuinely unattested" that still ships `strong` + `DSK-P-002` is making
    // exactly the claim the `general` verdict denies. `shape-check.ts`'s rules
    // for these two fields are warning-only AND do not run on this path, so
    // nothing else removes them.
    //
    // The invariant, stated: `dsk_protocol_id` and `evidence_strength` NEVER
    // appear without a resolving `dsk_claim_id`. The UI's mapper already gates
    // provenance on the id as a unit; this makes the wire agree with it rather
    // than relying on every consumer to re-implement the gate.
    stats.general++;
    delete e.dsk_protocol_id;
    delete e.evidence_strength;
    e[DSK_GROUNDING_KEY] = 'general' satisfies DskGroundingState;
    return e;
  });

  return { prompts: out, stats };
}
