// Compatibility entry point for the existing host verification callers.
// Only the provenance reader decides origin; this module owns no second policy.
export { statementOrigin } from '../../../cee/provenance/provenance-of.js';

export const UNKNOWN_ORIGIN_DETAIL = 'The retained source is not verified. Its origin stays unknown; nothing was prepared. Ask for its source.';
