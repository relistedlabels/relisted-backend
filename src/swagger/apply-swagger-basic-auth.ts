import type { INestApplication } from '@nestjs/common';
import basicAuth from 'express-basic-auth';

/**
 * Protects only Swagger UI (`/{path}`) and OpenAPI JSON (`/{path}-json`).
 * Register before `SwaggerModule.setup` so auth runs ahead of Swagger’s static handlers.
 */
export function applySwaggerBasicAuth(
  app: INestApplication,
  swaggerPath: string,
  username: string,
  password: string,
): void {
  const middleware = basicAuth({
    users: { [username]: password },
    challenge: true,
    realm: 'Swagger API',
  });

  app.use(`/${swaggerPath}`, middleware);
  app.use(`/${swaggerPath}-json`, middleware);
}
