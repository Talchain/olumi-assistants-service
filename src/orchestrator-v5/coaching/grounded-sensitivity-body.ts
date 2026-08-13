/**
 * THE GROUNDED SENSITIVITY BODY — Lane C.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES, MEASURED RATHER THAN ASSERTED.
 *
 * `sensitivity_flip_risk` is the lens **40 of 45** real banked runs select — by
 * an order of magnitude the thing users actually get. It declares NO companion
 * exercise (`phase3-blocks.ts`, the `return []` arm), so its entire user-facing
 * surface is one coaching block whose body is a CONSTANT from
 * `BODY_BY_RATIONALE`, keyed by rationale code. Censused over those 45
 * captures: **1 distinct title, 2 distinct bodies** — and the 2 are the number
 * of rationale codes that fired, not producer content.
 *
 * The copy reaching 38 of those 40 runs opens:
 *
 *     "THIS FACTOR moves the result more than any other."
 *
 * A deictic with NO ANTECEDENT. The product points at a factor and never says
 * which one — while `factor_sensitivity[].factor_label` carries the name on
 * **40/40** of exactly those runs, in the same array the lens already grounds
 * its claim in (`groundingField: 'factor_sensitivity'`).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── ⭐ THE CLAIM BOUNDARY: THIS RESOLVES A PRONOUN, IT ADDS NO PROPOSITION ───
 * Every grounded body asserts exactly what the constant asserted, with the
 * referent made explicit. That is not a stylistic description — it is enforced
 * by construction below: the opening clause is REPLACED and the remainder of
 * the reviewed sentence is carried through by `slice`, byte-for-byte.
 *
 * The consequence is that there is no new claim to license:
 *   - **No leading option.** None of these sentences names an option, and this
 *     module does not add one. Naming the option that would take the lead
 *     belongs to the canonical `readMayNameLeadingOptionVerdict` derivation;
 *     five producers of "who is leading" already exist in this estate and a
 *     pure module cannot hold that permission (nor fake it).
 *   - **No magnitude.** The label is a name, not a number.
 *   - **⚠ NO FLIP VERB on the `_NO_FLIP` codes**, which are the ONLY two codes
 *     real traffic produces (`SENSITIVITY_ISOLATED_NO_FLIP` 38,
 *     `DOMINANT_DRIVER_NO_FLIP` 2). Those runs carry a POSITIVE producer
 *     attestation that no factor can move the winner — ROADMAP 2.278 re-aimed
 *     that copy from the ranking to the margin precisely for that reason. A
 *     grounded body that re-opened "could flip" would be false on the exact
 *     traffic it ships to. Pinned by test, with a positive control proving the
 *     probe fires.
 *
 * ── WHERE DELIBERATE VAGUENESS IS PRESERVED, AND WHY ─────────────────────────
 * `FLIP_RISK_CORRELATED` opens "No single factor is decisive here". The
 * producer's own semantics for the `correlated` category is that the factor
 * tips the result ONLY IN COMBINATION with others — so rewriting this as
 * "<label> could tip the result" would invert the sentence's meaning and
 * over-claim on a category defined by its non-singularity. The grounded form
 * therefore keeps "No single factor is decisive here" INTACT and names the
 * subject as a member of the combination ("— <label> among them —"), which is
 * exactly what `flipRiskCategory === 'correlated'` licenses and nothing more.
 * The vagueness about singularity is load-bearing and is kept.
 *
 * ── ⚠ THE ANTI-MIRROR GUARD (trap 12), AND WHY IT IS NOT A COPY ─────────────
 * `BODY_BY_RATIONALE` lives in `compose/lens-selector.ts` and is reviewed on
 * its own terms. This module does NOT restate those sentences. It declares, per
 * code, the OPENING CLAUSE it expects to find and the grounded clause that
 * replaces it, then asserts the constant actually starts with that opening. If
 * anyone edits the copy, the assertion fails and this module REFUSES — the
 * caller falls back to the constant and the user sees today's sentence. It
 * cannot silently ground a rewritten sentence or mangle one.
 *
 * That refusal is the SAFE half; the LOUD half is a test asserting that every
 * declared code still matches at rest, so a copy edit turns CI red rather than
 * turning this feature quietly off in production. Fail-safe at runtime,
 * fail-loud in CI — a mirror with no alarm is the dominant defect class here.
 *
 * ── COMPOSABILITY IS ASKED EARLY ─────────────────────────────────────────────
 * The grounded body interpolates a PRODUCER label, so unlike the constant it
 * can trip the prose gate or breach the block's body cap. Both are evaluated on
 * the ACTUAL composed string and refuse the GROUNDING, never the block. Gate
 * objects are IMPORTED, never re-declared.
 *
 * Pure: no I/O, no clock, no config. A total function of
 * `(rationaleCode, subjectFactorId, enrichment)`.
 */

