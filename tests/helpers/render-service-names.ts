/**
 * Render service names, as actually injected into `RENDER_SERVICE_NAME`.
 *
 * ⚠ THESE ARE NOT THE BLUEPRINT `name:` FIELDS. `render.yaml` declares
 * `olumi-assistants-service` and `render-staging.yaml` declares
 * `olumi-assistants-staging`, but the DEPLOYED services are called
 * `cee-production` and `cee-staging` — verified by reading the live Render
 * config (and corroborated by the `cee-staging.onrender.com` host used
 * throughout `tools/`). Render injects the real service name, not the
 * blueprint's.
 *
 * This constant is a MIRROR — there is no in-repo source of truth for the
 * deployed service names, because the blueprints disagree with reality. It is
 * centralised here so there is exactly one copy to correct on a rename, and
 * the suites below exercise BOTH families so a rename in either direction
 * still has coverage.
 *
 * Why it matters that these be real: `getRuntimeEnv()` classifies via
 * `RENDER_SERVICE_NAME.toLowerCase().includes("staging")`. Both name families
 * happen to classify identically, so testing only the fictional blueprint
 * names yields green assertions over inputs that never occur — drift that is
 * invisible precisely because it is harmless today.
 */

/** The live PRODUCTION service (classifies as `prod` — no "staging" substring). */
export const RENDER_PROD_SERVICE_NAME = "cee-production";

/** The live STAGING service (classifies as `staging`). */
export const RENDER_STAGING_SERVICE_NAME = "cee-staging";

/** Blueprint `name:` values — retained as secondary fixtures only. */
export const BLUEPRINT_PROD_SERVICE_NAME = "olumi-assistants-service";
export const BLUEPRINT_STAGING_SERVICE_NAME = "olumi-assistants-staging";
