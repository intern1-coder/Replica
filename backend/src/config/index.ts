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

  // Public frontend URL — used to build links emailed to users (password reset).
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''),

  passwordReset: {
    expiresMinutes: parseInt(process.env.PASSWORD_RESET_EXPIRES_MINUTES || '30', 10),
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
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
  },

  puppeteer: {
    // ARM64 VM will use apt install chromium and provide this env var.
    // Locally, you might need to install chrome and set this var for Windows.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  },
} as const;

// ── Production transport safety ──────────────────────────────────────────────────
// resetUrl/magicUrl are built from frontendUrl (FRONTEND_URL) and
// magicLink.appUrl (APP_URL) and emailed to users. In production these MUST be
// https, otherwise one-time login/reset tokens would travel over plaintext.
// Fail fast at startup rather than silently emailing insecure links.
if (config.env === 'production') {
  for (const [name, value] of [
    ['FRONTEND_URL', config.frontendUrl],
    ['APP_URL', config.magicLink.appUrl],
  ] as const) {
    if (!value.startsWith('https://')) {
      throw new Error(`${name} must use https:// in production (got: ${value})`);
    }
  }
}

export type Config = typeof config;
export default config;
