// ============================================================================
// Structured Logger — outputs JSON to stdout for CloudWatch
// All Lambda packages must use this logger exclusively. No bare console.log.
// ============================================================================
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
export function createLogger(component) {
    const log = (level, message, errorDetails) => {
        const entry = {
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
        debug: (message, errorDetails) => log('debug', message, errorDetails),
        info: (message, errorDetails) => log('info', message, errorDetails),
        warn: (message, errorDetails) => log('warn', message, errorDetails),
        error: (message, errorDetails) => log('error', message, errorDetails),
    };
}
//# sourceMappingURL=logger.js.map