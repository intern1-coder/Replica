import fs from 'fs/promises';
import path from 'path';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import s3 from '../lib/s3';
import config from '../config';

/** True when media files are stored on local disk instead of S3. */
export function usesLocalStorage(): boolean {
  const { accessKeyId } = config.storage;
  return (
    !accessKeyId ||
    accessKeyId.includes('mock') ||
    accessKeyId.includes('your-') ||
    accessKeyId === ''
  );
}

/**
 * Generates a time-limited signed URL for a media object in S3.
 *
 * The URL is valid for config.storage.signedUrlExpiresSeconds (default 1 hour).
 * Clients use this URL to fetch media directly from S3 — no traffic proxied
 * through the backend, keeping the VM's memory free.
 *
 * @param storageKey - The S3 object key (JobMedia.storageKey)
 * @param filename - Human-readable download filename (e.g. "Diagnostic Report – 51 Tolcarne Drive.pdf").
 *   Falls back to the raw storage key's basename when omitted. Local-disk downloads don't need this —
 *   same-origin `/uploads/...` URLs are named via the frontend's `a.download` attribute instead.
 */
export async function getMediaSignedUrl(storageKey: string, download: boolean = false, filename?: string): Promise<string> {
  if (usesLocalStorage()) {
    let url = `/uploads/${storageKey}`;
    if (download) url += '?download=true';
    return url;
  }

  let disposition = 'inline';
  if (download) {
    if (filename) {
      // ASCII fallback for clients that don't support the RFC 5987 filename*
      // form — an en dash or non-ASCII address character just becomes "_".
      const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
      disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
    } else {
      disposition = `attachment; filename="${storageKey.split('/').pop()}"`;
    }
  }

  const command = new GetObjectCommand({
    Bucket: config.storage.bucket,
    Key: storageKey,
    ResponseContentDisposition: disposition,
  });

  return getSignedUrl(s3, command, {
    expiresIn: config.storage.signedUrlExpiresSeconds,
  });
}

/** Reads a stored object into memory for trusted server-side attachments. */
export async function getMediaBuffer(storageKey: string): Promise<Buffer> {
  if (usesLocalStorage()) {
    return fs.readFile(path.join(__dirname, '../../uploads', storageKey));
  }

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: config.storage.bucket,
      Key: storageKey,
    })
  );

  if (!response.Body) throw new Error(`Stored object has no body: ${storageKey}`);
  return Buffer.from(await response.Body.transformToByteArray());
}

/**
 * Permanently deletes a media object from storage (local disk or S3).
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
