// ============================================================================
// @insight-engine/core — Barrel Export
// All shared types, utilities, and clients are exported from here.
// Other packages import from '@insight-engine/core'.
// ============================================================================

// Types
export type {
  Platform,
  ContentItemStatus,
  DraftContentStatus,
  PublishingQueueItemStatus,
  ContentSource,
  PersonaTone,
  DigestSchedule,
  MonitoringInterval,
  ContentItem,
  RelevanceScore,
  HotTake,
  DraftContent,
  ApprovalDigest,
  PublishingQueueItem,
  SocialConnection,
  PlatformPreferences,
  PersonaFigure,
  PersonaFile,
  OAuthTokenSet,
  AppConfig,
  LogLevel,
  LogEntry,
} from './types.js';

// Logger
export { createLogger } from './logger.js';
export type { Logger } from './logger.js';

// Config
export { loadConfig, ConfigValidationError } from './config.js';

// DynamoDB
export {
  createDynamoDBClient,
  DynamoDBClientWrapper,
  TABLE_NAMES,
  getTableName,
} from './dynamodb.js';
export type { TableName } from './dynamodb.js';

// RDS (scaffold — implementation in Phase 8)
export { createRdsClient } from './rds.js';
export type { RdsConfig, QueryResult, IRdsClient } from './rds.js';

// Persona
export { loadPersona, personaFileSchema } from './persona.js';

// OAuth
export { OAuthTokenManager, OAuthRefreshError } from './oauth.js';
