import { Role } from '@prisma/client';
import { PrismaService } from 'src/services/prisma/prisma.service';

/**
 * Users who should receive shipment / dispatch admin alerts (in-app + email).
 * Includes platform `Role.ADMIN` and users assigned an `AdminRole` row.
 */
export async function fetchAdminAlertRecipients(
  prisma: PrismaService,
): Promise<Array<{ id: string; email: string; name: string }>> {
  return prisma.user.findMany({
    where: {
      isSuspended: false,
      OR: [{ role: Role.ADMIN }, { adminRoleId: { not: null } }],
    },
    select: { id: true, email: true, name: true },
  });
}
