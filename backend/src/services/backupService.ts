import cron from 'node-cron';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs/promises';
import { PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import s3 from '../lib/s3';
import config from '../config';
import logger from '../lib/logger';

const execAsync = util.promisify(exec);

export function startBackupCron() {
  // Run every night at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    logger.info('Starting nightly database backup...');
    try {
      await runBackup();
      await cleanupOldBackups();
    } catch (err) {
      logger.error('Database backup failed', { error: err });
    }
  });

  // Run weekly on Sunday at 3:00 AM to monitor storage usage
  cron.schedule('0 3 * * 0', async () => {
    try {
      await checkStorageUsage();
    } catch (err) {
      logger.error('Storage usage check failed', { error: err });
    }
  });
}

async function checkStorageUsage() {
  let totalBytes = 0;
  let isTruncated = true;
  let continuationToken = undefined;

  while (isTruncated) {
    const data: any = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.storage.bucket,
        ContinuationToken: continuationToken,
      })
    );

    if (data.Contents) {
      for (const item of data.Contents) {
        totalBytes += item.Size || 0;
      }
    }

    isTruncated = data.IsTruncated ?? false;
    continuationToken = data.NextContinuationToken;
  }

  const gigabytes = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
  logger.info(`Object Storage Usage Report: ${gigabytes} GB total used in bucket ${config.storage.bucket}`);

  // Threshold alert (e.g., 50GB)
  if (totalBytes > 50 * 1024 * 1024 * 1024) {
    logger.warn(`ALERT: Object Storage usage has exceeded 50GB. Current usage: ${gigabytes} GB`);
  }
}

async function runBackup() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }

  const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const isFirstOfMonth = new Date().getDate() === 1;
  const folder = isFirstOfMonth ? 'monthly' : 'daily';
  const fileName = `affinity_db_${dateStr}.sql.gz`;
  const tempFilePath = path.join('/tmp', fileName);

  // Run pg_dump and gzip
  // NOTE: Requires postgresql-client installed in the environment (done in Dockerfile)
  const dumpCmd = `pg_dump "${process.env.DATABASE_URL}" | gzip > ${tempFilePath}`;
  await execAsync(dumpCmd);

  // Upload to OCI
  const fileBuffer = await fs.readFile(tempFilePath);
  const storageKey = `backups/${folder}/${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: storageKey,
      Body: fileBuffer,
      ContentType: 'application/gzip',
    })
  );

  logger.info(`Database backup uploaded successfully to ${storageKey}`);

  // Cleanup temp file
  await fs.unlink(tempFilePath).catch(() => {});
}

async function cleanupOldBackups() {
  // We only clean up 'daily' backups. We keep 30 days.
  const retentionDays = 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const listParams = {
    Bucket: config.storage.bucket,
    Prefix: 'backups/daily/',
  };

  const data = await s3.send(new ListObjectsV2Command(listParams));
  if (!data.Contents) return;

  for (const item of data.Contents) {
    if (item.LastModified && item.LastModified < cutoffDate && item.Key) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.storage.bucket,
          Key: item.Key,
        })
      );
      logger.info(`Deleted old backup: ${item.Key}`);
    }
  }
}
