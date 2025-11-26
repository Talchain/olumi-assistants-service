/**
 * Prompt Audit Logging
 *
 * Provides comprehensive audit trail for all prompt management operations.
 * Supports both in-memory storage (for development) and file-based storage
 * (for production).
 */

import { readFile, mkdir, appendFile } from 'fs/promises';
import { dirname } from 'path';
import { log, emit } from '../utils/telemetry.js';

/**
 * Audit event types
 */
export type AuditAction =
  | 'prompt.created'
  | 'prompt.updated'
  | 'prompt.deleted'
  | 'prompt.archived'
  | 'version.created'
  | 'version.rollback'
  | 'status.changed'
  | 'experiment.started'
  | 'experiment.ended'
  | 'admin.login'
  | 'admin.logout';

/**
 * Audit log entry
 */
export interface AuditEntry {
  /** Unique ID for this entry */
  id: string;
  /** Timestamp */
  timestamp: string;
  /** Action performed */
  action: AuditAction;
  /** User who performed the action */
  actor: string;
  /** IP address (if available) */
  ip?: string;
  /** Resource type (prompt, experiment, etc.) */
  resourceType: 'prompt' | 'version' | 'experiment' | 'admin';
  /** Resource ID */
  resourceId: string;
  /** Changes made (before/after for updates) */
  changes?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Audit log configuration
 */
export interface AuditConfig {
  /** Enable audit logging */
  enabled: boolean;
  /** Path to audit log file */
  logPath: string;
  /** Also emit to telemetry */
  emitTelemetry: boolean;
  /** Max entries to keep in memory */
  maxInMemoryEntries: number;
}

const DEFAULT_CONFIG: AuditConfig = {
  enabled: true,
  logPath: 'data/audit/prompts.log',
  emitTelemetry: true,
  maxInMemoryEntries: 1000,
};

/**
 * Telemetry events
 */
const AuditTelemetryEvents = {
  AuditEntryCreated: 'prompt.audit.entry_created',
  AuditLogError: 'prompt.audit.error',
} as const;

/**
 * Generate a unique ID for audit entries
 */
function generateAuditId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `audit_${timestamp}_${random}`;
}

/**
 * Audit logger class
 */
export class AuditLogger {
  private config: AuditConfig;
  private entries: AuditEntry[] = [];
  private initialized = false;

  constructor(config?: Partial<AuditConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the audit logger
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.config.enabled) {
      this.initialized = true;
      return;
    }

