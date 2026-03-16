import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const TOPSHIP_API_URL = process.env.TOPSHIP_API_URL || 'https://topship-staging.africa/api';
const TOPSHIP_API_KEY = process.env.TOPSHIP_API_KEY || '';

async function testBookShipment() {
  try {
    const details = {
      senderDetail: {
        name: "Lister Name Test",
        phoneNumber: "08000000000",
        email: "lister_test@relisted.com",
        city: "Lagos",
        state: "Lagos",
        countryCode: "NG",
        addressLine1: "268, Herbert Macauly way, Yaba",
        country: "Nigeria",
        postalCode: ""
      },
      receiverDetail: {
        name: "Renter Name Test",
        phoneNumber: "08011111111",
        email: "renter_test@relisted.com",
        city: "Abuja",
        state: "Federal Capital Territory",
        countryCode: "NG",
        addressLine1: "123, Abuja Crescent",
        country: "Nigeria",
        postalCode: ""
      },
      pricingTier: "Budget",
      insuranceType: 'None',
      itemCollectionMode: 'PickUp',
      shipmentRoute: 'Domestic',
      insuranceCharge: 0,
      shipmentCharge: 3000,
      pickupId: `PICKUP-${Date.now()}`,
      pickupPartner: 'Standard',
      pickupCharge: 1500,
      valueAddedTaxCharge: 337,
      discount: 0,
      deliveryLocation: "123, Abuja Crescent",
      items: [{
        category: 'Others',
        description: "Test Clothing Rental Item",
        weight: 1,
        quantity: 1,
        value: 5000
      }]
    };

    // Variation 3: shipment as array of details with singular keys
    const payload = { 
       shipment: [
         details
       ]
    };

    console.log("Booking shipment as draft (Variation 3)...");
    // console.log("Payload:", JSON.stringify(payload, null, 2));

    const response = await axios.post(`${TOPSHIP_API_URL}/save-shipment`, payload, {
      headers: {
        Authorization: `Bearer ${TOPSHIP_API_KEY}`,
        'Content-Type': 'application/json',
      }
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

testBookShipment();
