import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import type {
  API,
  Characteristic,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import {
  HueTransitionsPlatform,
  type HueTransitionsPlatformDependencies,
} from '../src/platform.js';
import type { HueApi } from '../src/api.js';
import type {
  HueBridgeDiscoveryResponse,
  HueLight,
  HueScene,
} from '../src/types.js';

type DiscoverBridges = () => Promise<HueBridgeDiscoveryResponse[]>;

function createScene(id = 'scene-1', name = 'Morning'): HueScene {
  return {
    id,
    type: 'scene',
    metadata: { name },
    group: { rid: 'room-1', rtype: 'room' },
    actions: [],
    status: { active: 'inactive' },
  };
}

class FakeAccessory {
  public readonly context: Record<string, unknown> = {};
  public readonly service: Service;

  constructor(
    public readonly displayName: string,
    public readonly UUID: string,
  ) {
    const characteristic = {
      onGet: jest.fn(function (this: Characteristic) {
        return this;
      }),
      onSet: jest.fn(function (this: Characteristic) {
        return this;
      }),
    } as unknown as Characteristic;
    this.service = {
      setCharacteristic: jest.fn(function (this: Service) {
        return this;
      }),
      updateCharacteristic: jest.fn(function (this: Service) {
        return this;
      }),
      getCharacteristic: jest.fn(() => characteristic),
    } as unknown as Service;
  }

  getService(type: unknown): Service {
    if (type === 'AccessoryInformation') {
      return {
        setCharacteristic: jest.fn(function (this: Service) {
          return this;
        }),
      } as unknown as Service;
    }

    return this.service;
  }

  addService(): Service {
    return this.service;
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe('HueTransitionsPlatform', () => {
  let log: jest.Mocked<Logger>;
  let api: API;
  let hueApi: jest.Mocked<HueApi>;
  let dependencies: HueTransitionsPlatformDependencies;
  let didFinishLaunching: () => void;
  let shutdown: () => void;
  let config: PlatformConfig;

  beforeEach(() => {
    jest.useFakeTimers();
    log = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
    hueApi = {
      getScenes: jest.fn<() => Promise<HueScene[]>>().mockResolvedValue([createScene()]),
      getLights: jest.fn<() => Promise<HueLight[]>>(),
      getScene: jest.fn<(sceneId: string) => Promise<HueScene>>(),
      recallScene: jest.fn<(sceneId: string, transitionMs?: number) => Promise<void>>(),
      testConnection: jest.fn<() => Promise<boolean>>(),
    };
    dependencies = {
      createApiClient: jest.fn(() => hueApi),
      discoverBridges: jest.fn<DiscoverBridges>().mockResolvedValue([]),
    };
    api = {
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
          generate: jest.fn((value: string) => `uuid-${value}`),
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
          didFinishLaunching = callback;
        }
        if (event === 'shutdown') {
          shutdown = callback;
        }
        return api;
      }),
      platformAccessory: FakeAccessory,
      registerPlatformAccessories: jest.fn(),
      unregisterPlatformAccessories: jest.fn(),
      updatePlatformAccessories: jest.fn(),
    } as unknown as API;
    config = {
      platform: 'HueTransitions',
      name: 'Hue Transitions',
      bridgeIp: '192.168.1.10',
      bridgeId: '001788FFFE123456',
      apiKey: 'key',
      scenes: [{
        id: 'scene-1',
        name: 'Morning',
        transitionDuration: 30,
      }],
      pollingInterval: 60000,
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createPlatform(overrides: Partial<PlatformConfig> = {}): HueTransitionsPlatform {
    return new HueTransitionsPlatform(
      log,
      { ...config, ...overrides },
      api as API,
      dependencies,
    );
  }

  it('normalizes configuration and rejects invalid scene values', () => {
    const platform = createPlatform({
      bridgeIp: 'not-an-ip',
      bridgeId: 'not-an-id',
      pollingInterval: 'oops',
      scenes: [
        { id: 'valid', name: 'Valid', transitionDuration: 1 },
        { id: 'valid', name: 'Duplicate', transitionDuration: 2 },
        { id: 'negative', name: 'Negative', transitionDuration: -1 },
        { id: 'string', name: 'String', transitionDuration: '30' },
        { id: 'large', name: 'Large', transitionDuration: 61 },
      ],
    });

    expect(platform.config.bridgeIp).toBeUndefined();
    expect(platform.config.bridgeId).toBeUndefined();
    expect(platform.config.pollingInterval).toBe(60000);
    expect(platform.config.scenes).toEqual([
      { id: 'valid', name: 'Valid', transitionDuration: 1 },
    ]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('finite integer'));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('duplicate'));
  });

  it('handles a non-array scene configuration and missing optional names', () => {
    const platform = createPlatform({
      platform: undefined,
      name: undefined,
      scenes: 'not-an-array',
    });

    expect(platform.config.platform).toBe('HueTransitions');
    expect(platform.config.name).toBeUndefined();
    expect(platform.config.scenes).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(
      'Ignoring scenes configuration because it is not an array',
    );
  });

  it('clamps finite polling intervals and warns about insecure TLS', () => {
    const platform = createPlatform({
      pollingInterval: 999999,
      allowInsecureTls: true,
    });

    expect(platform.config.pollingInterval).toBe(300000);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('outside the supported range'));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TLS certificate verification'));
  });

  it('attaches handlers to configured cached accessories immediately', () => {
    const platform = createPlatform();
    const accessory = new FakeAccessory(
      'Morning',
      'uuid-@jay-d-tyler/homebridge-hue-transitions-scene-1',
    ) as unknown as PlatformAccessory;
    accessory.context.sceneId = 'scene-1';

    platform.configureAccessory(accessory);

    expect(platform.accessories.get(accessory.UUID)).toBe(accessory);
    expect(accessory.getService('Switch')?.getCharacteristic).toHaveBeenCalled();
    expect(dependencies.createApiClient).not.toHaveBeenCalled();
  });

  it('removes every cached accessory when configuration is emptied', () => {
    const platform = createPlatform({ scenes: [] });
    const accessory = new FakeAccessory('Old', 'cached') as unknown as PlatformAccessory;
    accessory.context.sceneId = 'old-scene';
    platform.configureAccessory(accessory);

    didFinishLaunching();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [accessory],
    );
    expect(platform.accessories.size).toBe(0);
  });

  it('keeps configured cached accessories through a bridge outage and retries', async () => {
    hueApi.getScenes
      .mockRejectedValueOnce(new Error('bridge offline'))
      .mockResolvedValueOnce([createScene()]);
    const platform = createPlatform();
    const accessory = new FakeAccessory(
      'Morning',
      'uuid-@jay-d-tyler/homebridge-hue-transitions-scene-1',
    ) as unknown as PlatformAccessory;
    accessory.context.sceneId = 'scene-1';
    platform.configureAccessory(accessory);

    didFinishLaunching();
    await settle();

    expect(api.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(platform.accessories.size).toBe(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to synchronize'),
      expect.any(Error),
    );

    await jest.advanceTimersByTimeAsync(60000);
    await settle();

    expect(hueApi.getScenes).toHaveBeenCalledTimes(2);
    expect(platform.accessories.size).toBe(1);
  });

  it('removes a cached scene after a successful bridge snapshot no longer contains it', async () => {
    hueApi.getScenes.mockResolvedValue([]);
    const platform = createPlatform();
    const accessory = new FakeAccessory('Morning', 'cached') as unknown as PlatformAccessory;
    accessory.context.sceneId = 'scene-1';
    platform.configureAccessory(accessory);

    didFinishLaunching();
    await settle();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [accessory],
    );
  });

  it('registers a new configured scene without redundant cache writes', async () => {
    const platform = createPlatform();
    didFinishLaunching();
    await settle();

    expect(api.registerPlatformAccessories).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [expect.objectContaining({ displayName: 'Morning' })],
    );
    expect(platform.accessories.size).toBe(1);

    await jest.advanceTimersByTimeAsync(60000);
    await settle();
    expect(api.updatePlatformAccessories).not.toHaveBeenCalled();
  });

  it('logs debug refreshes after the first successful synchronization', async () => {
    const platform = createPlatform({ debug: true });
    didFinishLaunching();
    await settle();

    await jest.advanceTimersByTimeAsync(60000);
    await settle();

    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Refreshed'));
    shutdown();
    expect(platform.accessories.size).toBe(1);
  });

  it('auto-discovers an IP and pins the discovered bridge ID', async () => {
    dependencies.discoverBridges = jest.fn<DiscoverBridges>().mockResolvedValue([{
      id: '001788fffeabcdef',
      internalipaddress: '192.168.1.20',
    }]);
    const platform = createPlatform({ bridgeIp: undefined, bridgeId: undefined });

    didFinishLaunching();
    await settle();

    expect(platform.config.bridgeIp).toBe('192.168.1.20');
    expect(platform.config.bridgeId).toBe('001788FFFEABCDEF');
    expect(dependencies.createApiClient).toHaveBeenCalledWith(
      '192.168.1.20',
      'key',
      expect.objectContaining({ bridgeId: '001788FFFEABCDEF' }),
    );
  });

  it('retries discovery when no bridge is initially found', async () => {
    const discover = jest.fn<DiscoverBridges>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: '001788FFFEABCDEF',
        internalipaddress: '192.168.1.20',
      }]);
    dependencies.discoverBridges = discover;
    createPlatform({ bridgeIp: undefined, bridgeId: undefined });

    didFinishLaunching();
    await settle();
    expect(dependencies.createApiClient).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(60000);
    await settle();
    expect(dependencies.createApiClient).toHaveBeenCalled();
  });

  it('warns and selects the first of multiple discovered bridges', async () => {
    dependencies.discoverBridges = jest.fn<DiscoverBridges>().mockResolvedValue([
      { id: '001788FFFE111111', internalipaddress: '192.168.1.11' },
      { id: '001788FFFE222222', internalipaddress: '192.168.1.22' },
    ]);
    createPlatform({ bridgeIp: undefined, bridgeId: undefined });

    didFinishLaunching();
    await settle();

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('found 2 bridges'));
    expect(dependencies.createApiClient).toHaveBeenCalledWith(
      '192.168.1.11',
      'key',
      expect.any(Object),
    );
  });

  it('does not poll without an API key but still removes stale cache entries', () => {
    const platform = createPlatform({ apiKey: undefined });
    const stale = new FakeAccessory('Stale', 'stale') as unknown as PlatformAccessory;
    stale.context.sceneId = 'not-configured';
    platform.configureAccessory(stale);

    didFinishLaunching();

    expect(api.unregisterPlatformAccessories).toHaveBeenCalled();
    expect(dependencies.createApiClient).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(log.warn).toHaveBeenCalledWith('API key not configured');
  });

  it('cleans up polling and accessory timers on shutdown', async () => {
    const platform = createPlatform();
    const accessory = new FakeAccessory('Morning', 'cached') as unknown as PlatformAccessory;
    accessory.context.sceneId = 'scene-1';
    platform.configureAccessory(accessory);
    didFinishLaunching();
    await settle();
    expect(jest.getTimerCount()).toBe(1);

    shutdown();

    expect(jest.getTimerCount()).toBe(0);
    expect(log.debug).toHaveBeenCalledWith('Cleanup completed');
  });
});
