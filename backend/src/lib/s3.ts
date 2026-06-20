import { S3Client } from '@aws-sdk/client-s3';
import config from '../config';

/**
 * S3-compatible client pointed at OCI Object Storage.
 *
 * OCI exposes an S3-compatible API at:
 *   https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
 *
 * forcePathStyle must be true for OCI — virtual-hosted-style URLs are not
 * supported on the OCI S3-compatible endpoint.
 *
 * Authentication uses an OCI Customer Secret Key (IAM → User → Customer
 * Secret Keys), NOT the standard OCI API key. The access/secret pair maps
 * to OCI_ACCESS_KEY_ID / OCI_SECRET_ACCESS_KEY in .env.
 */
const s3 = new S3Client({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
  forcePathStyle: true, // Required for OCI S3-compatible endpoint
});

export default s3;
