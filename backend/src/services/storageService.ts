import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import s3 from '../lib/s3';
import config from '../config';

/**
 * Generates a time-limited signed URL for a media object in OCI Object Storage.
 *
 * The URL is valid for config.storage.signedUrlExpiresSeconds (default 1 hour).
 * Clients use this URL to fetch media directly from OCI — no traffic proxied
 * through the backend, keeping the ARM64 VM's memory free.
 *
 * @param storageKey - The OCI Object Storage key (JobMedia.storageKey)
 */
export async function getMediaSignedUrl(storageKey: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.storage.bucket,
    Key: storageKey,
  });

  return getSignedUrl(s3, command, {
    expiresIn: config.storage.signedUrlExpiresSeconds,
  });
}

/**
 * Permanently deletes a media object from OCI Object Storage.
 * Called when a JobMedia record is deleted — keeps storage clean.
 *
 * Note: Does NOT delete the JobMedia DB row — the caller must do that.
 */
export async function deleteMediaFromStorage(storageKey: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.storage.bucket,
      Key: storageKey,
    })
  );
}
