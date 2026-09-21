/**
 * JWT sub extraction and user key resolution.
 *
 * Shared by orchestrator rate limiting (Task 2) and daily token budget (Task 3).
 * Decodes JWT payload without verification — used only for rate-limit bucketing,
 * not for authentication (auth is handled by the auth plugin).
 */

import type { FastifyRequest } from 'fastify';

/**
 * Extract the `sub` claim from a Bearer JWT token (decode only, no verification).
 * Returns undefined if the header is missing, malformed, or lacks a `sub` claim.
 */
export function extractJwtSub(authHeader: string | undefined): string | undefined {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return undefined;

  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    return typeof payload.sub === 'string' && payload.sub.length > 0
      ? payload.sub
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract the first client IP from x-forwarded-for, or fall back to request.ip.
 */
export function extractClientIp(request: FastifyRequest): string {
  const xff = request.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    if (first && first.length > 0) return first;
  }
  return request.ip || 'unknown';
}

/**
 * Resolve a stable user key for rate-limit and budget bucketing.
 * Prefers JWT `sub`; falls back to first IP from x-forwarded-for.
 */
export function resolveUserKey(request: FastifyRequest): string {
  const sub = extractJwtSub(request.headers.authorization);
  if (sub) return `sub:${sub}`;
  return `ip:${extractClientIp(request)}`;
}
