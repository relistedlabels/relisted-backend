function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/$/, '');
}

export function isHostedEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'
  );
}

/** Frontend origin for links in emails and notifications. */
export function resolveClientUrl(): string {
  const configured = trimTrailingSlash(
    process.env.CLIENT_URL || process.env.FRONTEND_URL || '',
  );
  if (configured) return configured;
  if (!isHostedEnvironment()) return 'http://localhost:3000';
  return '';
}

/** Public API origin for accept/reject links and uploaded asset URLs. */
export function resolveApiPublicUrl(): string {
  const configured = trimTrailingSlash(
    process.env.API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '',
  );
  if (configured) return configured;
  if (!isHostedEnvironment()) {
    return `http://localhost:${process.env.PORT ?? '4000'}`;
  }
  return '';
}

export type ListerAvailabilityResponseOutcome = 'accepted' | 'rejected' | 'error';

export function buildListerAvailabilityResponsePageUrl(params: {
  outcome: ListerAvailabilityResponseOutcome;
  requestId?: string;
  productName?: string;
  requestType?: 'purchase' | 'rental';
  message?: string;
}): string {
  const clientBase = resolveClientUrl();
  if (!clientBase) return '';

  const url = new URL('/shop/availability/lister-response', clientBase);
  url.searchParams.set('outcome', params.outcome);
  if (params.requestId) {
    url.searchParams.set('requestId', params.requestId);
  }
  if (params.productName) {
    url.searchParams.set('productName', params.productName);
  }
  if (params.requestType) {
    url.searchParams.set('requestType', params.requestType);
  }
  if (params.message) {
    url.searchParams.set('message', params.message);
  }
  return url.toString();
}

export function warnIfEmailLinkEnvMissing(): void {
  if (!isHostedEnvironment()) return;

  const missing: string[] = [];
  if (!resolveClientUrl()) {
    missing.push('CLIENT_URL (or FRONTEND_URL)');
  }
  if (!resolveApiPublicUrl()) {
    missing.push('API_PUBLIC_URL (or RENDER_EXTERNAL_URL)');
  }
  if (missing.length === 0) return;

  console.warn(
    `[Config] Email and notification links may use localhost until these are set on the host: ${missing.join(', ')}`,
  );
}
