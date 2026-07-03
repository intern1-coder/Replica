/**
 * Tests for passwordSetupService — the shared token-create-and-email helper
 * used by both the forgot-password flow and new-member invites.
 */

const createMock = jest.fn();

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    passwordResetToken: { create: (...args: unknown[]) => createMock(...args) },
  },
}));

const sendInviteEmail = jest.fn();
const sendPasswordResetEmail = jest.fn();

jest.mock('../services/emailService', () => ({
  __esModule: true,
  sendInviteEmail: (...args: unknown[]) => sendInviteEmail(...args),
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmail(...args),
}));

import { sendPasswordSetupEmail } from '../services/passwordSetupService';
import config from '../config';

const user = { id: 'u1', email: 'new.member@example.com', name: 'New Member' };

describe('sendPasswordSetupEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createMock.mockResolvedValue({});
    sendInviteEmail.mockResolvedValue(undefined);
    sendPasswordResetEmail.mockResolvedValue(undefined);
  });

  it('reset variant: stores a hashed token with the short reset expiry and sends the reset email', async () => {
    const before = Date.now();
    await sendPasswordSetupEmail(user);

    expect(createMock).toHaveBeenCalledTimes(1);
    const { data } = createMock.mock.calls[0][0];
    expect(data.userId).toBe('u1');
    expect(data.tokenHash).toEqual(expect.any(String));

    const expectedMs = config.passwordReset.expiresMinutes * 60_000;
    const delta = data.expiresAt.getTime() - before;
    expect(delta).toBeGreaterThan(expectedMs - 5_000);
    expect(delta).toBeLessThan(expectedMs + 5_000);

    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      user.email,
      user.name,
      expect.stringContaining('/reset-password?token=')
    );
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it('invite variant: uses the longer invite expiry and sends the invite email', async () => {
    const before = Date.now();
    await sendPasswordSetupEmail(user, { isInvite: true });

    const { data } = createMock.mock.calls[0][0];
    const expectedMs = config.invite.expiresHours * 3_600_000;
    const delta = data.expiresAt.getTime() - before;
    expect(delta).toBeGreaterThan(expectedMs - 5_000);
    expect(delta).toBeLessThan(expectedMs + 5_000);

    expect(sendInviteEmail).toHaveBeenCalledWith(
      user.email,
      user.name,
      expect.stringContaining('/reset-password?token=')
    );
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('does not send the raw token to the database — only its hash', async () => {
    await sendPasswordSetupEmail(user, { isInvite: true });

    const { data } = createMock.mock.calls[0][0];
    const sentUrl: string = sendInviteEmail.mock.calls[0][2];
    const rawToken = sentUrl.split('token=')[1];
    expect(rawToken).toBeTruthy();
    expect(data.tokenHash).not.toBe(rawToken);
  });

  it('propagates email failures so callers can react', async () => {
    sendInviteEmail.mockRejectedValue(new Error('SMTP down'));
    await expect(sendPasswordSetupEmail(user, { isInvite: true })).rejects.toThrow('SMTP down');
    // Token row was still created — a later resend will simply create another.
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
