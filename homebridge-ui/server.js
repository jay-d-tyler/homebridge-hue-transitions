import { HueApiClient } from '../dist/api.js';

/**
 * Custom UI server for Homebridge Config UI X
 */
export default class PluginUiServer {
  constructor(log, config) {
    this.log = log;
    this.config = config;
  }

  /**
   * Endpoint to fetch available scenes
   */
  async scenes(req, res) {
    try {
      // Get the plugin config
      const config = await this.homebridgeUiServer.getPluginConfig('homebridge-hue-transitions');

      if (!config || config.length === 0) {
        return res.json([]);
      }

      const pluginConfig = config[0];

      // Check if bridge is configured
      if (!pluginConfig.bridgeIp && !pluginConfig.apiKey) {
        // Try auto-discovery
        try {
          const discovery = await HueApiClient.discoverBridge();
          if (discovery) {
            pluginConfig.bridgeIp = discovery.internalipaddress;
          }
        } catch (err) {
          this.log.error('Auto-discovery failed:', err);
          return res.json([]);
        }
      }

      if (!pluginConfig.bridgeIp || !pluginConfig.apiKey) {
        return res.json([]);
      }

      // Fetch scenes from the Hue bridge
      const client = new HueApiClient(pluginConfig.bridgeIp, pluginConfig.apiKey);
      const scenes = await client.getScenes();

      // Return simplified scene list
      const sceneList = scenes.map(scene => ({
        id: scene.id,
        name: scene.metadata.name,
      }));

      res.json(sceneList);
    } catch (error) {
      this.log.error('Failed to fetch scenes:', error);
      res.status(500).json({ error: error.message });
    }
  }
}
