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
  REQUEST_TIMEOUT: 10000, // 10 seconds
  RETRIES: 3,
};

/**
 * Signify's private certificate authority for Hue Bridges.
 *
 * Hue Bridge certificates use the bridge ID as their common name, so callers
 * must validate that identity rather than the configured IP address.
 */
export const HUE_BRIDGE_CA_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICMjCCAdigAwIBAgIUO7FSLbaxikuXAljzVaurLXWmFw4wCgYIKoZIzj0EAwIw
OTELMAkGA1UEBhMCTkwxFDASBgNVBAoMC1BoaWxpcHMgSHVlMRQwEgYDVQQDDAty
b290LWJyaWRnZTAiGA8yMDE3MDEwMTAwMDAwMFoYDzIwMzgwMTE5MDMxNDA3WjA5
MQswCQYDVQQGEwJOTDEUMBIGA1UECgwLUGhpbGlwcyBIdWUxFDASBgNVBAMMC3Jv
b3QtYnJpZGdlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjNw2tx2AplOf9x86
aTdvEcL1FU65QDxziKvBpW9XXSIcibAeQiKxegpq8Exbr9v6LBnYbna2VcaK0G22
jOKkTqOBuTCBtjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNV
HQ4EFgQUZ2ONTFrDT6o8ItRnKfqWKnHFGmQwdAYDVR0jBG0wa4AUZ2ONTFrDT6o8
ItRnKfqWKnHFGmShPaQ7MDkxCzAJBgNVBAYTAk5MMRQwEgYDVQQKDAtQaGlsaXBz
IEh1ZTEUMBIGA1UEAwwLcm9vdC1icmlkZ2WCFDuxUi22sYpLlwJY81Wrqy11phcO
MAoGCCqGSM49BAMCA0gAMEUCIEBYYEOsa07TH7E5MJnGw557lVkORgit2Rm1h3B2
sFgDAiEA1Fj/C3AN5psFMjo0//mrQebo0eKd3aWRx+pQY08mk48=
-----END CERTIFICATE-----`;

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

/**
 * A Hue scene is an action, not a resource with an off state. Keep the
 * HomeKit switch on only long enough to acknowledge a successful trigger.
 */
export const MOMENTARY_SWITCH_RESET_DELAY = 1000;
