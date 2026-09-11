/**
 * ⭐ THE EVIDENCE ASSESSMENT, PROJECTED OUT OF A TRANSPORT-BANNED SUBTREE.
 *
 * PLoT computes `m1_coaching.evidence_gaps` on every run. `m1_coaching` is the
 * sole entry on `TIER3_TRANSPORT_BANNED_FIELDS`, so the finaliser deletes the
 * whole subtree before the wire — correctly: it carries VOI scores and other
 * Tier-3 quantities no surface is licensed to author claims from, and the ban is
 * whole-subtree precisely so an unknown prose leaf cannot ride out under a name
 * the walker does not know.
 *
 * The consequence was that the consumer's evidence check could never be answered,
 * so it rendered "Evidence not assessed" on every run — an honest refusal to read
 * silence as an all-clear, and a permanent one.
 *
 * ⭐ THE SHAPE FOLLOWS THE `flip_thresholds` PRECEDENT, NOT AN UN-BANDING.
 * There, a Tier-3-denied quantity reached a surface as the pre-formatted display
 * string the producer had already written, under an explicit licence. Here a
 * NARROW, SEPARATE block is projected out of the subtree before deletion:
 * producer-written labels, the ids that bind them, and the fact that the producer looked. The ban is
 * untouched, no Tier-3 numeric travels, and the enricher/fact path — which reads
 * the subtree's structured enums for the prompt — is not involved.
 *
 * ⛔⛔ FAIL CLOSED, AND THE DIRECTION MATTERS MORE THAN THE COVERAGE.
 * The consumer reads an empty gap list beside `assessed: true` as a LICENSED
 * ALL-CLEAR ("No evidence gaps flagged"). So an understated list is not a smaller
 * truth — past the last gap it becomes a false statement about the user's
 * evidence, which is strictly worse than the refusal it replaces. Every branch
 * here therefore declines rather than shrinks: no array, no block; one
 * unlabellable gap, no block at all. Emitting a partial list is the one outcome
 * this module may never produce.
 *
 * ⛔ NOT GATED ON DEBUG, DELIBERATELY. The Tier-3 deletion runs only when turn
 * debug is off. A projection that inherited that gating would be live exactly
 * when the deletion was not, i.e. it would do nothing on any deployment where it
 * was needed, and would go dark the moment the debug flag moved.
 */

/** One gap as it reaches the wire: what the producer called it, and nothing else. */
export interface ProjectedEvidenceGap {
  /**
   * ⚠ THE ID TRAVELS, AND THE NUMERICS DO NOT — that distinction IS the claim
   * boundary. An id licenses nothing: it lets the consumer bind a gap to the
   * factor it names by IDENTITY rather than keying on a label, which collides
   * and would have the consumer fabricating a key. A VOI score is the thing a
   * surface could author a claim from, and it stays behind the ban.
   */
  readonly factor_id: string;
  readonly factor_label: string;
}

/**
 * What the consumer needs to tell three states apart: assessed-with-gaps,
 * assessed-and-clear, and not assessed (this block absent).
 */
export interface EvidenceAssessment {
  readonly assessed: true;
  readonly gaps: readonly ProjectedEvidenceGap[];
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A gap is usable only when BOTH the id and the label are present. A gap with
 * no id could not be bound by the consumer; a gap with no label could not be
 * named to a user. Either way the answer would be incomplete, and an incomplete
 * answer here is the false all-clear — so both are fail-closed conditions.
 */
function usableGap(gap: unknown): ProjectedEvidenceGap | null {
  if (gap == null || typeof gap !== 'object') return null;
  const record = gap as Record<string, unknown>;
  const factor_id = nonEmptyString(record.factor_id);
  const factor_label = nonEmptyString(record.factor_label);
  if (factor_id === null || factor_label === null) return null;
  return { factor_id, factor_label };
}

/**
 * Project the assessment out of one block's enrichment, or return null.
 *
 * `null` means "make no claim" and leaves the consumer's honest refusal standing.
 * It is returned for a missing subtree, a non-array `evidence_gaps`, and — the
 * load-bearing one — any gap this projection cannot name.
 */
export function projectEvidenceAssessment(enrichment: unknown): EvidenceAssessment | null {
  if (enrichment == null || typeof enrichment !== 'object') return null;
  const coaching = (enrichment as Record<string, unknown>).m1_coaching;
  if (coaching == null || typeof coaching !== 'object') return null;

  const raw = (coaching as Record<string, unknown>).evidence_gaps;
  if (!Array.isArray(raw)) return null;

  /**
   * ⛔⛔ AN EMPTY ARRAY IS NOT AN ALL-CLEAR, AND THE FIRST VERSION OF THIS
   * MODULE TREATED IT AS ONE. That was the exact harm the acceptance condition
   * forbids, shipped by the module written to prevent it.
   *
   * The premise was "only an ARRAY is the producer saying it looked". Refuted at
   * PLoT's bytes: `evidence_gaps` is produced by
   * `safeCompute(() => computeEvidenceGaps(inputs), [], ...)`, which returns `[]`
   * on ANY EXCEPTION, and `computeEvidenceGaps` itself returns `[]` when there
   * are no factor sensitivities to assess. So `[]` has at least four producers —
   * it crashed, there was nothing assessable, it genuinely found none, or the
   * subtree never arrived — and only ONE of them licenses "No evidence gaps
   * flagged".
   *
   * CEE already holds this position at a reviewed seam: the decision-review
   * enricher and its invoke path both use `evidence_gaps.length > 0` as the
   * real-data signal. Answering the same question with the opposite default here
   * would be two seams disagreeing under one name (CLAUDE.md trap 21).
   *
   * So an empty list emits NOTHING and the consumer's honest "Evidence not
   * assessed" stands. We lose the ability to say "assessed, and clear" — and we
   * should, because on this wire we cannot tell that state from a crash.
   */
  if (raw.length === 0) return null;

  const gaps: ProjectedEvidenceGap[] = [];
  for (const gap of raw) {
    const projected = usableGap(gap);
    // One unusable gap voids the whole answer — see the fail-closed note above.
    if (projected === null) return null;
    gaps.push(projected);
  }
  return { assessed: true, gaps };
}
