// ============================================================================
// RDS Client Tests — pg.Pool-based PostgreSQL client
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mClient = {
  query: vi.fn().mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 }),
  release: vi.fn(),
};

const mPool = {
  connect: vi.fn().mockResolvedValue(mClient),
  query: vi.fn().mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 }),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

// Mock pg module using absolute certainty
vi.mock('pg', () => {
  return {
    default: {
      Pool: vi.fn(() => mPool),
    },
    Pool: vi.fn(() => mPool),
  };
});

import { createRdsClient } from '../rds.js';

describe('createRdsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a client with query method', () => {
    const client = createRdsClient({
      connectionString: 'postgresql://test:test@localhost:5432/test',
    });
    expect(client).toBeDefined();
    expect(typeof client.query).toBe('function');
    expect(typeof client.healthCheck).toBe('function');
    expect(typeof client.disconnect).toBe('function');
  });

  it('executes a query and returns results', async () => {
    const client = createRdsClient({
      connectionString: 'postgresql://test:test@localhost:5432/test',
    });

    try {
      const result = await client.query('SELECT 1');
      console.log('QUERY RESULT IN TEST:', JSON.stringify(result));
      expect(result.rows).toEqual([{ result: 1 }]);
      expect(result.rowCount).toBe(1);
    } catch (err: unknown) {
      console.log('QUERY ERROR IN TEST:', err);
      throw err;
    }
  });

  it('health check returns true on successful connection', async () => {
    const client = createRdsClient({
      connectionString: 'postgresql://test:test@localhost:5432/test',
    });

    const healthy = await client.healthCheck();
    console.log('HEALTH CHECK RESULT IN TEST:', healthy);
    expect(healthy).toBe(true);
  });

  it('disconnect closes the pool', async () => {
    const client = createRdsClient({
      connectionString: 'postgresql://test:test@localhost:5432/test',
    });

    await client.disconnect();
  });
});
