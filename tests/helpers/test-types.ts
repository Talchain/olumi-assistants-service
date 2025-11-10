/**
 * Test Type Helpers
 *
 * Helpers for narrowing `unknown` types in tests.
 * Security-sensitive functions like redactCsvData() return `unknown` to prevent
 * accidental leakage of sensitive data in production. In tests, we need to
 * access properties for assertions.
 */

/**
 * Cast unknown data to any for test assertions.
 * Only use in tests where you need to verify structure of redacted data.
 */
export function asTestData<T = any>(data: unknown): T {
  return data as T;
}
