import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const TOPSHIP_API_URL = process.env.TOPSHIP_API_URL || 'https://topship-staging.africa/api';
const TOPSHIP_API_KEY = process.env.TOPSHIP_API_KEY || '';

async function listShipments() {
  try {
    const filter = {
        receiverEmail: "test_renter_1773213178759@checkout.com"
    };

    console.log("Fetching shipments from Topship with filter:", JSON.stringify(filter));
    const response = await axios.get(`${TOPSHIP_API_URL}/get-shipments`, {
      headers: {
        Authorization: `Bearer ${TOPSHIP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      params: { filter: JSON.stringify(filter) }
    });

    console.log('Success!');
    const shipments = response.data;
    console.log(`Found ${Array.isArray(shipments) ? shipments.length : 'some'} shipments.`);
    
    // Print the first few to see the structure
    if (Array.isArray(shipments)) {
        console.log("First 5 shipments:");
        shipments.slice(0, 5).forEach((s, i) => {
            console.log(`[${i}] ID: ${s.id}, Tracking: ${s.trackingId}, Receiver: ${s.receiverDetail?.name}, Status: ${s.status}`);
        });
    } else {
        console.log(JSON.stringify(shipments, null, 2));
    }
  } catch (error: any) {
    if (error.response) {
       console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
    } else {
       console.error('API Error:', error.message);
    }
  }
}

listShipments();
