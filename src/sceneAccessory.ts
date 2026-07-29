import type {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  Logger,
} from 'homebridge';
import type { HueTransitionsPlatform } from './platform.js';
import type { HueApi } from './api.js';
import type { SceneConfig } from './types.js';
import { MOMENTARY_SWITCH_RESET_DELAY } from './settings.js';

/**
 * Scene Switch Accessory
 * Represents a Hue scene as a HomeKit switch with configurable transition duration
 */
export class HueSceneAccessory {
  private service: Service;
  private readonly sceneConfig: SceneConfig;
  private readonly log: Logger;
  private isActivating = false;
  private isOn = false;
  private resetTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly platform: HueTransitionsPlatform,
    private readonly accessory: PlatformAccessory,
    sceneConfig: SceneConfig,
    private readonly getApiClient: () => HueApi | null,
  ) {
    this.sceneConfig = sceneConfig;
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

    this.log.debug(`Scene accessory initialized: ${sceneConfig.name} (${sceneConfig.id})`);
  }

  /**
   * Get the current state of the momentary switch.
   */
  getOn(): CharacteristicValue {
    return this.isOn;
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
        const api = this.getApiClient();

        if (api === null) {
          throw new Error('Hue bridge is not connected yet');
        }

        // Convert transition duration from minutes to milliseconds
        const transitionMs = this.sceneConfig.transitionDuration * 60 * 1000;

        this.log.info(
          `Activating scene "${this.sceneConfig.name}" with ${this.sceneConfig.transitionDuration} minute transition`,
        );

        // Activate the scene with transition
        await api.recallScene(this.sceneConfig.id, transitionMs);

        this.isOn = true;
        this.scheduleReset();

        this.log.info(`Successfully activated scene "${this.sceneConfig.name}"`);
      } else {
        this.resetSwitch();

        if (this.platform.config.debug) {
          this.log.debug(`Scene ${this.sceneConfig.name} turned off (no action taken)`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to activate scene ${this.sceneConfig.name}: ${errorMessage}`);

      // Revert the switch state in HomeKit
      this.resetSwitch();

      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    } finally {
      this.isActivating = false;
    }
  }

  private scheduleReset(): void {
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
    }

    this.resetTimer = setTimeout(() => {
      this.resetTimer = null;
      this.resetSwitch();
    }, MOMENTARY_SWITCH_RESET_DELAY);
  }

  private resetSwitch(): void {
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }

    this.isOn = false;
    this.service.updateCharacteristic(this.platform.Characteristic.On, false);
  }

  destroy(): void {
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  /**
   * Get the scene configuration
   */
  getSceneConfig(): SceneConfig {
    return { ...this.sceneConfig };
  }
}
