import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from "homebridge";

import { PATH_EVENTS_ALL, PLATFORM_NAME, PLUGIN_NAME } from "./settings.js";
import { MieleApi } from "./miele/api.js";
import { MieleEventStream } from "./miele/events.js";
import { MieleToken } from "./miele/token.js";
import {
  MieleDeviceType,
  type MieleDevice,
  type MieleDeviceContext,
  type MieleDevicesResponse,
} from "./miele/types.js";
import { PlatformAccessoryBase } from "./platformAccessoryBase.js";
import { WasherDryerAccessory } from "./platformWasherDryerAccessory.js";
import { FridgeAccessory } from "./platformFridgeAccessory.js";
import { HoodAccessory } from "./platformHoodAccessory.js";
import { CoffeeSystemAccessory } from "./platformCoffeeSystemAccessory.js";

interface MielePlatformConfig extends PlatformConfig {
  clientID?: string;
  clientSecret?: string;
  /** Initial pair from the Miele developer portal; only used if no persisted state. */
  accessToken?: string;
  refreshToken?: string;
  /** Accept-Language for localised Miele enum strings. */
  language?: string;
  /** Periodic SSE reconnect interval, minutes. */
  reconnectEventStreamMinutes?: number;
}

/**
 * MielePlatform — DynamicPlatformPlugin that discovers Miele devices via REST
 * and updates HomeKit accessories from a single multiplexed SSE stream.
 */
export class MielePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  /** Restored cached accessories, indexed by UUID. */
  private readonly restored: Map<string, PlatformAccessory> = new Map();
  /** Live accessory instances, indexed by Miele serial number. */
  private readonly accessoriesBySerial: Map<string, PlatformAccessoryBase> = new Map();

  private token!: MieleToken;
  public api!: MieleApi;
  private stream!: MieleEventStream;

  constructor(
    public readonly log: Logger,
    public readonly config: MielePlatformConfig,
    public readonly hbApi: API,
  ) {
    this.Service = hbApi.hap.Service;
    this.Characteristic = hbApi.hap.Characteristic;
    this.log.debug("MielePlatform initialising.");
    this.hbApi.on("didFinishLaunching", () => {
      void this.bootstrap();
    });
  }

  /** Cache-restore hook. Real wiring happens later in `bootstrap()`. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Restoring cached Miele accessory: ${accessory.displayName}`);
    this.restored.set(accessory.UUID, accessory);
  }

  private async bootstrap(): Promise<void> {
    if (!this.config.clientID || !this.config.clientSecret) {
      this.log.error(
        "MielePlatform: clientID and clientSecret are required in config.json — aborting startup.",
      );
      return;
    }

    this.token = new MieleToken({
      clientID: this.config.clientID,
      clientSecret: this.config.clientSecret,
      storageDir: this.hbApi.user.persistPath(),
      log: this.log,
      fallback: {
        accessToken: this.config.accessToken,
        refreshToken: this.config.refreshToken,
      },
    });
    await this.token.init();

    this.api = new MieleApi(this.token, this.log, this.config.language ?? "");

    await this.discoverDevices();

    this.stream = new MieleEventStream({
      api: this.api,
      token: this.token,
      log: this.log,
      streamPath: PATH_EVENTS_ALL,
      periodicReconnectMin: this.config.reconnectEventStreamMinutes,
    });
    this.stream.on(({ serialNumber, state }) => {
      const acc = this.accessoriesBySerial.get(serialNumber);
      if (!acc) {
        this.log.debug(`SSE event for unknown serial ${serialNumber} — ignored.`);
        return;
      }
      acc.applyState(state);
    });
    this.stream.start();
  }

  private async discoverDevices(): Promise<void> {
    let devices: MieleDevicesResponse;
    try {
      devices = await this.api.listDevices();
    } catch (err) {
      this.log.error(`Miele device discovery failed: ${String(err)}`);
      return;
    }

    const seenUuids = new Set<string>();

    for (const [serialNumber, device] of Object.entries(devices)) {
      const ctx = this.toContext(serialNumber, device);
      const uuid = this.hbApi.hap.uuid.generate(serialNumber);
      seenUuids.add(uuid);

      const restored = this.restored.get(uuid);
      const accessory = restored ?? new this.hbApi.platformAccessory(ctx.displayName, uuid);
      accessory.context.device = ctx;

      const instance = this.buildAccessory(ctx, accessory);
      if (!instance) {
        this.log.info(
          `Skipping unsupported Miele device ${ctx.displayName} (rawType=${ctx.rawType}).`,
        );
        if (restored) {
          // Remove stale cached accessory of a now-unsupported type so HomeKit
          // doesn't keep a placeholder hanging around.
          this.hbApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [restored]);
        }
        continue;
      }

      this.accessoriesBySerial.set(serialNumber, instance);

      if (!restored) {
        this.log.info(`Registering new Miele accessory: ${ctx.displayName}`);
        this.hbApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // Drop cached accessories that no longer correspond to a Miele device.
    for (const [uuid, accessory] of this.restored) {
      if (!seenUuids.has(uuid)) {
        this.log.info(`Removing stale Miele accessory ${accessory.displayName} (no longer in API).`);
        this.hbApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  private toContext(serialNumber: string, device: MieleDevice): MieleDeviceContext {
    const ident = device.ident ?? ({} as MieleDevice["ident"]);
    return {
      serialNumber,
      displayName:
        ident.deviceName ||
        ident.type?.value_localized ||
        MieleDeviceType[ident.type?.value_raw as MieleDeviceType] ||
        `Miele ${serialNumber}`,
      modelNumber: ident.deviceIdentLabel?.techType || "Unknown Miele model",
      firmwareRevision: ident.xkmIdentLabel?.releaseVersion || "0.0.0",
      rawType: ident.type?.value_raw ?? -1,
    };
  }

  private buildAccessory(
    ctx: MieleDeviceContext,
    accessory: PlatformAccessory,
  ): PlatformAccessoryBase | null {
    switch (ctx.rawType) {
      case MieleDeviceType.Washer:
      case MieleDeviceType.WasherDryer:
      case MieleDeviceType.Dishwasher:
        return new WasherDryerAccessory(this, accessory, { exposeTemperature: true });
      case MieleDeviceType.Dryer:
        // Dryers don't track a meaningful drum temperature for HomeKit purposes.
        return new WasherDryerAccessory(this, accessory, { exposeTemperature: false });
      case MieleDeviceType.Fridge:
      case MieleDeviceType.Freezer:
      case MieleDeviceType.FridgeFreezer:
        return new FridgeAccessory(this, accessory);
      case MieleDeviceType.Hood:
        return new HoodAccessory(this, accessory);
      case MieleDeviceType.CoffeeSystem:
        return new CoffeeSystemAccessory(this, accessory);
      default:
        return null;
    }
  }
}
