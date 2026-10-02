/**
 * Branch-only PoC switches. Read at route registration so no request can opt in.
 * Keep these out of the shared config schema until the isolated trial is accepted.
 */
export function nativeContextTrialEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    OPENAI_NATIVE_CONTEXT_TRIAL: process.env.OPENAI_NATIVE_CONTEXT_TRIAL,
    OLUMI_ENV: process.env.OLUMI_ENV,
  };
}
