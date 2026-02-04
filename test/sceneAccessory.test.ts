import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { PlatformAccessory, Service, Characteristic, Logger } from 'homebridge';
import { HueSceneAccessory } from '../src/sceneAccessory.js';
import { HueApiClient } from '../src/api.js';
import type { HueTransitionsPlatform } from '../src/platform.js';
import type { SceneConfig, HueScene } from '../src/types.js';

// Mock API client
jest.mock('../src/api.js');
const MockedHueApiClient = HueApiClient as jest.MockedClass<typeof HueApiClient>;

describe('HueSceneAccessory', () => {
  let accessory: HueSceneAccessory;
  let mockPlatform: jest.Mocked<HueTransitionsPlatform>;
  let mockAccessory: jest.Mocked<PlatformAccessory>;
  let mockApiClient: jest.Mocked<HueApiClient>;
  let mockService: jest.Mocked<Service>;
  let mockCharacteristic: jest.Mocked<Characteristic>;
  let mockLog: jest.Mocked<Logger>;
  let sceneConfig: SceneConfig;
  let onGetHandler: () => Promise<boolean>;
  let onSetHandler: (value: boolean) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Scene configuration
    sceneConfig = {
      id: 'scene-1',
      name: 'Test Scene',
      transitionDuration: 30,
    };

    // Mock logger
    mockLog = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Mock characteristic
    mockCharacteristic = {
      onGet: jest.fn((handler) => {
        onGetHandler = handler;
        return mockCharacteristic;
      }),
      onSet: jest.fn((handler) => {
        onSetHandler = handler;
        return mockCharacteristic;
      }),
      updateCharacteristic: jest.fn(),
    } as unknown as jest.Mocked<Characteristic>;

    // Mock service
    mockService = {
      getCharacteristic: jest.fn(() => mockCharacteristic),
      setCharacteristic: jest.fn(() => mockService),
      updateCharacteristic: jest.fn(() => mockService),
    } as unknown as jest.Mocked<Service>;

    // Mock accessory information service
    const mockAccessoryInfoService = {
      setCharacteristic: jest.fn(function (this: Service) {
        return this;
      }),
    } as unknown as jest.Mocked<Service>;

    // Mock accessory
    mockAccessory = {
      getService: jest.fn((serviceType: string) => {
        if (serviceType === 'AccessoryInformation') {
          return mockAccessoryInfoService;
        }
        return mockService;
      }),
      addService: jest.fn(() => mockService),
      context: {},
      displayName: 'Test Scene',
      UUID: 'test-uuid',
    } as unknown as jest.Mocked<PlatformAccessory>;

    // Mock API client
    mockApiClient = {
      getScene: jest.fn(),
      recallScene: jest.fn(),
      getScenes: jest.fn(),
      getLights: jest.fn(),
      testConnection: jest.fn(),
    } as unknown as jest.Mocked<HueApiClient>;

    // Mock platform
    mockPlatform = {
      log: mockLog,
      config: { debug: false, scenes: [sceneConfig] },
      Service: {
        AccessoryInformation: 'AccessoryInformation',
        Switch: 'Switch',
      },
      Characteristic: {
        Manufacturer: 'Manufacturer',
        Model: 'Model',
        SerialNumber: 'SerialNumber',
        Name: 'Name',
        On: 'On',
      },
      api: {
        hap: {
          HapStatusError: class HapStatusError extends Error {
            constructor(public statusCode: number) {
              super();
            }
          },
          HAPStatus: {
            SERVICE_COMMUNICATION_FAILURE: -70402,
          },
        },
      },
      on: jest.fn(),
    } as unknown as jest.Mocked<HueTransitionsPlatform>;

    // Create accessory
    accessory = new HueSceneAccessory(mockPlatform, mockAccessory, sceneConfig, mockApiClient);
  });

  describe('Constructor', () => {
    it('should initialize accessory correctly', () => {
      expect(mockAccessory.getService).toHaveBeenCalledWith('AccessoryInformation');
      expect(mockAccessory.getService).toHaveBeenCalledWith('Switch');
      expect(mockCharacteristic.onGet).toHaveBeenCalled();
      expect(mockCharacteristic.onSet).toHaveBeenCalled();
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('Scene accessory initialized'),
      );
    });
  });

  describe('getOn', () => {
    it('should return true when scene is active', async () => {
      const mockScene: HueScene = {
        id: 'scene-1',
        type: 'scene',
        metadata: { name: 'Test Scene' },
        group: { rid: 'room-1', rtype: 'room' },
        actions: [],
        status: { active: 'static' },
      };

      mockApiClient.getScene.mockResolvedValue(mockScene);

      const result = await onGetHandler();

      expect(result).toBe(true);
      expect(mockApiClient.getScene).toHaveBeenCalledWith('scene-1');
    });

    it('should return false when scene is inactive', async () => {
      const mockScene: HueScene = {
        id: 'scene-1',
        type: 'scene',
        metadata: { name: 'Test Scene' },
        group: { rid: 'room-1', rtype: 'room' },
        actions: [],
        status: { active: 'inactive' },
      };

      mockApiClient.getScene.mockResolvedValue(mockScene);

      const result = await onGetHandler();

      expect(result).toBe(false);
    });

    it('should return true for recently activated scenes', async () => {
      // First activate the scene
      mockApiClient.recallScene.mockResolvedValue(undefined);
      await onSetHandler(true);

      // Mock scene status as inactive (but was just activated)
      const mockScene: HueScene = {
        id: 'scene-1',
        type: 'scene',
        metadata: { name: 'Test Scene' },
        group: { rid: 'room-1', rtype: 'room' },
        actions: [],
        status: { active: 'inactive' },
      };

      mockApiClient.getScene.mockResolvedValue(mockScene);

      // Should return true because it was recently activated (within 30 seconds)
      const result = await onGetHandler();

      expect(result).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      mockApiClient.getScene.mockRejectedValue(new Error('Network error'));

      await expect(onGetHandler()).rejects.toThrow();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('Error getting state'),
        expect.any(Error),
      );
    });
  });

  describe('setOn', () => {
    it('should activate scene with transition duration', async () => {
      mockApiClient.recallScene.mockResolvedValue(undefined);

      await onSetHandler(true);

      expect(mockApiClient.recallScene).toHaveBeenCalledWith(
        'scene-1',
        30 * 60 * 1000, // 30 minutes in milliseconds
      );
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('Activating scene'),
      );
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully activated'),
      );
    });

    it('should do nothing when turning off', async () => {
      await onSetHandler(false);

      expect(mockApiClient.recallScene).not.toHaveBeenCalled();
    });

    it('should handle activation errors', async () => {
      mockApiClient.recallScene.mockRejectedValue(new Error('API error'));

      await expect(onSetHandler(true)).rejects.toThrow();
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to activate scene'),
        expect.any(Error),
      );
      expect(mockService.updateCharacteristic).toHaveBeenCalled();
    });

    it('should prevent duplicate activations', async () => {
      // Start activating
      const promise1 = onSetHandler(true);

      // Try to activate again before first completes
      const promise2 = onSetHandler(true);

      await promise1;
      await promise2;

      // Should only be called once
      expect(mockApiClient.recallScene).toHaveBeenCalledTimes(1);
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('already activating'),
      );
    });
  });

  describe('handleSceneUpdate', () => {
    it('should update characteristic when scene status changes', () => {
      // Emit sceneUpdated event
      const listeners = (mockPlatform.on as jest.Mock).mock.calls
        .filter((call: unknown[]) => call[0] === 'sceneUpdated')
        .map((call: unknown[]) => call[1]);

      expect(listeners.length).toBeGreaterThan(0);

      const handler = listeners[0] as (sceneId: string, isActive: boolean) => void;

      // Call the handler
      handler('scene-1', true);

      expect(mockService.updateCharacteristic).toHaveBeenCalledWith('On', true);
    });

    it('should not update for different scenes', () => {
      const listeners = (mockPlatform.on as jest.Mock).mock.calls
        .filter((call: unknown[]) => call[0] === 'sceneUpdated')
        .map((call: unknown[]) => call[1]);

      const handler = listeners[0] as (sceneId: string, isActive: boolean) => void;

      // Call with different scene ID
      handler('scene-2', true);

      // Should not update
      expect(mockService.updateCharacteristic).not.toHaveBeenCalled();
    });
  });

  describe('getSceneConfig', () => {
    it('should return scene configuration', () => {
      const config = accessory.getSceneConfig();

      expect(config).toEqual(sceneConfig);
      expect(config).not.toBe(sceneConfig); // Should be a copy
    });
  });
});
