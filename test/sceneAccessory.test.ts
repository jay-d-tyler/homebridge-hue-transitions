import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type {
  Characteristic,
  Logger,
  PlatformAccessory,
  Service,
} from 'homebridge';
import { HueSceneAccessory } from '../src/sceneAccessory.js';
import type { HueApi } from '../src/api.js';
import type { HueTransitionsPlatform } from '../src/platform.js';
import type { SceneConfig } from '../src/types.js';

describe('HueSceneAccessory', () => {
  let apiClient: jest.Mocked<HueApi>;
  let service: jest.Mocked<Service>;
  let characteristic: jest.Mocked<Characteristic>;
  let log: jest.Mocked<Logger>;
  let platform: HueTransitionsPlatform;
  let sceneConfig: SceneConfig;
  let onGet: () => boolean;
  let onSet: (value: boolean) => Promise<void>;

  beforeEach(() => {
    jest.useFakeTimers();

    sceneConfig = {
      id: 'scene-1',
      name: 'Morning',
      transitionDuration: 30,
    };
    apiClient = {
      getScenes: jest.fn(),
      getLights: jest.fn(),
      getScene: jest.fn(),
      recallScene: jest.fn(),
      testConnection: jest.fn(),
    };
    log = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
    characteristic = {
      onGet: jest.fn((handler: unknown) => {
        onGet = handler as () => boolean;
        return characteristic;
      }),
      onSet: jest.fn((handler: unknown) => {
        onSet = handler as (value: boolean) => Promise<void>;
        return characteristic;
      }),
    } as unknown as jest.Mocked<Characteristic>;
    service = {
      getCharacteristic: jest.fn(() => characteristic),
      setCharacteristic: jest.fn(() => service),
      updateCharacteristic: jest.fn(() => service),
    } as unknown as jest.Mocked<Service>;
    const infoService = {
      setCharacteristic: jest.fn(function (this: Service) {
        return this;
      }),
    } as unknown as Service;
    const accessory = {
      UUID: 'uuid-scene-1',
      displayName: 'Morning',
      context: {},
      getService: jest.fn((type: unknown) => type === 'AccessoryInformation' ? infoService : service),
      addService: jest.fn(() => service),
    } as unknown as PlatformAccessory;
    platform = {
      log,
      config: { platform: 'HueTransitions', scenes: [sceneConfig], debug: false },
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
          HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
        },
      },
    } as unknown as HueTransitionsPlatform;

    new HueSceneAccessory(platform, accessory, sceneConfig, () => apiClient);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes the accessory services and handlers', () => {
    expect(characteristic.onGet).toHaveBeenCalled();
    expect(characteristic.onSet).toHaveBeenCalled();
    expect(service.setCharacteristic).toHaveBeenCalledWith('Name', 'Morning');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Scene accessory initialized'));
  });

  it('starts off and becomes a momentary trigger after recall', async () => {
    apiClient.recallScene.mockResolvedValue();
    expect(onGet()).toBe(false);

    await onSet(true);

    expect(apiClient.recallScene).toHaveBeenCalledWith('scene-1', 1_800_000);
    expect(onGet()).toBe(true);

    jest.advanceTimersByTime(1000);
    expect(onGet()).toBe(false);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('allows HomeKit to turn the virtual switch off without calling Hue', async () => {
    await onSet(false);
    expect(apiClient.recallScene).not.toHaveBeenCalled();
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('restarts the momentary reset timer after another completed activation', async () => {
    apiClient.recallScene.mockResolvedValue();

    await onSet(true);
    jest.advanceTimersByTime(500);
    await onSet(true);
    jest.advanceTimersByTime(500);

    expect(onGet()).toBe(true);
    jest.advanceTimersByTime(500);
    expect(onGet()).toBe(false);
  });

  it('logs virtual switch-off actions in debug mode', async () => {
    platform.config.debug = true;
    await onSet(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('turned off'));
  });

  it('coalesces concurrent activations', async () => {
    let resolveRecall: (() => void) | undefined;
    apiClient.recallScene.mockReturnValue(new Promise(resolve => {
      resolveRecall = resolve;
    }));

    const first = onSet(true);
    const second = onSet(true);
    resolveRecall?.();
    await Promise.all([first, second]);

    expect(apiClient.recallScene).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('already activating'));
  });

  it('returns a HomeKit communication error while disconnected', async () => {
    const disconnectedAccessory = new HueSceneAccessory(
      platform,
      {
        getService: jest.fn(() => service),
        addService: jest.fn(() => service),
      } as unknown as PlatformAccessory,
      sceneConfig,
      () => null,
    );

    await expect(disconnectedAccessory.setOn(true)).rejects.toMatchObject({ statusCode: -70402 });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not connected yet'));
  });

  it('resets the switch after a Hue recall failure', async () => {
    apiClient.recallScene.mockRejectedValue(new Error('bridge rejected request'));

    await expect(onSet(true)).rejects.toMatchObject({ statusCode: -70402 });
    expect(onGet()).toBe(false);
    expect(service.updateCharacteristic).toHaveBeenCalledWith('On', false);
  });

  it('clears its reset timer when destroyed', async () => {
    apiClient.recallScene.mockResolvedValue();
    const accessory = new HueSceneAccessory(
      platform,
      {
        getService: jest.fn(() => service),
        addService: jest.fn(() => service),
      } as unknown as PlatformAccessory,
      sceneConfig,
      () => apiClient,
    );

    await accessory.setOn(true);
    accessory.destroy();
    service.updateCharacteristic.mockClear();
    jest.advanceTimersByTime(1000);
    expect(service.updateCharacteristic).not.toHaveBeenCalled();
  });

  it('returns a defensive copy of scene configuration', () => {
    const accessory = new HueSceneAccessory(
      platform,
      {
        getService: jest.fn(() => service),
        addService: jest.fn(() => service),
      } as unknown as PlatformAccessory,
      sceneConfig,
      () => apiClient,
    );
    const copy = accessory.getSceneConfig();

    expect(copy).toEqual(sceneConfig);
    expect(copy).not.toBe(sceneConfig);
  });
});
