import nodemailer from 'nodemailer';
import config from '../config';
import logger, { maskEmail } from '../lib/logger';

// ── Transporter (lazy singleton) ───────────────────────────────────────────────
// Created on first use so config errors surface at call time, not module load.
// Port 587 + requireTLS enforces STARTTLS — never plain-text SMTP (Rules.md).
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,   // 587
    secure: false,              // false = STARTTLS on 587 (not implicit TLS on 465)
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
    requireTLS: true,           // Refuse the connection if STARTTLS is unavailable
  });

  return transporter;
}

// ── Email sending ──────────────────────────────────────────────────────────────

/**
 * Sends the one-time magic-link login email.
 *
 * @param toEmail  - Recipient email address
 * @param toName   - Recipient display name (used in greeting and To header)
 * @param magicUrl - Full magic-link URL containing the raw token
 */
export async function sendMagicLinkEmail(
  toEmail: string,
  toName: string,
  magicUrl: string
): Promise<void> {
  const from = `"${config.email.fromName}" <${config.email.from}>`;
  const expiryMinutes = config.magicLink.expiresMinutes;

  const info = await getTransporter().sendMail({
    from,
    to: `"${toName}" <${toEmail}>`,
    subject: 'Your Affinity Workspace login link',
    text: [
      `Hi ${toName},`,
      '',
      'Click the link below to log in to Affinity Workspace.',
      `This link expires in ${expiryMinutes} minutes and can only be used once.`,
      '',
      magicUrl,
      '',
      'If you did not request this, you can safely ignore this email.',
      '',
      '— Affinity Workspace',
    ].join('\n'),
    html: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Log in to Affinity Workspace</title>
        </head>
        <body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;color:#111827;">
          <h2 style="margin-bottom:4px;font-size:20px;">Log in to Affinity Workspace</h2>
          <p>Hi ${toName},</p>
          <p>
            Click the button below to log in. This link expires in
            <strong>${expiryMinutes} minutes</strong> and can only be used once.
          </p>
          <a href="${magicUrl}"
             style="display:inline-block;padding:11px 22px;background:#1d4ed8;color:#fff;
                    border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;font-size:15px;">
            Log in to Affinity
          </a>
          <p style="font-size:13px;color:#6b7280;margin-top:4px;">
            Or paste this URL into your browser:<br />
            <a href="${magicUrl}" style="color:#1d4ed8;word-break:break-all;">${magicUrl}</a>
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
          <p style="font-size:12px;color:#9ca3af;">
            If you did not request this email, you can safely ignore it.
            No account changes have been made.
          </p>
        </body>
      </html>
    `,
  });

  logger.info('Magic-link email sent', { maskedTo: maskEmail(toEmail), messageId: info.messageId });
}

/**
 * Sends the one-time password-reset email containing a secure link.
 *
 * @param toEmail  - Recipient email address
 * @param toName   - Recipient display name
 * @param resetUrl - Full reset URL containing the raw token
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  toName: string,
  resetUrl: string
): Promise<void> {
  const from = `"${config.email.fromName}" <${config.email.from}>`;
  const expiryMinutes = config.passwordReset.expiresMinutes;

  const info = await getTransporter().sendMail({
    from,
    to: `"${toName}" <${toEmail}>`,
    subject: 'Reset your Affinity Workspace password',
    text: [
      `Hi ${toName},`,
      '',
      'We received a request to reset your Affinity Workspace password.',
      `Click the link below to choose a new password. This link expires in ${expiryMinutes} minutes and can only be used once.`,
      '',
      resetUrl,
      '',
      'If you did not request this, you can safely ignore this email — your password will not change.',
      '',
      '— Affinity Workspace',
    ].join('\n'),
    html: `
      <!DOCTYPE html>
      <html lang="en">
        <head><meta charset="UTF-8" /><title>Reset your password</title></head>
        <body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;color:#111827;">
          <h2 style="margin-bottom:4px;font-size:20px;">Reset your password</h2>
          <p>Hi ${toName},</p>
          <p>
            We received a request to reset your Affinity Workspace password. Click the
            button below to choose a new one. This link expires in
            <strong>${expiryMinutes} minutes</strong> and can only be used once.
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:11px 22px;background:#1d4ed8;color:#fff;
                    border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;font-size:15px;">
            Reset password
          </a>
          <p style="font-size:13px;color:#6b7280;margin-top:4px;">
            Or paste this URL into your browser:<br />
            <a href="${resetUrl}" style="color:#1d4ed8;word-break:break-all;">${resetUrl}</a>
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
          <p style="font-size:12px;color:#9ca3af;">
            If you did not request this, you can safely ignore this email. No changes have been made.
          </p>
        </body>
      </html>
    `,
  });

  logger.info('Password-reset email sent', { maskedTo: maskEmail(toEmail), messageId: info.messageId });
}

/**
 * Sends an alert email when the nightly database backup fails.
 * Recipient is configured via ALERT_EMAIL env var (falls back to EMAIL_FROM).
 *
 * @param errorMessage - The error message from the failed backup attempt
 */
export async function sendBackupFailureAlert(errorMessage: string): Promise<void> {
  const alertEmail = process.env.ALERT_EMAIL || config.email.from;
  const from = `"${config.email.fromName}" <${config.email.from}>`;
  const now = new Date().toISOString();

  await getTransporter().sendMail({
    from,
    to: alertEmail,
    subject: `[ALERT] Affinity nightly backup failed — ${now.slice(0, 10)}`,
    text: [
      'The nightly Affinity database backup failed.',
      '',
      `Time: ${now}`,
      `Error: ${errorMessage}`,
      '',
      'Please investigate and run a manual backup as soon as possible.',
      '',
      '— Affinity Workspace (automated alert)',
    ].join('\n'),
    html: `
      <!DOCTYPE html>
      <html lang="en">
        <head><meta charset="UTF-8" /><title>Backup failure alert</title></head>
        <body style="font-family:system-ui,sans-serif;max-width:540px;margin:40px auto;color:#111827;">
          <h2 style="color:#dc2626;">Nightly backup failed</h2>
          <p>The nightly Affinity database backup did not complete successfully.</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0;">
            <tr><td style="padding:6px 12px;background:#f3f4f6;font-weight:600;width:80px;">Time</td>
                <td style="padding:6px 12px;">${now}</td></tr>
            <tr><td style="padding:6px 12px;background:#f3f4f6;font-weight:600;">Error</td>
                <td style="padding:6px 12px;font-family:monospace;font-size:13px;">${errorMessage}</td></tr>
          </table>
          <p><strong>Action required:</strong> Please investigate and run a manual backup as soon as possible.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
          <p style="font-size:12px;color:#9ca3af;">Automated alert from Affinity Workspace.</p>
        </body>
      </html>
    `,
  });

  logger.warn('Backup failure alert email sent', { maskedTo: maskEmail(alertEmail) });
}

// ── Diagnostics ────────────────────────────────────────────────────────────────

/**
 * Verifies SMTP connectivity. Useful for startup health checks.
 * Returns true on success, false on failure (non-throwing).
 */
export async function verifySmtpConnection(): Promise<boolean> {
  try {
    await getTransporter().verify();
    logger.info('SMTP connection verified', {
      host: config.email.host,
      port: config.email.port,
    });
    return true;
  } catch (err) {
    logger.warn('SMTP connection verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
