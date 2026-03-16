import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Injectable()
export class NewsletterService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(email: string) {
    const existing = await this.prisma.newsletter.findUnique({
      where: { email },
    });

    if (existing) {
      if (existing.isActive) {
        throw new BadRequestException('Email is already subscribed');
      }
      return this.prisma.newsletter.update({
        where: { email },
        data: { isActive: true },
      });
    }

    return this.prisma.newsletter.create({
      data: { email },
    });
  }

  async unsubscribe(email: string) {
    const existing = await this.prisma.newsletter.findUnique({
      where: { email },
    });

    if (!existing || !existing.isActive) {
      throw new BadRequestException('Email is not subscribed');
    }

    return this.prisma.newsletter.update({
      where: { email },
      data: { isActive: false },
    });
  }

  async getAllSubscribers() {
    return this.prisma.newsletter.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
