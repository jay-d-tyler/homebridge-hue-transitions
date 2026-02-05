# Homebridge Hue Transitions

[![npm version](https://badgen.net/npm/v/@jay-d-tyler/homebridge-hue-transitions)](https://www.npmjs.com/package/@jay-d-tyler/homebridge-hue-transitions)
[![npm downloads](https://badgen.net/npm/dt/@jay-d-tyler/homebridge-hue-transitions)](https://www.npmjs.com/package/@jay-d-tyler/homebridge-hue-transitions)

A Homebridge plugin that enables Philips Hue scenes with configurable transition durations in HomeKit. While Philips Hue lights work natively with HomeKit, HomeKit lacks the ability to activate scenes with custom transition times. This plugin bridges that gap by presenting Hue scenes as switches that, when activated, trigger the scene with your specified transition duration via the Hue API.

## Features

- 🎨 Expose Philips Hue scenes as HomeKit switches
- ⏱️ Configure custom transition durations (1-60 minutes) per scene
- 🔄 Automatic scene status synchronization
- 🌉 Auto-discovery of Hue bridges
- 🔐 Simple API key setup with guided instructions
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
   - Open the plugin settings
   - The plugin will auto-discover your Hue bridge
   - Follow the on-screen instructions to create an API key:
     - Press the link button on your Hue bridge
     - Run the provided command
     - Copy the API key into the settings

3. **Add scenes using the Scene Selector:**
   - After entering your API key, click **Save**
   - Click the **Scene Selector** button (top-right corner)
   - Browse all available scenes from your Hue bridge
   - Click **Add Scene** for each scene you want in HomeKit
   - Adjust transition durations (1-60 minutes) as needed

That's it! Your scenes will appear in HomeKit as switches.

### Manual Configuration

If you prefer manual configuration or need to discover your bridge IP:

**Get Bridge IP:**
```bash
curl https://discovery.meethue.com
```

**Create API Key:**
1. Press the link button on your Hue bridge
2. Within 30 seconds, run:
   ```bash
   curl -k -X POST https://YOUR_BRIDGE_IP/api \
     -d '{"devicetype":"homebridge-hue-transitions#homebridge"}'
   ```
3. Copy the `username` value - this is your API key

### Example Configuration (if configuring manually)

```json
{
  "platforms": [
    {
      "platform": "HueTransitions",
      "name": "Hue Transitions",
      "bridgeIp": "192.168.1.100",
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
      "debug": false
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
| `apiKey` | Yes | - | API key for your Hue bridge |
| `scenes` | Yes | `[]` | Array of scene configurations (see below) |
| `pollingInterval` | No | `60000` | Status polling interval in milliseconds (60000-300000) |
| `debug` | No | `false` | Enable detailed debug logging |

#### Scene Configuration

**Using Scene Selector (Recommended):**
- Click the "Scene Selector" button in the Homebridge Config UI X
- Browse and add scenes with one click
- Scenes are automatically added with default 30-minute transitions
- Edit transition durations directly in the config afterward

**Manual Configuration:**

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
4. The switch will show as "on" while the transition is active

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

### Polling

The plugin polls your Hue bridge at regular intervals (default: 1 minute) to keep scene status synchronized. This ensures HomeKit reflects the current state of your scenes.

### Scene Status

A scene is considered "active" when:
- It was activated by this plugin within the last 30 seconds, OR
- The Hue API reports the scene as `static` or `dynamic_palette`

Scenes automatically turn "off" in HomeKit after 30 seconds or when another scene is activated.

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

### 1.0.0

- Initial release
- Hue API v2 support
- Configurable transition durations (1-60 minutes)
- Auto-discovery of Hue bridges
- Comprehensive test suite
- Full TypeScript support
- Homebridge 2.0 compatibility
