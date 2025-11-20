// Shared banned-substring helper for telemetry and diagnostics tests (v1.12.0)
//
// IMPORTANT: This helper must remain metadata-only. It is intended to guard
// against accidental inclusion of secrets, credentials, or unsafe headers in
// telemetry payloads or diagnostics objects. It MUST NOT itself depend on
// application code.
import { expect } from "vitest";

export const BANNED_SUBSTRINGS: string[] = [
  // Secrets / credentials
  "secret",
  "password",
  "passwd",
  "api_key",
  "apikey",
  "authorization",
  "bearer ",
  "sk-",
  "sessionid",
  "cookie",
  // Headers that must never be echoed back
  "x-olumi-assist-key",
];

export function expectNoBannedSubstrings(data: Record<string, any>): void {
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      for (const banned of BANNED_SUBSTRINGS) {
        expect(lower.includes(banned)).toBe(false);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) {
        visit(v);
      }
    }
  };

  visit(data);
}
