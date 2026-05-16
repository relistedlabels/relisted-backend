import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Minimum gap between lastSeenAt writes per user (avoids DB load on every API call). */
const LAST_SEEN_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

@Injectable()
export class UserActivityService {
  private readonly logger = new Logger(UserActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordLogin(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: now, lastSeenAt: now },
    });
  }

  /**
   * Updates lastSeenAt when the user makes an authenticated request.
   * Throttled; failures are logged and do not affect the request.
   */
  touchLastSeen(userId: string, currentLastSeen?: Date | null): void {
    const now = new Date();
    if (currentLastSeen) {
      const elapsed = now.getTime() - currentLastSeen.getTime();
      if (elapsed < LAST_SEEN_TOUCH_INTERVAL_MS) {
        return;
      }
    }

    void this.prisma.user
      .update({
        where: { id: userId },
        data: { lastSeenAt: now },
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to update lastSeenAt for user ${userId}: ${err?.message ?? err}`,
        );
      });
  }
}