import { ENTITY_ID_LEAK_RE } from '../../orchestrator/shared/entity-id-pattern.js';
import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';
import { findForbiddenPhraseHit, RAW_DECIMAL_RE } from '../compose/forbidden-user-facing-phrases.js';
import { BODY_BY_RATIONALE, type LensRationaleCode } from '../compose/lens-selector.js';

export type GroundedSensitivityRefusalReason =
  /** The lens carried no single-factor subject (e.g. an option-level lens). */
  | 'no_subject_factor'
  /** The subject id matched no `factor_sensitivity` row carrying a label. */
  | 'no_factor_label'
  /** This rationale code declares no grounded form. */
  | 'no_grounded_form'
  /**
   * The constant no longer starts with the opening clause this module expects —
   * the copy was edited. Refuse rather than ground a sentence we no longer
   * recognise. A test makes this loud at rest.
   */
  | 'copy_drifted'
  /** The composed body trips a prose gate or the body cap. */
  | 'not_composable';

export interface GroundedSensitivityBody {
  readonly factorId: string;
  readonly factorLabel: string;
  /** The reviewed sentence with its opening deictic resolved to the label. */
  readonly body: string;
}

export interface GroundedSensitivityDecision {
  readonly grounded: GroundedSensitivityBody | null;
  readonly refusalReason: GroundedSensitivityRefusalReason | null;
}

/**
 * The block body cap. SINGLE-SOURCED against `phase3-blocks.ts`'s `BODY_MAX`
 * (300, itself single-sourced from `fragile-edge-offer-text.ts`). Refusing
 * ABOVE the cap rather than letting truncation run is deliberate: the grounded
 * name sits at the FRONT of the sentence, so truncation would eat the reviewed
 * tail and leave a body that names a factor and then stops mid-clause.
 */
export const GROUNDED_SENSITIVITY_BODY_MAX = 300;

/**
 * The declared substitutions. `expectedOpening` must be a PREFIX of the
 * constant; `ground` returns its replacement. Everything after the opening is
 * carried through untouched, which is what makes "adds no proposition" a
 * checkable property rather than an intention.
 *
 * Sparse by design: a rationale absent here has no grounded form and refuses.
 */
const SUBSTITUTION_BY_RATIONALE: Partial<
  Readonly<
    Record<
      LensRationaleCode,
      { readonly expectedOpening: string; readonly ground: (label: string) => string }
    >
  >
> = {
  // ── The two codes real traffic actually produces ───────────────────────────
  SENSITIVITY_ISOLATED_NO_FLIP: {
    expectedOpening: 'This factor moves the result more than any other.',
    ground: (l) => `${l} moves the result more than any other.`,
  },
  DOMINANT_DRIVER_NO_FLIP: {
    expectedOpening: 'One factor is doing most of the work in this result.',
    ground: (l) => `${l} is doing most of the work in this result.`,
  },
  // ── Declared for completeness; unobserved in the 45-capture census ─────────
  SENSITIVITY_CORRELATED_NO_FLIP: {
    expectedOpening: 'This factor moves the result alongside others rather than on its own.',
    ground: (l) => `${l} moves the result alongside others rather than on its own.`,
  },
  DOMINANT_DRIVER: {
    expectedOpening: 'One factor is doing most of the work in this result.',
    ground: (l) => `${l} is doing most of the work in this result.`,
  },
  FLIP_RISK_ISOLATED: {
    expectedOpening: 'The result leans on a single factor that could tip which option leads on its own',
    ground: (l) => `The result leans on ${l}, which could tip which option leads on its own`,
  },
  // ⚠ "No single factor is decisive here" is KEPT VERBATIM — see the header.
  // `correlated` means "tips only in combination", so the subject is named as a
  // MEMBER of the combination, never as the factor that could tip it.
  FLIP_RISK_CORRELATED: {
    expectedOpening: 'No single factor is decisive here, but the right combination of factors',
    ground: (l) => `No single factor is decisive here, but the right combination of factors — ${l} among them —`,
  },
};

