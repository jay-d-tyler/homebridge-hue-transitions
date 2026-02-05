import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { EventEmitter } from 'events';
import { PLATFORM_NAME, PLUGIN_NAME, POLLING_CONFIG } from './settings.js';
import { HueApiClient } from './api.js';
import { HueSceneAccessory } from './sceneAccessory.js';
import type { HueTransitionsPlatformConfig, SceneConfig, HueScene } from './types.js';

/**
 * Hue Transitions Platform
 * Manages Hue scene accessories with configurable transition durations
 */
export class HueTransitionsPlatform extends EventEmitter implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly config: HueTransitionsPlatformConfig;

  // Accessory management
  public readonly accessories = new Map<string, PlatformAccessory>();
  private readonly accessoryInstances = new Map<string, HueSceneAccessory>();

  // API client
  private apiClient: HueApiClient | null = null;

  // Polling
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    super();

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.config = config as HueTransitionsPlatformConfig;

    // Validate configuration
    if (!Array.isArray(this.config.scenes)) {
      this.config.scenes = [];
    }

    this.log.debug('Finished initializing platform:', this.config.name ?? PLATFORM_NAME);

    // Register event handlers
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      void this.discoverAndRegisterScenes();
    });

    this.api.on('shutdown', () => {
      this.log.debug('Shutting down platform');
      this.cleanup();
    });
  }

  /**
   * Restore cached accessories from disk
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Discover and register configured scenes
   */
  private async discoverAndRegisterScenes(): Promise<void> {
    try {
      // Initialize API client
      await this.initializeApiClient();

      if (!this.apiClient) {
        this.log.error('Failed to initialize API client - cannot discover scenes');
        return;
      }

      // Get all available scenes from the bridge
      const allScenes = await this.apiClient.getScenes();
      this.log.info(`Found ${allScenes.length} scenes on Hue bridge`);

      // Filter out any invalid scene configs (empty or incomplete entries)
      const validScenes = this.config.scenes.filter(s => s && s.id && s.name);

      // Check if any valid scenes are configured
      if (validScenes.length === 0) {
        this.log.warn('No scenes configured. Please add scenes using the Scene Selector or manually in the plugin configuration.');
        this.log.info('Available scenes:');
        for (const scene of allScenes) {
          this.log.info(`  - "${scene.metadata.name}" (ID: ${scene.id})`);
        }
        return;
      }

      // Register configured scenes
      const configuredSceneIds = new Set(validScenes.map(s => s.id));

      for (const sceneConfig of validScenes) {

        // Verify scene exists on bridge
        const sceneExists = allScenes.some(s => s.id === sceneConfig.id);

        if (!sceneExists) {
          this.log.warn(`Configured scene "${sceneConfig.name}" (${sceneConfig.id}) not found on bridge - skipping`);
          continue;
        }

        this.registerScene(sceneConfig);
      }

      // Remove stale accessories (scenes that are no longer configured)
      const staleAccessories: PlatformAccessory[] = [];

      for (const [uuid, accessory] of this.accessories) {
        const sceneId = accessory.context.sceneId as string;

        if (!configuredSceneIds.has(sceneId)) {
          this.log.info(`Removing stale accessory: ${accessory.displayName}`);
          staleAccessories.push(accessory);
          this.accessories.delete(uuid);
          this.accessoryInstances.delete(uuid);
        }
      }

      if (staleAccessories.length > 0) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
      }

      // Start polling for scene status updates
      this.startPolling();

      this.log.info(`Successfully initialized ${this.accessoryInstances.size} scene(s)`);
    } catch (error) {
      this.log.error('Failed to discover and register scenes:', error);
    }
  }

  /**
   * Initialize the Hue API client
   */
  private async initializeApiClient(): Promise<void> {
    try {
      // Check if bridge IP needs auto-discovery
      if (!this.config.bridgeIp) {
        this.log.info('Bridge IP not configured - attempting auto-discovery...');
        const bridges = await HueApiClient.discoverBridges();

        if (bridges.length === 0) {
          this.log.error('✗ Auto-discovery failed: No Hue bridges found on network');
          this.log.error('Please manually configure your bridge IP address in the plugin settings');
          return;
        }

        this.config.bridgeIp = bridges[0].internalipaddress;
        this.log.info(`✓ Auto-discovery successful! Found Hue bridge at ${this.config.bridgeIp}`);
      }

      // Check if API key is configured
      if (!this.config.apiKey) {
        this.log.warn('API key not configured');
        this.log.info('To create an API key:');
        this.log.info('1. Press the link button on your Hue bridge');
        this.log.info('2. Run the following command within 30 seconds:');
        this.log.info(`   curl -k -X POST https://${this.config.bridgeIp}/api ` +
          `-d '{"devicetype":"homebridge-hue-transitions#homebridge"}'`);
        this.log.info('3. Copy the "username" value from the response and add it as "apiKey" in the plugin settings');
        return;
      }

      // Create API client
      this.apiClient = new HueApiClient(this.config.bridgeIp, this.config.apiKey);

      // Test connection
      const isConnected = await this.apiClient.testConnection();

      if (!isConnected) {
        this.log.error('Failed to connect to Hue bridge - please check bridge IP and API key');
        this.apiClient = null;
        return;
      }

      this.log.info('Successfully connected to Hue bridge');
    } catch (error) {
      this.log.error('Failed to initialize API client:', error);
      this.apiClient = null;
    }
  }

  /**
   * Register a scene as an accessory
   */
  private registerScene(sceneConfig: SceneConfig): void {
    // Generate unique ID for the accessory
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}-${sceneConfig.id}`);

    // Check if accessory already exists
    let accessory = this.accessories.get(uuid);

    if (accessory) {
      // Update existing accessory
      this.log.info('Restoring existing accessory from cache:', sceneConfig.name);
      accessory.context.sceneConfig = sceneConfig;
    } else {
      // Create new accessory
      this.log.info('Adding new accessory:', sceneConfig.name);
      accessory = new this.api.platformAccessory(sceneConfig.name, uuid);
      accessory.context.sceneId = sceneConfig.id;
      accessory.context.sceneConfig = sceneConfig;

      // Register with Homebridge
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }

    // Create accessory instance
    if (this.apiClient) {
      const accessoryInstance = new HueSceneAccessory(this, accessory, sceneConfig, this.apiClient);
      this.accessoryInstances.set(uuid, accessoryInstance);
    }
  }

  /**
   * Start polling for scene status updates
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      return; // Already polling
    }

    const interval = this.config.pollingInterval ?? POLLING_CONFIG.DEFAULT_INTERVAL;

    // Validate interval
    const validInterval = Math.max(
      POLLING_CONFIG.MIN_INTERVAL,
      Math.min(POLLING_CONFIG.MAX_INTERVAL, interval),
    );

    if (validInterval !== interval) {
      this.log.warn(
        `Polling interval ${interval}ms is outside valid range ` +
        `(${POLLING_CONFIG.MIN_INTERVAL}-${POLLING_CONFIG.MAX_INTERVAL}ms), ` +
        `using ${validInterval}ms`,
      );
    }

    this.log.info(`Starting scene status polling every ${validInterval / 1000} seconds`);

    this.pollingInterval = setInterval(() => {
      void this.pollSceneStatus();
    }, validInterval);

    // Do an initial poll
    void this.pollSceneStatus();
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.log.debug('Stopped scene status polling');
    }
  }

  /**
   * Poll scene status and emit updates
   */
  private async pollSceneStatus(): Promise<void> {
    if (this.isPolling || !this.apiClient) {
      return; // Already polling or no API client
    }

    this.isPolling = true;

    try {
      // Get all scenes
      const scenes = await this.apiClient.getScenes();

      // Create a map for quick lookup
      const sceneMap = new Map<string, HueScene>(scenes.map(s => [s.id, s]));

      // Check each configured scene
      for (const sceneConfig of this.config.scenes) {
        const scene = sceneMap.get(sceneConfig.id);

        if (scene) {
          const isActive = scene.status?.active === 'static' || scene.status?.active === 'dynamic_palette';
          this.emit('sceneUpdated', sceneConfig.id, isActive);
        }
      }

      if (this.config.debug) {
        this.log.debug('Scene status poll completed');
      }
    } catch (error) {
      this.log.error('Error polling scene status:', error);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Cleanup on shutdown
   */
  private cleanup(): void {
    this.stopPolling();
    this.removeAllListeners();

    for (const _instance of this.accessoryInstances.values()) {
      // Cleanup any instance-specific resources if needed
    }

    this.log.debug('Cleanup completed');
  }
}
