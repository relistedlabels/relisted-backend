import { config } from 'dotenv';
import { join } from 'path';

/**
 * Load `.env` before other modules read process.env.
 * In non-production, override stale values inherited from shell or `nest --watch` parent.
 */
const envPath = join(process.cwd(), '.env');
const isHostedProd =
  process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

config({
  path: envPath,
  override: !isHostedProd,
});
