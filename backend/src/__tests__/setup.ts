// Set environment variables required by config/index.ts for unit tests.
// The unit tests don't connect to a real database or real services, but they import files that import config.

process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5432/affinity_test';
process.env.JWT_SECRET = 'test-secret';
process.env.SMTP_HOST = 'smtp.test.com';
process.env.SMTP_USER = 'test';
process.env.SMTP_PASS = 'test';
process.env.OCI_ENDPOINT = 'https://test.compat.objectstorage.us-ashburn-1.oraclecloud.com';
process.env.OCI_BUCKET_NAME = 'test-bucket';
process.env.OCI_ACCESS_KEY_ID = 'test-key';
process.env.OCI_SECRET_ACCESS_KEY = 'test-secret';
