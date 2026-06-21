import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';
import s3 from '../lib/s3';
import config from '../config';

// ── MIME types ─────────────────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'video/mp4',
  'video/quicktime',
]);

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

// ── Multer configuration ───────────────────────────────────────────────────────
// Memory storage — images are processed by sharp before upload.
// For this fleet size (5 users, ~5 photos per job) in-memory is appropriate.
// TechSpec.md: ~5 compressed photos + occasional short video per job.

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 150 * 1024 * 1024, // 150 MB raw ceiling (video safety margin)
    files: 10,                   // max files per upload batch
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WebP, HEIC, MP4, MOV.`));
    }
  },
});

// ── Upload result type ─────────────────────────────────────────────────────────

export interface UploadResult {
  storageKey: string; // stored in DB — the ONLY file reference we keep
  mimeType: string;
  sizeBytes: number;
  fileName: string;   // original name for display
}

// ── Core upload function ───────────────────────────────────────────────────────

/**
 * Processes and uploads a single file to OCI Object Storage.
 *
 * Images:
 *   - Resized to max 2048×2048 (maintaining aspect ratio, no upscaling)
 *   - Converted to JPEG at 80 % quality with progressive encoding
 *   - Target: ~300 KB per photo (TechSpec.md target)
 *
 * Videos:
 *   - Uploaded as-is (sharp does not process video)
 *   - Expected to already be ~5–10 MB (TechSpec.md)
 *
 * The storageKey format: jobs/<jobId>/media/<uuid>.<ext>
 * This is stored in JobMedia.storageKey — NEVER a local path. (Rules.md)
 */
export async function uploadMedia(
  file: Express.Multer.File,
  jobId: string
): Promise<UploadResult> {
  const isImage = IMAGE_MIME_TYPES.has(file.mimetype);
  let buffer: Buffer;
  let mimeType: string;
  let sizeBytes: number;

  if (isImage) {
    // Compress with sharp — ARM64 prebuilt binaries ship in the package (TechSpec.md)
    buffer = await sharp(file.buffer)
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, mozjpeg: false })
      .toBuffer();
    mimeType = 'image/jpeg';
    sizeBytes = buffer.length;
  } else {
    // Video — upload raw
    buffer = file.buffer;
    mimeType = file.mimetype;
    sizeBytes = file.size;
  }

  const ext = mimeType === 'image/jpeg' ? 'jpg' : (file.originalname.split('.').pop() ?? 'bin');
  const storageKey = `jobs/${jobId}/media/${crypto.randomUUID()}.${ext}`;

  // Fallback to local storage if AWS credentials are not configured
  if (!config.storage.accessKeyId || config.storage.accessKeyId.includes('mock') || config.storage.accessKeyId.includes('your-oci') || config.storage.accessKeyId === '') {
    const localPath = path.join(__dirname, '../../uploads', storageKey);
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, buffer);
  } else {
    await s3.send(
      new PutObjectCommand({
        Bucket: config.storage.bucket,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      })
    );
  }

  return {
    storageKey,
    mimeType,
    sizeBytes,
    fileName: file.originalname,
  };
}
