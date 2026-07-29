import { describe, it, expect, jest } from '@jest/globals';
import type { API } from 'homebridge';
import initializePlugin from '../src/index.js';
import { HueTransitionsPlatform } from '../src/platform.js';

describe('plugin initializer', () => {
  it('registers the Hue Transitions platform', () => {
    const registerPlatform = jest.fn();

    initializePlugin({ registerPlatform } as unknown as API);

    expect(registerPlatform).toHaveBeenCalledWith(
      '@jay-d-tyler/homebridge-hue-transitions',
      'HueTransitions',
      HueTransitionsPlatform,
    );
  });
});
