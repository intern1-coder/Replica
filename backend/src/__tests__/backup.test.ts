/**
 * Unit tests for backupService.ts
 *
 * Both `runBackup` and `cleanupOldBackups` are private (not exported).
 * We exercise them indirectly by calling `startBackupCron`, then
 * extracting and invoking the scheduled callback that node-cron registers.
 * An alternative pattern — re-exporting the helpers as `_runBackup` etc.
 * in backupService.ts — would make the tests simpler; that refactor is
 * noted but not required to make these tests work.
 *
 * Mocked:
 *   - child_process (exec → execAsync) via jest.mock
 *   - @aws-sdk/client-s3 command constructors
 *   - ../lib/s3  (the S3 client singleton)
 *   - fs/promises (readFile / unlink)
 *   - node-cron  (schedule — captures the callback)
 *   - ../services/emailService (sendBackupFailureAlert)
 */

// ── 1. Mock node-cron so we can capture scheduled callbacks ──────────────────
type CronCallback = () => Promise<void>;
const capturedCallbacks: CronCallback[] = [];

jest.mock('node-cron', () => ({
  schedule: jest.fn((_expr: string, cb: CronCallback) => {
    capturedCallbacks.push(cb);
  }),
}));

// ── 2. Mock child_process.exec ───────────────────────────────────────────────
const mockExec = jest.fn((_cmd: string, cb: (err: Error | null) => void) => {
  cb(null); // success by default
});

jest.mock('child_process', () => ({
  exec: (cmd: string, cb: (err: Error | null) => void) => mockExec(cmd, cb),
}));

// ── 3. Mock fs/promises ──────────────────────────────────────────────────────
const mockReadFile = jest.fn().mockResolvedValue(Buffer.from('fake-dump-data'));
const mockUnlink = jest.fn().mockResolvedValue(undefined);

jest.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  unlink: (...args: any[]) => mockUnlink(...args),
}));

// ── 4. Mock @aws-sdk/client-s3 ───────────────────────────────────────────────
const mockS3Send = jest.fn().mockResolvedValue({});

jest.mock('../lib/s3', () => ({
  __esModule: true,
  default: { send: (...args: any[]) => mockS3Send(...args) },
}));

// Capture the Command instances so we can assert on their input
let putObjectInput: any = {};
let deleteObjectInput: any = {};
let listObjectsInput: any = {};

jest.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: jest.fn().mockImplementation((input: any) => {
    putObjectInput = input;
    return { input };
  }),
  DeleteObjectCommand: jest.fn().mockImplementation((input: any) => {
    deleteObjectInput = input;
    return { input };
  }),
  ListObjectsV2Command: jest.fn().mockImplementation((input: any) => {
    listObjectsInput = input;
    return { input };
  }),
}));

// ── 5. Mock email service ────────────────────────────────────────────────────
jest.mock('../services/emailService', () => ({
  sendBackupFailureAlert: jest.fn().mockResolvedValue(undefined),
}));

// ── 6. Mock logger to silence output ─────────────────────────────────────────
jest.mock('../lib/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── Imports (after mocks are set up) ─────────────────────────────────────────
import { startBackupCron } from '../services/backupService';
import { sendBackupFailureAlert } from '../services/emailService';

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/affinity_test';
});

afterEach(() => {
  jest.clearAllMocks();
  putObjectInput = {};
  deleteObjectInput = {};
  listObjectsInput = {};
});

