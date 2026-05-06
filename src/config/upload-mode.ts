/**
 * Local file upload (no Cloudinary) for dev / self-hosted testing.
 *
 * In `.env` set:
 *   UPLOAD_STORAGE=local
 * and optionally (defaults to http://localhost:{PORT}):
 *   API_PUBLIC_URL=http://localhost:4000
 */
export function isLocalFileUploadMode(): boolean {
  // Never disk-backed uploads in production (guards against mis-set env on deploy).
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const v = process.env.UPLOAD_STORAGE?.trim().toLowerCase();
  if (v === 'local' || v === 'filesystem' || v === 'disk') return true;
  const flag = process.env.LOCAL_FILE_UPLOAD?.trim().toLowerCase();
  return flag === 'true' || flag === '1';
}

/** Base URL used in stored Upload.url so the frontend can load images (must match how you reach the API). */
export function getPublicApiBaseUrl(): string {
  const fromEnv =
    process.env.API_PUBLIC_URL?.trim().replace(/\/$/, '') ||
    process.env.BACKEND_PUBLIC_URL?.trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const port = process.env.PORT ?? '4000';
  return `http://localhost:${port}`;
}
