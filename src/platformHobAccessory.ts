import type { PlatformAccessory, Service } from "homebridge";

import { PlatformAccessoryBase } from "./platformAccessoryBase.js";
import type { MielePlatform } from "./platform.js";
import { MieleProgramState, type MieleDeviceState } from "./miele/types.js";

/**
 * Hob (induction / electric cooktop, rawType 27).
 *
 * Miele's 3rd-party API does NOT allow remotely turning a hob on — safety
 * reasons (hot surface, no way to verify nothing's resting on it). So this
 * accessory is intentionally read-only and exposes an `OccupancySensor`:
 * "occupied" while the hob is powered, "not occupied" when fully off.
 * That maps cleanly onto HomeKit automations ("when occupancy detected
 * → run scene X").
 *
 * Aggregation rule: occupied = status.value_raw is NOT one of
 * {Off, NotConnected, Idle}. StandBy (the 10-second "power button on,
 * waiting for you to pick a zone" window before auto-shutoff) IS
 * counted as occupied so the automation fires the moment the user
 * touches the cooktop — by the time they pick a zone the kitchen
 * lights are already on.
 */
export class HobAccessory extends PlatformAccessoryBase {
  private sensor: Service;

  constructor(platform: MielePlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.sensor = this.useService(this.platform.Service.OccupancySensor, this.device.displayName);
    this.sensor.setCharacteristic(this.platform.Characteristic.Name, this.device.displayName);
  }

  applyState(state: MieleDeviceState): void {
    const raw = state.status?.value_raw ?? MieleProgramState.NotConnected;
    const inactive =
      raw === MieleProgramState.Off ||
      raw === MieleProgramState.NotConnected ||
      raw === MieleProgramState.Idle;
    const occupied = !inactive;

    this.platform.log.debug(
      `${this.device.displayName}: status.value_raw=${raw} → ${occupied ? "OCCUPIED" : "not occupied"}`,
    );

    this.sensor.updateCharacteristic(
      this.platform.Characteristic.OccupancyDetected,
      occupied
        ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
  }
}
