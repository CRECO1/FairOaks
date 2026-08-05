/**
 * Broker-email -> Claude-extraction -> CRM ingestion pipeline.
 *
 * Public surface for the cron route and the backfill script.
 */

export * from './types';
export {
  BROKER_CONNECTION_ID,
  BROKER_USER_ID,
  fetchBrokerConnection,
  resolveConnection,
  getBrokerAccessToken,
  listMessageIds,
  fetchEmail,
  extractBody,
  extractImages,
} from './gmail';
export { MODEL, extractListing, normalizeExtraction, coerceAssetType } from './extract';
export {
  CREATED_BY,
  normalizeAddress,
  dedupKey,
  toRecord,
  fetchExistingKeys,
  upsertProperties,
} from './upsert';
export { DEFAULT_QUERY, runPipeline } from './pipeline';
export type { PipelineOptions, PipelineResult } from './pipeline';
export type { UpsertResult } from './upsert';
