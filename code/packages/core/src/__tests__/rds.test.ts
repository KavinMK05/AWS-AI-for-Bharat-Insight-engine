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

// Mock pg module — the code does `import pg from 'pg'` then `const { Pool } = pg;`
const mockPoolQuery = vi.fn().mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 }),
  release: vi.fn(),
};
const mockEnd = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(mockClient);
const mockOn = vi.fn();

vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockPoolQuery,
    connect: mockConnect,
    end: mockEnd,
    on: mockOn,
  }));

  return {
    default: { Pool: MockPool },
    Pool: MockPool,
  };
});

import { createRdsClient } from '../rds.js';

describe('createRdsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default implementations after clearAllMocks
    mockPoolQuery.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
    mockClient.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
    mockConnect.mockResolvedValue(mockClient);
    mockEnd.mockResolvedValue(undefined);
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

    const result = await client.query('SELECT 1');
    expect(result.rows).toEqual([{ result: 1 }]);
    expect(result.rowCount).toBe(1);
  });

  it('health check returns true on successful connection', async () => {
    const client = createRdsClient({
      connectionString: 'postgresql://test:test@localhost:5432/test',
    });

    const healthy = await client.healthCheck();
    expect(healthy).toBe(true);
  });

  it('disconnect closes the pool', async () => {
    const client = createRdsClient({
      connectionString: 'postgresql://test:test@localhost:5432/test',
    });

    await client.disconnect();
    // Should not throw
  });
});
