/**
 * Simple structured logger for ISL client
 *
 * Wraps the shared pino logger from telemetry for consistent redaction
 * across all logging paths.
 */

import { log as pinoLog } from './telemetry.js';

/**
 * Logger interface for ISL and other internal components.
 * Uses the shared pino logger with redaction paths.
 */
export const logger = {
  debug(data: Record<string, unknown>): void {
    pinoLog.debug(data);
  },

  info(data: Record<string, unknown>): void {
    pinoLog.info(data);
  },

  warn(data: Record<string, unknown>): void {
    pinoLog.warn(data);
  },

  error(data: Record<string, unknown>): void {
    pinoLog.error(data);
  },
};
