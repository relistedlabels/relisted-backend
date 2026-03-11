import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const TOPSHIP_API_URL = process.env.TOPSHIP_API_URL || 'https://topship-staging.africa/api';
const TOPSHIP_API_KEY = process.env.TOPSHIP_API_KEY || '';

async function testGetPickupRates() {
  try {
    const ratePayload = {
      senderDetail: {
        addressLine1: "268, Herbert Macauly way",
        addressLine2: "",
        country: "Nigeria",
        countryCode: "NG",
        state: "Lagos",
        city: "Yaba"
      },
      pickupDate: new Date().toISOString()
    };

    console.log("Fetching pickup rates...");
    const response = await axios.get(`${TOPSHIP_API_URL}/get-pickup-rates`, {
      headers: {
        Authorization: `Bearer ${TOPSHIP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      params: { input: JSON.stringify(ratePayload) }
    });
    console.log('Success!', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    if (error.response) {
       console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
    } else {
       console.error('API Error:', error.message);
    }
  }
}

testGetPickupRates();
