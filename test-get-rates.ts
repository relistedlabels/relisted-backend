import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const TOPSHIP_API_URL = process.env.TOPSHIP_API_URL || 'https://topship-staging.africa/api';
const TOPSHIP_API_KEY = process.env.TOPSHIP_API_KEY || '';

async function testGetRates() {
  try {
    const ratePayload = {
      senderDetails: { cityName: 'Lagos', countryCode: "NG" },
      receiverDetails: { cityName: 'Abuja', countryCode: "NG" },
      totalWeight: 1
    };

    console.log("Fetching rates...");
    const response = await axios.get(`${TOPSHIP_API_URL}/get-shipment-rate`, {
      headers: {
        Authorization: `Bearer ${TOPSHIP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      params: { shipmentDetail: JSON.stringify(ratePayload) }
    });
    console.log('Success!', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('API Error:', JSON.stringify(error.response?.data || error.message, null, 2));
  }
}

testGetRates();
