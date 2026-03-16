import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const TOPSHIP_API_URL = process.env.TOPSHIP_API_URL || 'https://topship-staging.africa/api';
const TOPSHIP_API_KEY = process.env.TOPSHIP_API_KEY || '';

async function testCreateAndVerify() {
  try {
    const sender = {
      addressLine1: "268, Herbert Macauly way, Yaba",
      city: "Lagos",
      state: "Lagos",
      countryCode: "NG",
      name: "Lister Name Test",
      phoneNumber: "08000000000",
      email: "lister_test@relisted.com"
    };

    const receiver = {
      addressLine1: "123, Abuja Crescent",
      city: "Abuja",
      state: "Federal Capital Territory",
      countryCode: "NG",
      name: "Renter Name Test",
      phoneNumber: "08011111111",
      email: "renter_test@relisted.com"
    };

    // 1. Fetch Pickup Rates
    console.log("--- Step 1: Fetching Pickup Rates ---");
    const pickupPayload = {
      senderDetail: {
        addressLine1: sender.addressLine1,
        addressLine2: "",
        country: "Nigeria",
        countryCode: sender.countryCode,
        state: sender.state,
        city: sender.city
      },
      pickupDate: new Date().toISOString()
    };

    const pickupResponse = await axios.get(`${TOPSHIP_API_URL}/get-pickup-rates`, {
      headers: { Authorization: `Bearer ${TOPSHIP_API_KEY}`, 'Content-Type': 'application/json' },
      params: { input: JSON.stringify(pickupPayload) }
    });

    const pickupRate = pickupResponse.data?.[0];
    if (!pickupRate) {
      console.error("No pickup rates found.");
      return;
    }
    console.log(`Selected Pickup Partner: ${pickupRate.partner}, Charge: ${pickupRate.pickupCharge}`);

    // 2. Fetch Shipment Rates
    console.log("\n--- Step 2: Fetching Shipment Rates ---");
    const ratePayload = {
      senderDetails: { cityName: sender.city, countryCode: sender.countryCode },
      receiverDetails: { cityName: receiver.city, countryCode: receiver.countryCode },
      totalWeight: 1
    };

    const rateResponse = await axios.get(`${TOPSHIP_API_URL}/get-shipment-rate`, {
      headers: { Authorization: `Bearer ${TOPSHIP_API_KEY}`, 'Content-Type': 'application/json' },
      params: { shipmentDetail: JSON.stringify(ratePayload) }
    });

    const shipmentRate = rateResponse.data?.[0]; // Default to first (Budget or similar)
    if (!shipmentRate) {
      console.error("No shipment rates found.");
      return;
    }
    console.log(`Selected Pricing Tier: ${shipmentRate.pricingTier}, Cost: ${shipmentRate.cost}`);

    // 3. Book Shipment Draft
    console.log("\n--- Step 3: Booking Shipment Draft ---");
    const details = {
      senderDetail: {
        name: sender.name,
        phoneNumber: sender.phoneNumber,
        email: sender.email,
        city: sender.city,
        state: sender.state,
        countryCode: sender.countryCode,
        addressLine1: sender.addressLine1,
        country: "Nigeria",
        postalCode: ""
      },
      receiverDetail: {
        name: receiver.name,
        phoneNumber: receiver.phoneNumber,
        email: receiver.email,
        city: receiver.city,
        state: receiver.state,
        countryCode: receiver.countryCode,
        addressLine1: receiver.addressLine1,
        country: "Nigeria",
        postalCode: ""
      },
      shipmentRoute: 'Domestic',
      pricingTier: shipmentRate.pricingTier,
      shipmentCharge: Number(shipmentRate.cost) / 100, // Convert Kobo to Naira
      insuranceType: 'None',
      itemCollectionMode: 'PickUp',
      insuranceCharge: 0,
      pickupId: pickupRate.pickupId || `PICKUP-${Date.now()}`,
      pickupPartner: pickupRate.partner,
      pickupCharge: Number(pickupRate.pickupCharge) / 100, // Convert Kobo to Naira
      valueAddedTaxCharge: Math.ceil((Number(shipmentRate.cost) / 100 + Number(pickupRate.pickupCharge) / 100) * 0.075),
      discount: 0,
      deliveryLocation: receiver.addressLine1,
      items: [{
        category: 'Others',
        description: "Test Clothing Rental Item",
        weight: 1,
        quantity: 1,
        value: 5000
      }]
    };

    const payload = { 
       shipment: [ details ]
    };

    const createResponse = await axios.post(`${TOPSHIP_API_URL}/save-shipment`, payload, {
      headers: { Authorization: `Bearer ${TOPSHIP_API_KEY}`, 'Content-Type': 'application/json' }
    });

    console.log('Creation Success!', JSON.stringify(createResponse.data, null, 2));
    
    const shipmentId = createResponse.data?.[0]?.id || createResponse.data?.[0]?.shipmentId;
    if (!shipmentId) {
        console.error("Could not find shipment ID in response.");
        return;
    }

    // 4. Verify Shipment Existence
    console.log(`\n--- Step 4: Verifying Shipment Existence (ID: ${shipmentId}) ---`);
    const verifyResponse = await axios.get(`${TOPSHIP_API_URL}/get-shipment/${shipmentId}`, {
        headers: { Authorization: `Bearer ${TOPSHIP_API_KEY}`, 'Content-Type': 'application/json' }
    });

    console.log('Verification Success!', JSON.stringify(verifyResponse.data, null, 2));

  } catch (error: any) {
    if (error.response) {
       console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
    } else {
       console.error('API Error:', error.message);
    }
  }
}

testCreateAndVerify();
