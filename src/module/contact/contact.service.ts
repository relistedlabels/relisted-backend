import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) {}

  async create(createContactSubmissionDto: CreateContactSubmissionDto) {
    const { firstName, lastName, email, message } = createContactSubmissionDto;

    const submission = await this.prisma.contactSubmission.create({
      data: {
        firstName,
        lastName,
        email,
        message,
        status: 'RECEIVED',
      },
    });

    return {
      success: true,
      message: 'Your message has been received. We will get back to you within 24 hours.',
      data: {
        ticketId: submission.id,
        submittedAt: submission.createdAt,
        status: submission.status,
      },
    };
  }
}
