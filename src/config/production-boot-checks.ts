/**
 * Boot-time refusals that must hold in production.
 *
 * "Production" here is the production LABEL (`NODE_ENV=production`) OR the declared
 * production DEPLOYMENT (`isProductionDeployment`, env-resolver.ts). The second only ever
 * adds: with OLUMI_DEPLOYMENT unset, each check behaves exactly as the label alone did.
 * Messages are unchanged.
 */
import { isProductionDeployment } from "./env-resolver.js";

export function isProductionLabelOrDeployment(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production" || isProductionDeployment();
}

/** A wildcard CORS origin is never allowed in production. */
export function assertNoWildcardOrigin(origins: readonly string[], nodeEnv: string | undefined): void {
  if (isProductionLabelOrDeployment(nodeEnv) && origins.some((origin) => origin === "*" || origin === '"*"')) {
    throw new Error("FATAL: ALLOWED_ORIGINS cannot contain '*' in production");
  }
}

/** Production must have an API key or an HMAC secret: authentication cannot be accidentally disabled. */
export function assertAuthConfigured(nodeEnv: string | undefined, hasApiKeys: boolean, hasHmacSecret: boolean): void {
  if (isProductionLabelOrDeployment(nodeEnv) && !hasApiKeys && !hasHmacSecret) {
    throw new Error(
      'FATAL: In production, at least one ASSIST_API_KEY/ASSIST_API_KEYS or HMAC_SECRET must be configured',
    );
  }
}
