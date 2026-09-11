import axios from 'axios';
import * as dotenv from 'dotenv';
import {
  isEligibleTshipQuoteRate,
  TshipRateLike,
} from './src/services/tship/tship-carrier-filter';

dotenv.config();

const useSandbox =
  process.env.TERMINAL_USE_SANDBOX?.trim() === '1' ||
  process.env.TERMINAL_USE_SANDBOX?.trim()?.toLowerCase() === 'true';
const baseUrl = (
  process.env.TERMINAL_API_BASE_URL?.trim() ||
  (useSandbox
    ? 'https://sandbox.terminal.africa/v1'
    : 'https://api.terminal.africa/v1')
).replace(/\/$/, '');
const apiKey = process.env.TERMINAL_API_KEY?.trim() || '';

function addressPayload(input: {
  name: string;
  email: string;
  phone: string;
  line1: string;
  city: string;
  state: string;
  zip?: string;
}) {
  const [first, ...rest] = input.name.trim().split(/\s+/);
  return {
    city: input.city,
    state: input.state,
    country: 'NG',
    email: input.email,
    phone: input.phone.startsWith('+') ? input.phone : `+234${input.phone.replace(/^0/, '')}`,
    line1: input.line1,
    line2: '-',
    first_name: first || 'Relisted',
    last_name: rest.join(' ') || 'Test',
    name: input.name,
    zip: input.zip ?? '101001',
    is_residential: true,
  };
}

async function main() {
  if (!apiKey) {
    console.error('TERMINAL_API_KEY is not set in .env');
    process.exit(1);
  }

  const body = {
    pickup_address: addressPayload({
      name: 'Relisted Lister',
      email: 'lister@relisted.com',
      phone: '08012345678',
      line1: '26a Dele Adedeji street, Lekki Phase One',
      city: 'Lekki',
      state: 'Lagos',
    }),
    delivery_address: addressPayload({
      name: 'Relisted Renter',
      email: 'renter@relisted.com',
      phone: '08087654321',
      line1: '34 Bourdillon',
      city: 'Ikoyi',
      state: 'Lagos',
    }),
    parcel: {
      description: 'Relisted test order',
      weight_unit: 'kg',
      items: [
        {
          name: 'Clothing bundle',
          description: 'Relisted rental items',
          weight: 1,
          quantity: 1,
          value: 15000,
          currency: 'NGN',
        },
      ],
    },
    currency: 'NGN',
    persist_data: true,
  };

  const url = `${baseUrl}/rates/shipment/quotes`;
  console.log(`Route: Lekki (Dele Adedeji) → Ikoyi (Bourdillon)`);
  console.log(`POST ${url} (sandbox=${useSandbox})`);

  const started = Date.now();
  const res = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: Number(process.env.TERMINAL_QUOTE_HTTP_TIMEOUT_MS ?? 60_000),
  });
  console.log(`HTTP ${res.status} in ${Date.now() - started}ms`);

  const rows = Array.isArray(res.data?.data) ? res.data.data : [];
  console.log(`Raw rates returned: ${rows.length}`);

  const eligible = rows.filter((r: TshipRateLike) =>
    isEligibleTshipQuoteRate(r, { sameDayOnly: true }),
  );
  console.log(`After same-day allowlist filter: ${eligible.length}\n`);

  for (const r of eligible.slice(0, 15)) {
    console.log(
      [
        String(r.carrier_slug ?? '?'),
        String(r.carrier_name ?? '?'),
        `NGN ${Number(r.amount ?? 0).toLocaleString()}`,
        String(r.delivery_time ?? ''),
        `rate_id=${String(r.rate_id ?? r.id ?? '')}`,
      ].join(' | '),
    );
  }

  if (eligible.length === 0 && rows.length > 0) {
    console.log('\nSample filtered-out carriers (first 8):');
    for (const r of rows.slice(0, 8)) {
      console.log(
        `  ${r.carrier_slug} | ${r.carrier_name} | ${r.delivery_time}`,
      );
    }
  }
}

main().catch((err) => {
  const status = err.response?.status;
  const data = err.response?.data;
  console.error(
    status ? `Request failed HTTP ${status}` : 'Request failed',
    data ? JSON.stringify(data, null, 2) : err.message,
  );
  process.exit(1);
});
