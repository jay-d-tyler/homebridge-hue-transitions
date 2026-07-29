import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { AxiosError, AxiosInstance } from 'axios';
import type { PeerCertificate } from 'node:tls';
import type {
  HueAuthResponse,
  HueResourceListResponse,
  HueScene,
  HueSingleResourceResponse,
} from '../src/types.js';

const axiosCreate = jest.fn<(config: unknown) => AxiosInstance>();
const axiosGet = jest.fn<(url: string, config?: unknown) => Promise<{ data: unknown }>>();
const axiosPost = jest.fn<
  (url: string, data: unknown, config?: unknown) => Promise<{ data: unknown }>
>();
const axiosIsAxiosError = jest.fn<(error: unknown) => boolean>();
const axiosRetry = Object.assign(
  jest.fn(),
  {
    exponentialDelay: jest.fn((retryCount: number) => retryCount * 100),
    isNetworkError: jest.fn(() => true),
  },
);

jest.unstable_mockModule('axios', () => ({
  default: {
    create: axiosCreate,
    get: axiosGet,
    post: axiosPost,
    isAxiosError: axiosIsAxiosError,
  },
}));

jest.unstable_mockModule('axios-retry', () => ({
  default: axiosRetry,
}));

const {
  HueApiClient,
  createHueHttpsAgent,
  normalizeBridgeId,
} = await import('../src/api.js');

function createScene(overrides: Partial<HueScene> = {}): HueScene {
  return {
    id: 'scene-1',
    type: 'scene',
    metadata: { name: 'Test Scene' },
    group: { rid: 'room-1', rtype: 'room' },
    actions: [],
    status: { active: 'inactive' },
    ...overrides,
  };
}

function createAxiosInstance(): jest.Mocked<AxiosInstance> {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    request: jest.fn(),
    head: jest.fn(),
    options: jest.fn(),
    postForm: jest.fn(),
    putForm: jest.fn(),
    patchForm: jest.fn(),
    getUri: jest.fn(),
    defaults: {},
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() },
    },
  } as unknown as jest.Mocked<AxiosInstance>;
}

describe('HueApiClient TLS', () => {
  it('normalizes bridge IDs', () => {
    expect(normalizeBridgeId('00:17:88-fffe123456')).toBe('001788FFFE123456');
  });

  it('verifies certificates by default', () => {
    const agent = createHueHttpsAgent({ bridgeId: '001788FFFE123456' });
    expect(agent.options.rejectUnauthorized).toBe(true);
    expect(agent.options.servername).toBe('001788FFFE123456');
    expect(agent.options.ca).toContain('BEGIN CERTIFICATE');
  });

  it('rejects a certificate for a different bridge', () => {
    const agent = createHueHttpsAgent({ bridgeId: '001788FFFE123456' });
    const checkServerIdentity = agent.options.checkServerIdentity;
    const certificate = {
      subject: { CN: '001788FFFE654321' },
    } as unknown as PeerCertificate;

    expect(checkServerIdentity?.('001788FFFE123456', certificate)?.message)
      .toContain('identity mismatch');
  });

  it('rejects a certificate with a malformed bridge identity', () => {
    const agent = createHueHttpsAgent();
    const certificate = {
      subject: { CN: 'not-a-hue-bridge' },
    } as unknown as PeerCertificate;

    expect(agent.options.checkServerIdentity?.('bridge', certificate)?.message)
      .toContain('invalid common name');
  });

  it('accepts a valid certificate from the expected bridge', () => {
    const agent = createHueHttpsAgent({ bridgeId: '001788FFFE123456' });
    const certificate = {
      subject: { CN: '001788FFFE123456' },
    } as unknown as PeerCertificate;

    expect(agent.options.checkServerIdentity?.('bridge', certificate)).toBeUndefined();
  });

  it('supports an explicit legacy insecure mode', () => {
    const agent = createHueHttpsAgent({ allowInsecureTls: true });
    expect(agent.options.rejectUnauthorized).toBe(false);
    expect(agent.options.ca).toBeUndefined();
  });

  it('configures retries for safe reads only', () => {
    const instance = createAxiosInstance();
    axiosCreate.mockReturnValue(instance);

    new HueApiClient('192.168.1.10', 'key', { bridgeId: '001788FFFE123456' });

    expect(axiosCreate).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://192.168.1.10/clip/v2',
      headers: { 'hue-application-key': 'key' },
    }));
    expect(axiosRetry).toHaveBeenCalledWith(instance, expect.objectContaining({ retries: 3 }));

    const retryCall = axiosRetry.mock.calls[0] as unknown as [
      AxiosInstance,
      { retryCondition: (error: Partial<AxiosError>) => boolean },
    ];
    const retryCondition = retryCall[1].retryCondition;
    expect(retryCondition({ config: { method: 'get' } as AxiosError['config'] })).toBe(true);
    expect(retryCondition({ config: { method: 'put' } as AxiosError['config'] })).toBe(false);

    axiosRetry.isNetworkError.mockReturnValueOnce(false);
    expect(retryCondition({
      config: { method: 'get' } as AxiosError['config'],
      response: { status: 503 } as AxiosError['response'],
    })).toBe(true);
  });
});

