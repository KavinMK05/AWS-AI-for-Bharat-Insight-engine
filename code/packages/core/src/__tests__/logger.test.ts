import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLogger } from '../logger.js';

describe('createLogger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('creates a logger with the given component name', () => {
    const logger = createLogger('TestComponent');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('outputs valid JSON with required fields on info', () => {
    const logger = createLogger('Watchtower');
    logger.info('Ingestion started');

    expect(stdoutSpy).toHaveBeenCalledOnce();
    const output = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output.trim());

    expect(parsed).toMatchObject({
      level: 'info',
      component: 'Watchtower',
      message: 'Ingestion started',
    });
    expect(parsed.timestamp).toBeDefined();
    expect(() => new Date(parsed.timestamp)).not.toThrow();
  });

  it('includes errorDetails when provided', () => {
    const logger = createLogger('Analyst');
    logger.error('Scoring failed', { source: 'arxiv', statusCode: 500 });

    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output.trim());

    expect(parsed).toMatchObject({
      level: 'error',
      component: 'Analyst',
      message: 'Scoring failed',
      errorDetails: { source: 'arxiv', statusCode: 500 },
    });
  });

  it('omits errorDetails when not provided', () => {
    const logger = createLogger('Publisher');
    logger.warn('Rate limit approaching');

    expect(stdoutSpy).toHaveBeenCalledOnce();
    const output = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output.trim());

    expect(parsed.errorDetails).toBeUndefined();
  });

  it('writes error level to stderr', () => {
    const logger = createLogger('Config');
    logger.error('Missing variable');

    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('writes non-error levels to stdout', () => {
    const logger = createLogger('Config');
    logger.info('Loaded');
    logger.debug('Debug info');
    logger.warn('Warning');

    expect(stdoutSpy).toHaveBeenCalledTimes(3);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
