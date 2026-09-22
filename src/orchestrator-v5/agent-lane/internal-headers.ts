/**
 * Headers for an internal call made on behalf of the turn's caller.
 *
 * ⛔ THE ASSIST KEY ALONE CANNOT READ A SIGNED-IN USER'S SCENARIO. Measured
 * against deployed staging, with a contrast control in the same run:
 *
 *     OWNED scenario, assist key only  -> HTTP 404
 *     GUEST scenario, assist key only  -> HTTP 200
 *
 * A caller presenting only the key resolves to `service_legacy`, so
 * `effectiveUserId` is null and every `/assist/v1/scenarios/*` route answers an
 * indistinguishable 404 on an owned scenario. An internal dispatch carrying
 * only the key therefore works perfectly on guest scenarios — which is what
 * local testing used — and fails on every real signed-in user's own model.
 *
 * Forwarding the caller's own `authorization` cannot widen authority: it is
 * their token, and the route's ownership pre-flight has already refused anyone
 * not entitled to the scenario.
 */
export function internalHeaders(
  assistKey: string,
  authorization: string | undefined,
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-olumi-assist-key': assistKey,
    ...(typeof authorization === 'string' && authorization.length > 0
      ? { authorization }
      : {}),
  };
}
