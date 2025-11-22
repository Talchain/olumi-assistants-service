import { expect } from "vitest";

// SDK-local copies of the secret-like key and banned-substring guards used to
// validate that CEE Decision Review payloads remain metadata-only.

const SECRET_KEY_TOKENS = [
  "secret",
  "password",
  "token",
  "apikey",
  "api_key",
  "access_key",
  "session_id",
];

const PROMPT_KEY_NAMES = ["prompt", "raw_prompt", "system_prompt"] as const;

export function expectNoSecretLikeKeysShared(payload: unknown): void {
  const bannedKeys: string[] = [];

  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      if (
        SECRET_KEY_TOKENS.some((token) => lowerKey.includes(token)) ||
        PROMPT_KEY_NAMES.includes(lowerKey as (typeof PROMPT_KEY_NAMES)[number])
      ) {
        bannedKeys.push(key);
      }

      visit(child);
    }
  };

  visit(payload);

  expect(bannedKeys).toEqual([]);
}

const BANNED_SUBSTRINGS: string[] = [
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

export function expectNoBannedSubstringsShared(payload: unknown): void {
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

  visit(payload);
}
