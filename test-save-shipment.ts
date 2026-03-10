import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const TOPSHIP_API_URL = process.env.TOPSHIP_API_URL || 'https://topship-staging.africa/api';
const TOPSHIP_API_KEY = process.env.TOPSHIP_API_KEY || '';

async function testSaveShipment() {
  try {
    const payload = {
        shipment: [{
            senderDetails: {
              name: "John Doe",
              phoneNumber: "08012345678",
              email: "john.doe@example.com",
              cityName: "Lagos",
              countryCode: "NG",
              addressLine: "123 Sender St"
            },
            receiverDetails: {
              name: "Jane Doe",
              phoneNumber: "08087654321",
              email: "jane.doe@example.com",
              cityName: "Abuja",
              countryCode: "NG",
              addressLine: "456 Receiver Ave"
            },
            itemCollectionMode: "PickUp",
            items: [
              {
                category: "apparel",
                description: "Test Package",
                weight: 1,
                quantity: 1,
                value: 1000
              }
            ]
        }]
    };

    console.log("Sending Payload:", JSON.stringify(payload, null, 2));

    const response = await axios.post(`${TOPSHIP_API_URL}/save-shipment`, payload, {
      headers: {
        Authorization: `Bearer ${TOPSHIP_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('Success!', response.data);
  } catch (error: any) {
    console.error('API Error:', JSON.stringify(error.response?.data || error.message, null, 2));
  }
}

testSaveShipment();
