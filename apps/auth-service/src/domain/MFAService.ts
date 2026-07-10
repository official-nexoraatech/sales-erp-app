import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { users } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { encryptField, decryptField } from '@erp/utils';
import { NotFoundError, ValidationError, SecurityError } from '@erp/types';
import { sha256Hex } from '../crypto.js';

const BACKUP_CODE_COUNT = 10;
const TOTP_ISSUER = 'NEXORAA ERP';

function generateBackupCode(): string {
  return randomBytes(5).toString('hex').toUpperCase();
}

export class MFAService {
  constructor(
    private readonly db: ErpDatabase,
    private readonly encryptionKey: string
  ) {}

  async enrollTOTP(
    userId: number,
    _tenantId: number
  ): Promise<{ qrCodeDataUrl: string; backupCodes: string[] }> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundError('User', userId);

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());
    const hashedBackupCodes = backupCodes.map((code) => sha256Hex(code));

    await this.db
      .update(users)
      .set({
        totpSecret: encryptField(secret, this.encryptionKey),
        backupCodes: hashedBackupCodes,
        totpEnabled: false, // stays false until confirmEnrollment succeeds
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { qrCodeDataUrl, backupCodes };
  }

  async confirmEnrollment(userId: number, totpCode: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.totpSecret) throw new ValidationError('No pending TOTP enrollment for this user');

    const secret = decryptField(user.totpSecret, this.encryptionKey);
    if (!authenticator.verify({ token: totpCode, secret })) {
      throw new ValidationError('Invalid TOTP code');
    }

    await this.db
      .update(users)
      .set({ totpEnabled: true, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async verifyTOTP(userId: number, totpCode: string): Promise<boolean> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.totpSecret) return false;

    const secret = decryptField(user.totpSecret, this.encryptionKey);
    return authenticator.verify({ token: totpCode, secret });
  }

  async useBackupCode(userId: number, code: string): Promise<boolean> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.backupCodes || user.backupCodes.length === 0) return false;

    const hash = sha256Hex(code.trim().toUpperCase());
    const index = user.backupCodes.indexOf(hash);
    if (index === -1) return false;

    const remainingCodes = [...user.backupCodes];
    remainingCodes.splice(index, 1); // burn after use
    await this.db
      .update(users)
      .set({ backupCodes: remainingCodes, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return true;
  }

  async disableTOTP(userId: number, totpCode: string): Promise<void> {
    const validTotp = await this.verifyTOTP(userId, totpCode);
    const validBackup = validTotp ? false : await this.useBackupCode(userId, totpCode);
    if (!validTotp && !validBackup) {
      throw new SecurityError('Invalid TOTP or backup code');
    }

    await this.db
      .update(users)
      .set({ totpEnabled: false, totpSecret: null, backupCodes: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async regenerateBackupCodes(userId: number, totpCode: string): Promise<string[]> {
    const valid = await this.verifyTOTP(userId, totpCode);
    if (!valid) throw new SecurityError('Invalid TOTP code');

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());
    const hashedBackupCodes = backupCodes.map((c) => sha256Hex(c));

    await this.db
      .update(users)
      .set({ backupCodes: hashedBackupCodes, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return backupCodes;
  }
}
