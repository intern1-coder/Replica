import { S3Client } from '@aws-sdk/client-s3';
import config from '../config';

/**
 * S3 client for object storage.
 *
 * Native AWS S3: leave STORAGE_ENDPOINT unset — the SDK derives the endpoint
 * from the region, and virtual-hosted-style URLs are used (forcePathStyle off).
 *
 * S3-compatible providers (e.g. OCI Object Storage) set STORAGE_ENDPOINT to
 * their compat URL; those endpoints require path-style URLs, so forcePathStyle
 * is enabled only in that case.
 */
const s3 = new S3Client({
  ...(config.storage.endpoint ? { endpoint: config.storage.endpoint, forcePathStyle: true } : {}),
  region: config.storage.region,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
});

export default s3;
