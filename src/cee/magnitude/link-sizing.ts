/**
 * ⭐ IS THIS LINK SIZED, AND BY WHOM? — the ONE reading every approval, readiness check and sentence shares (L4, 52f8cd;
 * DL ruling #85 5929790081 on 5929778726).
 *
 * WHY ONE MODULE. Paul's 1 Oct test (`96c6f5f4`): he approved Olumi's estimates for 8 unsized links at 09:25, and the next
 * three Runs repeated "Olumi hasn't sized…" word for word. "Sized" had three definitions — `goal-certainty` (only
 * `olumi_placeholder`), `placeholder-parts` (any `olumi_*` or `defaulted`), `target-testability` (`olumi_placeholder`) —
 * and the approval writer matched none of them: it recorded the review and kept `magnitude: 'olumi_placeholder'`
 * byte for byte, so nothing that asks "is it sized?" could ever see the approval.
 *
 * THE CLASSES (read off the stored provenance, nothing inferred):
 *   · `user`           — the user sized it: `source: 'user_specified'`, or a size construction credits to the user
 *                        (`magnitude: 'user_stated'`).
 *   · `placeholder`    — nobody sized it: Olumi's default strength (`magnitude: 'olumi_placeholder'`).
 *   · `olumi_accepted` — Olumi's estimate the user approved (`olumi_*` + `reviewed_by_user` confirm). Still Olumi's figure:
 *                        it earns no authorship credit (`earnsAuthorshipCredit` reads authorship, not this).
 *   · `olumi_estimate` — Olumi's estimate, not yet reviewed.
 *   · `unmarked`       — no sizing mark at all (a structural or brief link the sizer never marked).
 *
 * THE RULING (DL 5929790081):
 *   (i)  GOAL FIGURES — an accepted Olumi estimate SIZES a link ("rests on Olumi's estimates you accepted"); only a
 *        `placeholder` withholds them ({@link isPlaceholderLink}).
 *   (ii) A PARTS LIMIT — NO Olumi size scores it, accepted or not: the parts of a total are an identity, not a causal
 *        strength ({@link isSizedOnlyByOlumi}, the parts rule, unchanged).
 * Pure.
 */
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export type LinkSizing = 'user' | 'placeholder' | 'olumi_accepted' | 'olumi_estimate' | 'unmarked';

/** The writer's own literal for a link nobody sized (`cee-v3.ts` `magnitude`). */
export const PLACEHOLDER_MAGNITUDE = 'olumi_placeholder';
/** The literal an approval writes on a placeholder whose band the user approved: Olumi's size, now chosen. */
export const ESTIMATE_MAGNITUDE = 'olumi_estimate';

function reviewedByUser(p: Rec): boolean {
  const r = p.reviewed_by_user;
  return isRec(r) && r.intent === 'confirm';
}

export function linkSizing(edge: unknown): LinkSizing {
  const p = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  if (p?.source === 'user_specified' || p?.magnitude === 'user_stated') return 'user';
  if (p?.magnitude === PLACEHOLDER_MAGNITUDE) return 'placeholder';
  if (typeof p?.magnitude === 'string' && p.magnitude.startsWith('olumi_')) return reviewedByUser(p) ? 'olumi_accepted' : 'olumi_estimate';
  return 'unmarked';
}

/** (i) The link nobody sized — the one class that withholds goal figures and reads "Olumi hasn't sized…". */
export function isPlaceholderLink(edge: unknown): boolean {
  return linkSizing(edge) === 'placeholder';
}

/**
 * (ii) A link sized only by Olumi — any Olumi class, OR a plain `defaulted: true` size — and never the user's. The parts
 * rule: such a size never scores a parts limit. `defaulted` on a user's size marks a projected field (the spread), not
 * Olumi's size (MODEL GENERATION 5918011036; AIQ 5918035214; P0 PARTNER 5918144110).
 */
export function isSizedOnlyByOlumi(edge: unknown): boolean {
  const s = linkSizing(edge);
  if (s === 'user') return false;
  return s === 'placeholder' || s === 'olumi_accepted' || s === 'olumi_estimate' || (isRec(edge) && edge.defaulted === true);
}

/**
 * (i) GOAL FIGURES ONLY: an Olumi size the user accepted counts as sized for the goal (DL 5929790081 (i)). The parts rule
 * ({@link isSizedOnlyByOlumi}) never reads this: an accepted Olumi size still never scores a parts limit (ii).
 */
export function isAcceptedOlumiSize(edge: unknown): boolean {
  return linkSizing(edge) === 'olumi_accepted';
}

/**
 * The links an approval SIZES (L4 design 2): nobody sized them — Olumi's placeholder, or Olumi's older default (no sizing
 * mark at all, `defaulted: true`, not the user's: Paul's 4 magnitude-less links approved at 09:25, `96c6f5f4`).
 */
export function approvalSizes(edge: unknown): boolean {
  const s = linkSizing(edge);
  return s === 'placeholder' || (s === 'unmarked' && isRec(edge) && edge.defaulted === true);
}

/**
 * The approval rule (L4 design 2): a review recorded on a link nobody sized ({@link approvalSizes}) sizes it — Olumi's
 * band, now chosen and accepted — and on any other link changes nothing. Authorship is untouched (`source`, `reasoning`
 * and the rest are kept by the caller): an accepted Olumi estimate is still Olumi's figure. Returns the provenance to
 * store. `edge` is the link as stored BEFORE this write.
 */
export function sizedByApproval<P extends object>(provenance: P, edge: unknown): P {
  return approvalSizes(edge) ? { ...provenance, magnitude: ESTIMATE_MAGNITUDE } : provenance;
}
