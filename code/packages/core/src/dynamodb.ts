// ============================================================================
// DynamoDB Client Wrapper — AWS SDK v3
// Provides typed CRUD operations for all Insight Engine tables.
// ============================================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import type { PutCommandInput, GetCommandInput, QueryCommandInput, BatchGetCommandInput } from '@aws-sdk/lib-dynamodb';
import { createLogger } from './logger.js';

const logger = createLogger('DynamoDB');

/**
 * DynamoDB table names used by the Insight Engine.
 * Prefixed with the environment at runtime via config.tablePrefix.
 */
export const TABLE_NAMES = {
  contentItems: 'ContentItems',
  hotTakes: 'HotTakes',
  draftContent: 'DraftContent',
  publishingQueue: 'PublishingQueue',
  socialConnections: 'SocialConnections',
  metrics: 'Metrics',
} as const;

export type TableName = (typeof TABLE_NAMES)[keyof typeof TABLE_NAMES];

/**
 * Creates a DynamoDB Document Client with standard configuration.
 */
export function createDynamoDBClient(region: string): DynamoDBDocumentClient {
  const client = new DynamoDBClient({ region });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
    unmarshallOptions: {
      wrapNumbers: false,
    },
  });
}

/**
 * Get the full table name with environment prefix.
 */
export function getTableName(tablePrefix: string, table: TableName): string {
  return `${tablePrefix}${table}`;
}

/**
 * Typed wrapper around DynamoDB operations for the Insight Engine.
 */
export class DynamoDBClientWrapper {
  private readonly client: DynamoDBDocumentClient;
  private readonly tablePrefix: string;

  constructor(client: DynamoDBDocumentClient, tablePrefix: string) {
    this.client = client;
    this.tablePrefix = tablePrefix;
  }

  private tableName(table: TableName): string {
    return getTableName(this.tablePrefix, table);
  }

  /**
   * Put a single item into a DynamoDB table.
   */
  async putItem(table: TableName, item: Record<string, unknown>): Promise<void> {
    const params: PutCommandInput = {
      TableName: this.tableName(table),
      Item: item,
    };

    try {
      await this.client.send(new PutCommand(params));
      logger.debug(`Put item to ${table}`, { id: item['id'] as string });
    } catch (error: unknown) {
      logger.error(`Failed to put item to ${table}`, {
        table,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a single item by primary key.
   */
  async getItem<T extends Record<string, unknown>>(
    table: TableName,
    key: Record<string, unknown>,
  ): Promise<T | null> {
    const params: GetCommandInput = {
      TableName: this.tableName(table),
      Key: key,
    };

    try {
      const result = await this.client.send(new GetCommand(params));
      return (result.Item as T) ?? null;
    } catch (error: unknown) {
      logger.error(`Failed to get item from ${table}`, {
        table,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Batch get multiple items by primary key.
   * Automatically handles pagination - returns all items.
   * DynamoDB batch get limit is 100 items per request.
   */
  async batchGet<T extends Record<string, unknown>>(
    table: TableName,
    keys: Record<string, unknown>[],
  ): Promise<(T | null)[]> {
    if (keys.length === 0) {
      return [];
    }

    const tableName = this.tableName(table);
    const allItems: Record<string, T> = {};
    let unprocessedKeys: Record<string, unknown>[] = keys;

    try {
      while (unprocessedKeys.length > 0) {
        const batch = unprocessedKeys.slice(0, 100);
        unprocessedKeys = unprocessedKeys.slice(100);

        const params: BatchGetCommandInput = {
          RequestItems: {
            [tableName]: {
              Keys: batch,
            },
          },
        };

        const result = await this.client.send(new BatchGetCommand(params));
        const responses = result.Responses?.[tableName];
        if (responses) {
          for (const item of responses as T[]) {
            const id = item['id'] as string;
            if (id) {
              allItems[id] = item;
            }
          }
        }

        if (result.UnprocessedKeys && Object.keys(result.UnprocessedKeys).length > 0) {
          unprocessedKeys = unprocessedKeys.concat(
            Object.values(result.UnprocessedKeys).flatMap((v) => v.Keys ?? []) as Record<string, unknown>[],
          );
          logger.warn('Unprocessed keys in batch get', { table, count: unprocessedKeys.length });
        }
      }

      return keys.map((key) => {
        const id = key['id'] as string;
        return allItems[id] ?? null;
      });
    } catch (error: unknown) {
      logger.error(`Failed to batch get from ${table}`, {
        table,
        keyCount: keys.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Query items using a key condition expression.
   * Automatically paginates through all results using LastEvaluatedKey.
   */
  async queryItems<T extends Record<string, unknown>>(
    table: TableName,
    params: Omit<QueryCommandInput, 'TableName'>,
  ): Promise<T[]> {
    const allItems: T[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    try {
      do {
        const queryParams: QueryCommandInput = {
          ...params,
          TableName: this.tableName(table),
          ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        };

        const result = await this.client.send(new QueryCommand(queryParams));
        if (result.Items) {
          allItems.push(...(result.Items as T[]));
        }
        exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey);

      return allItems;
    } catch (error: unknown) {
      logger.error(`Failed to query ${table}`, {
        table,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Query items using a GSI.
   */
  async queryByIndex<T extends Record<string, unknown>>(
    table: TableName,
    indexName: string,
    keyConditionExpression: string,
    expressionAttributeValues: Record<string, unknown>,
    expressionAttributeNames?: Record<string, string>,
  ): Promise<T[]> {
    return this.queryItems<T>(table, {
      IndexName: indexName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(expressionAttributeNames && {
        ExpressionAttributeNames: expressionAttributeNames,
      }),
    });
  }

  /**
   * Update specific attributes of an item.
   */
  async updateItem(
    table: TableName,
    key: Record<string, unknown>,
    updateExpression: string,
    expressionAttributeValues: Record<string, unknown>,
    expressionAttributeNames?: Record<string, string>,
  ): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName(table),
          Key: key,
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ...(expressionAttributeNames && {
            ExpressionAttributeNames: expressionAttributeNames,
          }),
        }),
      );
      logger.debug(`Updated item in ${table}`, { key });
    } catch (error: unknown) {
      logger.error(`Failed to update item in ${table}`, {
        table,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a single item by primary key.
   */
  async deleteItem(table: TableName, key: Record<string, unknown>): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName(table),
          Key: key,
        }),
      );
      logger.debug(`Deleted item from ${table}`, { key });
    } catch (error: unknown) {
      logger.error(`Failed to delete item from ${table}`, {
        table,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
