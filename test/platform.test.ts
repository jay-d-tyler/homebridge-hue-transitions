import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { API, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { HueTransitionsPlatform } from '../src/platform.js';
import { HueApiClient } from '../src/api.js';
import { HueSceneAccessory } from '../src/sceneAccessory.js';
import type { HueScene } from '../src/types.js';

// Mock modules
jest.mock('../src/api.js');
jest.mock('../src/sceneAccessory.js');

const MockedHueApiClient = HueApiClient as jest.MockedClass<typeof HueApiClient>;
const MockedHueSceneAccessory = HueSceneAccessory as jest.MockedClass<typeof HueSceneAccessory>;

describe('HueTransitionsPlatform', () => {
  let platform: HueTransitionsPlatform;
  let mockLog: jest.Mocked<Logging>;
  let mockAPI: jest.Mocked<API>;
  let mockConfig: PlatformConfig;
  let didFinishLaunchingCallback: () => void;
  let shutdownCallback: () => void;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock logger
    mockLog = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
      success: jest.fn(),
    } as unknown as jest.Mocked<Logging>;

    // Mock Homebridge API
    mockAPI = {
      hap: {
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
        uuid: {
          generate: jest.fn((id: string) => `uuid-${id}`),
        },
        HapStatusError: class HapStatusError extends Error {
          constructor(public statusCode: number) {
            super();
          }
        },
        HAPStatus: {
          SERVICE_COMMUNICATION_FAILURE: -70402,
        },
      },
      on: jest.fn((event: string, callback: () => void) => {
        if (event === 'didFinishLaunching') {
          didFinishLaunchingCallback = callback;
        } else if (event === 'shutdown') {
          shutdownCallback = callback;
        }
      }),
      registerPlatformAccessories: jest.fn(),
      unregisterPlatformAccessories: jest.fn(),
      platformAccessory: jest.fn(),
    } as unknown as jest.Mocked<API>;

    // Mock config
    mockConfig = {
      platform: 'HueTransitions',
      name: 'Test Platform',
      bridgeIp: '192.168.1.100',
      apiKey: 'test-api-key',
      scenes: [
        {
          id: 'scene-1',
          name: 'Test Scene 1',
          transitionDuration: 30,
        },
        {
          id: 'scene-2',
          name: 'Test Scene 2',
          transitionDuration: 15,
        },
      ],
      pollingInterval: 60000,
      debug: false,
    };

    platform = new HueTransitionsPlatform(mockLog, mockConfig, mockAPI);
  });

  describe('Constructor', () => {
    it('should initialize platform correctly', () => {
      expect(platform.config).toEqual(mockConfig);
      expect(mockAPI.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function));
      expect(mockAPI.on).toHaveBeenCalledWith('shutdown', expect.any(Function));
    });

    it('should initialize empty scenes array if not provided', () => {
      const configWithoutScenes = { ...mockConfig };
      delete configWithoutScenes.scenes;

      const platformWithoutScenes = new HueTransitionsPlatform(mockLog, configWithoutScenes, mockAPI);

      expect(platformWithoutScenes.config.scenes).toEqual([]);
    });
  });

  describe('configureAccessory', () => {
    it('should restore accessories from cache', () => {
      const mockAccessory = {
        UUID: 'test-uuid',
        displayName: 'Test Accessory',
      } as PlatformAccessory;

      platform.configureAccessory(mockAccessory);

      expect(platform.accessories.get('test-uuid')).toBe(mockAccessory);
      expect(mockLog.info).toHaveBeenCalledWith('Loading accessory from cache:', 'Test Accessory');
    });
  });

  describe('discoverAndRegisterScenes', () => {
    let mockApiClient: jest.Mocked<HueApiClient>;
    let mockScenes: HueScene[];

    beforeEach(() => {
      mockScenes = [
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

      mockApiClient = {
        getScenes: jest.fn().mockResolvedValue(mockScenes),
        getLights: jest.fn().mockResolvedValue([]),
        getScene: jest.fn(),
        recallScene: jest.fn(),
        testConnection: jest.fn().mockResolvedValue(true),
      } as unknown as jest.Mocked<HueApiClient>;

      MockedHueApiClient.mockImplementation(() => mockApiClient);
    });

    it('should discover and register configured scenes', async () => {
      await didFinishLaunchingCallback();
      await Promise.resolve(); // Wait for async operations

      expect(MockedHueApiClient).toHaveBeenCalledWith('192.168.1.100', 'test-api-key');
      expect(mockApiClient.testConnection).toHaveBeenCalled();
      expect(mockApiClient.getScenes).toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('Successfully initialized 2 scene(s)'),
      );
    });

    it('should warn when configured scene not found on bridge', async () => {
      // Remove one scene from the bridge response
      mockApiClient.getScenes = jest.fn().mockResolvedValue([mockScenes[0]]);

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('not found on bridge'),
      );
    });

    it('should handle missing bridge IP with auto-discovery', async () => {
      const configWithoutBridgeIp = { ...mockConfig };
      delete configWithoutBridgeIp.bridgeIp;

      platform = new HueTransitionsPlatform(mockLog, configWithoutBridgeIp, mockAPI);

      MockedHueApiClient.discoverBridges = jest.fn().mockResolvedValue([
        { id: 'bridge-1', internalipaddress: '192.168.1.100' },
      ]);

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(MockedHueApiClient.discoverBridges).toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith('Discovered Hue bridge at 192.168.1.100');
    });

    it('should handle missing API key', async () => {
      const configWithoutApiKey = { ...mockConfig };
      delete configWithoutApiKey.apiKey;

      platform = new HueTransitionsPlatform(mockLog, configWithoutApiKey, mockAPI);

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockLog.error).toHaveBeenCalledWith('No API key configured');
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('To create an API key'));
    });

    it('should handle API client connection failure', async () => {
      mockApiClient.testConnection = jest.fn().mockResolvedValue(false);

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect to Hue bridge'),
      );
    });

    it('should remove stale accessories', async () => {
      // Add a cached accessory that's not in the config
      const staleAccessory = {
        UUID: 'stale-uuid',
        displayName: 'Stale Scene',
        context: { sceneId: 'scene-stale' },
      } as PlatformAccessory;

      platform.configureAccessory(staleAccessory);

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Removing stale accessory'));
      expect(mockAPI.unregisterPlatformAccessories).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        [staleAccessory],
      );
    });
  });

  describe('Polling', () => {
    let mockApiClient: jest.Mocked<HueApiClient>;

    beforeEach(() => {
      mockApiClient = {
        getScenes: jest.fn().mockResolvedValue([
          {
            id: 'scene-1',
            type: 'scene',
            metadata: { name: 'Test Scene 1' },
            group: { rid: 'room-1', rtype: 'room' },
            actions: [],
            status: { active: 'static' },
          },
        ]),
        testConnection: jest.fn().mockResolvedValue(true),
      } as unknown as jest.Mocked<HueApiClient>;

      MockedHueApiClient.mockImplementation(() => mockApiClient);
    });

    it('should start polling after initialization', async () => {
      jest.useFakeTimers();

      await didFinishLaunchingCallback();
      await Promise.resolve();

      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting scene status polling'),
      );

      jest.useRealTimers();
    });

    it('should emit sceneUpdated events during polling', async () => {
      jest.useFakeTimers();

      const sceneUpdatedHandler = jest.fn();
      platform.on('sceneUpdated', sceneUpdatedHandler);

      await didFinishLaunchingCallback();
      await Promise.resolve();

      // Fast-forward time to trigger a poll
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(mockApiClient.getScenes).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should handle polling errors gracefully', async () => {
      jest.useFakeTimers();

      mockApiClient.getScenes = jest.fn().mockRejectedValue(new Error('Network error'));

      await didFinishLaunchingCallback();
      await Promise.resolve();

      // Fast-forward time to trigger a poll
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('Error polling scene status'),
        expect.any(Error),
      );

      jest.useRealTimers();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup on shutdown', () => {
      shutdownCallback();

      expect(mockLog.debug).toHaveBeenCalledWith('Cleanup completed');
    });
  });
});
