/** Shared Redis connection options for Bull and application caches. */
export function redisConnectionOptions():
  | string
  | { host: string; port: number; password?: string; tls?: object } {
  const url = process.env.REDIS_URL?.trim();
  if (url) {
    return url;
  }
  const password = process.env.REDIS_PASSWORD?.trim();
  const tls =
    process.env.REDIS_TLS === 'true' || process.env.REDIS_TLS === '1'
      ? {}
      : undefined;
  return {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    ...(password ? { password } : {}),
    ...(tls ? { tls } : {}),
  };
}
