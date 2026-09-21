/**
 * Centralised API key validation for all providers.
 */

export function requireEnvKey(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}
