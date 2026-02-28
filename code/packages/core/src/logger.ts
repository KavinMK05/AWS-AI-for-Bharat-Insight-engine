// ============================================================================
// Structured Logger — outputs JSON to stdout for CloudWatch
// All Lambda packages must use this logger exclusively. No bare console.log.
// ============================================================================

import type { LogLevel, LogEntry } from './types.js';

/**
 * Creates a structured logger for a specific component.
 *
 * Usage:
 * ```ts
 * const logger = createLogger('Watchtower');
 * logger.info('Ingestion started', { feedCount: 5 });
 * logger.error('RSS fetch failed', { source: 'techcrunch', error: err.message });
 * ```
 */
export function createLogger(component: string) {
  const log = (level: LogLevel, message: string, errorDetails?: Record<string, unknown>): void => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...(errorDetails && { errorDetails }),
    };

    // Write JSON to stdout — CloudWatch picks this up automatically
    const output = JSON.stringify(entry);
    switch (level) {
      case 'error':
        process.stderr.write(output + '\n');
        break;
      default:
        process.stdout.write(output + '\n');
        break;
    }
  };

  return {
    debug: (message: string, errorDetails?: Record<string, unknown>) =>
      log('debug', message, errorDetails),
    info: (message: string, errorDetails?: Record<string, unknown>) =>
      log('info', message, errorDetails),
    warn: (message: string, errorDetails?: Record<string, unknown>) =>
      log('warn', message, errorDetails),
    error: (message: string, errorDetails?: Record<string, unknown>) =>
      log('error', message, errorDetails),
  };
}

/** Type of the logger returned by createLogger */
export type Logger = ReturnType<typeof createLogger>;
