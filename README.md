# Homebridge Hue Transitions

[![npm version](https://badgen.net/npm/v/@jay-d-tyler/homebridge-hue-transitions)](https://www.npmjs.com/package/@jay-d-tyler/homebridge-hue-transitions)
[![npm downloads](https://badgen.net/npm/dt/@jay-d-tyler/homebridge-hue-transitions)](https://www.npmjs.com/package/@jay-d-tyler/homebridge-hue-transitions)

A Homebridge plugin that enables Philips Hue scenes with configurable transition durations in HomeKit. While Philips Hue lights work natively with HomeKit, HomeKit lacks the ability to activate scenes with custom transition times. This plugin bridges that gap by presenting Hue scenes as switches that, when activated, trigger the scene with your specified transition duration via the Hue API.

## Features

- 🎨 Expose Philips Hue scenes as HomeKit switches
- ⏱️ Configure custom transition durations (1-60 minutes) per scene
- 🔄 Automatic bridge reconnection and scene availability refresh
- 🌉 Auto-discovery of Hue bridges
- 🔐 Simple API key setup with guided instructions
- 🛡️ Authenticated TLS using the Philips Hue Bridge certificate authority
- 📊 Comprehensive logging and error handling
- 🧪 Fully tested with 80%+ code coverage
- 🚀 Built with modern TypeScript and Homebridge 2.0 features

## Why This Plugin?

Philips Hue lights integrate natively with HomeKit, but HomeKit's scene activation is instantaneous. If you want to gradually transition to a scene over 30 minutes (perfect for wake-up lighting or wind-down routines), HomeKit can't do it.

This plugin solves that by:
1. Presenting configured Hue scenes as HomeKit switches
2. When you activate a switch, it calls the Hue API with your custom transition duration
3. Your lights smoothly transition to the scene over your specified time period

## Installation

### Option 1: Via Homebridge Config UI X (Recommended)

1. Search for "Hue Transitions" in the Homebridge Config UI X plugin search
2. Click **Install**
3. Configure the plugin (see Configuration section below)

### Option 2: Via npm

```bash
npm install -g @jay-d-tyler/homebridge-hue-transitions
```

## Configuration

### Quick Setup (Recommended)

1. **Install the plugin** via Homebridge Config UI X (search for "Hue Transitions")

2. **Get your Hue API key:**
   - Find the bridge IP first, using the manual discovery request below or your
     router's device list. The plugin returns before auto-discovery when no
     `apiKey` is configured; its setup guidance is printed in Homebridge logs.
   - Press the bridge link button and follow the manual key-creation steps
     below, including the TLS limitation.
   - Copy the returned `username` into `apiKey` in the plugin settings.

3. **Add scenes:**
   - After entering your API key, click **Save** and restart Homebridge. With a
     key configured, the plugin can auto-discover a bridge if `bridgeIp` is
     omitted. With multiple bridges it uses the first result; configure
     `bridgeIp` and `bridgeId` explicitly to select the bridge paired with the key.
   - Check the Homebridge logs - all available scenes with their IDs will be listed
   - Copy the scene IDs you want
   - Add scenes in the plugin configuration with your desired transition durations (1-60 minutes)

That's it! Your scenes will appear in HomeKit as switches.

### Manual Configuration

If you prefer manual configuration or need to discover your bridge IP:

**Get Bridge IP:**
```bash
curl https://discovery.meethue.com
```

The discovery response supplies `internalipaddress` and `id`. Verify that they
belong to the intended bridge. Manual `bridgeIp` configuration is supported;
include its `bridgeId` to pin the expected certificate identity.

**Create API Key:**
1. Press the link button on your Hue bridge
2. Within 30 seconds, run:
   ```bash
   curl -k -X POST https://YOUR_BRIDGE_IP/api \
     -d '{"devicetype":"homebridge-hue-transitions#homebridge"}'
   ```
3. Copy the `username` value - this is your API key. Keep it out of logs, issues,
   screenshots, and version control.

The `-k` example matches the existing setup command printed by the plugin, but
it disables TLS certificate and hostname verification. Encryption alone does
not establish that the responding device is the intended bridge, and the
returned key could be intercepted by an impersonating endpoint. Use this
shortcut only on a trusted local network after independently checking the
bridge address; it is not an authenticated pairing check. A verified TLS setup
requires the Hue Bridge CA and expected bridge identity, not simply removing
`-k` from an IP-address URL.

This setup command does not change the plugin's runtime TLS settings. Runtime
requests verify the Hue Bridge CA by default and, when `bridgeId` is supplied
or discovered, compare the certificate identity with that ID. Leave
`allowInsecureTls` disabled except for the explicit legacy fallback described
below.

### Example Configuration (if configuring manually)

```json
{
  "platforms": [
    {
      "platform": "HueTransitions",
      "name": "Hue Transitions",
      "bridgeIp": "192.168.1.100",
      "bridgeId": "001788FFFE123456",
      "apiKey": "your-api-key-here",
      "scenes": [
        {
          "id": "12345678-1234-1234-1234-123456789abc",
          "name": "Sunset",
          "transitionDuration": 30
        },
        {
          "id": "87654321-4321-4321-4321-cba987654321",
          "name": "Morning Routine",
          "transitionDuration": 15
        }
      ],
      "pollingInterval": 60000,
      "debug": false,
      "allowInsecureTls": false
    }
  ]
}
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `platform` | Yes | - | Must be `HueTransitions` |
| `name` | No | `Hue Transitions` | Display name in Homebridge logs |
| `bridgeIp` | No | Auto-discover | IP address of your Hue bridge |
| `bridgeId` | No | Auto-discover | Bridge ID used to verify the bridge TLS certificate |
| `apiKey` | Yes | - | API key for your Hue bridge |
| `scenes` | Yes | `[]` | Array of scene configurations (see below) |
| `pollingInterval` | No | `60000` | Scene refresh and reconnection interval in milliseconds (60000-300000) |
| `debug` | No | `false` | Enable detailed debug logging |
| `allowInsecureTls` | No | `false` | Disable certificate verification only for a legacy self-signed bridge |

When auto-discovery is used, the plugin fills both `bridgeIp` and `bridgeId`
for the running Homebridge process. If you configure the IP manually, adding
the bridge ID provides strict certificate identity verification. The ID is
shown in discovery results and contains 16 hexadecimal characters.

#### Scene Configuration

Each scene in the `scenes` array has these properties:

| Property | Required | Default | Description |
|----------|----------|---------|-------------|
| `id` | Yes | - | Scene ID from your Hue bridge |
| `name` | Yes | - | Display name in HomeKit |
| `transitionDuration` | Yes | - | Transition time in minutes (1-60) |

## Usage

Once configured:

1. The plugin will create a switch in HomeKit for each configured scene
2. Activate the switch to trigger the scene with your configured transition
3. The lights will gradually transition to the scene over your specified duration
4. The virtual switch automatically resets after one second so it can be triggered again

### Example Automations

**Wake-Up Routine:**
- Create a scene called "Morning Light" that gradually brightens your bedroom
- Configure it with a 30-minute transition
- Create a HomeKit automation that activates this scene 30 minutes before your alarm

**Wind-Down:**
- Create a scene called "Bedtime" that dims lights to warm, low levels
- Configure it with a 15-minute transition
- Activate it before bed for a gradual transition to sleep-friendly lighting

**Sunset Simulation:**
- Create a scene that mimics sunset colors
- Configure a 60-minute transition
- Automatically activate it in the evening

## Technical Details

### Hue API v2

This plugin uses the modern Hue API v2, which provides:
- Better performance and reliability
- More accurate scene status tracking
- Native support for transition durations
- Future-proof integration with latest Hue features

### Refresh and Recovery

The plugin refreshes the bridge scene list at regular intervals (default: one
minute). This detects removed scenes and retries discovery or connectivity
after a temporary bridge outage. Cached HomeKit triggers remain usable while
the bridge reconnects instead of requiring a Homebridge restart.

### Scene Trigger State

Hue scenes are actions and do not have a meaningful "off" operation. Each
accessory therefore behaves as a momentary trigger: it turns on after Hue
accepts the recall request and resets one second later. Turning it off manually
does not change the lights.

## Troubleshooting

### Bridge Not Found

If auto-discovery fails:
1. Manually configure your bridge IP address
2. Ensure your Homebridge server is on the same network as your Hue bridge
3. Check your firewall settings

### Authentication Failed

If you see authentication errors:
1. Verify your API key is correct
2. Try creating a new API key
3. Ensure you pressed the link button before creating the API key

### TLS Certificate Error

Modern Hue bridges use certificates issued by the Philips Hue Bridge
certificate authority. If you configured the bridge manually, verify that
`bridgeId` matches the bridge you intended to use.

Some legacy bridges may still present a self-signed certificate. Confirm that
the bridge firmware is current first. If it cannot receive a signed
certificate, enable `allowInsecureTls` explicitly; this disables bridge
identity verification and should remain a last resort.

### Scenes Not Appearing

If configured scenes don't show up:
1. Check the Homebridge logs for warnings about missing scenes
2. Verify the scene IDs are correct (they're case-sensitive)
3. Restart Homebridge after configuration changes

### Transitions Not Working

If scenes activate instantly without transitioning:
1. Ensure your Hue bridge firmware is up to date
2. Check that the scene ID is correct
3. Enable debug logging to see detailed API calls
4. Verify the transition duration is between 1-60 minutes

### Enable Debug Logging

For detailed troubleshooting information:
1. Set `"debug": true` in your config
2. Restart Homebridge
3. Check logs for detailed API calls and responses

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/jay-d-tyler/homebridge-hue-transitions.git
cd homebridge-hue-transitions

# Install dependencies
npm install

# Build the plugin
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Link for local development
npm link
```

### Running Tests

The plugin includes comprehensive test coverage:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Project Structure

```
homebridge-hue-transitions/
├── src/
│   ├── index.ts           # Plugin entry point
│   ├── platform.ts        # Main platform class
│   ├── api.ts             # Hue API client
│   ├── sceneAccessory.ts  # Scene switch accessory
│   ├── types.ts           # TypeScript type definitions
│   └── settings.ts        # Constants and configuration
├── test/
│   ├── api.test.ts        # API client tests
│   ├── index.test.ts      # Plugin registration test
│   ├── platform.test.ts   # Platform tests
│   └── sceneAccessory.test.ts  # Accessory tests
├── config.schema.json     # Homebridge Config UI schema
└── package.json
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Ensure all tests pass: `npm test`
5. Ensure linting passes: `npm run lint`
6. Submit a pull request

## License

Apache-2.0

## Credits

Created by Jay Tyler

Inspired by the need for gradual scene transitions in HomeKit, something that Philips Hue supports but HomeKit doesn't expose.

## Support

- **Issues:** [GitHub Issues](https://github.com/jay-d-tyler/homebridge-hue-transitions/issues)
- **Homebridge Discord:** [#plugins channel](https://discord.gg/homebridge)

## Changelog

### 2.1.0

- Make scene accessories reliable momentary triggers
- Preserve configured cached accessories through temporary bridge outages
- Remove stale accessories when scenes are deleted or disappear
- Add authenticated Hue Bridge TLS with an explicit legacy fallback
- Validate configuration at runtime and prevent malformed polling intervals
- Restore the test, coverage, CI, audit, and publishing gates

### 1.0.0

- Initial release
- Hue API v2 support
- Configurable transition durations (1-60 minutes)
- Auto-discovery of Hue bridges
- Comprehensive test suite
- Full TypeScript support
- Homebridge 2.0 compatibility
