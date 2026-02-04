import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { HueApiClient } from '../src/api.js';
import type {
  HueBridgeDiscoveryResponse,
  HueAuthResponse,
  HueResourceListResponse,
  HueSingleResourceResponse,
  HueScene,
  HueLight,
} from '../src/types.js';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HueApiClient', () => {
  let mockAxiosInstance: jest.Mocked<AxiosInstance>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock axios instance
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      request: jest.fn(),
      defaults: {
        headers: {
          common: {},
          delete: {},
          get: {},
          head: {},
          post: {},
          put: {},
          patch: {},
        },
      },
      interceptors: {
        request: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() },
        response: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() },
      },
    } as unknown as jest.Mocked<AxiosInstance>;

    mockedAxios.create.mockReturnValue(mockAxiosInstance);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('discoverBridges', () => {
    it('should discover Hue bridges', async () => {
      const mockBridges: HueBridgeDiscoveryResponse[] = [
        {
          id: 'abc123',
          internalipaddress: '192.168.1.100',
          port: 443,
        },
      ];

      mockedAxios.get.mockResolvedValue({ data: mockBridges });

      const bridges = await HueApiClient.discoverBridges();

      expect(bridges).toEqual(mockBridges);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://discovery.meethue.com',
        expect.objectContaining({ timeout: 10000 }),
      );
    });

    it('should handle discovery errors', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      await expect(HueApiClient.discoverBridges()).rejects.toThrow('Network error');
    });
  });

  describe('createApiKey', () => {
    it('should create API key when link button pressed', async () => {
      const mockResponse: HueAuthResponse[] = [
        {
          success: [{ username: 'test-api-key-123' }],
        },
      ];

      mockedAxios.post.mockResolvedValue({ data: mockResponse });

      const apiKey = await HueApiClient.createApiKey('192.168.1.100', 'testapp', 'testdevice');

      expect(apiKey).toBe('test-api-key-123');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://192.168.1.100/api',
        { devicetype: 'testapp#testdevice' },
        expect.any(Object),
      );
    });

    it('should throw error when link button not pressed', async () => {
      const mockResponse: HueAuthResponse[] = [
        {
          error: {
            type: 101,
            address: '',
            description: 'link button not pressed',
          },
        },
      ];

      mockedAxios.post.mockResolvedValue({ data: mockResponse });

      await expect(
        HueApiClient.createApiKey('192.168.1.100', 'testapp', 'testdevice'),
      ).rejects.toThrow('link button not pressed');
    });
  });

  describe('getScenes', () => {
    let client: HueApiClient;

    beforeEach(() => {
      client = new HueApiClient('192.168.1.100', 'test-api-key');
    });

    it('should get all scenes', async () => {
      const mockScenes: HueScene[] = [
        {
          id: 'scene-1',
          type: 'scene',
          metadata: { name: 'Test Scene 1' },
          group: { rid: 'room-1', rtype: 'room' },
          actions: [],
          status: { active: 'inactive' },
        },
        {
          id: 'scene-2',
          type: 'scene',
          metadata: { name: 'Test Scene 2' },
          group: { rid: 'room-2', rtype: 'room' },
          actions: [],
          status: { active: 'static' },
        },
      ];

      const mockResponse: HueResourceListResponse<HueScene> = {
        errors: [],
        data: mockScenes,
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockResponse });

      const scenes = await client.getScenes();

      expect(scenes).toEqual(mockScenes);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/resource/scene');
    });

    it('should handle API errors', async () => {
      const mockResponse: HueResourceListResponse<HueScene> = {
        errors: [{ description: 'Unauthorized' }],
        data: [],
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockResponse });

      await expect(client.getScenes()).rejects.toThrow('Hue API errors: Unauthorized');
    });
  });

  describe('getLights', () => {
    let client: HueApiClient;

    beforeEach(() => {
      client = new HueApiClient('192.168.1.100', 'test-api-key');
    });

    it('should get all lights', async () => {
      const mockLights: HueLight[] = [
        {
          id: 'light-1',
          type: 'light',
          metadata: { name: 'Test Light 1' },
          on: { on: true },
          dimming: { brightness: 80 },
        },
      ];

      const mockResponse: HueResourceListResponse<HueLight> = {
        errors: [],
        data: mockLights,
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockResponse });

      const lights = await client.getLights();

      expect(lights).toEqual(mockLights);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/resource/light');
    });
  });

  describe('getScene', () => {
    let client: HueApiClient;

    beforeEach(() => {
      client = new HueApiClient('192.168.1.100', 'test-api-key');
    });

    it('should get a specific scene', async () => {
      const mockScene: HueScene = {
        id: 'scene-1',
        type: 'scene',
        metadata: { name: 'Test Scene' },
        group: { rid: 'room-1', rtype: 'room' },
        actions: [],
        status: { active: 'static' },
      };

      const mockResponse: HueSingleResourceResponse<HueScene> = {
        errors: [],
        data: [mockScene],
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockResponse });

      const scene = await client.getScene('scene-1');

      expect(scene).toEqual(mockScene);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/resource/scene/scene-1');
    });

    it('should throw error when scene not found', async () => {
      const mockResponse: HueSingleResourceResponse<HueScene> = {
        errors: [],
        data: [],
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockResponse });

      await expect(client.getScene('nonexistent')).rejects.toThrow('Scene nonexistent not found');
    });
  });

  describe('recallScene', () => {
    let client: HueApiClient;

    beforeEach(() => {
      client = new HueApiClient('192.168.1.100', 'test-api-key');
    });

    it('should recall scene without transition', async () => {
      const mockResponse: HueSingleResourceResponse<HueScene> = {
        errors: [],
        data: [],
      };

      mockAxiosInstance.put.mockResolvedValue({ data: mockResponse });

      await client.recallScene('scene-1');

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/resource/scene/scene-1',
        {
          recall: {
            action: 'active',
          },
        },
      );
    });

    it('should recall scene with transition duration', async () => {
      const mockResponse: HueSingleResourceResponse<HueScene> = {
        errors: [],
        data: [],
      };

      mockAxiosInstance.put.mockResolvedValue({ data: mockResponse });

      await client.recallScene('scene-1', 30000);

      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/resource/scene/scene-1',
        {
          recall: {
            action: 'active',
            duration: 30000,
          },
        },
      );
    });

    it('should handle recall errors', async () => {
      const mockResponse: HueSingleResourceResponse<HueScene> = {
        errors: [{ description: 'Scene not found' }],
        data: [],
      };

      mockAxiosInstance.put.mockResolvedValue({ data: mockResponse });

      await expect(client.recallScene('nonexistent')).rejects.toThrow('Hue API errors: Scene not found');
    });
  });

  describe('testConnection', () => {
    let client: HueApiClient;

    beforeEach(() => {
      client = new HueApiClient('192.168.1.100', 'test-api-key');
    });

    it('should return true for successful connection', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: {} });

      const result = await client.testConnection();

      expect(result).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/resource');
    });

    it('should return false for failed connection', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Connection failed'));

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });
});