// ── Helper: register the cron callbacks by calling startBackupCron ────────────
function registerCrons() {
  capturedCallbacks.length = 0;
  startBackupCron();
  // index 0 → nightly backup (2 AM),  index 1 → weekly storage check (Sunday 3 AM)
  return { backupCb: capturedCallbacks[0], storageCb: capturedCallbacks[1] };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('runBackup (via nightly cron callback)', () => {
  it('calls pg_dump with the correct DATABASE_URL', async () => {
    const { backupCb } = registerCrons();

    // mockS3Send returns {} by default (PutObject success)
    await backupCb();

    expect(mockExec).toHaveBeenCalledTimes(1);
    const cmd: string = mockExec.mock.calls[0][0];
    expect(cmd).toContain('pg_dump');
    expect(cmd).toContain(process.env.DATABASE_URL);
    expect(cmd).toContain('gzip');
  });

  it('uploads to backups/daily/ on a non-first day of the month', async () => {
    // Force a non-first day
    jest.spyOn(Date.prototype, 'getDate').mockReturnValue(15);

    const { backupCb } = registerCrons();
    await backupCb();

    expect(putObjectInput.Key).toMatch(/^backups\/daily\//);
    expect(putObjectInput.Key).toMatch(/\.sql\.gz$/);
    expect(putObjectInput.ContentType).toBe('application/gzip');

    jest.restoreAllMocks();
  });

  it('uploads to backups/monthly/ on the first day of the month', async () => {
    jest.spyOn(Date.prototype, 'getDate').mockReturnValue(1);

    const { backupCb } = registerCrons();
    await backupCb();

    expect(putObjectInput.Key).toMatch(/^backups\/monthly\//);

    jest.restoreAllMocks();
  });

  it('sends a failure alert email when pg_dump fails', async () => {
    mockExec.mockImplementationOnce((_cmd: string, cb: (err: Error | null) => void) => {
      cb(new Error('pg_dump: connection refused'));
    });

    const { backupCb } = registerCrons();
    await backupCb(); // should not throw — error is caught internally

    expect(sendBackupFailureAlert).toHaveBeenCalledWith(
      expect.stringContaining('pg_dump')
    );
  });

  it('throws if DATABASE_URL is not set', async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const { backupCb } = registerCrons();
    await backupCb(); // error is caught by cron wrapper

    // The alert should have been sent about the missing env var
    expect(sendBackupFailureAlert).toHaveBeenCalledWith(
      expect.stringContaining('DATABASE_URL')
    );

    process.env.DATABASE_URL = original;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cleanupOldBackups (via nightly cron callback)', () => {
  const bucket = process.env.OCI_BUCKET_NAME ?? 'test-bucket';

  const now = new Date('2026-07-01T02:00:00Z');
  const oldDate = new Date('2026-05-15T00:00:00Z'); // > 30 days ago
  const recentDate = new Date('2026-06-25T00:00:00Z'); // < 30 days ago

  it('deletes backups older than 30 days and keeps newer ones', async () => {
    // First S3 call is PutObject (backup upload); second is ListObjectsV2 (cleanup)
    mockS3Send
      .mockResolvedValueOnce({}) // PutObject
      .mockResolvedValueOnce({  // ListObjectsV2
        Contents: [
          { Key: 'backups/daily/affinity_db_2026-05-15.sql.gz', LastModified: oldDate },
          { Key: 'backups/daily/affinity_db_2026-06-25.sql.gz', LastModified: recentDate },
        ],
        IsTruncated: false,
      })
      .mockResolvedValue({}); // DeleteObject

    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.spyOn(Date.prototype, 'getDate').mockReturnValue(1); // trigger monthly path to avoid date conflict

    const { backupCb } = registerCrons();
    await backupCb();

    jest.useRealTimers();
    jest.restoreAllMocks();

    // Only the old file should have been deleted
    const deleteCalls = mockS3Send.mock.calls.filter(
      (call) => call[0]?.input?.Key !== undefined
    );
    const deletedKeys = deleteCalls.map((call) => call[0]?.input?.Key);

    expect(deletedKeys).toContain('backups/daily/affinity_db_2026-05-15.sql.gz');
    expect(deletedKeys).not.toContain('backups/daily/affinity_db_2026-06-25.sql.gz');
  });

  it('lists only the backups/daily/ prefix during cleanup', async () => {
    mockS3Send
      .mockResolvedValueOnce({}) // PutObject
      .mockResolvedValueOnce({ Contents: [], IsTruncated: false }); // ListObjectsV2

    const { backupCb } = registerCrons();
    await backupCb();

    expect(listObjectsInput.Prefix).toBe('backups/daily/');
    expect(listObjectsInput.Bucket).toBe(bucket);
  });
});