// ============================================================================
// Defensive reads. A missing/ill-typed field becomes absent, never a default.
// ============================================================================

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** The producer's own label for this factor id, from the lens's grounding field. */
function resolveFactorLabel(enrichment: unknown, factorId: string): string | null {
  const root = readRecord(enrichment);
  const rows = root !== null && Array.isArray(root.factor_sensitivity) ? root.factor_sensitivity : [];
  for (const raw of rows) {
    const row = readRecord(raw);
    if (row === null) continue;
    if (nonEmptyString(row.factor_id) !== factorId) continue;
    return nonEmptyString(row.factor_label);
  }
  return null;
}

/** The prose gates, evaluated on the ACTUAL composed string (never a preview). */
function isComposable(body: string): boolean {
  if (body.length > GROUNDED_SENSITIVITY_BODY_MAX) return false;
  if (findForbiddenPhraseHit(body) !== null) return false;
  if (RAW_DECIMAL_RE.exec(body) !== null) return false;
  const idMatcher = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = idMatcher.exec(body)) !== null) {
    if (isSlugShapedEntityId(m[0])) return false;
  }
  return true;
}

/**
 * Resolve the deictic in this run's sensitivity body to the subject factor's
 * producer-authored label.
 *
 * Total: every input yields a decision, and every refusal names its reason. A
 * refusal means the caller keeps today's constant — never a worse sentence.
 */
export function selectGroundedSensitivityBody(
  rationaleCode: LensRationaleCode,
  subjectFactorId: string | null | undefined,
  enrichment: unknown,
  /**
   * TEST SEAM — the copy bank to read. Defaults to the real constant, so every
   * production call is byte-identical to a three-argument call.
   *
   * It exists because the drift guard below CANNOT FIRE on current data: at
   * rest every declared opening matches, so a mutant that deletes the guard
   * survives the whole suite. That survivor was measured, not assumed, and this
   * seam is the fix — the refusal arm is now exercised against a deliberately
   * drifted bank, so "fail-safe at runtime" is a demonstrated property rather
   * than a sentence in a header (CLAUDE.md trap 13b: a guard whose
   * discrimination nothing pins is a guard agreeing with itself).
   */
  bodyByRationale: Readonly<Record<LensRationaleCode, string>> = BODY_BY_RATIONALE,
): GroundedSensitivityDecision {
  if (nonEmptyString(subjectFactorId) === null) {
    return { grounded: null, refusalReason: 'no_subject_factor' };
  }
  const factorId = subjectFactorId as string;

  const substitution = SUBSTITUTION_BY_RATIONALE[rationaleCode];
  if (substitution === undefined) {
    return { grounded: null, refusalReason: 'no_grounded_form' };
  }

  const factorLabel = resolveFactorLabel(enrichment, factorId);
  if (factorLabel === null) {
    return { grounded: null, refusalReason: 'no_factor_label' };
  }

  // THE ANTI-MIRROR ASSERTION. We do not restate the copy; we check the copy we
  // borrowed still begins the way we expect, and refuse if it has moved.
  const constant = bodyByRationale[rationaleCode];
  if (!constant.startsWith(substitution.expectedOpening)) {
    return { grounded: null, refusalReason: 'copy_drifted' };
  }

  // The tail is carried through by SLICE — the reviewed sentence, byte-for-byte.
  const body = substitution.ground(factorLabel) + constant.slice(substitution.expectedOpening.length);

  if (!isComposable(body)) {
    return { grounded: null, refusalReason: 'not_composable' };
  }

  return { grounded: { factorId, factorLabel, body }, refusalReason: null };
}
