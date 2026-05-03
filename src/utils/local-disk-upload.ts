import { mkdir, unlink, writeFile } from 'fs/promises';
import * as path from 'path';
import { getPublicApiBaseUrl } from 'src/config/upload-mode';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

export function extensionForMime(mimetype: string): string {
  return MIME_EXT[mimetype] ?? '.bin';
}

export async function saveUploadToLocalDisk(params: {
  buffer: Buffer;
  uploadId: string;
  mimetype: string;
  cwd?: string;
}): Promise<{ url: string; publicId: string }> {
  const cwd = params.cwd ?? process.cwd();
  const dir = path.join(cwd, 'uploads', 'local');
  await mkdir(dir, { recursive: true });

  const ext = extensionForMime(params.mimetype);
  const filename = `${params.uploadId}${ext}`;
  const fullPath = path.join(dir, filename);
  await writeFile(fullPath, params.buffer);

  const base = getPublicApiBaseUrl();
  const url = `${base}/local-uploads/${filename}`;
  const publicId = `local/${filename}`;
  return { url, publicId };
}

/** Matches `publicId` values produced by `saveUploadToLocalDisk`. */
export function isLocalPublicId(publicId: string | null | undefined): boolean {
  return Boolean(publicId?.startsWith('local/'));
}

export async function removeLocalUploadFile(
  publicId: string,
  cwd?: string,
): Promise<void> {
  if (!isLocalPublicId(publicId)) return;
  const filename = publicId.slice('local/'.length);
  const root = path.join(cwd ?? process.cwd(), 'uploads', 'local');
  const fullPath = path.join(root, path.basename(filename));
  await unlink(fullPath).catch(() => undefined);
}
