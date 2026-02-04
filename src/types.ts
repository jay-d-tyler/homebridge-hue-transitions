/**
 * Plugin configuration interface
 */
export interface HueTransitionsPlatformConfig {
  platform: string;
  name?: string;
  bridgeIp?: string;
  apiKey?: string;
  scenes: SceneConfig[];
  pollingInterval?: number;
  debug?: boolean;
}

/**
 * Scene configuration
 */
export interface SceneConfig {
  id: string;
  name: string;
  transitionDuration: number; // in minutes
}

/**
 * Hue API v2 Bridge Discovery Response
 */
export interface HueBridgeDiscoveryResponse {
  id: string;
  internalipaddress: string;
  port?: number;
}

/**
 * Hue API v2 Authentication Response
 */
export interface HueAuthResponse {
  success?: {
    username: string;
  }[];
  error?: {
    type: number;
    address: string;
    description: string;
  };
}

/**
 * Hue API v2 Scene Resource
 */
export interface HueScene {
  id: string;
  id_v1?: string;
  type: 'scene';
  metadata: {
    name: string;
    image?: {
      rid: string;
      rtype: string;
    };
  };
  group: {
    rid: string;
    rtype: 'room' | 'zone';
  };
  actions: {
    target: {
      rid: string;
      rtype: string;
    };
    action: {
      on?: {
        on: boolean;
      };
      dimming?: {
        brightness: number;
      };
      color?: {
        xy: {
          x: number;
          y: number;
        };
      };
      color_temperature?: {
        mirek: number;
      };
    };
  }[];
  palette?: {
    color: {
      color: {
        xy: {
          x: number;
          y: number;
        };
      };
      dimming: {
        brightness: number;
      };
    }[];
    dimming: {
      brightness: number;
    }[];
    color_temperature: {
      mirek: number;
    }[];
  };
  speed?: number;
  auto_dynamic?: boolean;
  status?: {
    active: 'inactive' | 'static' | 'dynamic_palette';
  };
}

/**
 * Hue API v2 Light Resource
 */
export interface HueLight {
  id: string;
  id_v1?: string;
  type: 'light';
  metadata: {
    name: string;
    archetype?: string;
  };
  on: {
    on: boolean;
  };
  dimming?: {
    brightness: number;
  };
  color?: {
    xy: {
      x: number;
      y: number;
    };
    gamut?: {
      red: { x: number; y: number };
      green: { x: number; y: number };
      blue: { x: number; y: number };
    };
    gamut_type?: string;
  };
  color_temperature?: {
    mirek: number;
    mirek_valid: boolean;
    mirek_schema: {
      mirek_minimum: number;
      mirek_maximum: number;
    };
  };
  dynamics?: {
    status: string;
    status_values: string[];
    speed: number;
    speed_valid: boolean;
  };
}

/**
 * Hue API v2 Resource List Response
 */
export interface HueResourceListResponse<T> {
  errors: {
    description: string;
  }[];
  data: T[];
}

/**
 * Hue API v2 Single Resource Response
 */
export interface HueSingleResourceResponse<T> {
  errors: {
    description: string;
  }[];
  data: T[];
  rid?: string;
}

/**
 * Scene recall request
 */
export interface SceneRecallRequest {
  recall: {
    action: 'active';
    duration?: number; // in milliseconds
    dimming?: {
      brightness: number;
    };
  };
}
