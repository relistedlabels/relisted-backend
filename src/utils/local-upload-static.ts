import { existsSync } from 'fs';
import { basename, join, normalize } from 'path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/**
 * Serves files from uploads/local. When a referenced file is missing (common in
 * local dev after DB restore without the upload folder), returns a neutral
 * placeholder instead of 404 so shop and admin UIs stay usable.
 */
export function registerLocalUploadStatic(app: NestExpressApplication): void {
  const localDir = join(process.cwd(), 'uploads', 'local');
  const fallbackPath = join(
    process.cwd(),
    'assets',
    'local-upload-placeholder.png',
  );

  app.use(
    '/local-uploads',
    (req: Request, res: Response, next: NextFunction) => {
      const raw = req.path.replace(/^\/+/, '');
      const filename = basename(normalize(raw));
      if (!filename || filename === '.' || filename === '..') {
        return res.status(404).end();
      }

      const filePath = join(localDir, filename);
      if (existsSync(filePath)) {
        return res.sendFile(filePath);
      }

      if (existsSync(fallbackPath)) {
        return res.type('png').sendFile(fallbackPath);
      }

      return next();
    },
  );
}
