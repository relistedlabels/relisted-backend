import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const baseUrl = process.env.TOPSHIP_API_URL || 'https://topship-staging.africa/api';
const apiKey = process.env.TOPSHIP_API_KEY || '';

const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
};

async function testIt(payload: any, isStringified: boolean) {
  try {
    const params = isStringified ? { shipmentDetail: JSON.stringify(payload) } : { shipmentDetail: payload };
    console.log('Sending params:', params);
    const response = await axios.get(`${baseUrl}/get-shipment-rate`, {
      headers,
      params,
    });
    console.log(`Success (isStringified=${isStringified})! Response data:`, JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.log(`Failed (isStringified=${isStringified}):`, error.response?.data || error.message);
  }
}

async function run() {
  const payload = {
    senderDetails: { cityName: 'Lagos', countryCode: 'NG' },
    receiverDetails: { cityName: 'Abuja', countryCode: 'NG' },
    totalWeight: 1
  };
  await testIt(payload, false);
  console.log('---');
  await testIt(payload, true);
  console.log('---');

  // Let's try sending as a POST
  try {
     const response = await axios.post(`${baseUrl}/get-shipment-rate`, payload, { headers });
     console.log('POST Success!');
  } catch(e: any) {
     console.log('POST Failed:', e.response?.data || e.message);
  }
  
  // Let's try sending with shipmentDetail wrapper as POST
  try {
     const response = await axios.post(`${baseUrl}/get-shipment-rate`, { shipmentDetail: payload }, { headers });
     console.log('POST Wrapped Success!');
  } catch(e: any) {
     console.log('POST Wrapped Failed:', e.response?.data || e.message);
  }
}

run();
