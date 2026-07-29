import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { isIP } from 'node:net';
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  POLLING_CONFIG,
  TRANSITION_CONFIG,
} from './settings.js';
import {
  HueApiClient,
  normalizeBridgeId,
  type HueApi,
} from './api.js';
import { HueSceneAccessory } from './sceneAccessory.js';
import type {
  HueTransitionsPlatformConfig,
  SceneConfig,
} from './types.js';

export interface HueTransitionsPlatformDependencies {
  createApiClient(
    bridgeIp: string,
    apiKey: string,
    options: { bridgeId?: string; allowInsecureTls?: boolean },
  ): HueApi;
  discoverBridges: typeof HueApiClient.discoverBridges;
}

const DEFAULT_DEPENDENCIES: HueTransitionsPlatformDependencies = {
  createApiClient: (bridgeIp, apiKey, options) => new HueApiClient(bridgeIp, apiKey, options),
  discoverBridges: () => HueApiClient.discoverBridges(),
};

const HUE_BRIDGE_ID_PATTERN = /^[0-9A-F]{16}$/;

/**
 * Manages configured Hue scene triggers and keeps Homebridge's accessory cache
 * reconciled with both configuration and the bridge.
 */
export class HueTransitionsPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly config: HueTransitionsPlatformConfig;

  public readonly accessories = new Map<string, PlatformAccessory>();
  private readonly accessoryInstances = new Map<string, HueSceneAccessory>();
  private readonly dependencies: HueTransitionsPlatformDependencies;

  private apiClient: HueApi | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isSynchronizing = false;
  private hasConnected = false;
  private readonly bridgeWasAutoDiscovered: boolean;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
    dependencies: HueTransitionsPlatformDependencies = DEFAULT_DEPENDENCIES,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.dependencies = dependencies;
    this.config = this.normalizeConfig(config);
    this.bridgeWasAutoDiscovered = !this.config.bridgeIp;

    this.log.debug('Finished initializing platform:', this.config.name ?? PLATFORM_NAME);

    if (this.config.allowInsecureTls === true) {
      this.log.warn(
        'TLS certificate verification is disabled. Use allowInsecureTls only for a legacy self-signed Hue bridge.',
      );
    }

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.handleDidFinishLaunching();
    });

    this.api.on('shutdown', () => {
      this.log.debug('Shutting down platform');
      this.cleanup();
    });
  }

  /**
   * Restore a cached accessory and immediately attach its HomeKit handlers when
   * it is still configured. The handler uses a client provider so it remains
   * valid while the bridge connection is being established or recovered.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);

    const sceneId = this.getAccessorySceneId(accessory);
    const sceneConfig = this.configuredScenes.find(scene => scene.id === sceneId);

    if (sceneConfig !== undefined) {
      this.initializeAccessory(accessory, sceneConfig);
    }
  }

  private handleDidFinishLaunching(): void {
    const configuredIds = new Set(this.configuredScenes.map(scene => scene.id));
    this.removeAccessoriesNotIn(configuredIds, 'no longer configured');

    if (!this.config.apiKey) {
      this.log.warn('API key not configured');
      this.log.info('To create an API key:');
      this.log.info('1. Press the link button on your Hue bridge');
      this.log.info('2. Run the following command within 30 seconds:');
      this.log.info(`   curl -k -X POST https://${this.config.bridgeIp ?? 'YOUR_BRIDGE_IP'}/api ` +
        `-d '{"devicetype":"homebridge-hue-transitions#homebridge"}'`);
      this.log.info('3. Copy the "username" value into the apiKey setting');
      return;
    }

    if (this.configuredScenes.length === 0) {
      this.log.warn('No valid scenes configured. Available Hue scenes will be listed below.');
      void this.synchronizeScenes();
      return;
    }

    this.startPolling();
    void this.synchronizeScenes();
  }

  private get configuredScenes(): SceneConfig[] {
    return this.config.scenes as SceneConfig[];
  }

  /**
   * Reconcile configured scenes with a successfully fetched bridge snapshot.
   * Connection failures deliberately leave configured cached accessories in
   * place; the next poll retries without requiring a Homebridge restart.
   */
  private async synchronizeScenes(): Promise<void> {
    if (this.isSynchronizing) {
      return;
    }

    this.isSynchronizing = true;

    try {
      const client = await this.ensureApiClient();
      if (client === null) {
        return;
      }

      const allScenes = await client.getScenes();
      const bridgeSceneIds = new Set(allScenes.map(scene => scene.id));
      const matchedSceneIds = new Set<string>();

      if (!this.hasConnected) {
        this.log.info(`Successfully connected to Hue bridge; found ${allScenes.length} scene(s)`);
        this.hasConnected = true;
      } else if (this.config.debug) {
        this.log.debug(`Refreshed ${allScenes.length} scene(s) from Hue bridge`);
      }

      if (this.configuredScenes.length === 0) {
        this.log.info('Available scenes:');
        for (const scene of allScenes) {
          this.log.info(`  - "${scene.metadata.name}" (ID: ${scene.id})`);
        }
        return;
      }

      for (const sceneConfig of this.configuredScenes) {
        if (!bridgeSceneIds.has(sceneConfig.id)) {
          this.log.warn(
            `Configured scene "${sceneConfig.name}" (${sceneConfig.id}) was not found on the bridge`,
          );
          continue;
        }

        matchedSceneIds.add(sceneConfig.id);
        this.registerScene(sceneConfig);
      }

      this.removeAccessoriesNotIn(matchedSceneIds, 'not found on the Hue bridge');
      this.log.info(`Successfully initialized ${this.accessoryInstances.size} scene trigger(s)`);
    } catch (error) {
      this.hasConnected = false;
      this.log.error('Failed to synchronize scenes with the Hue bridge:', error);

      if (this.bridgeWasAutoDiscovered) {
        this.apiClient = null;
        this.config.bridgeIp = undefined;
        this.config.bridgeId = undefined;
      }
    } finally {
      this.isSynchronizing = false;
    }
  }

  private async ensureApiClient(): Promise<HueApi | null> {
    if (this.apiClient !== null) {
      return this.apiClient;
    }

    if (!this.config.bridgeIp) {
      this.log.info('Bridge IP not configured - attempting auto-discovery...');
      const bridges = await this.dependencies.discoverBridges();

      if (bridges.length === 0) {
        this.log.error('Auto-discovery found no Hue bridges; it will retry on the next refresh');
        return null;
      }

      if (bridges.length > 1) {
        this.log.warn(
          `Auto-discovery found ${bridges.length} bridges; using ${bridges[0].internalipaddress}. ` +
          'Configure bridgeIp and bridgeId to select a specific bridge.',
        );
      }

      this.config.bridgeIp = bridges[0].internalipaddress;
      this.config.bridgeId = normalizeBridgeId(bridges[0].id);
      this.log.info(`Discovered Hue bridge ${this.config.bridgeId} at ${this.config.bridgeIp}`);
    }

    if (!this.config.apiKey) {
      return null;
    }

    this.apiClient = this.dependencies.createApiClient(
      this.config.bridgeIp,
      this.config.apiKey,
      {
        bridgeId: this.config.bridgeId,
        allowInsecureTls: this.config.allowInsecureTls,
      },
    );

    return this.apiClient;
  }

  private registerScene(sceneConfig: SceneConfig): void {
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}-${sceneConfig.id}`);
    let accessory = this.accessories.get(uuid);

    if (accessory !== undefined) {
      const storedConfig: unknown = accessory.context.sceneConfig;
      const contextChanged = accessory.context.sceneId !== sceneConfig.id ||
        !this.sceneConfigsMatch(storedConfig, sceneConfig);

      if (contextChanged) {
        accessory.context.sceneId = sceneConfig.id;
        accessory.context.sceneConfig = sceneConfig;
        this.api.updatePlatformAccessories([accessory]);
      }

      this.initializeAccessory(accessory, sceneConfig);
      return;
    }

    this.log.info('Adding new scene trigger:', sceneConfig.name);
    accessory = new this.api.platformAccessory(sceneConfig.name, uuid);
    accessory.context.sceneId = sceneConfig.id;
    accessory.context.sceneConfig = sceneConfig;

    this.accessories.set(uuid, accessory);
    this.initializeAccessory(accessory, sceneConfig);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  private initializeAccessory(accessory: PlatformAccessory, sceneConfig: SceneConfig): void {
    if (this.accessoryInstances.has(accessory.UUID)) {
      return;
    }

    const instance = new HueSceneAccessory(
      this,
      accessory,
      sceneConfig,
      () => this.apiClient,
    );
    this.accessoryInstances.set(accessory.UUID, instance);
  }

  private removeAccessoriesNotIn(retainedSceneIds: Set<string>, reason: string): void {
    const staleAccessories: PlatformAccessory[] = [];

    for (const [uuid, accessory] of this.accessories) {
      const sceneId = this.getAccessorySceneId(accessory);
      const expectedUuid = sceneId === undefined
        ? undefined
        : this.api.hap.uuid.generate(`${PLUGIN_NAME}-${sceneId}`);

      if (
        sceneId !== undefined &&
        retainedSceneIds.has(sceneId) &&
        accessory.UUID === expectedUuid
      ) {
        continue;
      }

      this.log.info(`Removing accessory "${accessory.displayName}": ${reason}`);
      this.accessoryInstances.get(uuid)?.destroy();
      this.accessoryInstances.delete(uuid);
      this.accessories.delete(uuid);
      staleAccessories.push(accessory);
    }

    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    }
  }

  private getAccessorySceneId(accessory: PlatformAccessory): string | undefined {
    const sceneId: unknown = accessory.context.sceneId;
    return typeof sceneId === 'string' ? sceneId : undefined;
  }

  private sceneConfigsMatch(value: unknown, expected: SceneConfig): boolean {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const stored = value as Partial<SceneConfig>;
    return stored.id === expected.id &&
      stored.name === expected.name &&
      stored.transitionDuration === expected.transitionDuration;
  }

  private startPolling(): void {
    if (this.pollingInterval !== null) {
      return;
    }

    const interval = this.config.pollingInterval ?? POLLING_CONFIG.DEFAULT_INTERVAL;
    this.log.info(`Refreshing Hue scenes every ${interval / 1000} seconds`);

    this.pollingInterval = setInterval(() => {
      void this.synchronizeScenes();
    }, interval);
  }

  private stopPolling(): void {
    if (this.pollingInterval !== null) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private normalizeConfig(config: PlatformConfig): HueTransitionsPlatformConfig {
    const raw = config as Partial<HueTransitionsPlatformConfig>;
    const rawScenes: unknown = config.scenes;
    const scenes: SceneConfig[] = [];
    const seenSceneIds = new Set<string>();

    if (Array.isArray(rawScenes)) {
      (rawScenes as Partial<SceneConfig>[]).forEach((scene, index) => {
        const id = typeof scene.id === 'string' ? scene.id.trim() : '';
        const name = typeof scene.name === 'string' ? scene.name.trim() : '';
        const duration = scene.transitionDuration;
        const durationIsValid = typeof duration === 'number' &&
          Number.isFinite(duration) &&
          Number.isInteger(duration) &&
          duration >= TRANSITION_CONFIG.MIN_DURATION &&
          duration <= TRANSITION_CONFIG.MAX_DURATION;

        if (!id || !name || !durationIsValid) {
          this.log.warn(
            `Ignoring invalid scene configuration at index ${index}; ` +
            `id and name are required and transitionDuration must be an integer from ` +
            `${TRANSITION_CONFIG.MIN_DURATION} to ${TRANSITION_CONFIG.MAX_DURATION}`,
          );
          return;
        }

        if (seenSceneIds.has(id)) {
          this.log.warn(`Ignoring duplicate scene configuration for ${id}`);
          return;
        }

        seenSceneIds.add(id);
        scenes.push({ id, name, transitionDuration: duration });
      });
    } else if (rawScenes !== undefined) {
      this.log.warn('Ignoring scenes configuration because it is not an array');
    }

    let pollingInterval = POLLING_CONFIG.DEFAULT_INTERVAL;
    if (
      typeof raw.pollingInterval === 'number' &&
      Number.isFinite(raw.pollingInterval) &&
      Number.isInteger(raw.pollingInterval)
    ) {
      pollingInterval = Math.max(
        POLLING_CONFIG.MIN_INTERVAL,
        Math.min(POLLING_CONFIG.MAX_INTERVAL, raw.pollingInterval),
      );

      if (pollingInterval !== raw.pollingInterval) {
        this.log.warn(
          `Polling interval ${raw.pollingInterval}ms is outside the supported range; ` +
          `using ${pollingInterval}ms`,
        );
      }
    } else if (raw.pollingInterval !== undefined) {
      this.log.warn(
        `Polling interval must be a finite integer; using ${POLLING_CONFIG.DEFAULT_INTERVAL}ms`,
      );
    }

    let bridgeIp: string | undefined;
    if (typeof raw.bridgeIp === 'string' && raw.bridgeIp.trim() !== '') {
      const candidate = raw.bridgeIp.trim();
      if (isIP(candidate) === 4) {
        bridgeIp = candidate;
      } else {
        this.log.warn(`Ignoring invalid IPv4 bridgeIp value "${candidate}"`);
      }
    }

    let bridgeId: string | undefined;
    if (typeof raw.bridgeId === 'string' && raw.bridgeId.trim() !== '') {
      const candidate = normalizeBridgeId(raw.bridgeId);
      if (HUE_BRIDGE_ID_PATTERN.test(candidate)) {
        bridgeId = candidate;
      } else {
        this.log.warn(`Ignoring invalid Hue bridgeId value "${raw.bridgeId}"`);
      }
    }

    const apiKey = typeof raw.apiKey === 'string' && raw.apiKey.trim() !== ''
      ? raw.apiKey.trim()
      : undefined;

    return {
      platform: typeof raw.platform === 'string' ? raw.platform : PLATFORM_NAME,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      bridgeIp,
      bridgeId,
      apiKey,
      scenes,
      pollingInterval,
      debug: raw.debug === true,
      allowInsecureTls: raw.allowInsecureTls === true,
    };
  }

  private cleanup(): void {
    this.stopPolling();

    for (const instance of this.accessoryInstances.values()) {
      instance.destroy();
    }

    this.accessoryInstances.clear();
    this.log.debug('Cleanup completed');
  }
}