describe('HueApiClient static operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axiosIsAxiosError.mockReturnValue(false);
  });

  it('discovers bridges', async () => {
    const bridges = [{ id: '001788FFFE123456', internalipaddress: '192.168.1.10' }];
    axiosGet.mockResolvedValue({ data: bridges });

    await expect(HueApiClient.discoverBridges()).resolves.toEqual(bridges);
    expect(axiosGet).toHaveBeenCalledWith(
      'https://discovery.meethue.com',
      { timeout: 10000 },
    );
  });

  it('adds context to Axios discovery failures', async () => {
    const error = new Error('network down');
    axiosGet.mockRejectedValue(error);
    axiosIsAxiosError.mockReturnValue(true);

    await expect(HueApiClient.discoverBridges()).rejects
      .toThrow('Failed to discover Hue bridges: network down');
  });

  it('preserves non-Axios discovery failures', async () => {
    const error = new Error('unexpected');
    axiosGet.mockRejectedValue(error);

    await expect(HueApiClient.discoverBridges()).rejects.toBe(error);
  });

  it('creates an API key from the Hue v1 response shape', async () => {
    const response: HueAuthResponse[] = [{ success: { username: 'new-key' } }];
    axiosPost.mockResolvedValue({ data: response });

    await expect(
      HueApiClient.createApiKey(
        '192.168.1.10',
        'homebridge-hue-transitions',
        'homebridge',
        { allowInsecureTls: true },
      ),
    ).resolves.toBe('new-key');
  });

  it('uses secure TLS defaults when creating an API key', async () => {
    axiosPost.mockResolvedValue({ data: [{ success: { username: 'new-key' } }] });

    await HueApiClient.createApiKey('192.168.1.10', 'app', 'device');

    expect(axiosPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        httpsAgent: expect.objectContaining({
          options: expect.objectContaining({ rejectUnauthorized: true }),
        }),
      }),
    );
  });

  it('reports link-button errors', async () => {
    const response: HueAuthResponse[] = [{
      error: { type: 101, address: '', description: 'link button not pressed' },
    }];
    axiosPost.mockResolvedValue({ data: response });

    await expect(
      HueApiClient.createApiKey('192.168.1.10', 'app', 'device', { allowInsecureTls: true }),
    ).rejects.toThrow('link button not pressed');
  });

  it('rejects an empty API-key response', async () => {
    axiosPost.mockResolvedValue({ data: [] });

    await expect(
      HueApiClient.createApiKey('192.168.1.10', 'app', 'device', { allowInsecureTls: true }),
    ).rejects.toThrow('Unexpected response format');
  });

  it('adds context to Axios API-key failures', async () => {
    axiosPost.mockRejectedValue(new Error('connection reset'));
    axiosIsAxiosError.mockReturnValue(true);

    await expect(
      HueApiClient.createApiKey('192.168.1.10', 'app', 'device', { allowInsecureTls: true }),
    ).rejects.toThrow('Failed to create API key: connection reset');
  });
});

