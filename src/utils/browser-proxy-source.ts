/**
 * Browser-proxy provenance marker (login 3.4 CEE-half).
 *
 * The CEE browser proxy (/proxy/v5/turn) injects the service assist key into
 * its internal /orchestrate/v2/turn call, which makes browser-originated
 * traffic indistinguishable from a trusted key-authed service caller at the
 * auth layer. The flag-gated user-JWT enforcement (CEE_REQUIRE_USER_JWT)
 * must refuse UNAUTHENTICATED browser-proxy turns while still allowing
 * direct key-authed service callers (internal harnesses) to supply a legacy
 * user_id — so the proxy stamps this header on every internal request.
 *
 * Unspoofable by construction: the header is NOT in the proxy's
 * browser-request forward allowlist, and the proxy sets it unconditionally
 * AFTER the allowlist copy, so a browser-supplied value can never reach the
 * internal route. A direct caller that voluntarily sends the header merely
 * opts itself INTO the stricter browser-path rules — spoofing can only
 * tighten, never loosen, enforcement.
 *
 * Kept in its own dependency-free module so the proxy route does not import
 * the JWT-verification stack.
 */

/** Header name stamped by the CEE browser proxy on internal requests. */
export const BROWSER_PROXY_SOURCE_HEADER = "x-olumi-proxy-source";

/** Canonical marker value (matches the proxy's x-proxy-source response header). */
export const BROWSER_PROXY_SOURCE_VALUE = "cee-browser-proxy";
