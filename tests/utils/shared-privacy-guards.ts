import { expectNoSecretLikeKeys } from "./no-secret-like-keys.js";
import { expectNoBannedSubstrings } from "./telemetry-banned-substrings.js";

/**
 * Shared wrappers so both root tests and SDK tests can rely on a single
 * source of truth for secret-like key and banned-substring guards.
 */
export function expectNoSecretLikeKeysShared(payload: unknown): void {
  expectNoSecretLikeKeys(payload);
}

export function expectNoBannedSubstringsShared(payload: unknown): void {
  // The underlying helper expects a record; payloads under test are objects or
  // plain JSON, so a narrow cast via unknown is sufficient.
  expectNoBannedSubstrings(payload as unknown as Record<string, unknown>);
}
