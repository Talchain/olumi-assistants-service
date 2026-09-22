/**
 * Turn a `UserIdentityResolution` into the turn's caller identity.
 *
 * ⛔ THE DANGEROUS DIRECTION IS DOWNGRADING, NOT REFUSING. A token that was
 * presented but cannot be verified must be REFUSED. Treating that caller as
 * anonymous is how an owned scenario becomes readable by someone who merely
 * failed to authenticate — and it fails silently, because anonymous is a
 * perfectly valid state for guest use.
 *
 * `off` and `service_legacy` are genuinely anonymous: no token was presented,
 * or user JWTs are not required here. Those are guests and must keep working.
 */
import type { UserIdentityResolution } from '../../orchestrator/user-identity.js';

export type CallerIdentity =
  | { readonly kind: 'caller'; readonly userId: string | null }
  | { readonly kind: 'refuse'; readonly reason: string };

export function callerIdentityFrom(identity: UserIdentityResolution): CallerIdentity {
  if (identity.mode === 'refused') return { kind: 'refuse', reason: identity.reason };
  if (identity.mode === 'verified') return { kind: 'caller', userId: identity.userId };
  // 'off' | 'service_legacy' — no verified user, and none was claimed.
  return { kind: 'caller', userId: null };
}
