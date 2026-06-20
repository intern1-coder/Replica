import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    url: requireEnv('DATABASE_URL'),
  },

  jwt: {
    secret: requireEnv('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  magicLink: {
    expiresMinutes: parseInt(process.env.MAGIC_LINK_EXPIRES_MINUTES || '15', 10),
    appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  },

  email: {
    host: requireEnv('SMTP_HOST'),
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: requireEnv('SMTP_USER'),
    pass: requireEnv('SMTP_PASS'),
    from: process.env.EMAIL_FROM || 'noreply@affinity.local',
    fromName: process.env.EMAIL_FROM_NAME || 'Affinity Workspace',
  },

  // OCI Object Storage — S3-compatible API (TechSpec.md)
  storage: {
    endpoint: requireEnv('OCI_ENDPOINT'),
    region: process.env.OCI_REGION || 'us-ashburn-1',
    bucket: requireEnv('OCI_BUCKET_NAME'),
    accessKeyId: requireEnv('OCI_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('OCI_SECRET_ACCESS_KEY'),
    // How long signed GET URLs are valid (seconds). Default 1 hour.
    signedUrlExpiresSeconds: parseInt(process.env.SIGNED_URL_EXPIRES_SECONDS || '3600', 10),
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },

  puppeteer: {
    // ARM64 VM will use apt install chromium and provide this env var.
    // Locally, you might need to install chrome and set this var for Windows.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  },
} as const;

export type Config = typeof config;
export default config;
