// ============================================================================
// @insight-engine/core — Barrel Export
// All shared types, utilities, and clients are exported from here.
// Other packages import from '@insight-engine/core'.
// ============================================================================
// Logger
export { createLogger } from './logger.js';
// Config
export { loadConfig, ConfigValidationError } from './config.js';
// DynamoDB
export { createDynamoDBClient, DynamoDBClientWrapper, TABLE_NAMES, getTableName, } from './dynamodb.js';
// RDS (scaffold — implementation in Phase 8)
export { createRdsClient } from './rds.js';
// Persona
export { loadPersona, personaFileSchema } from './persona.js';
// OAuth
export { OAuthTokenManager, OAuthRefreshError } from './oauth.js';
//# sourceMappingURL=index.js.map