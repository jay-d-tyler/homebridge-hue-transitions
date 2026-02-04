import type {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  Logger,
} from 'homebridge';
import type { HueTransitionsPlatform } from './platform.js';
import type { HueApiClient } from './api.js';
import type { SceneConfig } from './types.js';

/**
 * Scene Switch Accessory
 * Represents a Hue scene as a HomeKit switch with configurable transition duration
 */
export class HueSceneAccessory {
  private service: Service;
  private readonly sceneConfig: SceneConfig;
  private readonly api: HueApiClient;
  private readonly log: Logger;
  private isActivating = false;
  private lastActivated: number | null = null;

  constructor(
    private readonly platform: HueTransitionsPlatform,
    private readonly accessory: PlatformAccessory,
    sceneConfig: SceneConfig,
    api: HueApiClient,
  ) {
    this.sceneConfig = sceneConfig;
    this.api = api;
    this.log = platform.log;

    // Set accessory information
    const infoService = this.accessory.getService(this.platform.Service.AccessoryInformation);
    if (infoService) {
      infoService
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Philips Hue')
        .setCharacteristic(this.platform.Characteristic.Model, 'Scene Switch')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, sceneConfig.id)
        .setCharacteristic(this.platform.Characteristic.Name, sceneConfig.name);
    }

    // Get or create the switch service
    this.service = this.accessory.getService(this.platform.Service.Switch) ??
      this.accessory.addService(this.platform.Service.Switch);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, sceneConfig.name);

    // Register handlers for the On characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));

    // Listen for scene updates from the platform
    this.platform.on('sceneUpdated', this.handleSceneUpdate.bind(this));

    this.log.debug(`Scene accessory initialized: ${sceneConfig.name} (${sceneConfig.id})`);
  }

  /**
   * Get the current state of the switch
   * We consider the scene "on" if it was recently activated (within the last 30 seconds)
   */
  async getOn(): Promise<CharacteristicValue> {
    try {
      // Check if scene was recently activated
      if (this.lastActivated !== null) {
        const timeSinceActivation = Date.now() - this.lastActivated;
        // Consider the scene "on" for 30 seconds after activation
        if (timeSinceActivation < 30000) {
          return true;
        }
      }

      // Try to determine if this scene is currently active by checking the scene status
      try {
        const scene = await this.api.getScene(this.sceneConfig.id);
        const isActive = scene.status?.active === 'static' || scene.status?.active === 'dynamic_palette';

        if (this.platform.config.debug) {
          this.log.debug(`Scene ${this.sceneConfig.name} status: ${scene.status?.active ?? 'unknown'}, isActive: ${isActive}`);
        }

        return isActive;
      } catch (error) {
        // If we can't fetch the scene status, fall back to the time-based check
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log.warn(`Failed to get scene status for ${this.sceneConfig.name}: ${errorMessage}`);
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error(`Error getting state for scene ${this.sceneConfig.name}: ${errorMessage}`);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Set the state of the switch
   * When turned on, activate the scene with the configured transition duration
   * When turned off, do nothing (scenes don't have an "off" state)
   */
  async setOn(value: CharacteristicValue): Promise<void> {
    const isOn = value as boolean;

    // Prevent duplicate activations
    if (this.isActivating) {
      this.log.debug(`Scene ${this.sceneConfig.name} is already activating, ignoring request`);
      return;
    }

    try {
      if (isOn) {
        this.isActivating = true;

        // Convert transition duration from minutes to milliseconds
        const transitionMs = this.sceneConfig.transitionDuration * 60 * 1000;

        this.log.info(
          `Activating scene "${this.sceneConfig.name}" with ${this.sceneConfig.transitionDuration} minute transition`,
        );

        // Activate the scene with transition
        await this.api.recallScene(this.sceneConfig.id, transitionMs);

        // Record activation time
        this.lastActivated = Date.now();

        this.log.info(`Successfully activated scene "${this.sceneConfig.name}"`);
      } else {
        // Turning off a scene doesn't do anything - scenes are momentary
        // But we'll reset our activation tracking
        this.lastActivated = null;

        if (this.platform.config.debug) {
          this.log.debug(`Scene ${this.sceneConfig.name} turned off (no action taken)`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to activate scene ${this.sceneConfig.name}: ${errorMessage}`);

      // Revert the switch state in HomeKit
      setTimeout(() => {
        this.service.updateCharacteristic(this.platform.Characteristic.On, !isOn);
      }, 100);

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    } finally {
      this.isActivating = false;
    }
  }

  /**
   * Handle scene updates from the platform polling
   */
  private handleSceneUpdate(sceneId: string, isActive: boolean): void {
    if (sceneId === this.sceneConfig.id) {
      if (this.platform.config.debug) {
        this.log.debug(`Updating scene ${this.sceneConfig.name} state to ${isActive}`);
      }

      // Update the switch characteristic
      this.service.updateCharacteristic(this.platform.Characteristic.On, isActive);
    }
  }

  /**
   * Get the scene configuration
   */
  getSceneConfig(): SceneConfig {
    return { ...this.sceneConfig };
  }
}
