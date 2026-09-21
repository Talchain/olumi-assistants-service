/**
 * V6 Context Management — claim-permission types (Increment 1).
 *
 * TYPES + a single default-held constant. Structural only. This defines WHICH
 * science-bearing claim classes are held vs allowed for surfacing; it surfaces
 * nothing itself and is NOT wired to any runtime path in this increment.
 *
 * Every uncertified, science-bearing class DEFAULTS TO HELD. Moving any class
 * from `held` to `allowed` is out of scope here and is gated on the
 * science-certification pathway (#305 R2 + Neil/Jinghui sign-off) — see
 * `Docs/v6/context-management-authoritative-state-map.md` §7. No relaxation is
 * performed in this increment.
 */

/** Whether a claim class may be surfaced (`allowed`) or must be withheld (`held`). */
export type ClaimPermissionState = 'held' | 'allowed';

/**
 * Science-bearing claim classes that default to held until certified. These are
 * the producer-owned scientific outputs the frame must never surface as prose
 * without certification (F.6: the frame annotates permission, it never derives
 * or reinterprets the science itself).
 */
export type HeldScienceClaimClass =
  | 'sensitivity'
  | 'fragility'
  | 'influence_driver'
  | 'flip'
  | 'robustness'
  | 'evpi_voi'
  | 'm1_coaching'
  | 'causal_mechanism';

/** Per-class permission table. Exhaustive over {@link HeldScienceClaimClass}. */
export type ClaimPermissionTable = Readonly<
  Record<HeldScienceClaimClass, ClaimPermissionState>
>;

/**
 * The structural default: every science-bearing class is HELD. This is the
 * default-held table referenced by the frame contract. It performs no
 * relaxation and is not consumed by any runtime path in this increment; a
 * later, separately-reviewed increment (state map §6, Increment 5) materialises
 * the policy logic that reads it.
 */
export const DEFAULT_CLAIM_PERMISSIONS: ClaimPermissionTable = {
  sensitivity: 'held',
  fragility: 'held',
  influence_driver: 'held',
  flip: 'held',
  robustness: 'held',
  evpi_voi: 'held',
  m1_coaching: 'held',
  causal_mechanism: 'held',
};
