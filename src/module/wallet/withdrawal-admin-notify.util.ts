import { Role } from '@prisma/client';
import { fetchAdminAlertRecipients } from 'src/module/shipment/shipment-admin-alert-recipients';
import { MailService } from 'src/services/mail/mail.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { PrismaService } from 'src/services/prisma/prisma.service';

function requesterRoleLabel(role: string): string {
  if (role === Role.LISTER) return 'Lister';
  if (role === Role.RENTER) return 'Renter';
  if (role === Role.ADMIN) return 'Admin';
  return role;
}

function adminWalletsLink(): string {
  const origin = (
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
  const segment = process.env.ADMIN_SECRET_SEGMENT?.trim() || 'k340eol21';
  return `${origin}/admin/${segment}/wallets`;
}

/** In-app + email alert when a renter or lister submits a withdrawal request. */
export async function notifyAdminsNewWithdrawalRequest(
  prisma: PrismaService,
  notificationService: NotificationService,
  mailService: MailService,
  input: {
    withdrawalId: string;
    reference: string;
    amount: number;
    userId: string;
    bankAccount: {
      bankName: string;
      accountNumber: string;
      accountName?: string | null;
    };
  },
): Promise<void> {
  const [user, admins] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, name: true, email: true, role: true },
    }),
    fetchAdminAlertRecipients(prisma),
  ]);

  if (!user) return;

  const recipients = admins.filter((admin) => admin.email?.trim());
  if (recipients.length === 0) {
    console.warn(
      `[Withdrawal] No admin email recipients for withdrawal ${input.reference}.`,
    );
    return;
  }

  const adminLink = adminWalletsLink();
  const amountLabel = `NGN ${input.amount.toLocaleString()}`;
  const roleLabel = requesterRoleLabel(user.role);

  await Promise.all(
    recipients.map(async (admin) => {
      await notificationService.createNotification({
        userId: admin.id,
        title: 'New withdrawal request',
        message: `${user.name} requested ${amountLabel} (${input.reference}). Review it under Wallets, Withdrawals in admin.`,
        type: 'ADMIN_WITHDRAWAL_REQUEST',
        metadata: {
          withdrawalId: input.withdrawalId,
          reference: input.reference,
          amount: input.amount,
          requesterId: user.id,
          requesterRole: user.role,
        },
        sendEmail: false,
      });

      try {
        await mailService.sendAdminWithdrawalRequestAlert({
          email: admin.email.trim(),
          adminName: admin.name || 'Admin',
          reference: input.reference,
          amount: input.amount,
          requesterName: user.name,
          requesterEmail: user.email,
          requesterRole: roleLabel,
          bankName: input.bankAccount.bankName,
          accountNumber: input.bankAccount.accountNumber,
          accountName: input.bankAccount.accountName ?? undefined,
          adminLink,
        });
      } catch (err) {
        console.error(
          `[Withdrawal] Admin alert email to ${admin.email} failed for ${input.reference}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );
}
