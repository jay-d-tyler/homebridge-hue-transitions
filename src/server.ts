import type { API, Logger } from 'homebridge';
import type { HueTransitionsPlatformConfig } from './types.js';
import { HueApiClient } from './api.js';

/**
 * Custom UI server for Homebridge Config UI X
 * Provides dynamic scene selection
 */
export class UIServer {
  constructor(
    private readonly log: Logger,
    private readonly config: HueTransitionsPlatformConfig,
  ) {}

  /**
   * Setup custom UI endpoints
   */
  setupServer(api: API): void {
    // Register endpoint to fetch available scenes
    api.on('didFinishLaunching', () => {
      this.log.debug('UI Server ready');
    });
  }

  /**
   * Get available scenes from the Hue bridge
   */
  async getAvailableScenes(): Promise<{ id: string; name: string }[]> {
    try {
      // Check if bridge is configured
      if (!this.config.bridgeIp || !this.config.apiKey) {
        return [];
      }

      const client = new HueApiClient(this.config.bridgeIp, this.config.apiKey);
      const scenes = await client.getScenes();

      return scenes.map(scene => ({
        id: scene.id,
        name: scene.metadata.name,
      }));
    } catch (error) {
      this.log.error('Failed to fetch scenes for UI:', error);
      return [];
    }
  }
}