describe('HueApiClient resource operations', () => {
  let axiosInstance: jest.Mocked<AxiosInstance>;
  let client: InstanceType<typeof HueApiClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    axiosIsAxiosError.mockReturnValue(false);
    axiosInstance = createAxiosInstance();
    client = new HueApiClient('192.168.1.10', 'key', {}, axiosInstance);
  });

  it('gets scenes and lights', async () => {
    const sceneResponse: HueResourceListResponse<HueScene> = {
      errors: [],
      data: [createScene()],
    };
    axiosInstance.get
      .mockResolvedValueOnce({ data: sceneResponse })
      .mockResolvedValueOnce({ data: { errors: [], data: [{ id: 'light-1' }] } });

    await expect(client.getScenes()).resolves.toEqual(sceneResponse.data);
    await expect(client.getLights()).resolves.toEqual([{ id: 'light-1' }]);
  });

  it('reports Hue response errors', async () => {
    axiosInstance.get.mockResolvedValue({
      data: { errors: [{ description: 'unauthorized' }], data: [] },
    });

    await expect(client.getScenes()).rejects.toThrow('Hue API errors: unauthorized');
  });

  it('reports Hue errors returned by light and scene resources', async () => {
    axiosInstance.get
      .mockResolvedValueOnce({
        data: { errors: [{ description: 'light unavailable' }], data: [] },
      })
      .mockResolvedValueOnce({
        data: { errors: [{ description: 'scene unavailable' }], data: [] },
      });

    await expect(client.getLights()).rejects.toThrow('light unavailable');
    await expect(client.getScene('scene-1')).rejects.toThrow('scene unavailable');
  });

  it('gets a scene using an encoded resource ID', async () => {
    const response: HueSingleResourceResponse<HueScene> = {
      errors: [],
      data: [createScene()],
    };
    axiosInstance.get.mockResolvedValue({ data: response });

    await expect(client.getScene('scene/one')).resolves.toEqual(response.data[0]);
    expect(axiosInstance.get).toHaveBeenCalledWith('/resource/scene/scene%2Fone');
  });

  it('reports a missing scene', async () => {
    axiosInstance.get.mockResolvedValue({ data: { errors: [], data: [] } });
    await expect(client.getScene('missing')).rejects.toThrow('Scene missing not found');
  });

  it('recalls a scene with a duration', async () => {
    axiosInstance.put.mockResolvedValue({ data: { errors: [], data: [] } });

    await client.recallScene('scene/one', 1_800_000);

    expect(axiosInstance.put).toHaveBeenCalledWith(
      '/resource/scene/scene%2Fone',
      { recall: { action: 'active', duration: 1_800_000 } },
    );
  });

  it('omits non-positive durations and reports Hue recall errors', async () => {
    axiosInstance.put
      .mockResolvedValueOnce({ data: { errors: [], data: [] } })
      .mockResolvedValueOnce({
        data: { errors: [{ description: 'scene unavailable' }], data: [] },
      });

    await client.recallScene('scene-1', 0);
    expect(axiosInstance.put).toHaveBeenNthCalledWith(
      1,
      '/resource/scene/scene-1',
      { recall: { action: 'active' } },
    );
    await expect(client.recallScene('scene-1')).rejects.toThrow('scene unavailable');
  });

  it.each([
    [401, 'Authentication failed'],
    [404, 'Resource not found'],
    [429, 'Rate limit exceeded'],
    [500, 'Hue bridge server error'],
  ])('maps HTTP %s errors', async (status, expectedMessage) => {
    const error = Object.assign(new Error('request failed'), {
      response: { status },
      isAxiosError: true,
    });
    axiosInstance.get.mockRejectedValue(error);
    axiosIsAxiosError.mockReturnValue(true);

    await expect(client.getScenes()).rejects.toThrow(expectedMessage);
  });

  it.each([
    ['ECONNREFUSED', 'Cannot connect'],
    ['ETIMEDOUT', 'timed out'],
    ['OTHER', 'Hue API error: failed'],
  ])('maps transport error %s', async (code, expectedMessage) => {
    const error = Object.assign(new Error('failed'), { code, isAxiosError: true });
    axiosInstance.get.mockRejectedValue(error);
    axiosIsAxiosError.mockReturnValue(true);

    await expect(client.getScenes()).rejects.toThrow(expectedMessage);
  });

  it('tests connectivity without leaking failures', async () => {
    axiosInstance.get
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error('offline'));

    await expect(client.testConnection()).resolves.toBe(true);
    await expect(client.testConnection()).resolves.toBe(false);
  });
});
