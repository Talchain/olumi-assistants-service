/**
 * One browser-origin policy for global CORS and the browser turn proxy.
 *
 * Netlify's immutable deploy permalinks are the only pattern admitted here.
 * Branch/deploy-preview hostnames remain explicit-list only. The immutable
 * pattern is enabled only when the staging alias itself is configured, so an
 * environment with no Olumi staging browser surface does not acquire one.
 */
export const OLUMI_STAGING_ORIGIN = "https://staging--olumi.netlify.app";

const OLUMI_IMMUTABLE_DEPLOY_ORIGIN =
  /^https:\/\/[0-9a-f]{24}--olumi\.netlify\.app$/;

export function isAllowedBrowserOrigin(
  origin: string,
  configuredOrigins: ReadonlySet<string>,
): boolean {
  if (configuredOrigins.has(origin)) return true;

  return (
    configuredOrigins.has(OLUMI_STAGING_ORIGIN) &&
    OLUMI_IMMUTABLE_DEPLOY_ORIGIN.test(origin)
  );
}
