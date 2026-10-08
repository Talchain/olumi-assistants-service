/**
 * The face markers for a Run whose chance leaves out Olumi's draft-time added risks (P05b #2854). ONE declaration, read by
 * the widening producer and the reply composer. A leaf module (no imports): the composer importing widen-draft directly
 * pulled widen-draft's dependency chain into the composer's load order and broke module initialisation (#2843 r16 CI).
 */
export const WIDENED_RISK_MARKER_DOWN = "Leaves out Olumi's added risks; may be too high";
export const WIDENED_RISK_MARKER_MOVE = "Leaves out Olumi's added risks; may move";