    try {
      // Ensure log directory exists
      const dir = dirname(this.config.logPath);
      await mkdir(dir, { recursive: true });

      log.info({ logPath: this.config.logPath }, 'Audit logger initialized');
      this.initialized = true;
    } catch (error) {
      log.error({ error, logPath: this.config.logPath }, 'Failed to initialize audit logger');
      emit(AuditTelemetryEvents.AuditLogError, {
        operation: 'initialize',
        error: String(error),
      });
      // Continue without file logging
      this.initialized = true;
    }
  }

  /**
   * Log an audit entry
   */
  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const fullEntry: AuditEntry = {
      ...entry,
      id: generateAuditId(),
      timestamp: new Date().toISOString(),
    };

    // Store in memory
    this.entries.push(fullEntry);

    // Trim if over limit
    if (this.entries.length > this.config.maxInMemoryEntries) {
      this.entries = this.entries.slice(-this.config.maxInMemoryEntries);
    }

    // Write to file
    if (this.config.enabled) {
      try {
        const line = JSON.stringify(fullEntry) + '\n';
        await appendFile(this.config.logPath, line, 'utf-8');
      } catch (error) {
        log.error({ error, entry: fullEntry }, 'Failed to write audit entry to file');
        emit(AuditTelemetryEvents.AuditLogError, {
          operation: 'write',
          error: String(error),
        });
      }
    }

    // Emit telemetry
    if (this.config.emitTelemetry) {
      emit(AuditTelemetryEvents.AuditEntryCreated, {
        action: fullEntry.action,
        resourceType: fullEntry.resourceType,
        resourceId: fullEntry.resourceId,
        actor: fullEntry.actor,
      });
    }

    log.debug(
      {
        action: fullEntry.action,
        resourceId: fullEntry.resourceId,
        actor: fullEntry.actor,
      },
      'Audit entry logged'
    );

    return fullEntry;
  }

  /**
   * Get recent audit entries
   */
  getRecent(limit = 100): AuditEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  /**
   * Get entries for a specific resource
   */
  getForResource(resourceType: string, resourceId: string): AuditEntry[] {
    return this.entries
      .filter(e => e.resourceType === resourceType && e.resourceId === resourceId)
      .reverse();
  }

  /**
   * Get entries by actor
   */
  getByActor(actor: string, limit = 100): AuditEntry[] {
    return this.entries
      .filter(e => e.actor === actor)
      .slice(-limit)
      .reverse();
  }

  /**
   * Get entries by action
   */
  getByAction(action: AuditAction, limit = 100): AuditEntry[] {
    return this.entries
      .filter(e => e.action === action)
      .slice(-limit)
      .reverse();
  }

  /**
   * Search entries by date range
   */
  getByDateRange(startDate: Date, endDate: Date): AuditEntry[] {
    const start = startDate.toISOString();
    const end = endDate.toISOString();

    return this.entries.filter(e => e.timestamp >= start && e.timestamp <= end);
  }

  /**
   * Load historical entries from file
   */
  async loadFromFile(maxEntries = 1000): Promise<number> {
    if (!this.config.enabled) return 0;

    try {
      const content = await readFile(this.config.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Parse last N entries
      const recentLines = lines.slice(-maxEntries);
      const parsed: AuditEntry[] = [];

      for (const line of recentLines) {
        try {
          parsed.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }

      this.entries = parsed;
      return parsed.length;
    } catch {
      // File may not exist yet
      return 0;
    }
  }

  /**
   * Clear in-memory entries (for testing)
   */
  clear(): void {
    this.entries = [];
  }
}

// =========================================================================
// Convenience Functions
// =========================================================================

/**
 * Log a prompt creation event
 */
export async function logPromptCreated(
  logger: AuditLogger,
  promptId: string,
  actor: string,
  metadata?: Record<string, unknown>
): Promise<AuditEntry> {
  return logger.log({
    action: 'prompt.created',
    actor,
    resourceType: 'prompt',
    resourceId: promptId,
    metadata,
  });
}

/**
 * Log a prompt update event
 */
export async function logPromptUpdated(
  logger: AuditLogger,
  promptId: string,
  actor: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<AuditEntry> {
  return logger.log({
    action: 'prompt.updated',
    actor,
    resourceType: 'prompt',
    resourceId: promptId,
    changes: { before, after },
  });
}

/**
 * Log a version creation event
 */
export async function logVersionCreated(
  logger: AuditLogger,
  promptId: string,
  version: number,
  actor: string,
  changeNote?: string
): Promise<AuditEntry> {
  return logger.log({
    action: 'version.created',
    actor,
    resourceType: 'version',
    resourceId: `${promptId}:v${version}`,
    metadata: { promptId, version, changeNote },
  });
}

/**
 * Log a rollback event
 */
export async function logVersionRollback(
  logger: AuditLogger,
  promptId: string,
  fromVersion: number,
  toVersion: number,
  actor: string,
  reason: string
): Promise<AuditEntry> {
  return logger.log({
    action: 'version.rollback',
    actor,
    resourceType: 'version',
    resourceId: `${promptId}:v${toVersion}`,
    changes: {
      before: { activeVersion: fromVersion },
      after: { activeVersion: toVersion },
    },
    metadata: { promptId, fromVersion, toVersion, reason },
  });
}

/**
 * Log a status change event
 */
export async function logStatusChanged(
  logger: AuditLogger,
  promptId: string,
  fromStatus: string,
  toStatus: string,
  actor: string
): Promise<AuditEntry> {
  return logger.log({
    action: 'status.changed',
    actor,
    resourceType: 'prompt',
    resourceId: promptId,
    changes: {
      before: { status: fromStatus },
      after: { status: toStatus },
    },
  });
}

/**
 * Log an experiment start event
 */
export async function logExperimentStarted(
  logger: AuditLogger,
  experimentName: string,
  actor: string,
  config: Record<string, unknown>
): Promise<AuditEntry> {
  return logger.log({
    action: 'experiment.started',
    actor,
    resourceType: 'experiment',
    resourceId: experimentName,
    metadata: config,
  });
}

/**
 * Log an experiment end event
 */
export async function logExperimentEnded(
  logger: AuditLogger,
  experimentName: string,
  actor: string,
  results?: Record<string, unknown>
): Promise<AuditEntry> {
  return logger.log({
    action: 'experiment.ended',
    actor,
    resourceType: 'experiment',
    resourceId: experimentName,
    metadata: results,
  });
}

// =========================================================================
// Singleton Instance
// =========================================================================

let auditLogger: AuditLogger | null = null;

/**
 * Get the audit logger instance
 */
export function getAuditLogger(config?: Partial<AuditConfig>): AuditLogger {
  if (!auditLogger) {
    auditLogger = new AuditLogger(config);
  }
  return auditLogger;
}

/**
 * Reset the audit logger (for testing)
 */
export function resetAuditLogger(): void {
  auditLogger = null;
}
