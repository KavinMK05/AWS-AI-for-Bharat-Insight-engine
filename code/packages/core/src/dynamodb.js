// ============================================================================
// DynamoDB Client Wrapper — AWS SDK v3
// Provides typed CRUD operations for all Insight Engine tables.
// ============================================================================
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, } from '@aws-sdk/lib-dynamodb';
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
};
/**
 * Creates a DynamoDB Document Client with standard configuration.
 */
export function createDynamoDBClient(region) {
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
export function getTableName(tablePrefix, table) {
    return `${tablePrefix}${table}`;
}
/**
 * Typed wrapper around DynamoDB operations for the Insight Engine.
 */
export class DynamoDBClientWrapper {
    client;
    tablePrefix;
    constructor(client, tablePrefix) {
        this.client = client;
        this.tablePrefix = tablePrefix;
    }
    tableName(table) {
        return getTableName(this.tablePrefix, table);
    }
    /**
     * Put a single item into a DynamoDB table.
     */
    async putItem(table, item) {
        const params = {
            TableName: this.tableName(table),
            Item: item,
        };
        try {
            await this.client.send(new PutCommand(params));
            logger.debug(`Put item to ${table}`, { id: item['id'] });
        }
        catch (error) {
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
    async getItem(table, key) {
        const params = {
            TableName: this.tableName(table),
            Key: key,
        };
        try {
            const result = await this.client.send(new GetCommand(params));
            return result.Item ?? null;
        }
        catch (error) {
            logger.error(`Failed to get item from ${table}`, {
                table,
                key,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Query items using a key condition expression.
     */
    async queryItems(table, params) {
        const queryParams = {
            ...params,
            TableName: this.tableName(table),
        };
        try {
            const result = await this.client.send(new QueryCommand(queryParams));
            return result.Items ?? [];
        }
        catch (error) {
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
    async queryByIndex(table, indexName, keyConditionExpression, expressionAttributeValues, expressionAttributeNames) {
        return this.queryItems(table, {
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
    async updateItem(table, key, updateExpression, expressionAttributeValues, expressionAttributeNames) {
        try {
            await this.client.send(new UpdateCommand({
                TableName: this.tableName(table),
                Key: key,
                UpdateExpression: updateExpression,
                ExpressionAttributeValues: expressionAttributeValues,
                ...(expressionAttributeNames && {
                    ExpressionAttributeNames: expressionAttributeNames,
                }),
            }));
            logger.debug(`Updated item in ${table}`, { key });
        }
        catch (error) {
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
    async deleteItem(table, key) {
        try {
            await this.client.send(new DeleteCommand({
                TableName: this.tableName(table),
                Key: key,
            }));
            logger.debug(`Deleted item from ${table}`, { key });
        }
        catch (error) {
            logger.error(`Failed to delete item from ${table}`, {
                table,
                key,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}
//# sourceMappingURL=dynamodb.js.map