import { expect } from "vitest";

const SECRET_KEY_TOKENS = [
  "secret",
  "password",
  "token",
  "apikey",
  "api_key",
  "access_key",
  "session_id",
];

const PROMPT_KEY_NAMES = ["prompt", "raw_prompt", "system_prompt"];

export function expectNoSecretLikeKeys(payload: unknown): void {
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
        PROMPT_KEY_NAMES.includes(lowerKey)
      ) {
        bannedKeys.push(key);
      }

      visit(child);
    }
  };

  visit(payload);

  expect(bannedKeys).toEqual([]);
}
