import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";

import { PlatformAccessoryBase } from "./platformAccessoryBase.js";
import type { MielePlatform } from "./platform.js";
import {
  MieleProcessAction,
  MieleProgramState,
  type MieleDeviceState,
} from "./miele/types.js";

const MAX_REMAINING_SECONDS = 8 * 3600;

/**
 * Maps Miele washer / washer-dryer / dishwasher / dryer state onto a HomeKit
 * `Valve (Water Faucet)` service:
 *   - `Active`: ON when the program is Running or Pause; OFF in idle/done states.
 *     Writing ON → Miele Start, OFF → Miele Stop (subject to allowed-actions).
 *   - `InUse`: tracks `Running` only.
 *   - `RemainingDuration`: in seconds.
 *
 * Optionally also exposes a `TemperatureSensor` for the program's target temp
 * (washers) or live drum temp (dryers).
 */
export class WasherDryerAccessory extends PlatformAccessoryBase {
  private valve: Service;
  private tempService: Service | undefined;

  constructor(
    platform: MielePlatform,
    accessory: PlatformAccessory,
    private readonly opts: { exposeTemperature: boolean },
  ) {
    super(platform, accessory);

    this.valve = this.useService(this.platform.Service.Valve, this.device.displayName);
    this.valve.setCharacteristic(this.platform.Characteristic.Name, this.device.displayName);
    this.valve.setCharacteristic(
      this.platform.Characteristic.ValveType,
      this.platform.Characteristic.ValveType.WATER_FAUCET,
    );

    this.valve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet((v) => this.handleActiveSet(v));

    this.valve
      .getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .setProps({ minValue: 0, maxValue: MAX_REMAINING_SECONDS, minStep: 1 });

    if (this.opts.exposeTemperature) {
      this.tempService = this.useService(
        this.platform.Service.TemperatureSensor,
        this.device.displayName,
      );
      this.tempService.setCharacteristic(this.platform.Characteristic.Name, this.device.displayName);
      this.tempService
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: 0, maxValue: 110 });
    } else {
      const existing = this.accessory.getService(this.platform.Service.TemperatureSensor);
      if (existing) {
        this.accessory.removeService(existing);
      }
    }
  }

  applyState(state: MieleDeviceState): void {
    const programRaw = state.status?.value_raw ?? MieleProgramState.NotConnected;
    const isActive =
      programRaw === MieleProgramState.Running ||
      programRaw === MieleProgramState.Pause ||
      programRaw === MieleProgramState.ProgramSelected ||
      programRaw === MieleProgramState.ProgramProgrammed;
    const isRunning = programRaw === MieleProgramState.Running;

    this.valve.updateCharacteristic(
      this.platform.Characteristic.Active,
      isActive
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE,
    );
    this.valve.updateCharacteristic(
      this.platform.Characteristic.InUse,
      isRunning
        ? this.platform.Characteristic.InUse.IN_USE
        : this.platform.Characteristic.InUse.NOT_IN_USE,
    );

    const remaining = state.remainingTime
      ? state.remainingTime[0] * 3600 + state.remainingTime[1] * 60
      : 0;
    this.valve.updateCharacteristic(
      this.platform.Characteristic.RemainingDuration,
      Math.min(remaining, MAX_REMAINING_SECONDS),
    );

    if (this.tempService) {
      const t = state.targetTemperature?.[0]?.value_raw ?? state.temperature?.[0]?.value_raw;
      // Miele reports centi-degrees for some endpoints; -32768 means "no reading".
      if (t !== undefined && t > -10000) {
        const celsius = Math.abs(t) > 200 ? t / 100 : t;
        this.tempService.updateCharacteristic(
          this.platform.Characteristic.CurrentTemperature,
          Math.max(0, Math.min(110, celsius)),
        );
      }
    }
  }

  private async handleActiveSet(value: CharacteristicValue): Promise<void> {
    const wantActive = value === this.platform.Characteristic.Active.ACTIVE;
    const action = wantActive ? MieleProcessAction.Start : MieleProcessAction.Stop;
    try {
      const allowed = await this.platform.api.getAllowedActions(this.device.serialNumber);
      if (!allowed.processAction?.includes(action)) {
        this.platform.log.info(
          `${this.device.displayName}: ignoring ${wantActive ? "Start" : "Stop"} — ` +
            `Miele reports allowed=${JSON.stringify(allowed.processAction)} in the current state.`,
        );
        return;
      }
      await this.platform.api.putAction(this.device.serialNumber, { processAction: action });
    } catch (err) {
      this.platform.log.error(
        `${this.device.displayName}: action ${wantActive ? "Start" : "Stop"} failed: ${String(err)}`,
      );
    }
  }
}
