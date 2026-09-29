// Internal CEE judgement policy constants for server-side logic.
// These mirror the SDK policy thresholds for quality banding and team disagreement.

export const CEE_QUALITY_HIGH_MIN = 8; // 8–10 = high
export const CEE_QUALITY_MEDIUM_MIN = 5; // 5–7 = medium; 1–4 = low

export const CEE_TEAM_DISAGREEMENT_MIN_SCORE = 0.4; // score where we start calling disagreement "material"
export const CEE_TEAM_DISAGREEMENT_MIN_PARTICIPANTS = 3; // minimum participants for material disagreement
