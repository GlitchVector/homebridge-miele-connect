/**
 * Miele 3rd-party API type shapes.
 *
 * These shapes are intentionally narrow — only the fields the plugin actually
 * reads are typed. The Miele payloads are deeply nested and undocumented in
 * places; widening these later is cheap, but typing every field would just
 * become noise.
 */

/** OAuth token response (Miele's `/thirdparty/token` endpoint). */
export interface MieleTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds. */
  expires_in: number;
  token_type?: string;
}

/** Persisted token state — adds the creation timestamp for refresh logic. */
export interface MielePersistedToken extends MieleTokenResponse {
  /** ISO-8601 string (kept JSON-friendly for node-fs persistence). */
  created_at: string;
}

/**
 * Numeric device-type IDs returned in `ident.type.value_raw`. The Miele
 * docs publish a much longer list; we only enumerate the types this plugin
 * actually maps to a HomeKit accessory.
 */
export enum MieleDeviceType {
  Washer = 1,
  Dryer = 2,
  Dishwasher = 7,
  CoffeeSystem = 17,
  Hood = 18,
  Fridge = 19,
  Freezer = 20,
  FridgeFreezer = 21,
  WasherDryer = 24,
}

/** Top-level state.status.value_raw values (machine running-state). */
export enum MieleProgramState {
  Off = 1,
  StandBy = 2,
  ProgramSelected = 3,
  ProgramProgrammed = 4,
  Running = 5,
  Pause = 6,
  EndProgrammed = 7,
  Failure = 8,
  ProgramInterrupted = 9,
  Idle = 10,
  RinseHold = 11,
  Service = 12,
  Superfreezing = 13,
  Supercooling = 14,
  Superheating = 15,
  NotConnected = 255,
}

/**
 * Process-action codes sent in PUT `/devices/<id>/actions` { processAction }.
 * Read also as allowed-action keys in GET `/devices/<id>/actions` response.
 */
export enum MieleProcessAction {
  Start = 1,
  Stop = 2,
  Pause = 3,
  StartSuperFreezing = 4,
  StopSuperFreezing = 5,
  StartSuperCooling = 6,
  StopSuperCooling = 7,
}

/** A `temperature` or `targetTemperature` array entry. */
export interface MieleTempEntry {
  /** centi-degrees (e.g. 4000 = 40.0°C). Special sentinel `-32768` means "no value". */
  value_raw: number;
  value_localized: number | null;
  unit: "Celsius" | "Fahrenheit" | string;
}

/** Subset of the `state` object the plugin reacts to. */
export interface MieleDeviceState {
  status?: { value_raw: number; value_localized?: string };
  programPhase?: { value_raw: number; value_localized?: string };
  /** `[hours, minutes]`. */
  remainingTime?: [number, number];
  /** `[hours, minutes]`. */
  elapsedTime?: [number, number];
  temperature?: MieleTempEntry[];
  targetTemperature?: MieleTempEntry[];
  /** Hood: ventilation step (0..4). */
  ventilationStep?: { value_raw: number };
  light?: number;
  /** Power-on/off state for devices that report it directly. */
  signalDoor?: boolean;
}

/** Per-device entry returned by GET `/v1/devices`. */
export interface MieleDevice {
  ident: {
    type: { value_raw: number; value_localized?: string };
    deviceName?: string;
    deviceIdentLabel?: { techType?: string; fabNumber?: string };
    xkmIdentLabel?: { techType?: string; releaseVersion?: string };
  };
  state: MieleDeviceState;
}

/** Result of GET `/v1/devices` — keyed by device fab number (serial). */
export type MieleDevicesResponse = Record<string, MieleDevice>;

/** Result of GET `/v1/devices/<id>/actions` — booleans + arrays for what's currently allowed. */
export interface MieleAllowedActions {
  processAction: MieleProcessAction[];
  light?: number[];
  ventilationStep?: number[];
  powerOn?: boolean;
  powerOff?: boolean;
  targetTemperature?: Array<{ zone: number; min: number; max: number }>;
  startTime?: number[];
  ambientLight?: number[];
}

/** Body shape for PUT `/v1/devices/<id>/actions`. */
export type MieleActionBody =
  | { processAction: MieleProcessAction }
  | { powerOn: true }
  | { powerOff: true }
  | { light: number }
  | { ventilationStep: number }
  | { targetTemperature: Array<{ zone: number; value: number }> };

/**
 * Compact, plugin-internal projection of a device — what `MielePlatform` hands
 * to each `<Type>Accessory`. Keeps accessory code free of REST-shape details.
 */
export interface MieleDeviceContext {
  /** Stable across reboots — used as HomeKit serial number + UUID seed. */
  serialNumber: string;
  displayName: string;
  modelNumber: string;
  firmwareRevision: string;
  rawType: number;
}
