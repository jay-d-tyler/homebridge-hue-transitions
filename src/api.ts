import axios, { type AxiosInstance, type AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import https from 'https';
import {
  API_CONFIG,
  HUE_BRIDGE_CA_CERTIFICATE,
} from './settings.js';
import type {
  HueBridgeDiscoveryResponse,
  HueAuthResponse,
  HueResourceListResponse,
  HueSingleResourceResponse,
  HueScene,
  HueLight,
  SceneRecallRequest,
} from './types.js';

export interface HueApiClientOptions {
  bridgeId?: string;
  allowInsecureTls?: boolean;
}

export interface HueApi {
  getScenes(): Promise<HueScene[]>;
  getLights(): Promise<HueLight[]>;
  getScene(sceneId: string): Promise<HueScene>;
  recallScene(sceneId: string, transitionMs?: number): Promise<void>;
  testConnection(): Promise<boolean>;
}

const HUE_BRIDGE_ID_PATTERN = /^[0-9A-F]{16}$/;

export function normalizeBridgeId(bridgeId: string): string {
  return bridgeId.replaceAll(':', '').replaceAll('-', '').trim().toUpperCase();
}

export function createHueHttpsAgent(options: HueApiClientOptions = {}): https.Agent {
  if (options.allowInsecureTls === true) {
    return new https.Agent({ rejectUnauthorized: false });
  }

  const expectedBridgeId = options.bridgeId === undefined
    ? undefined
    : normalizeBridgeId(options.bridgeId);

  return new https.Agent({
    ca: HUE_BRIDGE_CA_CERTIFICATE,
    rejectUnauthorized: true,
    servername: expectedBridgeId,
    checkServerIdentity: (_hostname, certificate) => {
      const commonName: unknown = (
        certificate.subject as unknown as Record<string, unknown>
      ).CN;

      if (typeof commonName !== 'string') {
        return new Error('Hue bridge certificate does not contain a common name');
      }

      const certificateBridgeId = normalizeBridgeId(commonName);

      if (!HUE_BRIDGE_ID_PATTERN.test(certificateBridgeId)) {
        return new Error('Hue bridge certificate has an invalid common name');
      }

      if (expectedBridgeId !== undefined && certificateBridgeId !== expectedBridgeId) {
        return new Error(
          `Hue bridge certificate identity mismatch: expected ${expectedBridgeId}, received ${certificateBridgeId}`,
        );
      }

      return undefined;
    },
  });
}

export class HueApiClient {
  private readonly client: AxiosInstance;

  constructor(
    bridgeIp: string,
    apiKey: string,
    options: HueApiClientOptions = {},
    client?: AxiosInstance,
  ) {
    if (client !== undefined) {
      this.client = client;
      return;
    }

    this.client = axios.create({
      baseURL: `https://${bridgeIp}/clip/${API_CONFIG.API_VERSION}`,
      timeout: API_CONFIG.REQUEST_TIMEOUT,
      headers: {
        'hue-application-key': apiKey,
      },
      httpsAgent: createHueHttpsAgent(options),
    });

    // Reads are safe to retry. Scene recall PUTs are actions and must not be
    // repeated after an ambiguous network failure.
    axiosRetry(this.client, {
      retries: API_CONFIG.RETRIES,
      retryDelay: (retryCount: number) => axiosRetry.exponentialDelay(retryCount),
      retryCondition: (error) => {
        const method = error.config?.method?.toLowerCase();
        return method === 'get' && (
          axiosRetry.isNetworkError(error) ||
          (error.response !== undefined && error.response.status >= 500)
        );
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
  static async createApiKey(
    bridgeIp: string,
    appName: string,
    deviceName: string,
    options: HueApiClientOptions = {},
  ): Promise<string> {
    try {
      const response = await axios.post<HueAuthResponse[]>(
        `https://${bridgeIp}/api`,
        {
          devicetype: `${appName}#${deviceName}`,
        },
        {
          timeout: API_CONFIG.REQUEST_TIMEOUT,
          httpsAgent: createHueHttpsAgent(options),
        },
      );

      const result: HueAuthResponse | undefined = response.data.at(0);

      if (result?.success?.username) {
        return result.success.username;
      }

      if (result?.error) {
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
      const response = await this.client.get<HueSingleResourceResponse<HueScene>>(
        `/resource/scene/${encodeURIComponent(sceneId)}`,
      );

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
        `/resource/scene/${encodeURIComponent(sceneId)}`,
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
