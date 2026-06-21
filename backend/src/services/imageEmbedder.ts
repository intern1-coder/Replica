import fs from 'fs/promises';
import path from 'path';
import prisma from '../lib/prisma';
import { MediaType } from '@prisma/client';
import { getMediaSignedUrl } from './storageService';
import config from '../config';
import logger from '../lib/logger';

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

  const results: { src: string; fileName: string }[] = [];

  for (const media of mediaRecords) {
    try {
      // Check if using local storage
      const isLocalStorage = !config.storage.accessKeyId || 
        config.storage.accessKeyId.includes('mock') || 
        config.storage.accessKeyId.includes('your-oci') || 
        config.storage.accessKeyId === '';

      let imageBuffer: Buffer;

      if (isLocalStorage) {
        // Read directly from local uploads directory
        const localPath = path.join(__dirname, '../../uploads', media.storageKey);
        imageBuffer = await fs.readFile(localPath);
      } else {
        // For S3/OCI, fetch via signed URL
        const url = await getMediaSignedUrl(media.storageKey);
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      }

      const mimeType = media.mimeType || 'image/jpeg';
      const base64 = imageBuffer.toString('base64');
      results.push({
        src: `data:${mimeType};base64,${base64}`,
        fileName: media.fileName,
      });
    } catch (err) {
      logger.error(`Failed to embed image ${media.id}: ${err}`);
      // Skip failed images rather than crashing
    }
  }

  return results;
}
