import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Reads the first defined variable from a list of names. Lets STORAGE_* be the
// canonical names while old OCI_* names keep working on existing servers.
function requireEnvAny(names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${names[0]} (or legacy ${names.slice(1).join(', ')})`);
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

  // New-member invite links reuse the reset-token flow but live longer —
  // invitees may not check email within the reset flow's short window.
  invite: {
    expiresHours: parseInt(process.env.INVITE_EXPIRES_HOURS || '72', 10),
  },

  email: {
    host: requireEnv('SMTP_HOST'),
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: requireEnv('SMTP_USER'),
    pass: requireEnv('SMTP_PASS'),
    // EMAIL_FROM is the canonical name; SMTP_FROM is a legacy alias kept so
    // an existing deployment's .env (or docker-compose.yml) using the old
    // name still works instead of silently falling through to the
    // unroutable default below.
    from: process.env.EMAIL_FROM || process.env.SMTP_FROM || 'noreply@affinity.local',
    fromName: process.env.EMAIL_FROM_NAME || 'Affinity Workspace',
  },

  // Object storage — AWS S3 by default. STORAGE_ENDPOINT is only needed for
  // S3-compatible providers (e.g. OCI); leave it unset for native AWS S3 and
  // the SDK derives the endpoint from the region. Legacy OCI_* names still work.
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT || process.env.OCI_ENDPOINT || undefined,
    region: process.env.STORAGE_REGION || process.env.OCI_REGION || 'ap-south-1',
    bucket: requireEnvAny(['STORAGE_BUCKET_NAME', 'OCI_BUCKET_NAME']),
    accessKeyId: requireEnvAny(['STORAGE_ACCESS_KEY_ID', 'OCI_ACCESS_KEY_ID']),
    secretAccessKey: requireEnvAny(['STORAGE_SECRET_ACCESS_KEY', 'OCI_SECRET_ACCESS_KEY']),
    // How long signed GET URLs are valid (seconds). Default 1 hour.
    signedUrlExpiresSeconds: parseInt(process.env.SIGNED_URL_EXPIRES_SECONDS || '3600', 10),
  },

  cors: {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
  },

  puppeteer: {
    // Optional override. Unset = Playwright's bundled Chromium
    // (`npx playwright install chromium`). Set to a system Chrome path if preferred.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    // When Chromium fails to launch/render, generatePdf() throws by default —
    // a blank "Mock PDF Generated" document must never be silently uploaded
    // and persisted as if it were real. Only tests may opt into that fallback.
    allowMockFallback: process.env.NODE_ENV === 'test',
  },
} as const;

// ── Production transport safety ──────────────────────────────────────────────────
// resetUrl/magicUrl are built from frontendUrl (FRONTEND_URL) and
// magicLink.appUrl (APP_URL) and emailed to users. In production these MUST be
// https, otherwise one-time login/reset tokens would travel over plaintext.
// Fail fast at startup rather than silently emailing insecure links.
if (config.env === 'production') {
  if (process.env.ALLOW_PRODUCTION !== 'true') {
    throw new Error('Production mode is disabled. Set ALLOW_PRODUCTION=true only for an intentional production deployment.');
  }

  for (const [name, value] of [
    ['FRONTEND_URL', config.frontendUrl],
    ['APP_URL', config.magicLink.appUrl],
  ] as const) {
    if (!value.startsWith('https://')) {
      throw new Error(`${name} must use https:// in production (got: ${value})`);
    }
  }

  // JWT_SECRET is only checked for truthiness by requireEnv() above — a
  // short or placeholder value (e.g. .env.example's literal
  // "change-me-to-a-long-random-secret-at-least-64-chars") boots fine and
  // lets anyone forge a SUPER_ADMIN token. Fail fast in production only —
  // tests intentionally use a short fixed secret (see __tests__/setup.ts).
  if (config.jwt.secret.length < 32 || config.jwt.secret.includes('change-me')) {
    throw new Error(
      'JWT_SECRET is missing, too short, or still the .env.example placeholder. ' +
      'Set a random secret of at least 32 characters before starting in production.'
    );
  }
}

export type Config = typeof config;
export default config;
