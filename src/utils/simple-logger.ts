/**
 * Simple structured logger for ISL client
 *
 * Uses console with JSON formatting for consistency with Fastify's logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: number;
  time: number;
  pid: number;
  hostname: string;
  [key: string]: unknown;
}

const LEVELS = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

class SimpleLogger {
  private minLevel: number;

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = LEVELS[minLevel];
  }

  private log(level: LogLevel, data: Record<string, unknown>): void {
    if (LEVELS[level] < this.minLevel) {
      return;
    }

    const entry: LogEntry = {
      level: LEVELS[level],
      time: Date.now(),
      pid: process.pid,
      hostname: 'olumi-assistants-service',
      ...data,
    };

    console.log(JSON.stringify(entry));
  }

  debug(data: Record<string, unknown>): void {
    this.log('debug', data);
  }

  info(data: Record<string, unknown>): void {
    this.log('info', data);
  }

  warn(data: Record<string, unknown>): void {
    this.log('warn', data);
  }

  error(data: Record<string, unknown>): void {
    this.log('error', data);
  }
}

// Export singleton instance
export const logger = new SimpleLogger(
  (process.env.LOG_LEVEL as LogLevel) || 'info',
);
