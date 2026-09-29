// Internal CEE judgement policy constants for the TypeScript SDK.
// These centralise thresholds used for quality banding, health status, truncation,
// and team disagreement. They are metadata-only and deterministic.

export const CEE_QUALITY_HIGH_MIN = 8; // 8–10 = high
export const CEE_QUALITY_MEDIUM_MIN = 5; // 5–7 = medium; 1–4 = low

export const CEE_HEALTH_RISK_MAX = 3; // 1–3 => risk band in health when used alone

export const CEE_HEAVY_TRUNCATION_FLAG_COUNT = 2; // 2+ truncation flags => heavy truncation

export const CEE_TEAM_DISAGREEMENT_MIN_SCORE = 0.4; // score where we start calling disagreement "material"
export const CEE_TEAM_DISAGREEMENT_MIN_PARTICIPANTS = 3; // minimum participants for material disagreement
