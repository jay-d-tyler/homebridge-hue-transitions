import axios, { type AxiosInstance, type AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import https from 'https';
import { API_CONFIG } from './settings.js';
import type {
  HueBridgeDiscoveryResponse,
  HueAuthResponse,
  HueResourceListResponse,
  HueSingleResourceResponse,
  HueScene,
  HueLight,
  SceneRecallRequest,
} from './types.js';

export class HueApiClient {
  private readonly client: AxiosInstance;

  constructor(bridgeIp: string, apiKey: string) {
    this.client = axios.create({
      baseURL: `https://${bridgeIp}/clip/${API_CONFIG.API_VERSION}`,
      timeout: API_CONFIG.REQUEST_TIMEOUT,
      headers: {
        'hue-application-key': apiKey,
      },
      // Hue bridge uses self-signed certificates
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
    });

    // Configure retry logic
    axiosRetry(this.client, {
      retries: 3,
      retryDelay: (retryCount: number) => axiosRetry.exponentialDelay(retryCount),
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          (error.response !== undefined && error.response.status >= 500);
      },
    });
  }

  /**
   * Discover Hue bridges on the local network
   */
  static async discoverBridges(): Promise<HueBridgeDiscoveryResponse[]> {
    try {
      const response = await axios.get<HueBridgeDiscoveryResponse[]>(API_CONFIG.DISCOVERY_URL, {
        timeout: API_CONFIG.REQUEST_TIMEOUT,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to discover Hue bridges: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Create a new API key (requires link button press)
   */
  static async createApiKey(bridgeIp: string, appName: string, deviceName: string): Promise<string> {
    try {
      const response = await axios.post<HueAuthResponse[]>(
        `https://${bridgeIp}/api`,
        {
          devicetype: `${appName}#${deviceName}`,
        },
        {
          timeout: API_CONFIG.REQUEST_TIMEOUT,
          httpsAgent: new (await import('https')).Agent({
            rejectUnauthorized: false,
          }),
        },
      );

      const result = response.data[0];

      if (result.success && result.success.length > 0) {
        return result.success[0].username;
      }

      if (result.error) {
        throw new Error(result.error.description);
      }

      throw new Error('Unexpected response format from Hue bridge');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to create API key: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get all scenes from the bridge
   */
  async getScenes(): Promise<HueScene[]> {
    try {
      const response = await this.client.get<HueResourceListResponse<HueScene>>('/resource/scene');

      if (response.data.errors.length > 0) {
        throw new Error(`Hue API errors: ${response.data.errors.map(e => e.description).join(', ')}`);
      }

      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.handleApiError(error);
      }
      throw error;
    }
  }

  /**
   * Get all lights from the bridge
   */
  async getLights(): Promise<HueLight[]> {
    try {
      const response = await this.client.get<HueResourceListResponse<HueLight>>('/resource/light');

      if (response.data.errors.length > 0) {
        throw new Error(`Hue API errors: ${response.data.errors.map(e => e.description).join(', ')}`);
      }

      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.handleApiError(error);
      }
      throw error;
    }
  }

  /**
   * Get a specific scene by ID
   */
  async getScene(sceneId: string): Promise<HueScene> {
    try {
      const response = await this.client.get<HueSingleResourceResponse<HueScene>>(`/resource/scene/${sceneId}`);

      if (response.data.errors.length > 0) {
        throw new Error(`Hue API errors: ${response.data.errors.map(e => e.description).join(', ')}`);
      }

      if (!response.data.data.length) {
        throw new Error(`Scene ${sceneId} not found`);
      }

      return response.data.data[0];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.handleApiError(error);
      }
      throw error;
    }
  }

  /**
   * Activate a scene with optional transition duration
   * @param sceneId - The scene ID to activate
   * @param transitionMs - Transition duration in milliseconds (optional)
   */
  async recallScene(sceneId: string, transitionMs?: number): Promise<void> {
    try {
      const request: SceneRecallRequest = {
        recall: {
          action: 'active',
        },
      };

      // Add transition duration if specified
      if (transitionMs !== undefined && transitionMs > 0) {
        request.recall.duration = transitionMs;
      }

      const response = await this.client.put<HueSingleResourceResponse<HueScene>>(
        `/resource/scene/${sceneId}`,
        request,
      );

      if (response.data.errors.length > 0) {
        throw new Error(`Hue API errors: ${response.data.errors.map(e => e.description).join(', ')}`);
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.handleApiError(error);
      }
      throw error;
    }
  }

  /**
   * Test connection to the bridge
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/resource');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Handle API errors with appropriate error messages
   */
  private handleApiError(error: AxiosError): never {
    const response = (error as { response?: { status: number } }).response;

    if (response) {
      const status = response.status;

      if (status === 401 || status === 403) {
        throw new Error('Authentication failed - please check your API key');
      } else if (status === 404) {
        throw new Error('Resource not found on Hue bridge');
      } else if (status === 429) {
        throw new Error('Rate limit exceeded - too many requests to Hue bridge');
      } else if (status >= 500) {
        throw new Error('Hue bridge server error');
      }
    }

    const errorCode = (error as { code?: string }).code;
    if (errorCode === 'ECONNREFUSED') {
      throw new Error('Cannot connect to Hue bridge - check bridge IP address');
    } else if (errorCode === 'ETIMEDOUT') {
      throw new Error('Connection to Hue bridge timed out');
    }

    const message = (error as { message?: string }).message ?? 'Unknown error';
    throw new Error(`Hue API error: ${message}`);
  }
}
