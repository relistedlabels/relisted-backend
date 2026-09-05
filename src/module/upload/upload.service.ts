import {
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import cloudinary, { handleUpload } from 'src/config/cloudinary.config';
import { isLocalFileUploadMode } from 'src/config/upload-mode';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import {
  isLocalPublicId,
  removeLocalUploadFile,
  saveUploadToLocalDisk,
} from 'src/utils/local-disk-upload';
import { userEntity } from '../auth/auth.types';

@Injectable()
export class UploadService {
  constructor(private readonly prisma: PrismaService) {}

  /** Images: 5MB. PDFs keep a higher cap for ID documents. */
  private readonly MAX_IMAGE_SIZE_BYTES = 12 * 1024 * 1024;
  private readonly MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;
  /** Matches frontend `thumb` ladder: f_webp,q_auto:eco,w_200,c_limit */
  private readonly THUMB_TRANSFORM = 'f_webp,q_auto:eco,w_200,c_limit';
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

    const isPdf = file.mimetype === 'application/pdf';
    const maxBytes = isPdf
      ? this.MAX_PDF_SIZE_BYTES
      : this.MAX_IMAGE_SIZE_BYTES;
    if (file.size > maxBytes) {
      bad('File too large');
    }

    if (!this.ALLOWED_TYPES.includes(file.mimetype)) {
      bad('Invalid file type');
    }
  }

  private getThumbnailUrl(url: string): string {
    if (!url || !url.includes('cloudinary')) return url;
    const parts = url.split('/upload/');
    if (parts.length !== 2) return url;
    return `${parts[0]}/upload/${this.THUMB_TRANSFORM}/${parts[1]}`;
  }

  async uploadFile(
    id: string,
    file: Express.Multer.File,
    user: userEntity,
    isChatImage = false,
  ) {
    try {
      this.validateFile(file);

      const fieldName = (file.fieldname?.trim() || 'file').slice(0, 120);

      let fileUrl: string;
      let filePublicId: string;

      if (isLocalFileUploadMode()) {
        const local = await saveUploadToLocalDisk({
          buffer: file.buffer,
          uploadId: id,
          mimetype: file.mimetype,
        });
        fileUrl = local.url;
        filePublicId = local.publicId;
      } else {
        let uploadResult: any;
        try {
          const isImage = String(file.mimetype || '').startsWith('image/');
          uploadResult = await handleUpload(file.buffer, { isImage });
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : JSON.stringify(err);
          throw new InternalServerErrorException(
            `Cloudinary upload failed (${msg}). For local testing without Cloudinary, set UPLOAD_STORAGE=local and API_PUBLIC_URL in .env`,
          );
        }
        if (!uploadResult?.secure_url || !uploadResult?.public_id) {
          bad('Upload failed');
        }
        fileUrl = uploadResult.secure_url;
        filePublicId = uploadResult.public_id;
      }

      const isImage = String(file.mimetype || '').startsWith('image/');
      const thumbnailUrl = isImage ? this.getThumbnailUrl(fileUrl) : null;

      const data = await this.prisma.upload.create({
        data: {
          id,
          name: file.originalname.slice(0, 255),
          url: fileUrl,
          publicId: filePublicId,
          type: file.mimetype,
          fieldName,
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
    } catch (e: unknown) {
      if (e instanceof HttpException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Upload failed: ${msg}`,
      );
    }
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
      if (isLocalPublicId(upload.publicId)) {
        await removeLocalUploadFile(upload.publicId);
      } else if (upload.publicId) {
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
