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
 * "occupied" while at least one zone is heating, "not occupied" when the
 * hob is off/standby. That maps cleanly onto HomeKit automations
 * ("when occupancy detected → run scene X").
 *
 * Aggregation rule: occupied = status.value_raw is NOT one of
 * {Off, StandBy, NotConnected, Idle}. Everything else (Running, Pause,
 * ProgramSelected, …) is treated as "in use" because for a hob, the
 * device only leaves Off/StandBy when a zone is actually drawing power.
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
      raw === MieleProgramState.StandBy ||
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
