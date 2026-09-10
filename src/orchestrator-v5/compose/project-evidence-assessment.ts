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
 * producer-written labels and the fact that the producer looked. The ban is
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

function usableLabel(gap: unknown): string | null {
  if (gap == null || typeof gap !== 'object') return null;
  const label = (gap as Record<string, unknown>).factor_label;
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  // Silence is not an assessment. Only an ARRAY is the producer saying it looked.
  if (!Array.isArray(raw)) return null;

  const gaps: ProjectedEvidenceGap[] = [];
  for (const gap of raw) {
    const factor_label = usableLabel(gap);
    // One unnameable gap voids the whole answer — see the fail-closed note above.
    if (factor_label === null) return null;
    gaps.push({ factor_label });
  }
  return { assessed: true, gaps };
}
