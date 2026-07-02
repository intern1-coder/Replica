import fs from 'fs/promises';
import path from 'path';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import s3 from '../lib/s3';
import config from '../config';

/** True when media files are stored on local disk instead of OCI/S3. */
export function usesLocalStorage(): boolean {
  const { accessKeyId } = config.storage;
  return (
    !accessKeyId ||
    accessKeyId.includes('mock') ||
    accessKeyId.includes('your-oci') ||
    accessKeyId === ''
  );
}

/**
 * Generates a time-limited signed URL for a media object in OCI Object Storage.
 *
 * The URL is valid for config.storage.signedUrlExpiresSeconds (default 1 hour).
 * Clients use this URL to fetch media directly from OCI — no traffic proxied
 * through the backend, keeping the ARM64 VM's memory free.
 *
 * @param storageKey - The OCI Object Storage key (JobMedia.storageKey)
 */
export async function getMediaSignedUrl(storageKey: string, download: boolean = false): Promise<string> {
  if (usesLocalStorage()) {
    let url = `/uploads/${storageKey}`;
    if (download) url += '?download=true';
    return url;
  }

  const command = new GetObjectCommand({
    Bucket: config.storage.bucket,
    Key: storageKey,
    ResponseContentDisposition: download ? `attachment; filename="${storageKey.split('/').pop()}"` : 'inline',
  });

  return getSignedUrl(s3, command, {
    expiresIn: config.storage.signedUrlExpiresSeconds,
  });
}

/**
 * Permanently deletes a media object from storage (local disk or OCI).
 * Called when a JobMedia record is deleted — keeps storage clean.
 *
 * Note: Does NOT delete the JobMedia DB row — the caller must do that.
 */
export async function deleteMediaFromStorage(storageKey: string): Promise<void> {
  if (usesLocalStorage()) {
    const localPath = path.join(__dirname, '../../uploads', storageKey);
    try {
      await fs.unlink(localPath);
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code !== 'ENOENT') throw err;
    }
    return;
  }

  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.storage.bucket,
      Key: storageKey,
    })
  );
}
