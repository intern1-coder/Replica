import fs from 'fs/promises';
import path from 'path';
import prisma from '../lib/prisma';
import { MediaType } from '@prisma/client';
import { getMediaSignedUrl } from './storageService';
import config from '../config';
import logger from '../lib/logger';

async function fetchMediaBuffer(
  storageKey: string
): Promise<Buffer> {
  const isLocalStorage =
    !config.storage.accessKeyId ||
    config.storage.accessKeyId.includes('mock') ||
    config.storage.accessKeyId.includes('your-') ||
    config.storage.accessKeyId === '';

  if (isLocalStorage) {
    const localPath = path.join(__dirname, '../../uploads', storageKey);
    return fs.readFile(localPath);
  }

  const url = await getMediaSignedUrl(storageKey);
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Fetches all job media of a given type and returns them as base64 data URIs
 * suitable for embedding in HTML templates rendered as PDFs.
 */
export async function getBase64Images(
  jobId: string,
  mediaType: MediaType
): Promise<{ src: string; fileName: string }[]> {
  const mediaRecords = await prisma.jobMedia.findMany({
    where: { jobId, mediaType },
    orderBy: { createdAt: 'asc' },
  });

  const results = await Promise.all(
    mediaRecords.map(async (media) => {
      try {
        const imageBuffer = await fetchMediaBuffer(media.storageKey);
        const mimeType = media.mimeType || 'image/jpeg';
        const base64 = imageBuffer.toString('base64');
        return {
          src: `data:${mimeType};base64,${base64}`,
          fileName: media.fileName,
        };
      } catch (err) {
        logger.error(`Failed to embed image ${media.id}: ${err}`);
        return null;
      }
    })
  );

  return results.filter((r): r is { src: string; fileName: string } => r !== null);
}
