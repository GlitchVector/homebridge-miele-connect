import type {
  PlatformAccessory,
  Service,
  WithUUID,
} from "homebridge";

import type { MielePlatform } from "./platform.js";
import type { MieleDeviceContext, MieleDeviceState } from "./miele/types.js";

/**
 * Base class for every Miele HomeKit accessory.
 *
 * Sets the AccessoryInformation service and exposes a single `applyState`
 * extension point that subclasses override to map a Miele state payload into
 * HomeKit characteristics. The platform fans out SSE events to every
 * registered accessory via `applyState`, so subclasses don't manage their
 * own SSE subscriptions.
 */
export abstract class PlatformAccessoryBase {
  protected readonly device: MieleDeviceContext;

  constructor(
    protected readonly platform: MielePlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    this.device = accessory.context.device as MieleDeviceContext;

    const info = accessory.getService(this.platform.Service.AccessoryInformation);
    info
      ?.setCharacteristic(this.platform.Characteristic.Manufacturer, "Miele")
      .setCharacteristic(this.platform.Characteristic.Model, this.device.modelNumber)
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        this.device.firmwareRevision,
      )
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.serialNumber);
  }

  /**
   * Resolve a HomeKit service by ctor + name + subtype, idempotently. Reuses
   * the cached service from the persisted PlatformAccessory on restart
   * instead of creating duplicates.
   */
  protected useService(
    serviceCtor: WithUUID<typeof Service>,
    name: string,
    subtype?: string,
  ): Service {
    const existing = subtype
      ? this.accessory.getServiceById(serviceCtor, subtype)
      : this.accessory.getService(serviceCtor);
    if (existing) {
      return existing;
    }
    return this.accessory.addService(serviceCtor, name, subtype ?? "");
  }

  /**
   * Called by `MielePlatform` whenever the SSE stream emits a new state for
   * this device's serial. Subclasses translate Miele state → HomeKit chars.
   */
  abstract applyState(state: MieleDeviceState): void;
}
