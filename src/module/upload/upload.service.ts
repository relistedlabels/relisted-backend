import { Injectable } from '@nestjs/common';
import cloudinary, { handleUpload } from 'src/config/cloudinary.config';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';

@Injectable()
export class UploadService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
  private readonly ALLOWED_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
  ];

  private validateFile(file: Express.Multer.File): void {
    if (!file) bad('file is required');
    if (!file.buffer || file.size <= 0) bad('invalid file');

    if (file.size > this.MAX_IMAGE_SIZE_BYTES) {
      bad('File too large');
    }

    if (!this.ALLOWED_TYPES.includes(file.mimetype)) {
      bad('Invalid file type');
    }
  }

  private getThumbnailUrl(url: string, width = 400): string {
    if (!url || !url.includes('cloudinary')) return url;
    const parts = url.split('/upload/');
    if (parts.length !== 2) return url;
    return `${parts[0]}/upload/w_${width},f_jpg,q_auto/${parts[1]}`;
  }

  async uploadFile(
    id: string,
    file: Express.Multer.File,
    user: userEntity,
    isChatImage = false,
  ) {
    this.validateFile(file);

    const uploadResult: any = await handleUpload(file.buffer);
    if (!uploadResult?.secure_url || !uploadResult?.public_id) {
      bad('Upload failed');
    }

    const isImage = String(file.mimetype || '').startsWith('image/');
    const thumbnailUrl = isImage
      ? this.getThumbnailUrl(uploadResult.secure_url)
      : null;

    const data = await this.prisma.upload.create({
      data: {
        id,
        name: file.originalname,
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        type: file.mimetype,
        fieldName: file.fieldname,
        size: file.size,
        user: {
          connect: {
            id: user.id,
          },
        },
      },
    });

    return {
      ...data,
      thumbnailUrl,
      isImage,
      isChatImage: Boolean(isChatImage),
    };
  }

  async uploadIds(ids: string[]) {
    return await this.prisma.upload.findMany({
      where: {
        id: { in: ids },
      },
    });
  }

  async download(id: string) {
    return await this.prisma.upload.findUnique({
      where: {
        id,
      },
      select: {
        url: true,
        type: true,
      },
    });
  }

  async deleteUpload(ids: string[], user: userEntity) {
    const uploads = await this.prisma.upload.findMany({
      where: {
        id: { in: ids },
      },
    });

    for (const upload of uploads) {
      if (upload.publicId) {
        await cloudinary.uploader.destroy(upload.publicId);
      }
    }

    return await this.prisma.upload.deleteMany({
      where: {
        id: { in: ids },
      },
    });
  }
}
