/**
 * Centralised Admin Authentication Middleware
 *
 * Provides shared admin auth logic for all admin routes:
 * - IP allowlist verification
 * - Admin API key verification (full and read-only)
 * - Telemetry emission with hashed IPs (no PII)
 *
 * Used by: admin.prompts.ts, admin.testing.ts, admin.v1.llm-output.ts, admin.v1.draft-failures.ts
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { log, emit, hashIP } from '../utils/telemetry.js';
import { config } from '../config/index.js';

/**
 * Telemetry events for admin auth
 */
export const AdminAuthTelemetryEvents = {
  AdminAuthFailed: 'admin.auth.failed',
  AdminIPBlocked: 'admin.ip.blocked',
} as const;

/**
 * Permission level for admin operations
 */
export type AdminPermission = 'read' | 'write';

/**
 * Parse and cache allowed IPs from config.
 * Returns null if no IP restriction is configured.
 */
function getAllowedIPs(): Set<string> | null {
  const allowedIPsConfig = config.prompts?.adminAllowedIPs;
  if (!allowedIPsConfig || allowedIPsConfig.trim() === '') {
    return null; // No restriction
  }

  return new Set(
    allowedIPsConfig
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0)
  );
}

/**
 * Check if request IP is allowed.
 * Returns true if allowed, sends error response if blocked.
 */
export function verifyIPAllowed(request: FastifyRequest, reply: FastifyReply): boolean {
  const allowedIPs = getAllowedIPs();

  // No IP restriction configured
  if (!allowedIPs) {
    return true;
  }

  const requestIP = request.ip;

  // Check if IP is in allowlist
  // Also check for common localhost representations
  const isAllowed =
    allowedIPs.has(requestIP) ||
    (requestIP === '::1' && allowedIPs.has('127.0.0.1')) ||
    (requestIP === '127.0.0.1' && allowedIPs.has('::1'));

  if (!isAllowed) {
    // Use hashed IP in telemetry/logs to avoid PII leakage
    const ipHash = hashIP(requestIP);
    emit(AdminAuthTelemetryEvents.AdminIPBlocked, {
      ip_hash: ipHash,
      path: request.url,
      allowedCount: allowedIPs.size,
    });
    log.warn({ ip_hash: ipHash, path: request.url }, 'Admin access blocked by IP allowlist');
    reply.status(403).send({
      error: 'ip_not_allowed',
      message: 'Your IP address is not authorized for admin access',
    });
    return false;
  }

  return true;
}

/**
 * Verify admin API key with permission level.
 *
 * Supports two key types:
 * - ADMIN_API_KEY: Full read/write access
 * - ADMIN_API_KEY_READ: Read-only access (list, get, diff only)
 *
 * @param request - Fastify request
 * @param reply - Fastify reply
 * @param requiredPermission - 'read' for read-only ops, 'write' for mutations
 * @returns true if authorized, false if error response sent
 */
export function verifyAdminKey(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredPermission: AdminPermission = 'write'
): boolean {
  // First check IP allowlist
  if (!verifyIPAllowed(request, reply)) {
    return false;
  }

  const adminKey = config.prompts?.adminApiKey;
  const adminKeyRead = config.prompts?.adminApiKeyRead;

  // At least one key must be configured
  if (!adminKey && !adminKeyRead) {
    log.warn('No admin API keys configured, admin routes disabled');
    reply.status(503).send({
      error: 'admin_not_configured',
      message: 'Admin API is not configured',
    });
    return false;
  }

  const providedKey = request.headers['x-admin-key'] as string;

  if (!providedKey) {
    emit(AdminAuthTelemetryEvents.AdminAuthFailed, {
      ip_hash: hashIP(request.ip),
      path: request.url,
      reason: 'missing_key',
    });
    reply.status(401).send({
      error: 'unauthorized',
      message: 'Missing admin API key',
    });
    return false;
  }

  // Check full access key
  if (adminKey && providedKey === adminKey) {
    return true;
  }

  // Check read-only key
  if (adminKeyRead && providedKey === adminKeyRead) {
    // Read-only key provided - check if operation is read-only
    if (requiredPermission === 'write') {
      emit(AdminAuthTelemetryEvents.AdminAuthFailed, {
        ip_hash: hashIP(request.ip),
        path: request.url,
        reason: 'insufficient_permission',
      });
      reply.status(403).send({
        error: 'forbidden',
        message: 'Read-only key cannot perform write operations',
      });
      return false;
    }
    return true;
  }

  // Invalid key
  emit(AdminAuthTelemetryEvents.AdminAuthFailed, {
    ip_hash: hashIP(request.ip),
    path: request.url,
    reason: 'invalid_key',
  });
  reply.status(401).send({
    error: 'unauthorized',
    message: 'Invalid admin API key',
  });
  return false;
}

/**
 * Get actor identifier from request (admin key ID or IP hash).
 * Uses hashed IP to avoid PII in audit logs.
 */
export function getActorFromRequest(request: FastifyRequest): string {
  return `admin@${hashIP(request.ip)}`;
}
