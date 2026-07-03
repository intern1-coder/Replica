import prisma from '../lib/prisma';
import config from '../config';
import { generateResetToken, hashResetToken } from './authService';
import { sendInviteEmail, sendPasswordResetEmail } from './emailService';

/**
 * Creates a single-use PasswordResetToken for the user and emails them the
 * set-password link. Shared by the forgot-password flow and new-member invites.
 *
 * Invites (`isInvite: true`) get different email copy and a longer expiry
 * (config.invite.expiresHours vs config.passwordReset.expiresMinutes).
 *
 * Throws if the email cannot be sent — callers decide whether that is fatal.
 */
export async function sendPasswordSetupEmail(
  user: { id: string; email: string; name: string },
  { isInvite = false }: { isInvite?: boolean } = {}
): Promise<void> {
  const rawToken = generateResetToken();
  const expiresAt = new Date(
    Date.now() +
      (isInvite
        ? config.invite.expiresHours * 3_600_000
        : config.passwordReset.expiresMinutes * 60_000)
  );

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashResetToken(rawToken), expiresAt },
  });

  const setupUrl = `${config.frontendUrl}/reset-password?token=${rawToken}`;

  if (isInvite) {
    await sendInviteEmail(user.email, user.name, setupUrl);
  } else {
    await sendPasswordResetEmail(user.email, user.name, setupUrl);
  }
}
