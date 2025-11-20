export const SSE_DEGRADED_HEADER_NAME = "X-Olumi-Degraded";
export const SSE_DEGRADED_HEADER_NAME_LOWER = "x-olumi-degraded";

export const SSE_DEGRADED_REDIS_REASON = "redis" as const;

export const SSE_DEGRADED_KIND_REDIS_UNAVAILABLE = "redis_unavailable" as const;

export type SseDegradedKind = typeof SSE_DEGRADED_KIND_REDIS_UNAVAILABLE;
