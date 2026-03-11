import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TopshipService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = process.env.TOPSHIP_API_URL || 'https://topship-staging.africa/api';
    this.apiKey = process.env.TOPSHIP_API_KEY || '';
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async getShipmentRate(data: any) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-shipment-rate`, {
        headers: this.headers,
        params: { shipmentDetail: typeof data === 'string' ? data : JSON.stringify(data) },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getShopAndShipRates(data: any) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-shopnship-rates`, {
        headers: this.headers,
        params: { input: typeof data === 'string' ? data : JSON.stringify(data) },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getPickupRates(data: any) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-pickup-rates`, {
        headers: this.headers,
        params: { input: typeof data === 'string' ? data : JSON.stringify(data) },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getShipments(filter: any) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-shipments`, {
        headers: this.headers,
        params: { filter },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getShipmentById(id: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-shipment/${id}`, {
        headers: this.headers,
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async cancelShipment(id: string) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/cancel-shipment`,
        { id },
        { headers: this.headers },
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async trackShipment(trackingId: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/track-shipment`, {
        headers: this.headers,
        params: { trackingId },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getCountries() {
    try {
      const response = await axios.get(`${this.baseUrl}/get-countries`, {
        headers: this.headers,
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getStates(countryCode: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-states`, {
        headers: this.headers,
        params: { countryCode },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async getCities(countryCode: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/get-cities`, {
        headers: this.headers,
        params: { countryCode },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async bookShipmentAsDraft(data: any) {
    try {
      const response = await axios.post(`${this.baseUrl}/save-shipment`, data, {
        headers: this.headers,
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async bookShopAndShipAsDraft(data: any) {
    try {
      const response = await axios.post(`${this.baseUrl}/save-shopnship`, data, {
        headers: this.headers,
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  async payForShipment(shipmentId: string) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/pay-from-wallet`,
        { detail: { shipmentId } },
        { headers: this.headers },
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error);
    }
  }

  private handleError(error: any) {
    console.error('Topship API error:', error.response?.data || error.message);
    throw new InternalServerErrorException(
      error.response?.data?.message || 'Topship API request failed',
    );
  }
}
