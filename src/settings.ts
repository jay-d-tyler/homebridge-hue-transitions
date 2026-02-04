/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'HueTransitions';

/**
 * This must match the name of your plugin as defined in the package.json
 */
export const PLUGIN_NAME = '@jay-d-tyler/homebridge-hue-transitions';

/**
 * Philips Hue API Configuration
 */
export const API_CONFIG = {
  DISCOVERY_URL: 'https://discovery.meethue.com',
  API_VERSION: 'v2',
  LINK_BUTTON_TIMEOUT: 30000, // 30 seconds
  REQUEST_TIMEOUT: 10000, // 10 seconds
};

/**
 * Polling Configuration
 */
export const POLLING_CONFIG = {
  DEFAULT_INTERVAL: 60000, // 60 seconds (default)
  MIN_INTERVAL: 60000, // 1 minute minimum
  MAX_INTERVAL: 300000, // 5 minutes maximum
};

/**
 * Transition Configuration
 */
export const TRANSITION_CONFIG = {
  DEFAULT_DURATION: 30, // 30 minutes
  MIN_DURATION: 1, // 1 minute
  MAX_DURATION: 60, // 60 minutes
};
